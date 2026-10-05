import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Euler,
  IcosahedronGeometry,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  BoxGeometry,
  Quaternion,
  type Scene,
  Vector3,
} from 'three';
import { PROJECTILE_VISUALS } from '../data/units.ts';
import type { SimClient } from '../game/sim-client.ts';
import { DT, EV_PROJ_IMPACT, IMPACT_TERRAIN } from '../sim/constants.ts';
import { EVENT_STRIDE } from '../sim/events.ts';
import { H_PROJECTILES, PROJ_STRIDE } from '../sim/snapshot.ts';

const LIVE_CAP = 512;
const STUCK_CAP = 320;
/** Seconds a stuck arrow or javelin stays before sinking away. */
const STUCK_TIME = 14;
const SINK_TIME = 2;
const FLOATS = 8;

type Part = [BufferGeometry, number, Matrix4];

/** Merge simple primitives (all along +z, the flight direction) into one coloured geometry. */
function merged(parts: Part[]): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const index: number[] = [];
  const v = new Vector3();
  const c = new Color();
  for (const [geo, color, m] of parts) {
    const p = geo.getAttribute('position');
    const base = pos.length / 3;
    c.setHex(color);
    for (let k = 0; k < p.count; k++) {
      v.set(p.getX(k), p.getY(k), p.getZ(k)).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
      col.push(c.r, c.g, c.b);
    }
    if (geo.index) for (let k = 0; k < geo.index.count; k++) index.push(base + geo.index.getX(k));
    else for (let k = 0; k < p.count; k++) index.push(base + k);
    geo.dispose();
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(index);
  return g;
}

function m(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): Matrix4 {
  return new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(1, 1, 1));
}

const HALF_PI = Math.PI / 2;

function geometryFor(kind: string): BufferGeometry {
  switch (kind) {
    case 'arrow':
      return merged([
        [new CylinderGeometry(0.012, 0.012, 0.78, 4), 0xb08a5a, m(0, 0, 0, HALF_PI)],
        [new ConeGeometry(0.03, 0.1, 4), 0x9aa1aa, m(0, 0, 0.44, HALF_PI)],
        [new BoxGeometry(0.004, 0.06, 0.14), 0xf3ead8, m(0, 0, -0.32)],
        [new BoxGeometry(0.06, 0.004, 0.14), 0xf3ead8, m(0, 0, -0.32)],
      ]);
    case 'javelin':
      return merged([
        [new CylinderGeometry(0.02, 0.02, 1.3, 4), 0x9a6a3f, m(0, 0, 0, HALF_PI)],
        [new ConeGeometry(0.035, 0.18, 4), 0xc3c9d1, m(0, 0, 0.74, HALF_PI)],
      ]);
    case 'stone':
      return merged([[new IcosahedronGeometry(0.09, 0), 0x8e8a80, m(0, 0, 0)]]);
    default:
      // Lead sling bullet, drawn a little large so it can be seen at all.
      return merged([[new IcosahedronGeometry(0.06, 0), 0x4c5058, m(0, 0, 0, 0, 0, 0)]]);
  }
}

interface KindBatch {
  data: Float32Array;
  buffer: InstancedInterleavedBuffer;
  geo: InstancedBufferGeometry;
  mesh: Mesh;
  count: number;
}

/**
 * Draws projectiles in flight (one instanced draw per kind, each oriented along its velocity)
 * and arrows or javelins stuck in the ground after they land. Purely visual.
 */
export class ProjectileRenderer {
  private readonly kinds: KindBatch[] = [];
  private readonly stuck = new Float32Array(STUCK_CAP * FLOATS);
  private stuckHead = 0;
  private stuckCount = 0;
  private now = 0;

