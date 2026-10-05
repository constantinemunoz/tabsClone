import { Vector3 } from 'three';
import { formation, parseArmy } from '../data/army-gen.ts';
import { getMap, MAPS } from '../data/maps.ts';
import { UNITS } from '../data/units.ts';
import { QUALITY_PRESETS, type QualityTier } from '../platform/quality.ts';
import { loadSettings, type Settings, saveSettings } from '../platform/settings.ts';
import { decodeSetup, encodeSetup, shareUrl } from '../platform/share.ts';
import { loadJSON, saveJSON } from '../platform/storage.ts';
import { pickGround } from '../render/pick.ts';
import { renderPortraits } from '../render/portraits.ts';
import type { Ghost } from '../render/placement-view.ts';
import { RESULT_DRAW, RESULT_RUNNING } from '../sim/constants.ts';
import type { BattleSetup } from '../sim/sim.ts';
import { H_ALIVE_BLUE, H_ALIVE_RED, H_COST_BLUE, H_COST_RED, H_DAMAGE, H_RESULT, H_TICK, MAX_STAT_TYPES } from '../sim/snapshot.ts';
import { BattleScreen, MenuScreen, OpenCodeDialog, PlacementScreen, ResultScreen, SettingsDialog, ShareDialog, Toast } from '../ui/screens.ts';
import { type App, SPEEDS } from './app.ts';
import { devSetupFromUrl } from './dev-battles.ts';
import { Placement } from './placement.ts';

type Phase = 'menu' | 'placement' | 'battle' | 'result';

/** Armies for the battle that plays behind the main menu. */
const DEMO_ARMY = 'hoplite*16,spartan*4,marine*6,peltast*8,skirmisher*8,slinger*8,archer*8,horseman*4';
/** Seconds the finished battle keeps playing before the result appears. */
const RESULT_DELAY = 2.2;

interface SavedSandbox {
  mapId: string;
  budget: number;
  units: number[];
}

function randomSeed(): number {
  return (Math.random() * 4294967296) >>> 0;
}

/**
 * The phase state machine (menu, placement, battle, result) and the glue between the engine
 * (App), the placement rules and the HTML screens.
 */
export class Game {
  private phase: Phase = 'menu';
  private readonly app: App;
  private readonly canvas: HTMLCanvasElement;
  private settings: Settings;
  readonly placement: Placement;
  private team = 0;
  private selected = 0;
  private ghost: Ghost | null = null;
  private drawnVersion = -1;
  private drawnGhost = '';
  private painting = false;
  private paintX = 0;
  private paintZ = 0;
  private readonly hit = new Vector3();
  private battleSetup: BattleSetup | null = null;
  private startCount: [number, number] = [0, 0];
  private startCost: [number, number] = [1, 1];
  private resultTimer = -1;
  private resultTick = 0;
  private speedIndex = 2;
  private lastSpeedIndex = 2;
  /** A seed shared or loaded for an exact placement version, so that battle replays exactly. */
  private fixedSeed: { seed: number; version: number } | null = null;
  private attractYaw = 0.6;
  private demoMap = 0;
  private saveTimer = 0;

  private readonly menu: MenuScreen;
  private readonly settingsDlg: SettingsDialog;
  private readonly shareDlg: ShareDialog;
  private readonly openDlg: OpenCodeDialog;
  private readonly placeUi: PlacementScreen;
  private readonly battleUi: BattleScreen;
  private readonly resultUi: ResultScreen;
  private readonly toast: Toast;

