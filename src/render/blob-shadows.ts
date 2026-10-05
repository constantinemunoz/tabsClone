import {
  BufferAttribute,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  type Scene,
  ShaderMaterial,
} from 'three';
import { isVoid, surfaceHeight, type Terrain } from '../sim/terrain.ts';

/**
 * Instanced blob shadows: one soft dark disc per unit, ragdoll or corpse, lying on the ground
 * plane under it (tilted to the local slope) and fading as the body rises. One draw call.
 */
export class BlobShadows {
  readonly mesh: Mesh;
  private readonly a: Float32Array;
  private readonly b: Float32Array;
  private readonly attrA: InstancedBufferAttribute;
  private readonly attrB: InstancedBufferAttribute;
  private readonly geo: InstancedBufferGeometry;
  readonly capacity: number;
  private count = 0;
  private terrain: Terrain | null = null;

  constructor(scene: Scene, capacity: number) {
    this.capacity = capacity;
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array([-1, 0, -1, -1, 0, 1, 1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0, -1]), 3));
    this.a = new Float32Array(capacity * 4);
    this.b = new Float32Array(capacity * 4);
    this.attrA = new InstancedBufferAttribute(this.a, 4);
    this.attrB = new InstancedBufferAttribute(this.b, 4);
    this.attrA.setUsage(DynamicDrawUsage);
    this.attrB.setUsage(DynamicDrawUsage);
    geo.setAttribute('iA', this.attrA);
    geo.setAttribute('iB', this.attrB);
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute vec4 iA; // x, y, z, radius
        attribute vec4 iB; // slope dx, slope dz, strength
        varying vec2 vUv;
        varying float vStrength;
        void main() {
          vUv = position.xz;
          vec3 p = vec3(iA.x + position.x * iA.w, 0.0, iA.z + position.z * iA.w);
          p.y = iA.y + iB.x * position.x * iA.w + iB.y * position.z * iA.w + 0.05;
          vStrength = iB.z;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vStrength;
        void main() {
          float d = length(vUv);
          float a = (1.0 - smoothstep(0.35, 1.0, d)) * vStrength;
          if (a < 0.01) discard;
          gl_FragColor = vec4(0.05, 0.06, 0.09, a * 0.42);
        }
      `,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.matrixAutoUpdate = false;
    scene.add(this.mesh);
  }

  setTerrain(t: Terrain): void {
    this.terrain = t;
  }

  begin(): void {
    this.count = 0;
  }

  /** Add a shadow for a body whose lowest point is at height y above (x, z). */
  add(x: number, y: number, z: number, radius: number): void {
    const t = this.terrain;
    if (!t || this.count >= this.capacity) return;
    if (t.mask && isVoid(t, x, z)) return;
    const g = surfaceHeight(t, x, z);
    const above = y - g;
    if (above > 12) return;
    const strength = 1 - Math.min(1, Math.max(0, above) / 8);
    const e = 0.5;
    const sx = (surfaceHeight(t, x + e, z) - surfaceHeight(t, x - e, z)) / (2 * e);
    const sz = (surfaceHeight(t, x, z + e) - surfaceHeight(t, x, z - e)) / (2 * e);
    const o = this.count * 4;
    this.a[o] = x;
    this.a[o + 1] = g;
    this.a[o + 2] = z;
    this.a[o + 3] = radius * (1 + Math.max(0, above) * 0.08);
    this.b[o] = sx;
    this.b[o + 1] = sz;
    this.b[o + 2] = strength;
    this.b[o + 3] = 0;
    this.count++;
  }

  end(): void {
    this.geo.instanceCount = this.count;
    this.attrA.needsUpdate = true;
    this.attrB.needsUpdate = true;
  }
}
