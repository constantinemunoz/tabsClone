import { formation, parseArmy, stressSetup } from '../data/army-gen.ts';
import { getMap, MAPS } from '../data/maps.ts';
import type { BattleSetup } from '../sim/sim.ts';

/**
 * Temporary developer panel for trying battles before the real menus and placement screen
 * exist (Milestone 5 replaces it). Preset armies, a map picker and the controls.
 */
export const PRESETS: { name: string; blue: string; red: string }[] = [
  { name: 'Mixed melee', blue: 'scrapper*30,pikeling*12,bulwark*8,rammer*6,biglump*1', red: 'scrapper*30,pikeling*12,bulwark*8,rammer*6,biglump*1' },
  { name: 'Giants vs crowd', blue: 'biglump*2', red: 'scrapper*70' },
  { name: 'Rammer charge', blue: 'rammer*12', red: 'pikeling*20,scrapper*24' },
  { name: 'Shield wall', blue: 'bulwark*16', red: 'scrapper*50' },
  { name: 'Scrapper brawl', blue: 'scrapper*40', red: 'scrapper*40' },
];

export function presetSetup(index: number, mapId: string, seed: number): BattleSetup {
  const p = PRESETS[index];
  const map = getMap(mapId);
  return {
    mapId: map.id,
    seed,
    units: [...formation(parseArmy(p.blue), 0, map.zones.blue), ...formation(parseArmy(p.red), 1, map.zones.red)],
  };
}

export interface DevPanel {
  el: HTMLElement;
  setPhysics(state: 'loading' | 'ready' | 'failed'): void;
}

export function createDevPanel(parent: HTMLElement, onStart: (s: BattleSetup) => void, initialMap: string): DevPanel {
  const el = document.createElement('div');
  el.className = 'dev-panel';
  const title = document.createElement('div');
  title.className = 'dev-panel-title';
  title.textContent = 'Test battles';
  el.appendChild(title);

  const mapSel = document.createElement('select');
  for (const m of MAPS) {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.name;
    if (m.id === initialMap) o.selected = true;
    mapSel.appendChild(o);
  }
  el.appendChild(mapSel);

  let seed = 1000 + Math.floor(Math.random() * 9000);
  const grid = document.createElement('div');
  grid.className = 'dev-panel-buttons';
  PRESETS.forEach((p, k) => {
    const b = document.createElement('button');
    b.textContent = p.name;
    b.addEventListener('click', () => {
      seed++;
      onStart(presetSetup(k, mapSel.value, seed));
      b.blur();
    });
    grid.appendChild(b);
  });
  const stress = document.createElement('button');
  stress.textContent = 'Stress 150 v 150';
  stress.addEventListener('click', () => {
    seed++;
    onStart(stressSetup(150, mapSel.value, seed));
    stress.blur();
  });
  grid.appendChild(stress);
  el.appendChild(grid);

  const help = document.createElement('div');
  help.className = 'dev-panel-help';
  help.innerHTML =
    '<b>WASD</b> move · <b>drag</b> orbit · <b>wheel</b> zoom<br>' +
    '<b>Space</b> pause · <b>1</b> 0.25x · <b>2</b> 1x · <b>3</b> 2x<br>' +
    '<b>R</b> restart · <b>`</b> stats';
  el.appendChild(help);

  const physics = document.createElement('div');
  physics.className = 'dev-panel-physics';
  el.appendChild(physics);
  const setPhysics = (state: 'loading' | 'ready' | 'failed') => {
    physics.dataset.state = state;
    physics.textContent =
      state === 'ready'
        ? 'Ragdoll physics on'
        : state === 'failed'
          ? 'Ragdoll physics unavailable here: deaths and tumbles use the simple fallback animations'
          : 'Loading ragdoll physics…';
  };
  setPhysics('loading');
  parent.appendChild(el);
  return { el, setPhysics };
}
