import { getMap } from '../data/maps.ts';
import { canTargetAir, type UnitDef, UNITS } from '../data/units.ts';
import { resolveAttacks, updateStates } from './combat.ts';
import {
  EV_DEATH,
  F_FELL,
  F_FLYING,
  FLYER_REFERENCE_HOVER,
  GRID_CELL,
  RESULT_BLUE,
  RESULT_DRAW,
  RESULT_RED,
  RESULT_RUNNING,
  S_DEAD,
  S_IDLE,
  STALEMATE_TICKS,
} from './constants.ts';
import { EventBuffer } from './events.ts';
import { SpatialGrid } from './grid.ts';
import { integrate, separate } from './movement.ts';
import { Projectiles } from './projectiles.ts';
import { Rng } from './rng.ts';
import { createTerrain, groundHeight, type Terrain, VOID_HEIGHT } from './terrain.ts';
import { World } from './world.ts';

export interface PlacedUnit {
  /** Index into the unit definition table. */
  type: number;
  team: number;
  x: number;
  z: number;
}

/** Everything needed to reproduce a battle: same setup + same seed = same battle. */
export interface BattleSetup {
  mapId: string;
  seed: number;
  units: PlacedUnit[];
}

export const EVENT_CAPACITY = 768;
export const PROJECTILE_CAPACITY = 512;

/**
 * The pure simulation. No Three.js, DOM or browser APIs: it runs unchanged in the Web Worker
 * and in Node for tests and benchmarks. Deterministic: seeded RNG, slot-order iteration, no clock.
 */
export class Sim {
  readonly defs: UnitDef[];
  readonly world: World;
  readonly terrain: Terrain;
  readonly grid: SpatialGrid;
  readonly rng: Rng;
  readonly events: EventBuffer;
  readonly projectiles: Projectiles;
  /** Per unit type: can this unit's weapon reach a hovering flyer? */
  readonly canAir: Uint8Array;
  /** Domain bounds units are kept inside on maps without void. */
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;

  tick = 0;
  lastDamageTick = 0;
  result = RESULT_RUNNING;
  readonly alive = new Int32Array(2);
  readonly aliveCost = new Float64Array(2);
  /** Unit that died last (for the final-kill camera). */
  lastDeath = -1;

  // Scratch buffers reused every tick so the hot path allocates nothing.
  readonly candIdx = new Int32Array(128);
  readonly candDist = new Float32Array(128);
  readonly dir = new Float32Array(2);
  readonly preSepX: Float32Array;
  readonly preSepZ: Float32Array;

  constructor(setup: BattleSetup, defs: UnitDef[] = UNITS, capacity = setup.units.length) {
    this.defs = defs;
    const map = getMap(setup.mapId);
    this.terrain = createTerrain(map);
    const t = this.terrain;
    this.minX = t.x0;
    this.minZ = t.z0;
    this.maxX = t.x0 + (t.nx - 1) * t.cell;
    this.maxZ = t.z0 + (t.nz - 1) * t.cell;
    const cap = Math.max(1, capacity);
    this.world = new World(cap);
    this.grid = new SpatialGrid(this.minX, this.minZ, this.maxX - this.minX, this.maxZ - this.minZ, GRID_CELL, cap);
    this.rng = new Rng(setup.seed);
    this.events = new EventBuffer(EVENT_CAPACITY);
    this.projectiles = new Projectiles(PROJECTILE_CAPACITY);
    this.canAir = new Uint8Array(defs.length);
    for (let k = 0; k < defs.length; k++) this.canAir[k] = canTargetAir(defs[k], FLYER_REFERENCE_HOVER) ? 1 : 0;
    this.preSepX = new Float32Array(cap);
    this.preSepZ = new Float32Array(cap);

    for (let k = 0; k < setup.units.length && k < cap; k++) this.spawn(setup.units[k]);
    this.countAlive();
  }

  private spawn(u: PlacedUnit): void {
    const w = this.world;
    const i = w.count++;
    const d = this.defs[u.type];
    w.type[i] = u.type;
    w.team[i] = u.team;
    w.px[i] = u.x;
    w.pz[i] = u.z;
    let g = groundHeight(this.terrain, u.x, u.z);
    if (g === VOID_HEIGHT) g = this.terrain.minHeight;
    w.py[i] = g + (d.flying ? d.hoverHeight : 0);
    w.hoverY[i] = w.py[i];
    // Blue faces +x (towards red), red faces -x.
    w.yaw[i] = u.team === 0 ? Math.PI / 2 : -Math.PI / 2;
    w.radius[i] = d.radius;
    w.height[i] = d.height;
    w.mass[i] = d.mass;
    w.health[i] = d.health;
    w.maxHealth[i] = d.health;
    w.state[i] = S_IDLE;
    w.flags[i] = d.flying ? F_FLYING : 0;
    w.target[i] = -1;
    // Small random delay before the first swing so a crowd never attacks in lockstep.
    w.attackCooldown[i] = this.rng.int(12);
  }

  /** Advance the battle by one fixed tick. */
  step(): void {
    this.events.clear();
    // 1. Spatial hash.
    this.grid.rebuild(this.world);
    // 2 + 3. Targeting and the per-unit state machine (steering included).
    updateStates(this);
    // 4. Movement, terrain following, falling, kill plane.
    integrate(this);
    // 5. Push overlapping capsules apart.
    separate(this);
    // 6. Attacks and projectiles.
    resolveAttacks(this);
    // 7. Deaths, then the win check.
    this.markDeaths();
    this.checkResult();
    this.tick++;
  }

  private markDeaths(): void {
    const w = this.world;
    for (let i = 0; i < w.count; i++) {
      if (w.state[i] === S_DEAD || w.health[i] > 0) continue;
      w.state[i] = S_DEAD;
      w.target[i] = -1;
      this.lastDeath = i;
      const imp = Math.hypot(w.lastImpX[i], w.lastImpY[i], w.lastImpZ[i]);
      this.events.push(
        EV_DEATH,
        i,
        w.px[i],
        w.py[i],
        w.pz[i],
        imp,
        w.vx[i],
        w.vy[i],
        w.vz[i],
        w.flags[i] & F_FELL ? 1 : 0,
      );
    }
  }

  countAlive(): void {
    const w = this.world;
    this.alive[0] = this.alive[1] = 0;
    this.aliveCost[0] = this.aliveCost[1] = 0;
    for (let i = 0; i < w.count; i++) {
      if (w.state[i] === S_DEAD) continue;
      const tm = w.team[i];
      this.alive[tm]++;
      this.aliveCost[tm] += this.defs[w.type[i]].cost;
    }
  }

  private checkResult(): void {
    this.countAlive();
    if (this.result !== RESULT_RUNNING) return;
    const b = this.alive[0];
    const r = this.alive[1];
    if (b === 0 || r === 0) {
      this.result = b === 0 && r === 0 ? RESULT_DRAW : b === 0 ? RESULT_RED : RESULT_BLUE;
      return;
    }
    if (this.tick - this.lastDamageTick > STALEMATE_TICKS) {
      const cb = this.aliveCost[0];
      const cr = this.aliveCost[1];
      this.result = cb > cr ? RESULT_BLUE : cr > cb ? RESULT_RED : RESULT_DRAW;
    }
  }
}
