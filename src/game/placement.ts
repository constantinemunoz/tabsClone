import { unitSpacing } from '../data/army-gen.ts';
import { getMap, type Rect } from '../data/maps.ts';
import { UNITS } from '../data/units.ts';
import type { BattleSetup, PlacedUnit } from '../sim/sim.ts';

export type PlaceCheck = 'ok' | 'outside' | 'blocked' | 'budget' | 'cap';

/** Per-side budgets offered in the sandbox (0 = unlimited). */
export const BUDGET_OPTIONS = [0, 300, 600, 1000, 1500, 2500];

/**
 * The armies being set up before a battle: pure data and rules, no rendering.
 * Units snap to a 1 m grid, must stand inside their team's zone, can't overlap, and must fit
 * the per-side budget (if there is one) and the overall unit cap.
 */
export class Placement {
  units: PlacedUnit[] = [];
  mapId: string;
  /** Per-side budget; 0 means unlimited. */
  budget = 0;
  /** Bumped on every change, so views know when to redraw. */
  version = 0;

  constructor(mapId: string) {
    this.mapId = getMap(mapId).id;
  }

  zone(team: number): Rect {
    const z = getMap(this.mapId).zones;
    return team === 0 ? z.blue : z.red;
  }

  spent(team: number): number {
    let s = 0;
    for (const u of this.units) if (u.team === team) s += UNITS[u.type].cost;
    return s;
  }

  count(team: number): number {
    let n = 0;
    for (const u of this.units) if (u.team === team) n++;
    return n;
  }

  remaining(team: number): number {
    return this.budget > 0 ? this.budget - this.spent(team) : Infinity;
  }

  static snap(v: number): number {
    return Math.round(v);
  }

  check(type: number, team: number, x: number, z: number, unitCap: number): PlaceCheck {
    const sx = Placement.snap(x);
    const sz = Placement.snap(z);
    const zone = this.zone(team);
    if (sx < zone.minX || sx > zone.maxX || sz < zone.minZ || sz > zone.maxZ) return 'outside';
    if (this.units.length >= unitCap) return 'cap';
    if (UNITS[type].cost > this.remaining(team)) return 'budget';
    const r = UNITS[type].radius;
    for (const u of this.units) {
      const min = (r + UNITS[u.type].radius) * 0.9;
      const dx = u.x - sx;
      const dz = u.z - sz;
      if (dx * dx + dz * dz < min * min) return 'blocked';
    }
    return 'ok';
  }

  place(type: number, team: number, x: number, z: number, unitCap: number): boolean {
    if (this.check(type, team, x, z, unitCap) !== 'ok') return false;
    this.units.push({ type, team, x: Placement.snap(x), z: Placement.snap(z) });
    this.version++;
    return true;
  }

  /** Index of the unit nearest (x, z) within maxDist, or -1. */
  nearest(x: number, z: number, maxDist: number): number {
    let best = -1;
    let bestD = maxDist * maxDist;
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      const d = (u.x - x) * (u.x - x) + (u.z - z) * (u.z - z);
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  removeNear(x: number, z: number, maxDist = 1.2): boolean {
    const i = this.nearest(x, z, maxDist);
    if (i < 0) return false;
    this.units.splice(i, 1);
    this.version++;
    return true;
  }

  clear(team: number): void {
    this.units = this.units.filter((u) => u.team !== team);
    this.version++;
  }

  /** Replace the other side with a mirror image of this side's army. */
  mirror(fromTeam: number): void {
    const other = 1 - fromTeam;
    const copy = this.units.filter((u) => u.team === fromTeam).map((u) => ({ ...u, team: other, x: -u.x }));
    this.units = [...this.units.filter((u) => u.team === fromTeam), ...copy];
    this.version++;
  }

  /** Units in placement order (which is also slot order, so replays are identical). */
  toSetup(seed: number): BattleSetup {
    return { mapId: this.mapId, seed, units: this.units.map((u) => ({ ...u })) };
  }

  load(setup: BattleSetup): void {
    this.mapId = getMap(setup.mapId).id;
    this.units = setup.units.map((u) => ({ ...u }));
    this.version++;
  }

  /** Spacing used when painting a row of this unit type. */
  static rowSpacing(type: number): number {
    return unitSpacing(type);
  }
}
