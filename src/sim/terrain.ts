import type { MapDef, Rect } from '../data/maps.ts';
import { fbm, noise2, smoothstep } from './noise.ts';

/** Height returned where there is no ground at all (off the edge of the sky island). */
export const VOID_HEIGHT = -10000;

/**
 * A heightmap on a regular grid. Shared by the simulation (gameplay truth) and the
 * renderer (which builds its mesh from exactly the same data).
 */
export interface Terrain {
  nx: number;
  nz: number;
  cell: number;
  x0: number;
  z0: number;
  heights: Float32Array;
  /** Signed distance-like field, positive where ground exists. null if the map has no void. */
  mask: Float32Array | null;
  minHeight: number;
  maxHeight: number;
  /** Height range inside the play area only (used to colour the ground). */
  playMinHeight: number;
  playMaxHeight: number;
  /** Units below this height are dead. */
  killY: number;
  play: Rect;
}

function outsideDistance(r: Rect, x: number, z: number): number {
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  return Math.sqrt(dx * dx + dz * dz);
}

/** Hills that rise outside the play area to frame it and hide the heightmap edge. */
function borderHills(def: MapDef, x: number, z: number): number {
  const d = outsideDistance(def.play, x, z);
  if (d <= 0) return 0;
  const s = smoothstep(2, 34, d);
  return s * s * (10 + 9 * fbm(x / 23, z / 23, def.seed + 77, 3));
}

function meadowHeight(def: MapDef, x: number, z: number): number {
  const s = def.seed;
  let h = fbm(x / 34, z / 34, s, 4) * 2.4 + noise2(x / 9, z / 9, s + 5) * 0.35;
  h += borderHills(def, x, z);
  return h;
}

const PLATEAU_HEIGHT = 8;
const VALLEY_HALF = 12;
const RAMP_LENGTH = 13;

function plateauHeight(def: MapDef, x: number, z: number): number {
  const s = def.seed;
  // Mirror across x = 0 so neither side gets a better plateau.
  const ax = Math.abs(x);
  const edge = VALLEY_HALF + noise2(ax / 7, z / 7, s + 3) * 2;
  const top = edge + 1.6;
  // Cliff: rises over 1.6 m, far steeper than the 45 degree walking limit.
  const cliff = smoothstep(edge, top, ax);
  // Two ramps per side: wedges that run from the cliff top down into the valley.
  const rampMask = Math.max(1 - smoothstep(5, 9, Math.abs(z - 21)), 1 - smoothstep(5, 9, Math.abs(z + 21)));
  const ramp = Math.min(1, Math.max(0, (ax - (top - RAMP_LENGTH)) / RAMP_LENGTH)) * rampMask;
  const t = Math.max(cliff, ramp);
  let h = PLATEAU_HEIGHT * t;
  h += fbm(ax / 22, z / 22, s, 3) * 0.6 * (0.4 + t);
  h += borderHills(def, x, z) * 1.2;
  return h;
}

function islandMask(def: MapDef, x: number, z: number): number {
  const s = def.seed;
  // Rounded-rectangle island, pinched in the middle so the front line runs near the edges.
  const a = 63;
  const b = 41 - 15 * Math.exp(-(x / 22) * (x / 22));
  const nx = Math.abs(x) / a;
  const nz = Math.abs(z) / b;
  const p = 3.5;
  const r = Math.pow(Math.pow(nx, p) + Math.pow(nz, p), 1 / p);
  const wobble = 1 + noise2(x / 13, z / 13, s + 11) * 0.09;
  return (wobble - r) * Math.min(a, b);
}

function islandHeight(def: MapDef, x: number, z: number): number {
  const s = def.seed;
  return 3 + fbm(x / 26, z / 26, s, 3) * 1.6 + noise2(x / 8, z / 8, s + 9) * 0.25;
}

