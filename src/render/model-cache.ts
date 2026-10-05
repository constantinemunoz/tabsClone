import type { UnitDef } from '../data/units.ts';
import { buildUnitModel, type UnitModel } from './unit-model.ts';

const cache = new Map<string, UnitModel>();

/** Unit meshes are built once per type and shared by every view that draws them. */
export function getUnitModel(def: UnitDef): UnitModel {
  let m = cache.get(def.id);
  if (!m) {
    m = buildUnitModel(def);
    cache.set(def.id, m);
  }
  return m;
}
