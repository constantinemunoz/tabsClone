import { getMap, type MapDef } from '../data/maps.ts';
import { UNITS } from '../data/units.ts';
import { detectQualityTier, QUALITY_PRESETS, type QualitySettings } from '../platform/quality.ts';
import { CameraController } from '../render/camera.ts';
import { ProjectileRenderer } from '../render/projectiles.ts';
import { loadRapier, RagdollSystem } from '../render/ragdolls.ts';
import { GameScene } from '../render/scene.ts';
import { UnitRenderer } from '../render/units.ts';
import { PlacementView } from '../render/placement-view.ts';
import { ZoneOverlay } from '../render/zones.ts';
import type { BattleSetup } from '../sim/sim.ts';
import {
  H_ALIVE_BLUE,
  H_ALIVE_RED,
  H_BUFFERS_ALLOCATED,
  H_PROJECTILES,
  H_TICK,
  H_TICK_MS,
  H_TICK_MS_MAX,
} from '../sim/snapshot.ts';
import { createTerrain, type Terrain } from '../sim/terrain.ts';
import { DevOverlay } from '../ui/dev-overlay.ts';
import { SimClient } from './sim-client.ts';

/** Battle speeds: pause, 0.25x, 1x, 2x. */
export const SPEEDS = [0, 0.25, 1, 2];

/** Most units a battle can hold on any tier; sizes the shadow pool. */
const MAX_UNITS = 1200;

/**
 * The engine host: owns the scene, camera, overlay, the simulation client, the renderers and
 * the frame loop. It knows nothing about menus; the game controller (game.ts) drives it.
 * Pauses everything while the tab is hidden.
 */
export class App {
  readonly scene: GameScene;
  readonly cam: CameraController;
  readonly overlay: DevOverlay;
  readonly sim = new SimClient();
  readonly ragdolls: RagdollSystem;
  readonly units: UnitRenderer;
  readonly projectiles: ProjectileRenderer;
  readonly placementView: PlacementView;
  readonly zones: ZoneOverlay;
  quality: QualitySettings;
  /** Tier picked automatically for this machine (used when settings say "auto"). */
  readonly detectedTier: QualitySettings['tier'];
  map!: MapDef;
  terrain!: Terrain;
  setup: BattleSetup | null = null;
  speed = 1;
  private pausedSpeed = 1;
  private rapierLoading = false;
  /** True while a battle is loaded (its units are drawn and the sim is stepping). */
  battleActive = false;
  /** Called every frame before rendering, with real and battle-speed-scaled dt. */
  onFrame: ((dt: number, battleDt: number) => void) | null = null;
  /** Called when the ragdoll physics engine finishes loading or fails to load. */
  onPhysicsState: ((state: 'loading' | 'ready' | 'failed') => void) | null = null;

