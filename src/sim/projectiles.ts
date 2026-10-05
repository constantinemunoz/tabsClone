import { PROJECTILE_VISUALS, type WeaponDef } from '../data/units.ts';
import { DT, EV_PROJ_IMPACT, EV_PROJ_SPAWN, EV_STRIKE, GRAVITY, IMPACT_EXPIRED, IMPACT_TERRAIN, IMPACT_UNIT, S_DEAD, TICK_HZ } from './constants.ts';
import { applyHit } from './combat.ts';
import type { Sim } from './sim.ts';
import { groundHeight, VOID_HEIGHT } from './terrain.ts';

const DEG = Math.PI / 180;
/** Longest step used when testing a projectile's path against the terrain. */
const TERRAIN_STEP = 0.5;

/** Result slot for segment tests (avoids allocating a return object). */
let closestS = 0;

/**
 * Squared distance between segment P0-P1 and the vertical segment from (ax, ay0, az) to
 * (ax, ay1, az). Also sets closestS to the parameter along P0-P1 of the closest point.
 */
function segmentToVertical(
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  ax: number,
  ay0: number,
  ay1: number,
  az: number,
): number {
  // Closest points between two segments (Ericson, Real-Time Collision Detection 5.1.9).
  const d1x = x1 - x0, d1y = y1 - y0, d1z = z1 - z0;
  const d2y = ay1 - ay0;
  const rx = x0 - ax, ry = y0 - ay0, rz = z0 - az;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2y * d2y;
  const f = d2y * ry;
  let s: number;
  let t: number;
  if (a <= 1e-9 && e <= 1e-9) {
    s = 0;
    t = 0;
  } else if (a <= 1e-9) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-9) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1y * d2y;
      const denom = a * e - b * b;
      s = denom > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  closestS = s;
  const px = x0 + d1x * s - ax;
  const py = y0 + d1y * s - (ay0 + d2y * t);
  const pz = z0 + d1z * s - az;
  return px * px + py * py + pz * pz;
}

/**
 * Pooled projectiles in their own typed arrays. Launched on a ballistic arc toward the target
 * (leading it a little) with seeded spread. Each tick the swept segment is tested against the
 * terrain and nearby unit capsules, so fast projectiles can't tunnel through anything.
 */