  constructor(app: App, canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.app = app;
    this.canvas = canvas;
    this.settings = loadSettings();
    this.applyQuality();
    this.placement = new Placement('meadow');

    this.menu = new MenuScreen(ui);
    this.placeUi = new PlacementScreen(ui);
    this.battleUi = new BattleScreen(ui);
    this.resultUi = new ResultScreen(ui);
    this.settingsDlg = new SettingsDialog(ui);
    this.shareDlg = new ShareDialog(ui);
    this.openDlg = new OpenCodeDialog(ui);
    this.toast = new Toast(ui);

    this.menu.onSandbox = () => this.toPlacement();
    this.menu.onSettings = () => this.settingsDlg.show(this.settings.quality, this.app.detectedTier);
    this.menu.onOpenCode = () => this.openDlg.show();
    this.openDlg.onOpen = (text) => this.openShared(text);
    this.settingsDlg.onQuality = (q) => {
      this.settings.quality = q;
      saveSettings(this.settings);
      this.applyQuality();
      this.settingsDlg.show(q, this.app.detectedTier);
    };
    this.app.onPhysicsState = (s) => this.settingsDlg.setPhysics(s);

    const pu = this.placeUi;
    pu.onMenu = () => this.toMenu();
    pu.onMap = (id) => {
      this.placement.mapId = getMap(id).id;
      this.placement.version++;
      this.app.loadMap(this.placement.mapId);
      this.app.zones.setActive(this.team);
      this.placementChanged();
    };
    pu.onBudget = (b) => {
      this.placement.budget = b;
      this.placement.version++;
      this.placementChanged();
    };
    pu.onTeam = (t) => this.setTeam(t);
    pu.onSelect = (k) => {
      this.selected = k;
      this.refreshPlacementUi();
    };
    pu.onMirror = () => {
      this.placement.mirror(this.team);
      this.placementChanged();
      this.toast.show(this.team === 0 ? 'Red now mirrors blue' : 'Blue now mirrors red');
    };
    pu.onClear = () => {
      this.placement.clear(this.team);
      this.placementChanged();
    };
    pu.onShare = () => {
      const seed = this.seedForPlacement();
      this.fixedSeed = { seed, version: this.placement.version };
      this.openShare(this.placement.toSetup(seed));
    };
    pu.onStart = () => this.startFromPlacement();

    this.battleUi.onSpeed = (k) => this.setSpeed(k);
    this.battleUi.onEdit = () => this.toPlacement();
    this.battleUi.onMenu = () => this.toMenu();
    this.resultUi.onReplay = () => this.battleSetup && this.startBattle(this.battleSetup);
    this.resultUi.onEdit = () => this.toPlacement();
    this.resultUi.onShare = () => this.battleSetup && this.openShare(this.battleSetup);
    this.resultUi.onMenu = () => this.toMenu();

    app.cam.handlers = {
      onLeftDown: (x, y) => this.paintStart(x, y),
      onLeftMove: (x, y) => this.paintMove(x, y),
      onLeftUp: () => {
        this.painting = false;
      },
      onRightClick: (x, y) => this.removeAt(x, y),
      onHover: (x, y) => this.hover(x, y),
    };
    app.onFrame = (dt) => this.frame(dt);
    window.addEventListener('keydown', this.onKey);

    // Portraits need the renderer; draw them once now.
    try {
      this.placeUi.setPortraits(renderPortraits(app.scene.renderer, UNITS));
    } catch (err) {
      console.warn('Could not render unit portraits.', err);
    }
  }

  /** Decide the first screen: a shared link, a developer battle, or the menu. */
  boot(): void {
    const dev = devSetupFromUrl(location.search);
    if (dev) {
      this.placement.load(dev);
      this.startBattle(dev);
      return;
    }
    this.restoreSandbox();
    const code = location.hash.slice(1);
    if (code) {
      if (this.openShared(code)) return;
      this.toast.show("That link's battle code couldn't be read, so here's the menu.", 3500);
    }
    this.toMenu();
  }

  // ---- Phases ------------------------------------------------------------------------------

  private hideAll(): void {
    this.menu.show(false);
    this.placeUi.show(false);
    this.battleUi.show(false);
    this.resultUi.show(false);
    this.app.placementView.setVisible(false);
    this.app.zones.setVisible(false);
    this.ghost = null;
    this.painting = false;
  }

  toMenu(): void {
    this.hideAll();
    this.phase = 'menu';
    this.app.cam.enabled = false;
    this.app.cam.leftClaimed = false;
    this.startDemo();
    this.menu.show(true);
  }

