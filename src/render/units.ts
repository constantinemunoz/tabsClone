import {
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  MeshLambertMaterial,
  type Scene,
  Vector3,
} from 'three';
import { TEAM_COLORS } from '../config.ts';
import type { UnitDef } from '../data/units.ts';
import type { SimClient } from '../game/sim-client.ts';
import { S_DEAD } from '../sim/constants.ts';
import { HEADER_FLOATS, U_STATE, UNIT_STRIDE } from '../sim/snapshot.ts';

/** Floats per instance: posYaw(4), spring+scale(4), anim(4), state(4). */
const INSTANCE_FLOATS = 16;

/**
 * One instanced draw call per unit type. Every unit keeps its slot for the whole battle, so the
 * mapping slot -> (type batch, instance index) is fixed at battle start.
 */
interface Batch {
  type: number;
  slots: Int32Array;
  data: Float32Array;
  buffer: InstancedInterleavedBuffer;
  mesh: Mesh;
}

function baseGeometry(d: UnitDef): BufferGeometry {
  const r = d.radius;
  const g = new CapsuleGeometry(r, Math.max(0.01, d.height - 2 * r), 4, 10).toNonIndexed();
  g.translate(0, d.height / 2, 0);
  // Nose so the facing is visible: shift the front vertices forward a little.
  const pos = g.getAttribute('position');
  for (let k = 0; k < pos.count; k++) {
    if (pos.getZ(k) > r * 0.6 && pos.getY(k) > d.height * 0.55) pos.setZ(k, pos.getZ(k) + r * 0.35);
  }
  const n = pos.count;
  const col = new Float32Array(n * 3).fill(1);
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  return g;
}

function makeMaterial(): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const blue = new Color(TEAM_COLORS.blue);
  const red = new Color(TEAM_COLORS.red);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTeamBlue = { value: new Vector3(blue.r, blue.g, blue.b) };
    shader.uniforms.uTeamRed = { value: new Vector3(red.r, red.g, red.b) };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 iPosYaw;
        attribute vec4 iSpring;
        attribute vec4 iState;
        uniform vec3 uTeamBlue;
        uniform vec3 uTeamRed;`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = position * iSpring.w;
        float cy = cos(iPosYaw.w);
        float sy = sin(iPosYaw.w);
        transformed = vec3(transformed.x * cy + transformed.z * sy, transformed.y, -transformed.x * sy + transformed.z * cy);
        transformed += iPosYaw.xyz;
        vColor.rgb *= iState.x < 0.5 ? uTeamBlue : uTeamRed;`,
      );
  };
  return m;
}

export class UnitRenderer {
  private batches: Batch[] = [];
  private readonly scene: Scene;
  private readonly pose = new Float32Array(4);

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /** Build one instanced batch per unit type present in the battle. */
  build(defs: UnitDef[], types: Uint8Array | number[], teams: Uint8Array | number[], count: number): void {
    this.dispose();
    const material = makeMaterial();
    for (let t = 0; t < defs.length; t++) {
      let n = 0;
      for (let i = 0; i < count; i++) if (types[i] === t) n++;
      if (n === 0) continue;
      const slots = new Int32Array(n);
      let k = 0;
      for (let i = 0; i < count; i++) if (types[i] === t) slots[k++] = i;
      const data = new Float32Array(n * INSTANCE_FLOATS);
      for (let j = 0; j < n; j++) {
        data[j * INSTANCE_FLOATS + 7] = 1;
        data[j * INSTANCE_FLOATS + 12] = teams[slots[j]];
      }
      const buffer = new InstancedInterleavedBuffer(data, INSTANCE_FLOATS, 1);
      buffer.setUsage(DynamicDrawUsage);
      const base = baseGeometry(defs[t]);
      const geo = new InstancedBufferGeometry();
      geo.setAttribute('position', base.getAttribute('position'));
      geo.setAttribute('color', base.getAttribute('color'));
      geo.setAttribute('iPosYaw', new InterleavedBufferAttribute(buffer, 4, 0));
      geo.setAttribute('iSpring', new InterleavedBufferAttribute(buffer, 4, 4));
      geo.setAttribute('iAnim', new InterleavedBufferAttribute(buffer, 4, 8));
      geo.setAttribute('iState', new InterleavedBufferAttribute(buffer, 4, 12));
      geo.instanceCount = n;
      const mesh = new Mesh(geo, material);
      // Instances move anywhere; the base geometry's bounds would cull them wrongly.
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
      this.batches.push({ type: t, slots, data, buffer, mesh });
    }
  }

  update(client: SimClient, alpha: number): void {
    const snap = client.curr;
    if (!snap) return;
    const pose = this.pose;
    for (let b = 0; b < this.batches.length; b++) {
      const batch = this.batches[b];
      const data = batch.data;
      const slots = batch.slots;
      for (let k = 0; k < slots.length; k++) {
        const i = slots[k];
        const o = k * INSTANCE_FLOATS;
        const dead = snap[HEADER_FLOATS + i * UNIT_STRIDE + U_STATE] === S_DEAD;
        client.unitPose(i, alpha, pose);
        data[o] = pose[0];
        data[o + 1] = pose[1];
        data[o + 2] = pose[2];
        data[o + 3] = pose[3];
        data[o + 7] = dead ? 0 : 1;
      }
      batch.buffer.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const b of this.batches) {
      this.scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      (b.mesh.material as MeshLambertMaterial).dispose();
    }
    this.batches = [];
  }
}