export function createTerrain(def: MapDef): Terrain {
  const cell = def.cell;
  const minX = def.play.minX - def.margin;
  const maxX = def.play.maxX + def.margin;
  const minZ = def.play.minZ - def.margin;
  const maxZ = def.play.maxZ + def.margin;
  const nx = Math.round((maxX - minX) / cell) + 1;
  const nz = Math.round((maxZ - minZ) / cell) + 1;
  const heights = new Float32Array(nx * nz);
  const mask = def.kind === 'island' ? new Float32Array(nx * nz) : null;
  let minH = Infinity;
  let maxH = -Infinity;
  let playMin = Infinity;
  let playMax = -Infinity;
  const pr = def.play;
  for (let j = 0; j < nz; j++) {
    const z = minZ + j * cell;
    for (let i = 0; i < nx; i++) {
      const x = minX + i * cell;
      const k = j * nx + i;
      let h: number;
      if (def.kind === 'plateaus') h = plateauHeight(def, x, z);
      else if (def.kind === 'island') h = islandHeight(def, x, z);
      else h = meadowHeight(def, x, z);
      heights[k] = h;
      if (mask) mask[k] = islandMask(def, x, z);
      if (!mask || mask[k] >= 0) {
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
        if (x >= pr.minX && x <= pr.maxX && z >= pr.minZ && z <= pr.maxZ) {
          if (h < playMin) playMin = h;
          if (h > playMax) playMax = h;
        }
      }
    }
  }
  return {
    nx,
    nz,
    cell,
    x0: minX,
    z0: minZ,
    heights,
    mask,
    minHeight: minH,
    maxHeight: maxH,
    playMinHeight: playMin,
    playMaxHeight: playMax,
    killY: minH - (mask ? 30 : 60),
    play: def.play,
  };
}

/**
 * Interpolates a grid field on the same triangles the render mesh uses: each cell is split
 * along a diagonal that alternates in a checkerboard, so sampled heights match the drawn
 * ground exactly and the island's coastline matches the clipped mesh edge.
 * Coordinates are clamped to the grid.
 */
function sampleField(t: Terrain, field: Float32Array, x: number, z: number): number {
  let fx = (x - t.x0) / t.cell;
  let fz = (z - t.z0) / t.cell;
  const mx = t.nx - 1;
  const mz = t.nz - 1;
  if (fx < 0) fx = 0;
  else if (fx > mx) fx = mx;
  if (fz < 0) fz = 0;
  else if (fz > mz) fz = mz;
  let ix = Math.floor(fx);
  let iz = Math.floor(fz);
  if (ix >= mx) ix = mx - 1;
  if (iz >= mz) iz = mz - 1;
  const u = fx - ix;
  const v = fz - iz;
  const k = iz * t.nx + ix;
  const h00 = field[k];
  const h10 = field[k + 1];
  const h01 = field[k + t.nx];
  const h11 = field[k + t.nx + 1];
  if (((ix + iz) & 1) === 0) {
    // Diagonal from (0,1) to (1,0).
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }
  // Diagonal from (0,0) to (1,1).
  if (v >= u) return h00 + (h11 - h01) * u + (h01 - h00) * v;
  return h00 + (h10 - h00) * u + (h11 - h10) * v;
}

/** Ground height ignoring holes. */
export function surfaceHeight(t: Terrain, x: number, z: number): number {
  return sampleField(t, t.heights, x, z);
}

/** True if there is no ground under (x, z). */
export function isVoid(t: Terrain, x: number, z: number): boolean {
  if (!t.mask) return false;
  const fx = (x - t.x0) / t.cell;
  const fz = (z - t.z0) / t.cell;
  if (fx < 0 || fz < 0 || fx > t.nx - 1 || fz > t.nz - 1) return true;
  return sampleField(t, t.mask, x, z) < 0;
}

/** Ground height at (x, z), or VOID_HEIGHT if there is no ground there. */
export function groundHeight(t: Terrain, x: number, z: number): number {
  if (t.mask && isVoid(t, x, z)) return VOID_HEIGHT;
  return sampleField(t, t.heights, x, z);
}
