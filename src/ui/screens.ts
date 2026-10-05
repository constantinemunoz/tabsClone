import { GAME_TITLE } from '../config.ts';
import { MAPS } from '../data/maps.ts';
import { type UnitDef, UNITS } from '../data/units.ts';
import { BUDGET_OPTIONS } from '../game/placement.ts';
import type { QualityTier } from '../platform/quality.ts';
import { h, icon, ICONS, setVisible } from './dom.ts';

/** Copy text to the clipboard, falling back to selecting it in the given field. */
async function copyText(text: string, field: HTMLInputElement | HTMLTextAreaElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    field.focus();
    field.select();
    return false;
  }
}

// ---- Main menu ----------------------------------------------------------------------------

export class MenuScreen {
  readonly el: HTMLElement;
  onSandbox: () => void = () => {};
  onOpenCode: () => void = () => {};
  onSettings: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.el = h(
      'section',
      { class: 'screen menu', hidden: true, 'aria-label': 'Main menu' },
      h(
        'div',
        { class: 'panel meander menu-card' },
        h(
          'div',
          { class: 'menu-body' },
          h('div', { class: 'eyebrow' }, 'Hoplites, slingers and horses'),
          h('h1', { class: 'title' }, GAME_TITLE),
          h('p', { class: 'lede' }, 'Line up two armies of ancient Greeks, press start, and watch it all go gloriously wrong.'),
          h(
            'nav',
            { class: 'menu-actions' },
            h('button', { class: 'btn btn-primary btn-big', onclick: () => this.onSandbox() }, 'Sandbox'),
            h('button', { class: 'btn', onclick: () => this.onOpenCode() }, 'Open a shared battle'),
            h('button', { class: 'btn', onclick: () => this.onSettings() }, icon(ICONS.gear), 'Settings'),
          ),
        ),
      ),
      h('div', { class: 'menu-foot' }, 'WASD to move · drag to orbit · wheel to zoom'),
    );
    parent.appendChild(this.el);
  }

  show(v: boolean): void {
    setVisible(this.el, v);
  }
}

// ---- Dialogs -------------------------------------------------------------------------------

abstract class Dialog {
  readonly el: HTMLElement;
  protected readonly body: HTMLElement;

  constructor(parent: HTMLElement, title: string) {
    this.body = h('div', { class: 'dialog-body' }, h('h2', {}, title));
    this.el = h('div', { class: 'dialog-backdrop', hidden: true, role: 'dialog', 'aria-label': title }, h('div', { class: 'panel meander dialog' }, this.body));
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.el) this.close();
    });
    parent.appendChild(this.el);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  close(): void {
    this.el.hidden = true;
  }
}

export class SettingsDialog extends Dialog {
  onQuality: (q: QualityTier | 'auto') => void = () => {};
  private readonly seg: HTMLElement;
  private readonly status: HTMLElement;
  private readonly autoLabel: HTMLButtonElement;

  constructor(parent: HTMLElement) {
    super(parent, 'Settings');
    this.autoLabel = h('button', { 'data-q': 'auto', 'aria-pressed': 'false' }, 'Auto');
    this.seg = h(
      'div',
      { class: 'seg', role: 'group', 'aria-label': 'Graphics quality' },
      this.autoLabel,
      ...(['low', 'medium', 'high'] as const).map((q) => h('button', { 'data-q': q, 'aria-pressed': 'false' }, q[0].toUpperCase() + q.slice(1))),
    );
    this.seg.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (b) this.onQuality(b.dataset.q as QualityTier | 'auto');
    });
    this.status = h('div', { class: 'status' }, '');
    this.body.append(
      h('label', { class: 'field' }, h('span', {}, 'Graphics quality'), this.seg),
      h('p', {}, 'Higher quality draws real shadows, keeps more corpses and allows more ragdolls at once. If the frame rate drops, the game lowers its resolution first.'),
      this.status,
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn btn-primary', onclick: () => this.close() }, 'Done')),
    );
  }

  show(quality: QualityTier | 'auto', detected: QualityTier): void {
    this.autoLabel.textContent = `Auto (${detected})`;
    for (const b of this.seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.q === quality));
    this.el.hidden = false;
  }

  setPhysics(state: 'loading' | 'ready' | 'failed'): void {
    this.status.dataset.state = state;
    this.status.textContent =
      state === 'ready'
        ? 'Ragdoll physics: on'
        : state === 'failed'
          ? 'Ragdoll physics: unavailable in this browser, so deaths and tumbles use simpler animations.'
          : 'Ragdoll physics: loading…';
  }
}