  private startDemo(): void {
    const map = MAPS[this.demoMap % MAPS.length];
    this.demoMap++;
    const army = parseArmy(DEMO_ARMY);
    const setup: BattleSetup = {
      mapId: map.id,
      seed: randomSeed(),
      units: [...formation(army, 0, map.zones.blue), ...formation(army, 1, map.zones.red)],
    };
    this.app.stopBattle();
    this.app.loadMap(map.id);
    this.app.speed = 1;
    void this.app.startBattle(setup);
    this.resultTimer = -1;
  }

  toPlacement(): void {
    this.hideAll();
    this.phase = 'placement';
    this.app.stopBattle();
    this.app.loadMap(this.placement.mapId);
    this.app.cam.enabled = true;
    this.app.cam.leftClaimed = true;
    this.app.cam.setView(0, 0, 0, 0.95, 105, true);
    this.app.placementView.setVisible(true);
    this.app.zones.setVisible(true);
    this.app.zones.setActive(this.team);
    this.drawnVersion = -1;
    this.refreshPlacementUi();
    this.placeUi.show(true);
  }

  private startFromPlacement(): void {
    if (this.placement.count(0) === 0 || this.placement.count(1) === 0) {
      this.toast.show('Both armies need at least one unit.');
      return;
    }
    this.startBattle(this.placement.toSetup(this.seedForPlacement()));
  }

  private seedForPlacement(): number {
    if (this.fixedSeed && this.fixedSeed.version === this.placement.version) return this.fixedSeed.seed;
    return randomSeed();
  }

  startBattle(setup: BattleSetup): void {
    this.hideAll();
    this.phase = 'battle';
    this.battleSetup = setup;
    this.startCount = [0, 0];
    this.startCost = [0, 0];
    for (const u of setup.units) {
      this.startCount[u.team]++;
      this.startCost[u.team] += UNITS[u.type].cost;
    }
    this.app.cam.enabled = true;
    this.app.cam.leftClaimed = false;
    // Glide in from the placement overview to a closer, three-quarter view of the field.
    this.app.cam.setView(0, 0, 0.55, 0.62, 72, true);
    this.app.stopBattle();
    this.setSpeed(2);
    void this.app.startBattle(setup);
    this.resultTimer = -1;
    this.battleUi.show(true);
  }

  private toResult(): void {
    const c = this.app.sim.curr;
    if (!c) return;
    this.phase = 'result';
    this.battleUi.show(false);
    const alive: [number, number] = [c[H_ALIVE_BLUE], c[H_ALIVE_RED]];
    const top: [string, string] = ['–', '–'];
    for (const t of [0, 1]) {
      let best = -1;
      let bestDmg = 0;
      for (let k = 0; k < UNITS.length && k < MAX_STAT_TYPES; k++) {
        const dmg = c[H_DAMAGE + t * MAX_STAT_TYPES + k];
        if (dmg > bestDmg) {
          bestDmg = dmg;
          best = k;
        }
      }
      if (best >= 0) top[t] = `${UNITS[best].name} (${Math.round(bestDmg)})`;
    }
    const result = c[H_RESULT];
    this.resultUi.show(true, {
      winner: result === RESULT_DRAW ? -1 : result,
      seconds: this.resultTick / 30,
      lost: [this.startCount[0] - alive[0], this.startCount[1] - alive[1]],
      survivors: alive,
      topUnit: top,
    });
  }

  // ---- Per frame ---------------------------------------------------------------------------

