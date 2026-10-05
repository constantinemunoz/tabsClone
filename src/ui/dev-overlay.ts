/** Numbers the overlay shows that come from outside the frame loop. */
export interface DevStats {
  tickMs: number;
  tickMsMax: number;
  drawCalls: number;
  triangles: number;
  units: number;
  alive: number;
  ragdolls: number;
  projectiles: number;
  resolutionScale: number;
  tier: string;
  simTick: number;
  snapshotBuffers: number;
}

/**
 * Developer overlay (toggle with ` or F3): fps, frame time, main-thread script time,
 * sim tick time, draw calls, unit count and active ragdolls.
 */
export class DevOverlay {
  readonly stats: DevStats = {
    tickMs: 0,
    tickMsMax: 0,
    drawCalls: 0,
    triangles: 0,
    units: 0,
    alive: 0,
    ragdolls: 0,
    projectiles: 0,
    resolutionScale: 1,
    tier: '',
    simTick: 0,
    snapshotBuffers: 0,
  };
  visible = false;
  private readonly el: HTMLDivElement;
  private frames = 0;
  private frameSum = 0;
  private frameMax = 0;
  private scriptSum = 0;
  private scriptMax = 0;
  private lastUpdate = 0;
  /** Rolling averages, readable by the adaptive-quality logic. */
  avgFrameMs = 16.7;
  avgScriptMs = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'dev-overlay';
    this.el.hidden = true;
    parent.appendChild(this.el);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote' || e.code === 'F3') {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  toggle(force?: boolean): void {
    this.visible = force ?? !this.visible;
    this.el.hidden = !this.visible;
  }

  /** Record one frame. frameMs is the time since the previous frame, scriptMs our own work. */
  frame(now: number, frameMs: number, scriptMs: number): void {
    this.frames++;
    this.frameSum += frameMs;
    this.scriptSum += scriptMs;
    if (frameMs > this.frameMax) this.frameMax = frameMs;
    if (scriptMs > this.scriptMax) this.scriptMax = scriptMs;
    if (now - this.lastUpdate < 500) return;
    const n = Math.max(1, this.frames);
    this.avgFrameMs = this.frameSum / n;
    this.avgScriptMs = this.scriptSum / n;
    if (this.visible) {
      const s = this.stats;
      const fps = 1000 / Math.max(0.001, this.avgFrameMs);
      this.el.textContent =
        `fps        ${fps.toFixed(0)}\n` +
        `frame ms   ${this.avgFrameMs.toFixed(2)}  (max ${this.frameMax.toFixed(1)})\n` +
        `script ms  ${this.avgScriptMs.toFixed(2)}  (max ${this.scriptMax.toFixed(1)})\n` +
        `tick ms    ${s.tickMs.toFixed(2)}  (max ${s.tickMsMax.toFixed(2)})\n` +
        `draw calls ${s.drawCalls}\n` +
        `triangles  ${(s.triangles / 1000).toFixed(0)}k\n` +
        `units      ${s.alive} / ${s.units}\n` +
        `ragdolls   ${s.ragdolls}\n` +
        `projectile ${s.projectiles}\n` +
        `sim tick   ${s.simTick}  (buffers ${s.snapshotBuffers})\n` +
        `quality    ${s.tier}  res x${s.resolutionScale.toFixed(2)}`;
    }
    this.frames = 0;
    this.frameSum = 0;
    this.scriptSum = 0;
    this.frameMax = 0;
    this.scriptMax = 0;
    this.lastUpdate = now;
  }
}
