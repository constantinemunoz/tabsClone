import { describe, expect, it } from 'vitest';
import { UNITS } from '../src/data/units.ts';
import { buildUnitModel, PART_PUPIL_R } from '../src/render/unit-model.ts';

describe('unit models', () => {
  for (const d of UNITS) {
    it(`${d.id}: builds an indexed body with every part tagged`, () => {
      const m = buildUnitModel(d);
      const g = m.geometry;
      const verts = g.getAttribute('position').count;
      const tris = g.index!.count / 3;
      const part = g.getAttribute('aPart');
      const seen = new Set<number>();
      for (let k = 0; k < part.count; k++) seen.add(part.getX(k));
      for (let p = 0; p <= PART_PUPIL_R; p++) expect(seen.has(p)).toBe(true);
      expect(m.layout.parts.length).toBe(6);
      console.log(`${d.id}: ${verts} vertices, ${tris} triangles`);
      // Keep bodies light: hundreds of these are on screen at once.
      expect(verts).toBeLessThan(1200);
      expect(tris).toBeLessThan(1000);
    });
  }
});