export class ShareDialog extends Dialog {
  private readonly link: HTMLInputElement;
  private readonly code: HTMLTextAreaElement;
  private readonly note: HTMLElement;

  constructor(parent: HTMLElement) {
    super(parent, 'Share this battle');
    this.link = h('input', { type: 'text', readonly: true, 'aria-label': 'Battle link' });
    this.code = h('textarea', { rows: 4, readonly: true, 'aria-label': 'Battle code' });
    this.note = h('div', { class: 'status' }, '');
    const copyLink = h('button', { class: 'btn', onclick: () => void this.copy(this.link.value, this.link, 'Link copied') }, 'Copy link');
    const copyCode = h('button', { class: 'btn', onclick: () => void this.copy(this.code.value, this.code, 'Code copied') }, 'Copy code');
    this.body.append(
      h('p', {}, 'Anyone who opens this link gets the same map, armies and random seed, so the battle plays out the same way.'),
      h('div', { class: 'copy-row' }, this.link, copyLink),
      h('label', { class: 'field' }, h('span', {}, 'Or paste this code into "Open a shared battle"'), this.code),
      h('div', { class: 'copy-row' }, this.note, h('div', { style: 'flex:1' }), copyCode),
      h('div', { class: 'dialog-actions' }, h('button', { class: 'btn btn-primary', onclick: () => this.close() }, 'Done')),
    );
  }

  private async copy(text: string, field: HTMLInputElement | HTMLTextAreaElement, done: string): Promise<void> {
    const ok = await copyText(text, field);
    this.note.textContent = ok ? done : 'Selected. Press Ctrl+C (or Cmd+C) to copy.';
  }

  show(link: string, code: string): void {
    this.link.value = link;
    this.code.value = code;
    this.note.textContent = '';
    this.el.hidden = false;
  }
}

export class OpenCodeDialog extends Dialog {
  onOpen: (text: string) => boolean = () => false;
  private readonly input: HTMLTextAreaElement;
  private readonly error: HTMLElement;

  constructor(parent: HTMLElement) {
    super(parent, 'Open a shared battle');
    this.input = h('textarea', { rows: 4, placeholder: 'Paste a battle link or code', 'aria-label': 'Battle link or code' });
    this.error = h('div', { class: 'error', role: 'alert' }, '');
    this.body.append(
      h('p', {}, 'Paste a link or code someone shared with you. Their armies load onto the battlefield, ready to start.'),
      this.input,
      this.error,
      h(
        'div',
        { class: 'dialog-actions' },
        h('button', { class: 'btn btn-quiet', onclick: () => this.close() }, 'Cancel'),
        h('button', { class: 'btn btn-primary', onclick: () => this.submit() }, 'Open battle'),
      ),
    );
  }

  private submit(): void {
    if (this.onOpen(this.input.value)) {
      this.close();
    } else {
      this.error.textContent = "That isn't a battle code this version can read. Check that the whole code was copied.";
    }
  }

  show(): void {
    this.input.value = '';
    this.error.textContent = '';
    this.el.hidden = false;
    this.input.focus();
  }
}

// ---- Placement -----------------------------------------------------------------------------

export interface PlacementState {
  team: number;
  selected: number;
  mapId: string;
  budget: number;
  spent: [number, number];
  counts: [number, number];
  total: number;
  cap: number;
}

export class PlacementScreen {
  readonly el: HTMLElement;
  onMenu: () => void = () => {};
  onMap: (id: string) => void = () => {};
  onBudget: (b: number) => void = () => {};
  onTeam: (t: number) => void = () => {};
  onSelect: (type: number) => void = () => {};
  onMirror: () => void = () => {};
  onClear: () => void = () => {};
  onShare: () => void = () => {};
  onStart: () => void = () => {};