  constructor(scene: Scene) {
    const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          attribute vec4 iPos;  // x, y, z, scale
          attribute vec4 iDir;  // flight direction, spin`,
        )
        .replace(
          '#include <begin_vertex>',
          `vec3 fwd = normalize(iDir.xyz);
          vec3 up0 = abs(fwd.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
          vec3 right = normalize(cross(up0, fwd));
          vec3 up = cross(fwd, right);
          float cs = cos(iDir.w);
          float sn = sin(iDir.w);
          vec3 p = vec3(position.x * cs - position.y * sn, position.x * sn + position.y * cs, position.z);
          vec3 transformed = iPos.xyz + (right * p.x + up * p.y + fwd * p.z) * iPos.w;`,
        );
    };
    material.customProgramCacheKey = () => 'projectile';
    for (const kind of PROJECTILE_VISUALS) {
      const base = geometryFor(kind);
      const cap = LIVE_CAP + (kind === 'arrow' || kind === 'javelin' ? STUCK_CAP : 0);
      const data = new Float32Array(cap * FLOATS);
      const buffer = new InstancedInterleavedBuffer(data, FLOATS, 1);
      buffer.setUsage(DynamicDrawUsage);
      const geo = new InstancedBufferGeometry();
      geo.setAttribute('position', base.getAttribute('position'));
      geo.setAttribute('color', base.getAttribute('color'));
      geo.setIndex(base.index);
      geo.setAttribute('iPos', new InterleavedBufferAttribute(buffer, 4, 0));
      geo.setAttribute('iDir', new InterleavedBufferAttribute(buffer, 4, 4));
      geo.instanceCount = 0;
      const mesh = new Mesh(geo, material);
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      scene.add(mesh);
      this.kinds.push({ data, buffer, geo, mesh, count: 0 });
    }
  }

  /** Impact events: arrows and javelins that hit the ground stay stuck in it for a while. */
  onEvents = (ev: Float32Array, offset: number, count: number): void => {
    for (let k = 0; k < count; k++) {
      const o = offset + k * EVENT_STRIDE;
      if (ev[o] !== EV_PROJ_IMPACT || ev[o + 5] !== IMPACT_TERRAIN) continue;
      const kind = ev[o + 9];
      if (kind > 1) continue;
      const s = ((this.stuckHead + this.stuckCount) % STUCK_CAP) * FLOATS;
      if (this.stuckCount < STUCK_CAP) this.stuckCount++;
      else this.stuckHead = (this.stuckHead + 1) % STUCK_CAP;
      const depth = kind === 0 ? 0.22 : 0.4;
      this.stuck[s] = ev[o + 2] + ev[o + 6] * depth;
      this.stuck[s + 1] = ev[o + 3] + ev[o + 7] * depth;
      this.stuck[s + 2] = ev[o + 4] + ev[o + 8] * depth;
      this.stuck[s + 3] = kind;
      this.stuck[s + 4] = ev[o + 6];
      this.stuck[s + 5] = ev[o + 7];
      this.stuck[s + 6] = ev[o + 8];
      this.stuck[s + 7] = this.now;
    }
  };

  clear(): void {
    this.stuckCount = 0;
    this.stuckHead = 0;
  }

  /** dt is visual time (already scaled by battle speed). */
  update(client: SimClient, alpha: number, dt: number): void {
    this.now += dt;
    for (const k of this.kinds) k.count = 0;
    const snap = client.curr;
    if (snap) {
      const n = snap[H_PROJECTILES];
      const base = client.projectilesOffset();
      // Render one tick behind the sim, like the units: step back along the velocity.
      const back = (1 - alpha) * DT;
      for (let i = 0; i < n; i++) {
        const o = base + i * PROJ_STRIDE;
        const kind = snap[o + 6];
        const batch = this.kinds[kind];
        if (!batch || batch.count >= LIVE_CAP) continue;
        const d = batch.data;
        const w = batch.count * FLOATS;
        const vx = snap[o + 3];
        const vy = snap[o + 4];
        const vz = snap[o + 5];
        d[w] = snap[o] - vx * back;
        d[w + 1] = snap[o + 1] - vy * back;
        d[w + 2] = snap[o + 2] - vz * back;
        d[w + 3] = kind === 3 ? 1.5 : 1;
        d[w + 4] = vx;
        d[w + 5] = vy;
        d[w + 6] = vz;
        // Stones and bullets tumble as they fly.
        d[w + 7] = kind >= 2 ? this.now * 14 + snap[o + 7] : 0;
        batch.count++;
      }
    }
    // Stuck arrows and javelins, sinking away at the end of their time.
    while (this.stuckCount > 0 && this.now - this.stuck[this.stuckHead * FLOATS + 7] > STUCK_TIME + SINK_TIME) {
      this.stuckHead = (this.stuckHead + 1) % STUCK_CAP;
      this.stuckCount--;
    }
    for (let k = 0; k < this.stuckCount; k++) {
      const s = ((this.stuckHead + k) % STUCK_CAP) * FLOATS;
      const batch = this.kinds[this.stuck[s + 3]];
      const age = this.now - this.stuck[s + 7];
      const sink = age > STUCK_TIME ? ((age - STUCK_TIME) / SINK_TIME) * 0.8 : 0;
      const d = batch.data;
      const w = batch.count * FLOATS;
      d[w] = this.stuck[s];
      d[w + 1] = this.stuck[s + 1] - sink;
      d[w + 2] = this.stuck[s + 2];
      d[w + 3] = 1;
      d[w + 4] = this.stuck[s + 4];
      d[w + 5] = this.stuck[s + 5];
      d[w + 6] = this.stuck[s + 6];
      d[w + 7] = 0;
      batch.count++;
    }
    for (const k of this.kinds) {
      k.geo.instanceCount = k.count;
      k.mesh.visible = k.count > 0;
      if (k.count > 0) k.buffer.needsUpdate = true;
    }
  }
}