  private frame(dt: number): void {
    const c = this.app.sim.curr;
    if (this.phase === 'menu') {
      // A slow orbit over the demo battle; start a new one when it ends.
      this.attractYaw += dt * 0.05;
      this.app.cam.setView(0, 0, this.attractYaw, 0.42, 78);
      if (c && c[H_RESULT] !== RESULT_RUNNING) {
        if (this.resultTimer < 0) this.resultTimer = 0;
        this.resultTimer += dt;
        if (this.resultTimer > 4) this.startDemo();
      }
      return;
    }
    if (this.phase === 'placement') {
      const key = this.ghost ? `${this.ghost.type},${this.ghost.team},${this.ghost.x},${this.ghost.z}` : '';
      if (this.drawnVersion !== this.placement.version || key !== this.drawnGhost) {
        this.drawnVersion = this.placement.version;
        this.drawnGhost = key;
        this.app.placementView.update(UNITS, this.placement, this.ghost);
      }
      return;
    }
    if (!c || !this.app.sim.ready) return;
    if (this.phase === 'battle') {
      const frac: [number, number] = [c[H_COST_BLUE] / Math.max(1, this.startCost[0]), c[H_COST_RED] / Math.max(1, this.startCost[1])];
      this.battleUi.update(frac, [c[H_ALIVE_BLUE], c[H_ALIVE_RED]], this.speedIndex);
      if (c[H_RESULT] !== RESULT_RUNNING) {
        if (this.resultTimer < 0) {
          this.resultTimer = 0;
          this.resultTick = c[H_TICK];
        }
        this.resultTimer += dt;
        if (this.resultTimer > RESULT_DELAY) this.toResult();
      }
    }
  }

  // ---- Placement input ---------------------------------------------------------------------

  private pick(clientX: number, clientY: number): boolean {
    const r = this.canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1;
    const ny = -((clientY - r.top) / r.height) * 2 + 1;
    return pickGround(this.app.scene.camera, nx, ny, this.app.terrain, this.hit);
  }

  private hover(x: number, y: number): void {
    if (this.phase !== 'placement') return;
    if (!this.pick(x, y)) {
      this.ghost = null;
      return;
    }
    const sx = Placement.snap(this.hit.x);
    const sz = Placement.snap(this.hit.z);
    const ok = this.placement.check(this.selected, this.team, sx, sz, this.app.quality.unitCap) === 'ok';
    this.ghost = ok ? { type: this.selected, team: this.team, x: sx, z: sz } : null;
    this.canvas.style.cursor = ok ? 'copy' : 'default';
  }

  private paintStart(x: number, y: number): void {
    if (this.phase !== 'placement' || !this.pick(x, y)) return;
    this.painting = true;
    const sx = Placement.snap(this.hit.x);
    const sz = Placement.snap(this.hit.z);
    const why = this.placement.check(this.selected, this.team, sx, sz, this.app.quality.unitCap);
    if (why === 'ok') {
      this.placement.place(this.selected, this.team, sx, sz, this.app.quality.unitCap);
      this.placementChanged();
    } else if (why === 'outside') {
      this.toast.show(this.team === 0 ? 'Blue units go in the blue zone.' : 'Red units go in the red zone.');
    } else if (why === 'budget') {
      this.toast.show('Not enough budget left for that unit.');
    } else if (why === 'cap') {
      this.toast.show(`That's the most units this quality setting allows (${this.app.quality.unitCap}).`);
    }
    this.paintX = sx;
    this.paintZ = sz;
  }

  /** Dragging paints a row: units at the type's spacing along the drag, on the 1 m grid. */
  private paintMove(x: number, y: number): void {
    this.hover(x, y);
    if (!this.painting || this.phase !== 'placement' || !this.pick(x, y)) return;
    const spacing = Placement.rowSpacing(this.selected);
    let dx = this.hit.x - this.paintX;
    let dz = this.hit.z - this.paintZ;
    let dist = Math.hypot(dx, dz);
    let changed = false;
    while (dist >= spacing) {
      const nx = this.paintX + (dx / dist) * spacing;
      const nz = this.paintZ + (dz / dist) * spacing;
      if (this.placement.place(this.selected, this.team, nx, nz, this.app.quality.unitCap)) changed = true;
      this.paintX = nx;
      this.paintZ = nz;
      dx = this.hit.x - this.paintX;
      dz = this.hit.z - this.paintZ;
      dist = Math.hypot(dx, dz);
    }
    if (changed) this.placementChanged();
  }

  private removeAt(x: number, y: number): void {
    if (this.phase !== 'placement' || !this.pick(x, y)) return;
    if (this.placement.removeNear(this.hit.x, this.hit.z, 1.4)) this.placementChanged();
  }

