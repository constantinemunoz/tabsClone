import { describe, expect, it } from 'vitest';
import { MAPS } from '../src/data/maps.ts';
import { buildTerrainMesh } from '../src/render/terrain-mesh.ts';
import { createTerrain, groundHeight, isVoid, VOID_HEIGHT } from '../src/sim/terrain.ts';

describe('terrain', () => {
  for (const def of MAPS) {
    it(`${def.id}: sim ground height matches the rendered triangles`, () => {
      const t = createTerrain(def);
      const mesh = buildTerrainMesh(t, def.palette, def.seed);
      const pos = mesh.geometry.getAttribute('position').array as Float32Array;
      let checked = 0;
      // Sample the centroid of every 37th walkable triangle.
      for (let tri = 0; tri < mesh.topTriangles; tri += 37) {
        const o = tri * 9;
        const ys = [pos[o + 1], pos[o + 4], pos[o + 7]];
        const cx = (pos[o] + pos[o + 3] + pos[o + 6]) / 3;
        const cy = (ys[0] + ys[1] + ys[2]) / 3;
        const cz = (pos[o + 2] + pos[o + 5] + pos[o + 8]) / 3;
        const area =
          (pos[o + 3] - pos[o]) * (pos[o + 8] - pos[o + 2]) - (pos[o + 5] - pos[o + 2]) * (pos[o + 6] - pos[o]);
        if (Math.abs(area) < 1e-3) continue;
        const h = groundHeight(t, cx, cz);
        if (h === VOID_HEIGHT) continue;
        expect(Math.abs(h - cy)).toBeLessThan(1e-3);
        checked++;
      }
      expect(checked).toBeGreaterThan(100);
    });
  }

  it('the sky island has void around it and ground in the middle', () => {
    const t = createTerrain(MAPS.find((m) => m.id === 'island')!);
    expect(isVoid(t, 0, 0)).toBe(false);
    expect(isVoid(t, -50, 0)).toBe(false);
    expect(isVoid(t, 0, 39)).toBe(true);
    expect(isVoid(t, 70, 0)).toBe(true);
    expect(groundHeight(t, 0, 60)).toBe(VOID_HEIGHT);
  });

  it('plateaus are higher than the valley and the cliff is steeper than 45 degrees', () => {
    const t = createTerrain(MAPS.find((m) => m.id === 'plateaus')!);
    const valley = groundHeight(t, 0, 0);
    const plateau = groundHeight(t, -35, 0);
    expect(plateau - valley).toBeGreaterThan(5);
    // Somewhere along a line across the cliff, the slope exceeds 1 (45 degrees).
    let maxSlope = 0;
    for (let x = -20; x < -6; x += 0.25) {
      maxSlope = Math.max(maxSlope, Math.abs(groundHeight(t, x + 0.25, 0) - groundHeight(t, x, 0)) / 0.25);
    }
    expect(maxSlope).toBeGreaterThan(1);
  });
});
