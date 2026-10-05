import { getMap, type MapDef } from '../data/maps.ts';
import { detectQualityTier, QUALITY_PRESETS, type QualitySettings } from '../platform/quality.ts';
import { CameraController } from '../render/camera.ts';
import { GameScene } from '../render/scene.ts';
import { createTerrain, type Terrain } from '../sim/terrain.ts';
import { DevOverlay } from '../ui/dev-overlay.ts';

/**
 * Top-level glue: owns the scene, camera, overlay and the frame loop.
 * Pauses everything while the tab is hidden.
 */
export class App {
  readonly scene: GameScene;
  readonly cam: CameraController;
  readonly overlay: DevOverlay;
  quality: QualitySettings;
  map!: MapDef;
  terrain!: Terrain;

  private raf = 0;
  private lastFrame = 0;
  private running = false;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    const probe = canvas.getContext('webgl2');
    this.quality = QUALITY_PRESETS[detectQualityTier(probe)];
    this.scene = new GameScene(canvas, this.quality);
    this.cam = new CameraController(this.scene.camera, canvas);
    this.overlay = new DevOverlay(ui);
    this.overlay.stats.tier = this.quality.tier;
    window.addEventListener('resize', () => this.scene.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop();
      else this.start();
    });
  }

  loadMap(id: string): void {
    this.map = getMap(id);
    this.terrain = createTerrain(this.map);
    this.scene.setMap(this.map, this.terrain);
    this.cam.setTerrain(this.terrain, this.map.play);
    this.cam.setView(0, 0, Math.PI * 0.5 + 0.35, 0.62, 85);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const t0 = performance.now();
    const frameMs = now - this.lastFrame;
    this.lastFrame = now;
    const dt = Math.min(frameMs, 100) / 1000;

    this.cam.update(dt);
    this.scene.render();

    const info = this.scene.renderer.info.render;
    this.overlay.stats.drawCalls = info.calls;
    this.overlay.stats.triangles = info.triangles;
    this.overlay.stats.resolutionScale = this.scene.resolutionScale;
    this.overlay.frame(now, frameMs, performance.now() - t0);
  };
}
