import {
  DynamicDrawUsage,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  type Scene,
} from 'three';
import { attackStyleIndex, type UnitDef } from '../data/units.ts';
import type { Placement } from '../game/placement.ts';
import { surfaceHeight, type Terrain } from '../sim/terrain.ts';
import { BlobShadows } from './blob-shadows.ts';
import { getUnitModel } from './model-cache.ts';
import { createLiveMaterial } from './unit-material.ts';

const FLOATS = 20;

export interface Ghost {
  type: number;
  team: number;
  x: number;
  z: number;
}

interface Batch {
  data: Float32Array;
  buffer: InstancedInterleavedBuffer;
  geo: InstancedBufferGeometry;
  mesh: Mesh;
  count: number;
  capacity: number;
}

/**
 * Draws the armies while they're being placed: every placed unit standing in its idle sway
 * (the same wobble shader as in battle), plus a pale ghost of the unit about to be placed.
 */
export class PlacementView {
  private batches: Batch[] = [];
  private readonly shadows: BlobShadows;
  private terrain: Terrain | null = null;
  private visible = false;

  constructor(scene: Scene, defs: UnitDef[], capacity: number) {
    this.shadows = new BlobShadows(scene, capacity + 1);
    this.shadows.mesh.visible = false;
    for (const def of defs) {
      const model = getUnitModel(def);
      const cap = capacity + 1;
      const data = new Float32Array(cap * FLOATS);
      const buffer = new InstancedInterleavedBuffer(data, FLOATS, 1);
      buffer.setUsage(DynamicDrawUsage);
      const geo = new InstancedBufferGeometry();
      for (const name of ['position', 'color', 'aPart', 'aPivot', 'aTint', 'aSet']) geo.setAttribute(name, model.geometry.getAttribute(name));
      geo.setIndex(model.geometry.index);
      geo.setAttribute('iPosYaw', new InterleavedBufferAttribute(buffer, 4, 0));
      geo.setAttribute('iSpring', new InterleavedBufferAttribute(buffer, 4, 4));
      geo.setAttribute('iSpringV', new InterleavedBufferAttribute(buffer, 4, 8));
      geo.setAttribute('iAnim', new InterleavedBufferAttribute(buffer, 4, 12));
      geo.setAttribute('iState', new InterleavedBufferAttribute(buffer, 4, 16));
      geo.instanceCount = 0;
      const v = def.visual;
      const look = {
        scale: v.scale,
        attackStyle: attackStyleIndex(def.weapon.style),
        sidearmStyle: attackStyleIndex((def.sidearm ?? def.weapon).style),
        floppy: Math.min(1.6, Math.max(0.4, 70 / v.wobbleStiffness)),
        horse: model.horse,
      };
      const mat = createLiveMaterial(model.layout, look);
      const mesh = new Mesh(geo, mat.material);
      mesh.customDepthMaterial = mat.depth;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      scene.add(mesh);
      this.batches.push({ data, buffer, geo, mesh, count: 0, capacity: cap });
    }
  }

  setTerrain(t: Terrain): void {
    this.terrain = t;
    this.shadows.setTerrain(t);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    for (const b of this.batches) b.mesh.visible = v && b.count > 0;
    this.shadows.mesh.visible = v;
  }

  private write(defs: UnitDef[], type: number, team: number, x: number, z: number, seed: number, ghost: boolean): void {
    const b = this.batches[type];
    if (!b || b.count >= b.capacity || !this.terrain) return;
    const d = b.data;
    const o = b.count * FLOATS;
    const y = surfaceHeight(this.terrain, x, z);
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = team === 0 ? Math.PI / 2 : -Math.PI / 2;
    d[o + 4] = 0;
    d[o + 5] = 0;
    d[o + 6] = 0;
    d[o + 7] = defs[type].visual.scale;
    d[o + 8] = 0;
    d[o + 9] = 0;
    d[o + 10] = 0;
    // The ghost is drawn washed out using the hit-flash channel.
    d[o + 11] = ghost ? 0.85 : 0;
    d[o + 12] = seed * 6.28;
    d[o + 13] = 0;
    d[o + 14] = 0;
    d[o + 15] = seed;
    d[o + 16] = team;
    d[o + 17] = 0;
    d[o + 18] = 0;
    d[o + 19] = 0;
    b.count++;
    if (!ghost) this.shadows.add(x, y, z, defs[type].radius * 1.25);
  }

  update(defs: UnitDef[], placement: Placement, ghost: Ghost | null): void {
    for (const b of this.batches) b.count = 0;
    this.shadows.begin();
    const units = placement.units;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      const seed = ((Math.imul(i + 1, 2654435761) >>> 0) % 10007) / 10007;
      this.write(defs, u.type, u.team, u.x, u.z, seed, false);
    }
    if (ghost) this.write(defs, ghost.type, ghost.team, ghost.x, ghost.z, 0.5, true);
    this.shadows.end();
    for (const b of this.batches) {
      b.geo.instanceCount = b.count;
      b.mesh.visible = this.visible && b.count > 0;
      if (b.count > 0) b.buffer.needsUpdate = true;
    }
  }
}
