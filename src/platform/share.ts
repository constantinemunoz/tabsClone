import { MAPS } from '../data/maps.ts';
import { UNITS } from '../data/units.ts';
import type { BattleSetup, PlacedUnit } from '../sim/sim.ts';

/**
 * Share links carry a battle's setup (map, seed, both armies), never its outcome: the same
 * setup replays the same way on the same machine, and closely enough elsewhere.
 *
 * Binary layout, then base64url without padding (only letters, digits, '-' and '_', so it
 * survives hosts that only pass plain #anchors through):
 *   u8  version (1)
 *   u8  map index
 *   u32 seed, little endian
 *   u16 unit count, little endian
 *   per unit, in slot order: u8 (type << 1 | team), i8 x, i8 z   (whole metres)
 */
export const SHARE_VERSION = 1;
const MAX_UNITS = 4000;

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const clampI8 = (v: number) => Math.max(-128, Math.min(127, Math.round(v)));

export function encodeSetup(setup: BattleSetup): string {
  const n = Math.min(setup.units.length, MAX_UNITS);
  const bytes = new Uint8Array(8 + n * 3);
  const view = new DataView(bytes.buffer);
  const mapIndex = Math.max(0, MAPS.findIndex((m) => m.id === setup.mapId));
  view.setUint8(0, SHARE_VERSION);
  view.setUint8(1, mapIndex);
  view.setUint32(2, setup.seed >>> 0, true);
  view.setUint16(6, n, true);
  for (let i = 0; i < n; i++) {
    const u = setup.units[i];
    const o = 8 + i * 3;
    view.setUint8(o, ((u.type & 0x7f) << 1) | (u.team & 1));
    view.setInt8(o + 1, clampI8(u.x));
    view.setInt8(o + 2, clampI8(u.z));
  }
  return toBase64Url(bytes);
}

/** Decode a share code; returns null for anything malformed or from an unknown version. */
export function decodeSetup(code: string): BattleSetup | null {
  const bytes = fromBase64Url(code.trim().replace(/^#/, ''));
  if (!bytes || bytes.length < 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== SHARE_VERSION) return null;
  const map = MAPS[view.getUint8(1)];
  if (!map) return null;
  const seed = view.getUint32(2, true);
  const n = view.getUint16(6, true);
  if (n > MAX_UNITS || bytes.length !== 8 + n * 3) return null;
  const units: PlacedUnit[] = [];
  for (let i = 0; i < n; i++) {
    const o = 8 + i * 3;
    const b = view.getUint8(o);
    const type = b >> 1;
    if (type >= UNITS.length) return null;
    units.push({ type, team: b & 1, x: view.getInt8(o + 1), z: view.getInt8(o + 2) });
  }
  return { mapId: map.id, seed, units };
}

/** A full link to this page that opens the given setup. */
export function shareUrl(setup: BattleSetup): string {
  const base = location.href.split('#')[0];
  return `${base}#${encodeSetup(setup)}`;
}
