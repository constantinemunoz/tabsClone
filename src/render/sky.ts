import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import type { MapPalette } from '../data/maps.ts';

/** Gradient sky dome with a soft sun glow. Follows the camera so it is never clipped. */
export class Sky {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor() {
    this.material = new ShaderMaterial({
      uniforms: {
        uTop: { value: new Color() },
        uHorizon: { value: new Color() },
        uBottom: { value: new Color() },
        uSunDir: { value: new Vector3(0, 1, 0) },
        uSunColor: { value: new Color(1, 1, 1) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uBottom;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float y = d.y;
          vec3 c = y > 0.0
            ? mix(uHorizon, uTop, pow(clamp(y, 0.0, 1.0), 0.55))
            : mix(uHorizon, uBottom, pow(clamp(-y, 0.0, 1.0), 0.45));
          float s = max(dot(d, uSunDir), 0.0);
          c += uSunColor * (pow(s, 900.0) * 1.2 + pow(s, 24.0) * 0.12);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }
      `,
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.mesh = new Mesh(new SphereGeometry(900, 32, 16), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  setPalette(p: MapPalette, sunDir: Vector3): void {
    const u = this.material.uniforms;
    (u.uTop.value as Color).setHex(p.skyTop);
    (u.uHorizon.value as Color).setHex(p.skyHorizon);
    (u.uBottom.value as Color).setHex(p.skyBottom);
    (u.uSunColor.value as Color).setHex(p.sun);
    (u.uSunDir.value as Vector3).copy(sunDir).normalize();
  }

  follow(camPos: Vector3): void {
    this.mesh.position.copy(camPos);
  }
}
