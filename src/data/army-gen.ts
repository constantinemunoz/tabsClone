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

/** A mixed army of roughly n units, weighted toward cheap units, for stress tests and benchmarks. */
export function mixedArmy(n: number): { type: number; count: number }[] {
  const pick = (id: string) => unitIndex(id);
  const giants = Math.max(0, Math.round(n / 75));
  const rest = n - giants;
  const mix: [string, number][] = [
    ['rammer', 0.12],
    ['bulwark', 0.14],
    ['pikeling', 0.18],
    ['scrapper', 0.56],
  ];
  const out: { type: number; count: number }[] = [];
  let used = 0;
  for (let k = 0; k < mix.length; k++) {
    const c = k === mix.length - 1 ? rest - used : Math.round(rest * mix[k][1]);
    used += c;
    out.push({ type: pick(mix[k][0]), count: c });
  }
  if (giants > 0) out.push({ type: pick('biglump'), count: giants });
  return out.filter((e) => e.type >= 0 && e.count > 0);
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