  private raf = 0;
  private lastFrame = 0;
  private running = false;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    const probe = canvas.getContext('webgl2');
    this.detectedTier = detectQualityTier(probe);
    this.quality = QUALITY_PRESETS[this.detectedTier];
    this.scene = new GameScene(canvas, this.quality);
    this.cam = new CameraController(this.scene.camera, canvas);
    this.overlay = new DevOverlay(ui);
    this.overlay.stats.tier = this.quality.tier;
    this.ragdolls = new RagdollSystem(this.quality.ragdollBudget, this.quality.corpseCap);
    this.units = new UnitRenderer(this.scene.scene, this.ragdolls, MAX_UNITS);
    this.projectiles = new ProjectileRenderer(this.scene.scene);
    this.sim.eventSink = (ev, offset, count) => {
      this.units.onEvents(ev, offset, count);
      this.projectiles.onEvents(ev, offset, count);
    };
    this.sim.snapshotSink = this.units.onSnapshot;
    this.placementView = new PlacementView(this.scene.scene, UNITS, MAX_UNITS);
    this.zones = new ZoneOverlay(this.scene.scene);
    window.addEventListener('resize', () => this.scene.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop();
      else this.start();
    });
  }

  /** Switch quality tier live: shadows, resolution, ragdoll budget. */
  setQuality(q: QualitySettings): void {
    this.quality = q;
    this.scene.applyQuality(q);
    this.ragdolls.setBudget(q.ragdollBudget);
    this.overlay.stats.tier = q.tier;
  }

  /** Load the ragdoll physics engine in the background, after the first frames are on screen. */
  loadPhysicsLater(): void {
    if (this.rapierLoading) return;
    this.rapierLoading = true;
    this.onPhysicsState?.('loading');
    const go = () => {
      loadRapier()
        .then((R) => {
          this.ragdolls.attachPhysics(R);
          if (this.scene.terrainData) {
            this.ragdolls.setTerrain(this.scene.terrainData.physicsVertices, this.scene.terrainData.physicsIndices, this.terrain.killY);
          }
          this.onPhysicsState?.('ready');
        })
        .catch((err: unknown) => {
          // Without Rapier everything still works: deaths and tumbles use the shader fallbacks.
          console.warn('Ragdoll physics unavailable, using shader fallbacks.', err);
          this.onPhysicsState?.('failed');
        });
    };
    setTimeout(go, 300);
  }

  togglePause(): void {
    if (this.speed > 0) {
      this.pausedSpeed = this.speed;
      this.speed = 0;
    } else {
      this.speed = this.pausedSpeed || 1;
    }
  }

  get paused(): boolean {
    return this.speed === 0;
  }

  loadMap(id: string): void {
    if (this.map && this.map.id === getMap(id).id) return;
    this.map = getMap(id);
    this.terrain = createTerrain(this.map);
    this.scene.setMap(this.map, this.terrain);
    this.cam.setTerrain(this.terrain, this.map.play);
    this.cam.setView(0, 0, Math.PI * 0.5 + 0.35, 0.62, 85);
    this.units.setTerrain(this.terrain);
    this.placementView.setTerrain(this.terrain);
    this.zones.build(this.map, this.terrain);
    if (this.scene.terrainData) {
      this.ragdolls.setTerrain(this.scene.terrainData.physicsVertices, this.scene.terrainData.physicsIndices, this.terrain.killY);
    }
  }

  async startBattle(setup: BattleSetup): Promise<void> {
    this.setup = setup;
    if (!this.map || this.map.id !== setup.mapId) this.loadMap(setup.mapId);
    else if (this.scene.terrainData) {
      // Same map: just clear the physics world of old ragdolls.
      this.ragdolls.setTerrain(this.scene.terrainData.physicsVertices, this.scene.terrainData.physicsIndices, this.terrain.killY);
    }
    const n = setup.units.length;
    const types = new Uint8Array(n);
    const teams = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      types[i] = setup.units[i].type;
      teams[i] = setup.units[i].team;
    }
    this.units.build(UNITS, types, teams, n);
    this.projectiles.clear();
    this.overlay.stats.units = n;
    if (this.speed === 0) this.speed = this.pausedSpeed || 1;
    this.battleActive = true;
    await this.sim.start(setup, n);
  }

  /** Tear down the running battle (its units, ragdolls, projectiles and worker). */
  stopBattle(): void {
    this.battleActive = false;
    this.sim.dispose();
    this.units.dispose();
    this.projectiles.clear();
    this.ragdolls.setBattle(0, new Uint8Array(0), new Uint8Array(0), [], []);
    this.units.shadows.begin();
    this.units.shadows.end();
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
    this.onFrame?.(dt, dt * this.speed);
    const sim = this.sim;
    if (this.battleActive && sim.ready && sim.curr) {
      const alpha = sim.alpha();
      const u0 = performance.now();
      this.units.update(sim, alpha, dt * this.speed);
      this.projectiles.update(sim, alpha, dt * this.speed);
      this.overlay.stats.updateMs = performance.now() - u0;
      const s = this.overlay.stats;
      const c = sim.curr;
      s.tickMs = c[H_TICK_MS];
      s.tickMsMax = c[H_TICK_MS_MAX];
      s.alive = c[H_ALIVE_BLUE] + c[H_ALIVE_RED];
      s.projectiles = c[H_PROJECTILES];
      s.simTick = c[H_TICK];
      s.snapshotBuffers = c[H_BUFFERS_ALLOCATED];
      s.ragdolls = this.units.activeRagdolls;
    }
    const r0 = performance.now();
    this.scene.render();
    this.overlay.stats.renderMs = performance.now() - r0;
    if (this.battleActive) sim.advance(dt, this.speed);

    const info = this.scene.renderer.info.render;
    this.overlay.stats.drawCalls = info.calls;
    this.overlay.stats.triangles = info.triangles;
    this.overlay.stats.resolutionScale = this.scene.resolutionScale;
    this.overlay.frame(now, frameMs, performance.now() - t0);
  };
}
