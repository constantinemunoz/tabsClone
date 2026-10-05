import type { Rect } from './maps.ts';
import { getMap } from './maps.ts';
import { UNITS, unitIndex } from './units.ts';
import type { BattleSetup, PlacedUnit } from '../sim/sim.ts';

/**
 * Helpers that lay out armies as placement data: used by the stress-test mode, the developer
 * demo battles, tests and the benchmark. Pure functions; no randomness beyond the given seed.
 */

/** Spacing (metres, whole numbers to match the 1 m placement grid) for a unit type. */
export function unitSpacing(type: number): number {
  return Math.max(1, Math.ceil(UNITS[type].radius * 2 + 0.3));
}

/**
 * Fill a zone with `count` units of each type in `types`, in blocks of rows starting at the
 * zone's front edge (the edge facing the enemy).
 */
export function formation(entries: { type: number; count: number }[], team: number, zone: Rect): PlacedUnit[] {
  const out: PlacedUnit[] = [];
  const front = team === 0 ? zone.maxX : zone.minX;
  const back = team === 0 ? -1 : 1;
  let rowX = front;
  for (const e of entries) {
    if (e.type < 0 || e.count <= 0) continue;
    const sp = unitSpacing(e.type);
    const perRow = Math.max(1, Math.floor((zone.maxZ - zone.minZ) / sp));
    let placed = 0;
    rowX += back * sp * 0.5;
    while (placed < e.count) {
      const inRow = Math.min(perRow, e.count - placed);
      const width = (inRow - 1) * sp;
      for (let k = 0; k < inRow; k++) {
        const z = Math.round(-width / 2 + k * sp + (zone.minZ + zone.maxZ) / 2);
        out.push({ type: e.type, team, x: Math.round(rowX), z });
      }
      placed += inRow;
      rowX += back * sp;
      if (team === 0 ? rowX < zone.minX : rowX > zone.maxX) rowX = front + back * sp * 0.5;
    }
    rowX += back * sp * 0.5;
  }
  return out;
}

/**
 * A mixed army of n units across the whole roster, for stress tests and benchmarks.
 * Listed front to back: the phalanx leads, missile troops behind it, cavalry at the rear.
 */
export function mixedArmy(n: number): { type: number; count: number }[] {
  const mix: [string, number][] = [
    ['hoplite', 0.3],
    ['spartan', 0.07],
    ['marine', 0.1],
    ['peltast', 0.12],
    ['skirmisher', 0.12],
    ['slinger', 0.11],
    ['archer', 0.12],
    ['horseman', 0.06],
  ];
  const counts = mix.map(([, f]) => Math.round(n * f));
  // Put any rounding difference into the hoplites.
  counts[0] += n - counts.reduce((a, b) => a + b, 0);
  return mix
    .map(([id], k) => ({ type: unitIndex(id), count: counts[k] }))
    .filter((e) => e.type >= 0 && e.count > 0);
}

/** N against N on the given map. */
export function stressSetup(perSide: number, mapId = 'meadow', seed = 12345): BattleSetup {
  const map = getMap(mapId);
  const army = mixedArmy(perSide);
  return {
    mapId,
    seed,
    units: [...formation(army, 0, map.zones.blue), ...formation(army, 1, map.zones.red)],
  };
}

/**
 * Parse a developer army string such as "scrapper*30,biglump*2" into formation entries.
 * Unknown ids are ignored.
 */
export function parseArmy(spec: string): { type: number; count: number }[] {
  const out: { type: number; count: number }[] = [];
  for (const part of spec.split(',')) {
    const [id, n] = part.split('*');
    const type = unitIndex(id.trim());
    const count = Math.min(1000, Math.max(0, parseInt(n ?? '1', 10) || 0));
    if (type >= 0 && count > 0) out.push({ type, count });
  }
  return out;
}
