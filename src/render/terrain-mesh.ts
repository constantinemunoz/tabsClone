import { BufferAttribute, BufferGeometry, Color } from 'three';
import type { MapPalette } from '../data/maps.ts';
import { hash01 } from '../sim/rng.ts';
import { noise2 } from '../sim/noise.ts';
import type { Terrain } from '../sim/terrain.ts';

/**
 * Builds the flat-shaded, vertex-coloured terrain mesh from the heightmap.
 *
 * Where the map has a mask (the sky island), each grid triangle is clipped against
 * the mask's zero contour (marching triangles), which gives a smooth coastline instead
 * of grid stair-steps, and a rocky skirt is hung below every coastline segment.
 *
 * Returns the render geometry plus an indexed copy for the ragdoll physics collider.
 */
export interface TerrainMeshData {
  geometry: BufferGeometry;
  /** The first topTriangles triangles are the walkable surface; the rest is the skirt. */
  topTriangles: number;
  physicsVertices: Float32Array;
  physicsIndices: Uint32Array;
}

interface V {
  x: number;
  y: number;
  z: number;
  m: number;
}

const SKIRT_SCALE = [1, 0.985, 0.93, 0.8, 0.6, 0.33, 0.08];
const SKIRT_DROP = [0, 2.5, 7, 14, 23, 33, 44];

