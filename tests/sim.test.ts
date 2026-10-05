import { describe, expect, it } from 'vitest';
import { formation, stressSetup } from '../src/data/army-gen.ts';
import { MAPS } from '../src/data/maps.ts';
import { type UnitDef, UNITS, unitIndex } from '../src/data/units.ts';
import {
  EV_HIT,
  EV_PROJ_SPAWN,
  F_CHARGED,
  F_FELL,
  F_SIDEARM,
  RESULT_BLUE,
  RESULT_RED,
  RESULT_RUNNING,
  S_DEAD,
  S_STRIKE,
  S_TUMBLING,
  STRIKE_TICKS,
  TICK_HZ,
} from '../src/sim/constants.ts';
import { chooseWeapon, resolveAttacks, updateShieldWalls } from '../src/sim/combat.ts';
import { EVENT_STRIDE } from '../src/sim/events.ts';
import { groundHeight } from '../src/sim/terrain.ts';
import { type BattleSetup, Sim } from '../src/sim/sim.ts';

function runToEnd(sim: Sim, maxTicks = 30 * 240): void {
  while (sim.result === RESULT_RUNNING && sim.tick < maxTicks) sim.step();
}

/** Every typed array of the world, concatenated as bytes. */
function worldBytes(sim: Sim): Uint8Array[] {
  const w = sim.world as unknown as Record<string, unknown>;
  const out: Uint8Array[] = [];
  for (const k of Object.keys(w).sort()) {
    const v = w[k];
    if (ArrayBuffer.isView(v)) out.push(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  }
  return out;
}

describe('determinism', () => {
  it('the same armies and seed give an identical final state', () => {
    const setup = stressSetup(60, 'meadow', 777);
    const a = new Sim(setup);
    const b = new Sim(structuredClone(setup));
    runToEnd(a);
    runToEnd(b);
    expect(a.result).not.toBe(RESULT_RUNNING);
    expect(b.tick).toBe(a.tick);
    expect(b.result).toBe(a.result);
    const wa = worldBytes(a);
    const wb = worldBytes(b);
    expect(wa.length).toBeGreaterThan(10);
    for (let k = 0; k < wa.length; k++) expect(Buffer.compare(wa[k], wb[k])).toBe(0);
  });

  it('a different seed plays out differently', () => {
    const a = new Sim(stressSetup(40, 'meadow', 1));
    const b = new Sim(stressSetup(40, 'meadow', 2));
    for (let k = 0; k < 600; k++) {
      a.step();
      b.step();
    }
    const wa = worldBytes(a);
    const wb = worldBytes(b);
    let same = true;
    for (let k = 0; k < wa.length; k++) if (Buffer.compare(wa[k], wb[k]) !== 0) same = false;
    expect(same).toBe(false);
  });
});

describe('spatial grid', () => {
  it('contains exactly the living units, each in the cell of its position', () => {
    const sim = new Sim(stressSetup(80, 'meadow', 5));
    for (let k = 0; k < 200; k++) sim.step();
    const g = sim.grid;
    g.rebuild(sim.world);
    const w = sim.world;
    const seen = new Set<number>();
    for (let c = 0; c < g.nx * g.nz; c++) {
      for (let k = g.cellStart[c]; k < g.cellStart[c + 1]; k++) {
        const i = g.items[k];
        expect(seen.has(i)).toBe(false);
        seen.add(i);
        expect(g.cellZ(w.pz[i]) * g.nx + g.cellX(w.px[i])).toBe(c);
      }
    }
    let alive = 0;
    for (let i = 0; i < w.count; i++) if (w.state[i] !== S_DEAD) alive++;
    expect(seen.size).toBe(alive);
  });
});

/** Two units facing each other on flat-ish ground, blue at x=0 facing +x. */
function duel(blueType: string, redType: string, redX: number, redZ = 0): Sim {
  const setup: BattleSetup = {
    mapId: 'meadow',
    seed: 3,
    units: [
      { type: unitIndex(blueType), team: 0, x: 0, z: 0 },
      { type: unitIndex(redType), team: 1, x: redX, z: redZ },
    ],
  };
  return new Sim(setup);
}

/** Force unit i to strike right now (with its main weapon, or sidearm if sel = 1) and resolve it. */
function forceStrike(sim: Sim, i: number, sel = 0): void {
  sim.grid.rebuild(sim.world);
  updateShieldWalls(sim);
  sim.world.weaponSel[i] = sel;
  sim.world.state[i] = S_STRIKE;
  sim.world.stateTimer[i] = STRIKE_TICKS;
  resolveAttacks(sim);
}

function lost(sim: Sim, i: number): number {
  return sim.world.maxHealth[i] - sim.world.health[i];
}

/** A copy of the roster where everything except the listed unit ids stands still. */
function frozenExcept(...ids: string[]): UnitDef[] {
  return UNITS.map((d) => (ids.includes(d.id) ? d : { ...d, speed: 0, turnRate: 0 }));
}

describe('melee', () => {
  it('hits a target in front and within range', () => {
    const sim = duel('hoplite', 'hoplite', 2.5);
    forceStrike(sim, 0);
    expect(lost(sim, 1)).toBeGreaterThan(0);
  });

  it('misses a target that is out of range at the strike tick', () => {
    const sim = duel('hoplite', 'hoplite', 3.6);
    forceStrike(sim, 0);
    expect(lost(sim, 1)).toBe(0);
  });

  it('misses a target behind the attacker', () => {
    const sim = duel('hoplite', 'hoplite', -2.5);
    forceStrike(sim, 0);
    expect(lost(sim, 1)).toBe(0);
  });

  it('a spear reaches further than a short sword', () => {
    const spear = duel('spartan', 'skirmisher', 2.6);
    const sword = duel('spartan', 'skirmisher', 2.6);
    forceStrike(spear, 0, 0);
    forceStrike(sword, 0, 1);
    expect(lost(spear, 1)).toBeGreaterThan(0);
    expect(lost(sword, 1)).toBe(0);
  });

  it('a shield takes reduced damage from the front', () => {
    const front = duel('hoplite', 'marine', 1.4);
    const back = duel('hoplite', 'marine', -1.4);
    // The marine faces the hoplite in both cases and uses its sword.
    front.world.yaw[1] = -Math.PI / 2;
    back.world.yaw[1] = Math.PI / 2;
    forceStrike(front, 1, 1);
    forceStrike(back, 1, 1);
    expect(lost(front, 0)).toBeGreaterThan(0);
    expect(lost(front, 0)).toBeLessThan(lost(back, 0) * 0.6);
  });
});

describe('unit specials', () => {
  it('hoplites standing in a line take less damage (shield wall); a column does not count', () => {
    const hit = (allies: [number, number][]) => {
      const sim = new Sim({
        mapId: 'meadow',
        seed: 5,
        units: [
          { type: unitIndex('hoplite'), team: 0, x: 0, z: 0 },
          { type: unitIndex('marine'), team: 1, x: -1.4, z: 0 },
          ...allies.map(([x, z]) => ({ type: unitIndex('hoplite'), team: 0, x, z })),
        ],
      });
      // Attacked from behind so the shield itself doesn't matter, only the wall.
      sim.world.yaw[1] = Math.PI / 2;
      forceStrike(sim, 1, 1);
      return { lost: lost(sim, 0), wall: sim.world.wallCount[0] };
    };
    const alone = hit([]);
    const line = hit([[0, 1.2], [0, -1.2], [0, 2.2]]);
    const column = hit([[1.2, 0], [2.4, 0]]);
    expect(alone.wall).toBe(0);
    expect(line.wall).toBe(3);
    expect(column.wall).toBe(0);
    expect(line.lost).toBeLessThan(alone.lost * 0.75);
  });

  it('sling bullets hurt heavy armour far more than unarmoured targets', () => {
    const shoot = (targetId: string) => {
      const sim = new Sim(
        {
          mapId: 'meadow',
          seed: 8,
          units: [
            { type: unitIndex('slinger'), team: 0, x: 0, z: 0 },
            { type: unitIndex(targetId), team: 1, x: 15, z: 0 },
          ],
        },
        frozenExcept('slinger'),
      );
      // Turn the target away so its shield plays no part.
      sim.world.yaw[1] = Math.PI / 2;
      for (let k = 0; k < 30 * 6; k++) {
        sim.step();
        sim.world.yaw[1] = Math.PI / 2;
      }
      return sim.world.damageDealt[0];
    };
    const vsHeavy = shoot('hoplite');
    const vsNone = shoot('skirmisher');
    expect(vsNone).toBeGreaterThan(0);
    expect(vsHeavy).toBeGreaterThan(vsNone * 1.8);
  });

  it('peltasts throw their javelins, then draw a sword and close in', () => {
    const sim = new Sim(
      { mapId: 'meadow', seed: 4, units: [{ type: unitIndex('peltast'), team: 0, x: 0, z: 0 }, { type: unitIndex('hoplite'), team: 1, x: 16, z: 0 }] },
      frozenExcept('peltast'),
    );
    const ammo = sim.world.ammo[0];
    expect(ammo === 2 || ammo === 3).toBe(true);
    let thrown = 0;
    let meleeHits = 0;
    for (let k = 0; k < 30 * 25; k++) {
      sim.step();
      for (let e = 0; e < sim.events.count; e++) {
        const o = e * EVENT_STRIDE;
        if (sim.events.data[o] === EV_PROJ_SPAWN && sim.events.data[o + 1] === 0) thrown++;
        if (sim.events.data[o] === EV_HIT && sim.events.data[o + 1] === 1 && sim.world.weaponSel[0] === 1) meleeHits++;
      }
    }
    expect(thrown).toBe(ammo);
    expect(sim.world.ammo[0]).toBe(0);
    expect(sim.world.flags[0] & F_SIDEARM).toBe(F_SIDEARM);
    expect(meleeHits).toBeGreaterThan(0);
  });

  it('a spartan draws its sword when the enemy is too close for the spear', () => {
    const sim = duel('spartan', 'hoplite', 1.3);
    const surface = 1.3 - sim.world.radius[0] - sim.world.radius[1];
    expect(chooseWeapon(sim, 0, surface)).toBe(1);
    expect(chooseWeapon(sim, 0, 1.5)).toBe(0);
  });

  it('a horseman hits far harder after a run-up than in a standing melee', () => {
    const charge = duel('horseman', 'hoplite', 2.4);
    charge.world.yaw[1] = Math.PI / 2;
    charge.world.flags[0] |= F_CHARGED;
    forceStrike(charge, 0);
    const standing = duel('horseman', 'hoplite', 2.4);
    standing.world.yaw[1] = Math.PI / 2;
    forceStrike(standing, 0);
    expect(lost(charge, 1)).toBeGreaterThan(lost(standing, 1) * 3);
    expect(charge.world.state[1]).toBe(S_TUMBLING);
  });

  it('horsemen ride around the flank instead of straight at the enemy line', () => {
    const sim = new Sim(
      { mapId: 'meadow', seed: 2, units: [{ type: unitIndex('horseman'), team: 0, x: -45, z: 6 }, { type: unitIndex('archer'), team: 1, x: 40, z: 0 }] },
      frozenExcept('horseman'),
    );
    let maxZ = 0;
    for (let k = 0; k < 30 * 6; k++) {
      sim.step();
      maxZ = Math.max(maxZ, sim.world.pz[0]);
    }
    // A straight ride would drift toward z = 0; the flanker swings out wide instead.
    expect(maxZ).toBeGreaterThan(12);
  });
});

describe('projectiles', () => {
  it('archers hit a distant target, and finished projectiles return to the pool', () => {
    const sim = new Sim(
      { mapId: 'meadow', seed: 12, units: [{ type: unitIndex('archer'), team: 0, x: -20, z: 0 }, { type: unitIndex('hoplite'), team: 1, x: 18, z: 0 }] },
      frozenExcept('archer'),
    );
    for (let k = 0; k < 30 * 12; k++) sim.step();
    expect(sim.world.damageDealt[0]).toBeGreaterThan(0);
    let live = 0;
    for (let k = 0; k < sim.projectiles.capacity; k++) live += sim.projectiles.alive[k];
    expect(live).toBe(sim.projectiles.count);
    expect(live).toBeLessThan(3);
  });

  it('a very fast projectile cannot tunnel through a body in one tick', () => {
    const sim = duel('archer', 'hoplite', 6);
    const p = sim.projectiles;
    sim.grid.rebuild(sim.world);
    // 300 m/s covers 10 m in one tick, starting 3 m in front of the target.
    p.alive[0] = 1;
    p.count = 1;
    p.px[0] = 3;
    p.py[0] = sim.world.py[1] + 1;
    p.pz[0] = 0;
    p.vx[0] = 300;
    p.vy[0] = 0;
    p.vz[0] = 0;
    p.gravityScale[0] = 0;
    p.radius[0] = 0.05;
    p.damage[0] = 10;
    p.knockback[0] = 0;
    p.knockUp[0] = 0;
    p.areaRadius[0] = 0;
    p.team[0] = 0;
    p.owner[0] = 0;
    p.ownerType[0] = unitIndex('archer');
    p.lifetime[0] = 10;
    p.update(sim);
    expect(lost(sim, 1)).toBeGreaterThan(0);
    expect(p.count).toBe(0);
  });

  it('area hits damage with falloff, and friendly fire hits allies only when the weapon allows it', () => {
    const make = (ff: boolean) => {
      const bomber: UnitDef = {
        ...UNITS[unitIndex('skirmisher')],
        id: 'bomber',
        speed: 0,
        weapon: { ...UNITS[unitIndex('skirmisher')].weapon, areaRadius: 4, friendlyFire: ff, damage: 40 },
      };
      const defs = [...frozenExcept(), bomber];
      const sim = new Sim(
        {
          mapId: 'meadow',
          seed: 1,
          units: [
            { type: defs.length - 1, team: 0, x: 0, z: 0 },
            { type: unitIndex('skirmisher'), team: 1, x: 12, z: 0 },
            { type: unitIndex('skirmisher'), team: 1, x: 14.5, z: 0 },
            { type: unitIndex('skirmisher'), team: 0, x: 12, z: 1.5 },
          ],
        },
        defs,
      );
      for (let k = 0; k < 30 * 4; k++) sim.step();
      return sim;
    };
    const ff = make(true);
    const safe = make(false);
    expect(lost(ff, 1)).toBeGreaterThan(0);
    expect(lost(ff, 2)).toBeGreaterThan(0);
    expect(lost(ff, 3)).toBeGreaterThan(0);
    expect(lost(safe, 3)).toBe(0);
  });
});

describe('terrain and flight', () => {
  it('a flyer hovers above the ground and is out of a spear’s reach, but not an archer’s', () => {
    const flyer: UnitDef = { ...UNITS[unitIndex('skirmisher')], id: 'flyer', flying: true, hoverHeight: 5, speed: 0 };
    const defs = [...UNITS, flyer];
    const sim = new Sim(
      {
        mapId: 'meadow',
        seed: 1,
        units: [
          { type: defs.length - 1, team: 0, x: 0, z: 0 },
          { type: unitIndex('hoplite'), team: 1, x: 3, z: 0 },
          { type: unitIndex('archer'), team: 1, x: 20, z: 0 },
        ],
      },
      defs,
    );
    for (let k = 0; k < 60; k++) sim.step();
    const ground = groundHeight(sim.terrain, sim.world.px[0], sim.world.pz[0]);
    expect(sim.world.py[0] - ground).toBeGreaterThan(4);
    expect(sim.world.target[1]).toBe(-1);
    expect(sim.world.target[2]).toBe(0);
  });

  it('units knocked off the sky island fall to their death', () => {
    const sim = new Sim({ mapId: 'island', seed: 1, units: [{ type: unitIndex('skirmisher'), team: 0, x: 0, z: 20 }, { type: unitIndex('hoplite'), team: 1, x: 40, z: 0 }] }, frozenExcept());
    sim.world.vz[0] = 14;
    sim.world.vy[0] = 3;
    for (let k = 0; k < 30 * 6; k++) sim.step();
    expect(sim.world.state[0]).toBe(S_DEAD);
    expect(sim.world.flags[0] & F_FELL).toBe(F_FELL);
  });

  it('a unit in the canyon cannot walk straight up the cliff to reach the plateau', () => {
    const sim = new Sim(
      { mapId: 'plateaus', seed: 1, units: [{ type: unitIndex('hoplite'), team: 0, x: 0, z: 0 }, { type: unitIndex('skirmisher'), team: 1, x: -30, z: 0 }] },
      frozenExcept('hoplite'),
    );
    for (let k = 0; k < 30 * 15; k++) sim.step();
    expect(sim.world.px[0]).toBeGreaterThan(-16);
    expect(sim.world.py[0]).toBeLessThan(3);
  });
});

describe('every unit on every map', () => {
  for (const map of MAPS) {
    it(`${map.id}: each unit type moves, attacks and deals damage`, () => {
      for (let t = 0; t < UNITS.length; t++) {
        const sim = new Sim({
          mapId: map.id,
          seed: 100 + t,
          units: [
            ...formation([{ type: t, count: 6 }], 0, map.zones.blue).map((u) => ({ ...u, x: u.x + 10 })),
            ...formation([{ type: unitIndex('hoplite'), count: 3 }, { type: unitIndex('archer'), count: 3 }], 1, map.zones.red).map((u) => ({ ...u, x: u.x - 10 })),
          ],
        });
        for (let k = 0; k < 30 * 40 && sim.result === RESULT_RUNNING; k++) sim.step();
        let dealt = 0;
        for (let i = 0; i < 6; i++) {
          dealt += sim.world.damageDealt[i];
          expect(Number.isFinite(sim.world.px[i]) && Number.isFinite(sim.world.py[i])).toBe(true);
        }
        expect(dealt, `${UNITS[t].id} on ${map.id}`).toBeGreaterThan(0);
      }
    });
  }
});

describe('battle flow', () => {
  it('a battle ends with the stronger army winning', () => {
    const setup: BattleSetup = {
      mapId: 'meadow',
      seed: 11,
      units: [
        ...Array.from({ length: 12 }, (_, k) => ({ type: unitIndex('hoplite'), team: 0, x: -20, z: k * 2 - 12 })),
        ...Array.from({ length: 3 }, (_, k) => ({ type: unitIndex('skirmisher'), team: 1, x: 20, z: k * 2 - 2 })),
      ],
    };
    const sim = new Sim(setup);
    runToEnd(sim);
    expect(sim.result).toBe(RESULT_BLUE);
    expect(sim.alive[1]).toBe(0);
  });

  it('ends a battle nobody can win after 20 seconds without damage, by remaining cost', () => {
    const setup: BattleSetup = {
      mapId: 'meadow',
      seed: 1,
      units: [
        { type: unitIndex('hoplite'), team: 0, x: -10, z: 0 },
        { type: unitIndex('spartan'), team: 1, x: 10, z: 0 },
      ],
    };
    // Both armies frozen in place, so they never meet.
    const sim = new Sim(setup, frozenExcept());
    let ticks = 0;
    while (sim.result === RESULT_RUNNING && ticks < 30 * 30) {
      sim.step();
      ticks++;
    }
    expect(sim.result).toBe(RESULT_RED);
    expect(ticks).toBeGreaterThanOrEqual(20 * TICK_HZ);
    expect(ticks).toBeLessThan(21 * TICK_HZ);
  });

  it('150 against 150 fights to a finish', () => {
    const sim = new Sim(stressSetup(150, 'meadow', 2024));
    runToEnd(sim, 30 * 300);
    expect(sim.result).not.toBe(RESULT_RUNNING);
  });
});
