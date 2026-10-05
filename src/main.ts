import './ui/styles.css';
import { GAME_TITLE } from './config.ts';
import { App } from './game/app.ts';

function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

function showFatal(ui: HTMLElement, title: string, lines: string[]): void {
  const wrap = document.createElement('div');
  wrap.className = 'fatal';
  const card = document.createElement('div');
  card.className = 'fatal-card';
  const h = document.createElement('h1');
  h.textContent = title;
  card.appendChild(h);
  for (const line of lines) {
    const p = document.createElement('p');
    p.textContent = line;
    card.appendChild(p);
  }
  wrap.appendChild(card);
  ui.appendChild(wrap);
}

document.title = GAME_TITLE;
const ui = document.getElementById('ui') as HTMLElement;
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;

if (!hasWebGL2()) {
  showFatal(ui, `${GAME_TITLE} needs WebGL2`, [
    "Your browser or graphics driver doesn't support WebGL2, which this game uses to draw the battlefield.",
    'Try a recent version of Chrome, Firefox, Edge or Safari, and check that hardware acceleration is turned on in your browser settings.',
  ]);
} else {
  const app = new App(canvas, ui);
  app.loadMap(new URLSearchParams(location.search).get('map') ?? 'meadow');
  app.start();
  (window as unknown as { app: App }).app = app;
}