  private readonly mapSel: HTMLSelectElement;
  private readonly budgetSel: HTMLSelectElement;
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly money: HTMLElement[] = [];
  private readonly cards: HTMLButtonElement[] = [];
  private readonly cardImgs: HTMLImageElement[] = [];
  private readonly info: HTMLElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly countLabel: HTMLElement;
  private readonly mirrorBtn: HTMLButtonElement;
  private portraits: string[][] = [[], []];
  private shownTeam = -1;

  constructor(parent: HTMLElement) {
    this.mapSel = h('select', { 'aria-label': 'Map' }, ...MAPS.map((m) => h('option', { value: m.id }, m.name)));
    this.mapSel.addEventListener('change', () => this.onMap(this.mapSel.value));
    this.budgetSel = h('select', { 'aria-label': 'Budget per side' }, ...BUDGET_OPTIONS.map((b) => h('option', { value: String(b) }, b === 0 ? 'No budget' : `${b} per side`)));
    this.budgetSel.addEventListener('change', () => this.onBudget(Number(this.budgetSel.value)));

    for (const team of [0, 1]) {
      const money = h('span', { class: 'side-money' }, '');
      const tab = h(
        'button',
        { class: 'side-tab', 'data-team': team, 'aria-pressed': 'false', onclick: () => this.onTeam(team) },
        h('span', { class: 'side-name' }, team === 0 ? 'Blue army' : 'Red army'),
        money,
      );
      this.tabs.push(tab);
      this.money.push(money);
    }
    this.mirrorBtn = h('button', { class: 'btn btn-quiet', onclick: () => this.onMirror(), title: 'Copy this army to the other side, mirrored' }, icon(ICONS.mirror), 'Mirror');

    const topbar = h(
      'div',
      { class: 'topbar' },
      h(
        'div',
        { class: 'panel bar-group' },
        h('button', { class: 'btn btn-quiet', onclick: () => this.onMenu(), 'aria-label': 'Main menu' }, icon(ICONS.back), 'Menu'),
        this.mapSel,
        this.budgetSel,
      ),
      h('div', { class: 'panel sides', role: 'group', 'aria-label': 'Army being placed' }, ...this.tabs),
      h(
        'div',
        { class: 'panel bar-group' },
        this.mirrorBtn,
        h('button', { class: 'btn btn-quiet', onclick: () => this.onClear() }, icon(ICONS.trash), 'Clear'),
        h('button', { class: 'btn btn-quiet', onclick: () => this.onShare() }, icon(ICONS.share), 'Share'),
      ),
    );

    const bar = h('div', { class: 'panel unitbar', role: 'listbox', 'aria-label': 'Units' });
    UNITS.forEach((d, k) => {
      const img = h('img', { alt: '', width: 72, height: 72 });
      const card = h(
        'button',
        { class: 'card', 'aria-pressed': 'false', title: `${d.name}: ${d.role}`, onclick: () => this.onSelect(k) },
        h('span', { class: 'card-key' }, String(k + 1)),
        img,
        h('span', { class: 'card-name' }, d.name),
        h('span', { class: 'card-cost' }, `${d.cost}`),
      );
      this.cards.push(card);
      this.cardImgs.push(img);
      bar.appendChild(card);
    });

    this.info = h('div', { class: 'unit-info-body' });
    this.startBtn = h('button', { class: 'btn btn-primary btn-big', onclick: () => this.onStart() }, icon(ICONS.play), 'Start battle');
    this.countLabel = h('div', { class: 'count' }, '');
    const dock = h(
      'div',
      { class: 'dock' },
      bar,
      h('div', { class: 'dock-side' }, h('div', { class: 'panel meander unit-info' }, this.info), h('div', { class: 'start-row' }, this.startBtn, this.countLabel)),
    );

    this.el = h(
      'section',
      { class: 'screen', hidden: true, 'aria-label': 'Place your armies' },
      topbar,
      h('div', { class: 'place-hint' }, 'Click to place · drag to paint a row · right-click to remove · right-drag to look around'),
      dock,
    );
    parent.appendChild(this.el);
  }

  setPortraits(p: string[][]): void {
    this.portraits = p;
    this.shownTeam = -1;
  }

  show(v: boolean): void {
    setVisible(this.el, v);
  }

