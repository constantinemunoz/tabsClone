import {
  CircleGeometry,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { MapDef } from '../data/maps.ts';
import type { QualitySettings } from '../platform/quality.ts';
import type { Terrain } from '../sim/terrain.ts';
import { Sky } from './sky.ts';
import { buildTerrainMesh, type TerrainMeshData } from './terrain-mesh.ts';

/** Direction the sunlight comes from (towards the sun). */
export const SUN_DIR = new Vector3(0.45, 0.82, 0.36).normalize();

/**
 * Owns the WebGL renderer, the scene graph, lights, sky, fog and terrain.
 * Units, effects and ragdolls add their own objects to `scene`.
 */
export class GameScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly sky = new Sky();
  terrainMesh: Mesh | null = null;
  terrainData: TerrainMeshData | null = null;
  private farGround: Mesh | null = null;
  private pixelRatio = 1;
  private resScale = 1;
  private quality: QualitySettings;

  constructor(canvas: HTMLCanvasElement, quality: QualitySettings) {
    this.quality = quality;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: quality.antialias,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.info.autoReset = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.shadowMap.enabled = quality.shadows;

    this.camera = new PerspectiveCamera(50, 1, 0.3, 2000);
    this.scene.fog = new Fog(0xffffff, 100, 400);

    this.sun = new DirectionalLight(0xffffff, 2.4);
    this.sun.position.copy(SUN_DIR).multiplyScalar(120);
    this.sun.target.position.set(0, 0, 0);
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -80;
    sc.right = 80;
    sc.top = 70;
    sc.bottom = -70;
    sc.near = 10;
    sc.far = 300;
    this.sun.shadow.bias = -0.0008;
    this.sun.castShadow = quality.shadows;
    this.scene.add(this.sun, this.sun.target);

    this.hemi = new HemisphereLight(0xffffff, 0x444444, 1.2);
    this.scene.add(this.hemi);
    this.scene.add(this.sky.mesh);

    this.applyQuality(quality);
  }

  applyQuality(q: QualitySettings): void {
    this.quality = q;
    this.resScale = q.resolutionScale;
    this.renderer.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;
    if (this.terrainMesh) this.terrainMesh.receiveShadow = q.shadows;
    // Materials must recompile when shadow support toggles.
    this.scene.traverse((o) => {
      const m = (o as Mesh).material;
      if (m && !Array.isArray(m)) m.needsUpdate = true;
    });
    this.resize();
  }

  /** Dynamic resolution: multiplies the capped device pixel ratio. */
  setResolutionScale(s: number): void {
    this.resScale = s;
    this.resize();
  }

  get resolutionScale(): number {
    return this.resScale;
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio, 2);
    const pr = Math.max(0.5, dpr * this.resScale);
    if (pr !== this.pixelRatio) {
      this.pixelRatio = pr;
      this.renderer.setPixelRatio(pr);
    }
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  setMap(def: MapDef, terrain: Terrain): void {
    const p = def.palette;
    const fog = this.scene.fog as Fog;
    fog.color.setHex(p.skyHorizon);
    fog.near = p.fogNear;
    fog.far = p.fogFar;
    this.sky.setPalette(p, SUN_DIR);
    this.sun.color.setHex(p.sun);
    this.sun.intensity = p.sunIntensity;
    this.hemi.color.setHex(p.hemiSky);
    this.hemi.groundColor.setHex(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;

    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as MeshLambertMaterial).dispose();
    }
    this.terrainData = buildTerrainMesh(terrain, p, def.seed);
    const mat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.terrainMesh = new Mesh(this.terrainData.geometry, mat);
    this.terrainMesh.receiveShadow = this.quality.shadows;
    this.terrainMesh.matrixAutoUpdate = false;
    this.scene.add(this.terrainMesh);

    if (this.farGround) {
      this.scene.remove(this.farGround);
      this.farGround.geometry.dispose();
      (this.farGround.material as MeshLambertMaterial).dispose();
      this.farGround = null;
    }
    if (p.farGround !== null) {
      const g = new CircleGeometry(1400, 48);
      g.rotateX(-Math.PI / 2);
      const m = new MeshLambertMaterial({ color: new Color(p.farGround) });
      this.farGround = new Mesh(g, m);
      this.farGround.position.y = terrain.minHeight - 1;
      this.farGround.matrixAutoUpdate = true;
      this.scene.add(this.farGround);
    }
  }

  render(): void {
    this.sky.follow(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }
}
