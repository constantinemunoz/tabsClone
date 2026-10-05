import { getMap, type MapDef } from '../data/maps.ts';
import { UNITS } from '../data/units.ts';
import { detectQualityTier, QUALITY_PRESETS, type QualitySettings } from '../platform/quality.ts';
import { CameraController } from '../render/camera.ts';
import { GameScene } from '../render/scene.ts';
import { UnitRenderer } from '../render/units.ts';
import { RESULT_BLUE, RESULT_RED, RESULT_RUNNING } from '../sim/constants.ts';
import type { BattleSetup } from '../sim/sim.ts';
import {
  H_ALIVE_BLUE,
  H_ALIVE_RED,
  H_BUFFERS_ALLOCATED,
  H_PROJECTILES,
  H_RESULT,
  H_TICK,
  H_TICK_MS,
  H_TICK_MS_MAX,
} from '../sim/snapshot.ts';
import { createTerrain, type Terrain } from '../sim/terrain.ts';
import { DevOverlay } from '../ui/dev-overlay.ts';
import { SimClient } from './sim-client.ts';

/** Battle speeds selectable with the number keys (index 0 is pause). */
export const SPEEDS = [0, 0.25, 1, 2];

/**
 * Top-level glue: owns the scene, camera, overlay, the simulation client and the frame loop.
 * Pauses everything while the tab is hidden.
 */
export class App {
  readonly scene: GameScene;
  readonly cam: CameraController;
  readonly overlay: DevOverlay;
  readonly sim = new SimClient();
  readonly units: UnitRenderer;
  quality: QualitySettings;
  map!: MapDef;
  terrain!: Terrain;
  setup: BattleSetup | null = null;
  speed = 1;
  private pausedSpeed = 1;
  private banner: HTMLDivElement;

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
    this.units = new UnitRenderer(this.scene.scene);
    this.banner = document.createElement('div');
    this.banner.className = 'dev-banner';
    this.banner.hidden = true;
    ui.appendChild(this.banner);
    window.addEventListener('resize', () => this.scene.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop();
      else this.start();
    });
    window.addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (this.speed > 0) {
        this.pausedSpeed = this.speed;
        this.speed = 0;
      } else {
        this.speed = this.pausedSpeed;
      }
    } else if (e.code === 'Digit1') this.speed = SPEEDS[1];
    else if (e.code === 'Digit2') this.speed = SPEEDS[2];
    else if (e.code === 'Digit3') this.speed = SPEEDS[3];
    else if (e.code === 'KeyR' && this.setup) void this.startBattle(this.setup);
  };

  loadMap(id: string): void {
    this.map = getMap(id);
    this.terrain = createTerrain(this.map);
    this.scene.setMap(this.map, this.terrain);
    this.cam.setTerrain(this.terrain, this.map.play);
    this.cam.setView(0, 0, Math.PI * 0.5 + 0.35, 0.62, 85);
  }

  async startBattle(setup: BattleSetup): Promise<void> {
    this.setup = setup;
    if (!this.map || this.map.id !== setup.mapId) this.loadMap(setup.mapId);
    const n = setup.units.length;
    const types = new Uint8Array(n);
    const teams = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      types[i] = setup.units[i].type;
      teams[i] = setup.units[i].team;
    }
    this.units.build(UNITS, types, teams, n);
    this.banner.hidden = true;
    this.overlay.stats.units = n;
    await this.sim.start(setup, n);
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
    const sim = this.sim;
    if (sim.ready && sim.curr) {
      const alpha = sim.alpha();
      this.units.update(sim, alpha);
      const s = this.overlay.stats;
      const c = sim.curr;
      s.tickMs = c[H_TICK_MS];
      s.tickMsMax = c[H_TICK_MS_MAX];
      s.alive = c[H_ALIVE_BLUE] + c[H_ALIVE_RED];
      s.projectiles = c[H_PROJECTILES];
      s.simTick = c[H_TICK];
      s.snapshotBuffers = c[H_BUFFERS_ALLOCATED];
      const result = c[H_RESULT];
      if (result !== RESULT_RUNNING && this.banner.hidden) {
        this.banner.hidden = false;
        this.banner.textContent =
          result === RESULT_BLUE ? 'Blue wins' : result === RESULT_RED ? 'Red wins' : 'Draw';
      }
    }
    this.scene.render();
    sim.advance(dt, this.speed);

    const info = this.scene.renderer.info.render;
    this.overlay.stats.drawCalls = info.calls;
    this.overlay.stats.triangles = info.triangles;
    this.overlay.stats.resolutionScale = this.scene.resolutionScale;
    this.overlay.frame(now, frameMs, performance.now() - t0);
  };
}