export function buildTerrainMesh(t: Terrain, palette: MapPalette, seed: number): TerrainMeshData {
  const pos: number[] = [];
  const col: number[] = [];
  const physTop: number[] = [];

  const cLow = new Color(palette.grassLow);
  const cHigh = new Color(palette.grassHigh);
  const cRock = new Color(palette.rock);
  const cDirt = new Color(palette.dirt);
  const cUnder = new Color(palette.underside);
  const tmp = new Color();

  const hRange = Math.max(3, t.playMaxHeight - t.playMinHeight);

  const pushTri = (a: V, b: V, c: V, color: Color, physics: boolean) => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let k = 0; k < 3; k++) col.push(color.r, color.g, color.b);
    if (physics) physTop.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };

  const faceColor = (a: V, b: V, c: V, salt: number): Color => {
    // Face normal y component tells us how steep the face is.
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const ndy = Math.abs(ny) / Math.max(1e-6, Math.sqrt(nx * nx + ny * ny + nz * nz));
    const cy = (a.y + b.y + c.y) / 3;
    const cx = (a.x + b.x + c.x) / 3;
    const cz = (a.z + b.z + c.z) / 3;
    const hT = Math.min(1, Math.max(0, (cy - t.playMinHeight) / hRange));
    tmp.copy(cLow).lerp(cHigh, Math.min(1, hT * 1.3 + noise2(cx / 11, cz / 11, seed + 21) * 0.35));
    // Patches of dirt on gentle ground.
    const dirt = noise2(cx / 17, cz / 17, seed + 31);
    if (dirt > 0.32) tmp.lerp(cDirt, Math.min(1, (dirt - 0.32) * 3));
    // Steep faces turn to rock.
    if (ndy < 0.82) tmp.lerp(cRock, Math.min(1, (0.82 - ndy) * 4));
    // Per-face brightness jitter gives the low-poly facet look.
    const j = 0.94 + hash01(Math.floor(cx * 7), Math.floor(cz * 7), seed + salt) * 0.12;
    tmp.multiplyScalar(j);
    return tmp;
  };

  const nodeV = (i: number, j: number): V => {
    const k = j * t.nx + i;
    return {
      x: t.x0 + i * t.cell,
      y: t.heights[k],
      z: t.z0 + j * t.cell,
      m: t.mask ? t.mask[k] : 1,
    };
  };

  const lerpV = (a: V, b: V): V => {
    const s = a.m / (a.m - b.m);
    return {
      x: a.x + (b.x - a.x) * s,
      y: a.y + (b.y - a.y) * s,
      z: a.z + (b.z - a.z) * s,
      m: 0,
    };
  };

  // Coastline segments, recorded as [x0,y0,z0, x1,y1,z1, outX, outZ].
  const coast: number[] = [];
  const poly: V[] = [];
  const isCut: boolean[] = [];

  const emitClipped = (a: V, b: V, c: V) => {
    if (a.m >= 0 && b.m >= 0 && c.m >= 0) {
      pushTri(a, b, c, faceColor(a, b, c, 1), true);
      return;
    }
    if (a.m < 0 && b.m < 0 && c.m < 0) return;
    // Sutherland-Hodgman against m >= 0.
    poly.length = 0;
    isCut.length = 0;
    const tri = [a, b, c];
    let insideX = 0, insideZ = 0, insideN = 0;
    for (let e = 0; e < 3; e++) {
      const p = tri[e];
      const q = tri[(e + 1) % 3];
      const pin = p.m >= 0;
      const qin = q.m >= 0;
      if (pin) {
        poly.push(p);
        isCut.push(false);
        insideX += p.x;
        insideZ += p.z;
        insideN++;
      }
      if (pin !== qin) {
        poly.push(lerpV(p, q));
        isCut.push(true);
      }
    }
    for (let k = 1; k + 1 < poly.length; k++) {
      pushTri(poly[0], poly[k], poly[k + 1], faceColor(poly[0], poly[k], poly[k + 1], 1), true);
    }
    // The two cut points form a coastline segment.
    let c0 = -1, c1 = -1;
    for (let k = 0; k < poly.length; k++) {
      if (isCut[k]) {
        if (c0 < 0) c0 = k;
        else c1 = k;
      }
    }
    if (c0 >= 0 && c1 >= 0 && insideN > 0) {
      const p = poly[c0];
      const q = poly[c1];
      const mx = (p.x + q.x) / 2;
      const mz = (p.z + q.z) / 2;
      coast.push(p.x, p.y, p.z, q.x, q.y, q.z, mx - insideX / insideN, mz - insideZ / insideN);
    }
  };

  for (let j = 0; j < t.nz - 1; j++) {
    for (let i = 0; i < t.nx - 1; i++) {
      const p00 = nodeV(i, j);
      const p10 = nodeV(i + 1, j);
      const p01 = nodeV(i, j + 1);
      const p11 = nodeV(i + 1, j + 1);
      // Alternate the diagonal so the facets don't line up in long rows.
      if (((i + j) & 1) === 0) {
        emitClipped(p00, p01, p10);
        emitClipped(p10, p01, p11);
      } else {
        emitClipped(p00, p01, p11);
        emitClipped(p00, p11, p10);
      }
    }
  }

  const topTriangles = pos.length / 9;

  // Rocky underside hanging from the coastline. Each level's points are a pure function
  // of the coastline point, so neighbouring segments meet without gaps.
  if (coast.length > 0) {
    const levelPoint = (x: number, y: number, z: number, level: number, out: V) => {
      const s = SKIRT_SCALE[level];
      const n = level === 0 ? 0 : noise2(x / 6 + level * 3.1, z / 6, seed + 50 + level);
      const scale = Math.max(0.02, s + n * 0.05 * (level > 0 ? 1 : 0));
      out.x = x * scale;
      out.z = z * scale;
      out.y = y - SKIRT_DROP[level] + n * 2.2 * Math.min(1, level);
      out.m = 0;
    };
    const a0: V = { x: 0, y: 0, z: 0, m: 0 };
    const b0: V = { x: 0, y: 0, z: 0, m: 0 };
    const a1: V = { x: 0, y: 0, z: 0, m: 0 };
    const b1: V = { x: 0, y: 0, z: 0, m: 0 };
    for (let s = 0; s < coast.length; s += 8) {
      const px = coast[s], py = coast[s + 1], pz = coast[s + 2];
      const qx = coast[s + 3], qy = coast[s + 4], qz = coast[s + 5];
      const ox = coast[s + 6], oz = coast[s + 7];
      // Orient so the face normal points away from the island.
      const ex = qx - px, ez = qz - pz;
      // Winding (p, p_below, q) has normal (-ez, 0, ex); flip when that points inward.
      const flip = -ez * ox + ex * oz < 0;
      for (let level = 0; level + 1 < SKIRT_SCALE.length; level++) {
        levelPoint(px, py, pz, level, a0);
        levelPoint(qx, qy, qz, level, b0);
        levelPoint(px, py, pz, level + 1, a1);
        levelPoint(qx, qy, qz, level + 1, b1);
        const depthT = level / (SKIRT_SCALE.length - 2);
        tmp.copy(level === 0 ? cDirt : cRock).lerp(cUnder, Math.min(1, depthT * 1.4));
        tmp.multiplyScalar(0.9 + hash01(Math.floor(px * 3), Math.floor(pz * 3), seed + level) * 0.16);
        const physics = level === 0;
        if (!flip) {
          pushTri(a0, a1, b0, tmp, physics);
          pushTri(b0, a1, b1, tmp, physics);
        } else {
          pushTri(a0, b0, a1, tmp, physics);
          pushTri(b0, b1, a1, tmp, physics);
        }
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();

  const physicsVertices = new Float32Array(physTop);
  const physicsIndices = new Uint32Array(physicsVertices.length / 3);
  for (let i = 0; i < physicsIndices.length; i++) physicsIndices[i] = i;
  return { geometry, topTriangles, physicsVertices, physicsIndices };
}