  private setTeam(t: number): void {
    this.team = t;
    this.app.zones.setActive(t);
    this.refreshPlacementUi();
  }

  private placementChanged(): void {
    this.refreshPlacementUi();
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveSandbox(), 400);
  }

  private refreshPlacementUi(): void {
    const p = this.placement;
    this.placeUi.update({
      team: this.team,
      selected: this.selected,
      mapId: p.mapId,
      budget: p.budget,
      spent: [p.spent(0), p.spent(1)],
      counts: [p.count(0), p.count(1)],
      total: p.units.length,
      cap: this.app.quality.unitCap,
    });
  }

  // ---- Saving and sharing ------------------------------------------------------------------

  private saveSandbox(): void {
    const units: number[] = [];
    for (const u of this.placement.units) units.push(u.type, u.team, u.x, u.z);
    saveJSON('sandbox', { mapId: this.placement.mapId, budget: this.placement.budget, units } satisfies SavedSandbox);
  }

  private restoreSandbox(): void {
    const s = loadJSON<SavedSandbox | null>('sandbox', null);
    if (!s || typeof s !== 'object' || !Array.isArray(s.units)) return;
    this.placement.mapId = getMap(String(s.mapId)).id;
    this.placement.budget = typeof s.budget === 'number' ? s.budget : 0;
    for (let k = 0; k + 3 < s.units.length; k += 4) {
      const [type, team, x, z] = s.units.slice(k, k + 4);
      if (UNITS[type] && (team === 0 || team === 1)) this.placement.units.push({ type, team, x, z });
    }
    this.placement.version++;
  }

  private openShare(setup: BattleSetup): void {
    this.shareDlg.show(shareUrl(setup), encodeSetup(setup));
  }

  /** Load a share link or code into placement. Returns false if it can't be read. */
  private openShared(text: string): boolean {
    const code = text.includes('#') ? text.slice(text.lastIndexOf('#') + 1) : text;
    const setup = decodeSetup(code);
    if (!setup) return false;
    this.placement.load(setup);
    this.placement.budget = 0;
    this.fixedSeed = { seed: setup.seed, version: this.placement.version };
    this.toPlacement();
    this.toast.show('Shared battle loaded. Press Start to watch it.');
    return true;
  }

  // ---- Settings, speed, keys ---------------------------------------------------------------

  private applyQuality(): void {
    const tier: QualityTier = this.settings.quality === 'auto' ? this.app.detectedTier : this.settings.quality;
    this.app.setQuality(QUALITY_PRESETS[tier]);
  }

  private setSpeed(k: number): void {
    if (k > 0) this.lastSpeedIndex = k;
    this.speedIndex = k;
    this.app.speed = SPEEDS[k];
  }

  private onKey = (e: KeyboardEvent): void => {
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA')) return;
    if (this.settingsDlg.open || this.shareDlg.open || this.openDlg.open) {
      if (e.code === 'Escape') {
        this.settingsDlg.close();
        this.shareDlg.close();
        this.openDlg.close();
      }
      return;
    }
    if (e.repeat) return;
    if (this.phase === 'placement') {
      const n = e.code.startsWith('Digit') ? Number(e.code.slice(5)) : 0;
      if (n >= 1 && n <= UNITS.length) {
        this.selected = n - 1;
        this.refreshPlacementUi();
      } else if (e.code === 'Tab') {
        e.preventDefault();
        this.setTeam(1 - this.team);
      } else if (e.code === 'Enter') {
        this.startFromPlacement();
      }
    } else if (this.phase === 'battle' || this.phase === 'result') {
      if (e.code === 'Space' || e.code === 'Escape') {
        e.preventDefault();
        this.setSpeed(this.speedIndex === 0 ? this.lastSpeedIndex : 0);
      } else if (e.code === 'Digit1') this.setSpeed(1);
      else if (e.code === 'Digit2') this.setSpeed(2);
      else if (e.code === 'Digit3') this.setSpeed(3);
      else if (e.code === 'KeyR' && this.battleSetup) this.startBattle(this.battleSetup);
    }
  };
}
