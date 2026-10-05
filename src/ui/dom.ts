/** Tiny DOM helpers for the plain HTML/CSS interface. */

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

/** Create an element: h('button', { class: 'btn', onclick: fn }, 'Start'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** Inline SVG icon from a path (24x24 box), drawn in currentColor. */
export function icon(path: string, label?: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', label ? 'false' : 'true');
  if (label) svg.setAttribute('aria-label', label);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  p.setAttribute('fill', 'currentColor');
  svg.appendChild(p);
  return svg;
}

export const ICONS = {
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  play: 'M8 5l11 7-11 7z',
  share: 'M18 16a3 3 0 0 0-2.4 1.2l-6.7-3.4a3 3 0 0 0 0-1.6l6.7-3.4A3 3 0 1 0 15 7a3 3 0 0 0 .1.8L8.4 11.2a3 3 0 1 0 0 3.6l6.7 3.4A3 3 0 1 0 18 16z',
  back: 'M15.4 6.6L14 5.2 7.2 12l6.8 6.8 1.4-1.4L10 12z',
  mirror: 'M11 3h2v18h-2zM4 7l5 5-5 5zM20 7v10l-5-5z',
  trash: 'M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 12H7z',
  gear: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm8.4 2.2l1.6 1.3-1.8 3.1-2-.6a7.6 7.6 0 0 1-1.6.9L16.2 18h-3.6l-.4-2.1a7.6 7.6 0 0 1-1.6-.9l-2 .6-1.8-3.1L8.4 11a7.4 7.4 0 0 1 0-1.9L6.8 7.8l1.8-3.1 2 .6a7.6 7.6 0 0 1 1.6-.9L12.6 2h3.6l.4 2.4a7.6 7.6 0 0 1 1.6.9l2-.6 1.8 3.1-1.6 1.3a7.4 7.4 0 0 1 0 1.6z',
  replay: 'M12 5V1L7 6l5 5V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z',
};

/** Show one screen element and hide the rest, with a short fade. */
export function setVisible(el: HTMLElement, visible: boolean): void {
  if (visible) {
    el.hidden = false;
    // Next frame, so the transition runs from the hidden state.
    requestAnimationFrame(() => el.classList.add('is-in'));
  } else {
    el.classList.remove('is-in');
    el.hidden = true;
  }
}