export class Projectiles {
  readonly capacity: number;
  readonly alive: Uint8Array;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly gravityScale: Float32Array;
  readonly radius: Float32Array;
  readonly damage: Float32Array;
  readonly knockback: Float32Array;
  readonly knockUp: Float32Array;
  readonly areaRadius: Float32Array;
  readonly team: Uint8Array;
  readonly owner: Int32Array;
  readonly ownerType: Uint8Array;
  readonly friendlyFire: Uint8Array;
  readonly lifetime: Int16Array;
  readonly visual: Uint8Array;
  count = 0;
  /** Shots skipped because the pool was full (should stay 0 in practice). */
  dropped = 0;
  private cursor = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    const f = () => new Float32Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.gravityScale = f();
    this.radius = f();
    this.damage = f();
    this.knockback = f();
    this.knockUp = f();
    this.areaRadius = f();
    this.team = new Uint8Array(capacity);
    this.owner = new Int32Array(capacity);
    this.ownerType = new Uint8Array(capacity);
    this.friendlyFire = new Uint8Array(capacity);
    this.lifetime = new Int16Array(capacity);
    this.visual = new Uint8Array(capacity);
  }

  private freeSlot(): number {
    for (let n = 0; n < this.capacity; n++) {
      const k = (this.cursor + n) % this.capacity;
      if (!this.alive[k]) {
        this.cursor = (k + 1) % this.capacity;
        return k;
      }
    }
    return -1;
  }

  /** Launch one projectile from unit i at its current target using weapon wp. */
  fire(sim: Sim, i: number, wp: WeaponDef): void {
    const w = sim.world;
    const pd = wp.projectile;
    const t = w.target[i];
    if (!pd || t < 0 || w.state[t] === S_DEAD) return;
    const k = this.freeSlot();
    if (k < 0) {
      this.dropped++;
      return;
    }
    const fx = Math.sin(w.yaw[i]);
    const fz = Math.cos(w.yaw[i]);
    const lx = w.px[i] + fx * w.radius[i] * 0.8;
    const ly = w.py[i] + w.height[i] * 0.85;
    const lz = w.pz[i] + fz * w.radius[i] * 0.8;
    // Aim at the body's middle, leading a moving target by most of the flight time.
    let tx = w.px[t];
    let tz = w.pz[t];
    const ty = w.py[t] + w.height[t] * 0.5;
    const g = GRAVITY * pd.gravityScale;
    const guessFlight = Math.sqrt((tx - lx) * (tx - lx) + (tz - lz) * (tz - lz)) / (pd.maxSpeed * 0.75);
    tx += w.vx[t] * guessFlight * 0.7;
    tz += w.vz[t] * guessFlight * 0.7;
    const dx = tx - lx;
    const dz = tz - lz;
    const d = Math.max(0.5, Math.sqrt(dx * dx + dz * dz));
    const dy = ty - ly;
    // Fixed elevation, raised when shooting uphill; solve the speed that lands on the target.
    const theta = (pd.launchAngle + Math.max(0, Math.atan2(dy, d) / DEG)) * DEG;
    const cos = Math.cos(theta);
    const denom = 2 * cos * cos * (d * Math.tan(theta) - dy);
    let speed = denom > 1e-3 ? Math.sqrt((g * d * d) / denom) : pd.maxSpeed;
    if (speed > pd.maxSpeed) speed = pd.maxSpeed;
    const yaw = Math.atan2(dx, dz) + sim.rng.gauss() * pd.spread * 0.5 * DEG;
    const elev = theta + sim.rng.gauss() * pd.spread * 0.5 * DEG;
    const ce = Math.cos(elev);
    this.px[k] = lx;
    this.py[k] = ly;
    this.pz[k] = lz;
    this.vx[k] = speed * ce * Math.sin(yaw);
    this.vy[k] = speed * Math.sin(elev);
    this.vz[k] = speed * ce * Math.cos(yaw);
    this.gravityScale[k] = pd.gravityScale;
    this.radius[k] = pd.radius;
    this.damage[k] = wp.damage;
    this.knockback[k] = wp.knockback;
    this.knockUp[k] = wp.knockUp;
    this.areaRadius[k] = wp.areaRadius;
    this.team[k] = w.team[i];
    this.owner[k] = i;
    this.ownerType[k] = w.type[i];
    this.friendlyFire[k] = wp.friendlyFire ? 1 : 0;
    this.lifetime[k] = Math.round(pd.lifetime * TICK_HZ);
    this.visual[k] = PROJECTILE_VISUALS.indexOf(pd.visual);
    this.alive[k] = 1;
    this.count++;
    const inv = 1 / Math.max(1e-4, speed);
    sim.events.push(EV_PROJ_SPAWN, i, lx, ly, lz, speed, this.vx[k] * inv, this.vy[k] * inv, this.vz[k] * inv, this.visual[k]);
    sim.events.push(EV_STRIKE, i, lx, ly, lz, 0, fx, 0, fz, 0);
  }

  /** Move every projectile one tick and resolve hits. */
  update(sim: Sim): void {
    if (this.count === 0) return;
    const w = sim.world;
    const g = sim.grid;
    const terrain = sim.terrain;
    for (let k = 0; k < this.capacity; k++) {
      if (!this.alive[k]) continue;
      const x0 = this.px[k];
      const y0 = this.py[k];
      const z0 = this.pz[k];
      this.vy[k] -= GRAVITY * this.gravityScale[k] * DT;
      const x1 = x0 + this.vx[k] * DT;
      const y1 = y0 + this.vy[k] * DT;
      const z1 = z0 + this.vz[k] * DT;
      const pr = this.radius[k];

      // Units along the swept segment.
      let bestS = 2;
      let bestJ = -1;
      const pad = g.maxRadius + pr + 0.1;
      const cx0 = g.cellX(Math.min(x0, x1) - pad);
      const cx1 = g.cellX(Math.max(x0, x1) + pad);
      const cz0 = g.cellZ(Math.min(z0, z1) - pad);
      const cz1 = g.cellZ(Math.max(z0, z1) + pad);
      const team = this.team[k];
      const ff = this.friendlyFire[k] === 1;
      const owner = this.owner[k];
      for (let gz = cz0; gz <= cz1; gz++) {
        for (let gx = cx0; gx <= cx1; gx++) {
          const c = gz * g.nx + gx;
          const end = g.cellStart[c + 1];
          for (let n = g.cellStart[c]; n < end; n++) {
            const j = g.items[n];
            if (j === owner || w.state[j] === S_DEAD) continue;
            if (!ff && w.team[j] === team) continue;
            const r = w.radius[j];
            const reach = r + pr;
            const d2 = segmentToVertical(x0, y0, z0, x1, y1, z1, w.px[j], w.py[j] + r, w.py[j] + w.height[j] - r, w.pz[j]);
            if (d2 <= reach * reach && closestS < bestS) {
              bestS = closestS;
              bestJ = j;
            }
          }
        }
      }

      // Terrain along the same segment, in short steps.
      let groundS = 2;
      const segLen = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0) + (z1 - z0) * (z1 - z0));
      const steps = Math.max(1, Math.ceil(segLen / TERRAIN_STEP));
      for (let m = 1; m <= steps; m++) {
        const s = m / steps;
        const sx = x0 + (x1 - x0) * s;
        const sz = z0 + (z1 - z0) * s;
        const gh = groundHeight(terrain, sx, sz);
        if (gh !== VOID_HEIGHT && y0 + (y1 - y0) * s <= gh) {
          groundS = s;
          break;
        }
      }

      let hitS = -1;
      let kind = IMPACT_TERRAIN;
      if (bestJ >= 0 && bestS <= groundS) {
        hitS = bestS;
        kind = IMPACT_UNIT;
      } else if (groundS <= 1) {
        hitS = groundS;
      }
      if (hitS >= 0) {
        const hx = x0 + (x1 - x0) * hitS;
        const hy = y0 + (y1 - y0) * hitS;
        const hz = z0 + (z1 - z0) * hitS;
        this.impact(sim, k, kind === IMPACT_UNIT ? bestJ : -1, hx, hy, hz, kind);
        continue;
      }
      this.px[k] = x1;
      this.py[k] = y1;
      this.pz[k] = z1;
      if (--this.lifetime[k] <= 0 || y1 < terrain.killY) this.impact(sim, k, -1, x1, y1, z1, IMPACT_EXPIRED);
    }
  }

  private impact(sim: Sim, k: number, unit: number, x: number, y: number, z: number, kind: number): void {
    const speed = Math.sqrt(this.vx[k] * this.vx[k] + this.vy[k] * this.vy[k] + this.vz[k] * this.vz[k]);
    const inv = 1 / Math.max(1e-4, speed);
    const dx = this.vx[k] * inv;
    const dy = this.vy[k] * inv;
    const dz = this.vz[k] * inv;
    const wp = sim.defs[this.ownerType[k]].weapon;
    if (kind !== IMPACT_EXPIRED && this.areaRadius[k] > 0) {
      this.explode(sim, k, x, y, z, wp);
    } else if (unit >= 0) {
      const kb = this.knockback[k];
      // "From" is a point back along the flight path, so shields facing the shooter block it.
      applyHit(sim, unit, this.damage[k], dx * kb, this.knockUp[k], dz * kb, this.owner[k], x - dx * 3, z - dz * 3, wp);
    }
    sim.events.push(EV_PROJ_IMPACT, unit, x, y, z, kind, dx, dy, dz, this.visual[k]);
    this.alive[k] = 0;
    this.count--;
  }

  /** Area hit: damage and radial knockback that fall off with distance. */
  private explode(sim: Sim, k: number, x: number, y: number, z: number, wp: WeaponDef): void {
    const w = sim.world;
    const g = sim.grid;
    const R = this.areaRadius[k];
    const ff = this.friendlyFire[k] === 1;
    const span = R + g.maxRadius;
    const cx0 = g.cellX(x - span);
    const cx1 = g.cellX(x + span);
    const cz0 = g.cellZ(z - span);
    const cz1 = g.cellZ(z + span);
    for (let gz = cz0; gz <= cz1; gz++) {
      for (let gx = cx0; gx <= cx1; gx++) {
        const c = gz * g.nx + gx;
        const end = g.cellStart[c + 1];
        for (let n = g.cellStart[c]; n < end; n++) {
          const j = g.items[n];
          if (w.state[j] === S_DEAD) continue;
          if (!ff && w.team[j] === this.team[k]) continue;
          // Distance from the blast to the nearest point of the unit's body axis.
          const by = Math.min(Math.max(y, w.py[j]), w.py[j] + w.height[j]);
          let ex = w.px[j] - x;
          const ey = by - y;
          let ez = w.pz[j] - z;
          const dist = Math.max(0, Math.sqrt(ex * ex + ey * ey + ez * ez) - w.radius[j]);
          if (dist >= R) continue;
          const f = 1 - dist / R;
          const hl = Math.sqrt(ex * ex + ez * ez);
          if (hl > 1e-4) {
            ex /= hl;
            ez /= hl;
          } else {
            ex = 0;
            ez = 0;
          }
          const kb = this.knockback[k] * f;
          applyHit(sim, j, this.damage[k] * f, ex * kb, this.knockUp[k] * f, ez * kb, this.owner[k], x, z, wp);
        }
      }
    }
  }
}
