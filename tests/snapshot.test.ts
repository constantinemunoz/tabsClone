import { describe, expect, it } from 'vitest';
import { stressSetup } from '../src/data/army-gen.ts';
import { lerpAngle } from '../src/game/sim-client.ts';
import { EVENT_STRIDE } from '../src/sim/events.ts';
import { EVENT_CAPACITY, PROJECTILE_CAPACITY, Sim } from '../src/sim/sim.ts';
import {
  eventsOffset,
  H_EVENTS,
  H_TICK,
  H_UNITS,
  HEADER_FLOATS,
  snapshotFloats,
  U_STATE,
  U_X,
  U_Z,
  UNIT_STRIDE,
  writeSnapshot,
} from '../src/sim/snapshot.ts';

describe('snapshot', () => {
  it('carries unit positions, states and the tick events', () => {
    const sim = new Sim(stressSetup(30, 'meadow', 1));
    const out = new Float32Array(snapshotFloats(sim.world.capacity, PROJECTILE_CAPACITY, EVENT_CAPACITY));
    let sawEvents = false;
    for (let k = 0; k < 400; k++) {
      sim.step();
      writeSnapshot(sim, out, 0, 0);
      expect(out[H_TICK]).toBe(sim.tick);
      expect(out[H_UNITS]).toBe(sim.world.count);
      for (const i of [0, 7, 59]) {
        const o = HEADER_FLOATS + i * UNIT_STRIDE;
        expect(out[o + U_X]).toBe(sim.world.px[i]);
        expect(out[o + U_Z]).toBe(sim.world.pz[i]);
        expect(out[o + U_STATE]).toBe(sim.world.state[i]);
      }
      const n = out[H_EVENTS];
      expect(n).toBe(sim.events.count);
      if (n > 0) {
        sawEvents = true;
        const eo = eventsOffset(sim.world.capacity, PROJECTILE_CAPACITY);
        for (let f = 0; f < n * EVENT_STRIDE; f++) expect(out[eo + f]).toBe(sim.events.data[f]);
      }
    }
    expect(sawEvents).toBe(true);
  });
});

describe('interpolation', () => {
  it('interpolates yaw along the shortest arc', () => {
    expect(lerpAngle(0, 1, 0.5)).toBeCloseTo(0.5);
    // From just below +PI to just above -PI is a short step across the seam, not a full turn.
    const a = Math.PI - 0.1;
    const b = -Math.PI + 0.1;
    const mid = lerpAngle(a, b, 0.5);
    expect(Math.abs(Math.cos(mid) - Math.cos(Math.PI))).toBeLessThan(1e-6);
    expect(Math.abs(lerpAngle(a, b, 1) - a)).toBeCloseTo(0.2);
  });
});
