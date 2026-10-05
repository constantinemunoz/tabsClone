import { describe, expect, it } from 'vitest';
import { stressSetup } from '../src/data/army-gen.ts';
import { unitIndex } from '../src/data/units.ts';
import { Placement } from '../src/game/placement.ts';
import { decodeSetup, encodeSetup } from '../src/platform/share.ts';

describe('share codes', () => {
  it('round-trip a full setup exactly, using only URL-safe characters', () => {
    const setup = stressSetup(150, 'plateaus', 3_000_000_123);
    const code = encodeSetup(setup);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSetup(code)).toEqual(setup);
    expect(decodeSetup('#' + code)).toEqual(setup);
  });

  it('reject malformed or unknown codes instead of throwing', () => {
    expect(decodeSetup('')).toBeNull();
    expect(decodeSetup('not a code!')).toBeNull();
    expect(decodeSetup('AAAA')).toBeNull();
    const code = encodeSetup({ mapId: 'meadow', seed: 1, units: [{ type: 0, team: 1, x: 20, z: 3 }] });
    expect(decodeSetup(code.slice(0, -2))).toBeNull();
    // A different version byte.
    const b64 = code.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((code.length + 3) % 4);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    bytes[0] = 99;
    const other = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(decodeSetup(other)).toBeNull();
  });
});

describe('placement', () => {
  const hop = unitIndex('hoplite');
  const horse = unitIndex('horseman');

  it('snaps to the 1 m grid and keeps units inside their own zone', () => {
    const p = new Placement('meadow');
    expect(p.place(hop, 0, -30.4, 2.6, 400)).toBe(true);
    expect(p.units[0]).toEqual({ type: hop, team: 0, x: -30, z: 3 });
    expect(p.check(hop, 0, 30, 0, 400)).toBe('outside');
    expect(p.check(hop, 1, 30, 0, 400)).toBe('ok');
  });

  it('refuses overlapping units but allows neighbours one metre apart', () => {
    const p = new Placement('meadow');
    p.place(hop, 0, -30, 0, 400);
    expect(p.check(hop, 0, -30, 0, 400)).toBe('blocked');
    expect(p.check(hop, 0, -29, 0, 400)).toBe('ok');
    expect(p.check(horse, 0, -29, 0, 400)).toBe('blocked');
  });

  it('enforces the per-side budget and the unit cap', () => {
    const p = new Placement('meadow');
    p.budget = 100;
    expect(p.place(hop, 0, -30, 0, 400)).toBe(true);
    expect(p.place(hop, 0, -30, 2, 400)).toBe(true);
    expect(p.check(hop, 0, -30, 4, 400)).toBe('budget');
    // The other side has its own budget.
    expect(p.check(hop, 1, 30, 0, 400)).toBe('ok');
    expect(p.check(hop, 1, 30, 0, 2)).toBe('cap');
    expect(p.remaining(0)).toBe(10);
  });

  it('removes the nearest unit, clears a side, and mirrors an army', () => {
    const p = new Placement('meadow');
    p.place(hop, 0, -30, 0, 400);
    p.place(hop, 0, -30, 5, 400);
    p.place(hop, 1, 30, 0, 400);
    expect(p.removeNear(-29.6, 4.7)).toBe(true);
    expect(p.count(0)).toBe(1);
    p.mirror(0);
    expect(p.units.filter((u) => u.team === 1)).toEqual([{ type: hop, team: 1, x: 30, z: 0 }]);
    p.clear(0);
    expect(p.count(0)).toBe(0);
    expect(p.count(1)).toBe(1);
  });
});