  update(s: PlacementState): void {
    this.mapSel.value = s.mapId;
    this.budgetSel.value = String(s.budget);
    for (const team of [0, 1]) {
      this.tabs[team].setAttribute('aria-pressed', String(team === s.team));
      const spent = s.spent[team];
      this.money[team].textContent =
        s.budget > 0 ? `${spent} / ${s.budget} spent · ${s.counts[team]} units` : `${spent} spent · ${s.counts[team]} units`;
    }
    this.mirrorBtn.textContent = '';
    this.mirrorBtn.append(icon(ICONS.mirror), s.team === 0 ? 'Mirror to red' : 'Mirror to blue');
    const left = s.budget > 0 ? s.budget - s.spent[s.team] : Infinity;
    UNITS.forEach((d, k) => {
      const card = this.cards[k];
      card.setAttribute('aria-pressed', String(k === s.selected));
      card.disabled = d.cost > left;
    });
    if (this.shownTeam !== s.team && this.portraits[s.team].length > 0) {
      this.shownTeam = s.team;
      UNITS.forEach((_, k) => {
        this.cardImgs[k].src = this.portraits[s.team][k];
      });
    }
    this.renderInfo(UNITS[s.selected]);
    this.startBtn.disabled = s.counts[0] === 0 || s.counts[1] === 0;
    this.countLabel.textContent = `${s.total} / ${s.cap} units`;
  }

  private infoFor = -1;

  private renderInfo(d: UnitDef): void {
    const k = UNITS.indexOf(d);
    if (k === this.infoFor) return;
    this.infoFor = k;
    const w = d.weapon;
    const attack = w.kind === 'projectile' ? `${w.range} m ${w.projectile?.visual ?? ''}` : `${w.range} m reach`;
    const extras: string[] = [];
    if (d.sidearm) extras.push('sidearm');
    if (d.ammo) extras.push(`${d.ammo[0]}–${d.ammo[1]} shots`);
    if (d.shieldWall) extras.push('shield wall');
    if (w.vsArmor?.heavy) extras.push(`${w.vsArmor.heavy}x vs heavy armour`);
    if (w.charge) extras.push('charge');
    this.info.replaceChildren(
      h('div', { class: 'role' }, d.role),
      h('h3', {}, d.name),
      h('p', {}, d.blurb),
      h(
        'dl',
        { class: 'stats' },
        h('dt', {}, 'Cost'),
        h('dd', {}, String(d.cost)),
        h('dt', {}, 'Health'),
        h('dd', {}, String(d.health)),
        h('dt', {}, 'Armour'),
        h('dd', {}, d.armor === 'none' ? 'None' : d.armor === 'light' ? 'Light' : 'Heavy'),
        h('dt', {}, 'Attack'),
        h('dd', {}, attack),
        h('dt', {}, 'Speed'),
        h('dd', {}, `${d.speed} m/s`),
        ...(extras.length ? [h('dt', {}, 'Special'), h('dd', {}, extras.join(', '))] : []),
      ),
    );
  }
}

// ---- Battle HUD ----------------------------------------------------------------------------

export class BattleScreen {
  readonly el: HTMLElement;
  onSpeed: (index: number) => void = () => {};
  onEdit: () => void = () => {};
  onMenu: () => void = () => {};
  private readonly fills: HTMLElement[] = [];
  private readonly labels: HTMLElement[] = [];
  private readonly speedBtns: HTMLButtonElement[] = [];

  constructor(parent: HTMLElement) {
    const teams = [0, 1].map((t) => {
      const fill = h('div', { class: 'fill', style: 'width:100%' });
      const label = h('span', {}, '');
      this.fills.push(fill);
      this.labels.push(label);
      return h(
        'div',
        { class: 'team', 'data-team': t },
        h('div', { class: 'team-label' }, h('span', {}, t === 0 ? 'Blue' : 'Red'), label),
        h('div', { class: 'meter', role: 'meter', 'aria-label': `${t === 0 ? 'Blue' : 'Red'} strength` }, fill),
      );
    });
    const speeds = ['Pause', '¼×', '1×', '2×'];
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Battle speed' });
    speeds.forEach((label, k) => {
      const b = h('button', { 'aria-pressed': 'false', onclick: () => this.onSpeed(k) }, k === 0 ? icon(ICONS.pause, 'Pause') : label);
      this.speedBtns.push(b);
      seg.appendChild(b);
    });
    this.el = h(
      'section',
      { class: 'screen', hidden: true, 'aria-label': 'Battle' },
      h('div', { class: 'panel strength' }, teams[0], h('div', { class: 'vs' }, 'VS'), teams[1]),
      h(
        'div',
        { class: 'battle-actions' },
        h('button', { class: 'btn', onclick: () => this.onEdit() }, icon(ICONS.back), 'Edit armies'),
      ),
      h('div', { class: 'panel speedbar' }, seg, h('button', { class: 'btn btn-quiet', onclick: () => this.onMenu() }, 'Menu')),
    );
    parent.appendChild(this.el);
  }

