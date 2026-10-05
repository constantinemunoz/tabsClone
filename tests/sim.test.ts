import { describe, expect, it } from 'vitest';
import { stressSetup } from '../src/data/army-gen.ts';
import { UNITS, unitIndex } from '../src/data/units.ts';
import {
  RESULT_BLUE,
  RESULT_RED,
  RESULT_RUNNING,
  S_DEAD,
  S_STRIKE,
  S_TUMBLING,
  STRIKE_TICKS,
  TICK_HZ,
} from '../src/sim/constants.ts';
import { resolveAttacks } from '../src/sim/combat.ts';
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

/** Force unit i to strike right now and resolve it. */
function forceStrike(sim: Sim, i: number): void {
  sim.grid.rebuild(sim.world);
  sim.world.state[i] = S_STRIKE;
  sim.world.stateTimer[i] = STRIKE_TICKS;
  resolveAttacks(sim);
}

describe('melee', () => {
  it('hits a target in front and within range', () => {
    const sim = duel('scrapper', 'scrapper', 1.3);
    const hp = sim.world.health[1];
    forceStrike(sim, 0);
    expect(sim.world.health[1]).toBeLessThan(hp);
  });

  it('misses a target that is out of range at the strike tick', () => {
    const sim = duel('scrapper', 'scrapper', 3.0);
    const hp = sim.world.health[1];
    forceStrike(sim, 0);
    expect(sim.world.health[1]).toBe(hp);
  });

  it('misses a target behind the attacker', () => {
    const sim = duel('scrapper', 'scrapper', -1.3);
    const hp = sim.world.health[1];
    forceStrike(sim, 0);
    expect(sim.world.health[1]).toBe(hp);
  });

  it('a spear reaches further than a club', () => {
    const sim = duel('pikeling', 'scrapper', 3.0);
    const hp = sim.world.health[1];
    forceStrike(sim, 0);
    expect(sim.world.health[1]).toBeLessThan(hp);
  });

  it('a giant sweep launches several light units, and small hits cannot make the giant tumble', () => {
    const setup: BattleSetup = {
      mapId: 'meadow',
      seed: 9,
      units: [
        { type: unitIndex('biglump'), team: 0, x: 0, z: 0 },
        { type: unitIndex('pikeling'), team: 1, x: 2.6, z: -1.2 },
        { type: unitIndex('pikeling'), team: 1, x: 2.8, z: 0 },
        { type: unitIndex('pikeling'), team: 1, x: 2.6, z: 1.2 },
      ],
    };
    const sim = new Sim(setup);
    forceStrike(sim, 0);
    let tumbling = 0;
    for (let i = 1; i < 4; i++) if (sim.world.state[i] === S_TUMBLING) tumbling++;
    expect(tumbling).toBe(3);
    // Now the pikelings hit back.
    for (let i = 1; i < 4; i++) {
      sim.world.yaw[i] = -Math.PI / 2;
      sim.world.px[i] = 2.3;
      forceStrike(sim, i);
    }
    expect(sim.world.state[0]).not.toBe(S_TUMBLING);
  });

  it('a shield takes reduced damage from the front', () => {
    const front = duel('bulwark', 'scrapper', 1.5);
    const back = duel('bulwark', 'scrapper', -1.5);
    // Red attacker faces the bulwark in both cases.
    front.world.yaw[1] = -Math.PI / 2;
    back.world.yaw[1] = Math.PI / 2;
    forceStrike(front, 1);
    forceStrike(back, 1);
    const lostFront = front.world.maxHealth[0] - front.world.health[0];
    const lostBack = back.world.maxHealth[0] - back.world.health[0];
    expect(lostFront).toBeGreaterThan(0);
    expect(lostFront).toBeLessThan(lostBack * 0.5);
  });
});

describe('battle flow', () => {
  it('a battle ends with the stronger army winning', () => {
    const setup: BattleSetup = {
      mapId: 'meadow',
      seed: 11,
      units: [
        ...Array.from({ length: 12 }, (_, k) => ({ type: unitIndex('pikeling'), team: 0, x: -20, z: k * 2 - 12 })),
        ...Array.from({ length: 3 }, (_, k) => ({ type: unitIndex('scrapper'), team: 1, x: 20, z: k * 2 - 2 })),
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
        { type: unitIndex('scrapper'), team: 0, x: -10, z: 0 },
        { type: unitIndex('biglump'), team: 1, x: 10, z: 0 },
      ],
    };
    // Both armies frozen in place, so they never meet.
    const sim = new Sim(setup, UNITS.map((d) => ({ ...d, speed: 0 })));
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