  show(v: boolean): void {
    setVisible(this.el, v);
  }

  update(frac: [number, number], alive: [number, number], speedIndex: number): void {
    for (const t of [0, 1]) {
      this.fills[t].style.width = `${Math.max(0, Math.min(1, frac[t])) * 100}%`;
      this.labels[t].textContent = `${alive[t]} standing`;
    }
    this.speedBtns.forEach((b, k) => b.setAttribute('aria-pressed', String(k === speedIndex)));
  }
}

// ---- Result --------------------------------------------------------------------------------

export interface ResultData {
  winner: number;
  seconds: number;
  lost: [number, number];
  survivors: [number, number];
  topUnit: [string, string];
}

export class ResultScreen {
  readonly el: HTMLElement;
  onReplay: () => void = () => {};
  onEdit: () => void = () => {};
  onShare: () => void = () => {};
  onMenu: () => void = () => {};
  private readonly body: HTMLElement;

  constructor(parent: HTMLElement) {
    this.body = h('div', { class: 'result-body' });
    this.el = h('section', { class: 'screen result', hidden: true, 'aria-label': 'Battle result' }, h('div', { class: 'panel meander result-card' }, this.body));
    parent.appendChild(this.el);
  }

  show(v: boolean, r?: ResultData): void {
    if (v && r) {
      const title = r.winner === 0 ? 'Blue wins' : r.winner === 1 ? 'Red wins' : 'A draw';
      const m = Math.floor(r.seconds / 60);
      const s = Math.floor(r.seconds % 60);
      this.body.replaceChildren(
        h('h2', { class: 'result-title', 'data-team': r.winner }, title),
        h('p', { class: 'result-sub' }, `The battle lasted ${m}:${String(s).padStart(2, '0')}.`),
        h(
          'table',
          { class: 'result-table' },
          h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { class: 't0' }, 'Blue'), h('th', { class: 't1' }, 'Red'))),
          h(
            'tbody',
            {},
            h('tr', {}, h('td', {}, 'Units lost'), h('td', {}, String(r.lost[0])), h('td', {}, String(r.lost[1]))),
            h('tr', {}, h('td', {}, 'Still standing'), h('td', {}, String(r.survivors[0])), h('td', {}, String(r.survivors[1]))),
            h('tr', {}, h('td', {}, 'Most damage'), h('td', {}, r.topUnit[0]), h('td', {}, r.topUnit[1])),
          ),
        ),
        h(
          'div',
          { class: 'result-actions' },
          h('button', { class: 'btn btn-primary', onclick: () => this.onReplay() }, icon(ICONS.replay), 'Replay'),
          h('button', { class: 'btn', onclick: () => this.onEdit() }, 'Edit armies'),
          h('button', { class: 'btn', onclick: () => this.onShare() }, icon(ICONS.share), 'Share'),
          h('button', { class: 'btn btn-quiet', onclick: () => this.onMenu() }, 'Menu'),
        ),
      );
    }
    setVisible(this.el, v);
  }
}

// ---- Toast ---------------------------------------------------------------------------------

export class Toast {
  private readonly el: HTMLElement;
  private timer = 0;

  constructor(parent: HTMLElement) {
    this.el = h('div', { class: 'toast', hidden: true, role: 'status' }, '');
    parent.appendChild(this.el);
  }

  show(text: string, ms = 2200): void {
    this.el.textContent = text;
    this.el.hidden = false;
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.el.hidden = true;
    }, ms);
  }
}
