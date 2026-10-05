/**
 * Map definitions as plain data. The heightmap itself is generated from these
 * parameters by src/sim/terrain.ts, identically in the worker and on the main thread.
 */

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export type MapKind = 'meadow' | 'plateaus' | 'island';

export interface MapPalette {
  grassLow: number;
  grassHigh: number;
  rock: number;
  dirt: number;
  /** Colour of the underside of floating terrain (sky island only). */
  underside: number;
  skyTop: number;
  skyHorizon: number;
  skyBottom: number;
  fogNear: number;
  fogFar: number;
  sun: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  /** Colour of the distant ground plane that hides the heightmap edge; null for no plane. */
  farGround: number | null;
  /** Prop colours: foliage, trunk, stone. */
  foliage: number;
  trunk: number;
  stone: number;
}

export interface MapDef {
  id: string;
  name: string;
  kind: MapKind;
  seed: number;
  /** The area units fight in (120 m x 80 m). */
  play: Rect;
  /** Extra heightmap around the play area, for scenery. */
  margin: number;
  /** Heightmap grid spacing in metres. Larger cells give chunkier low-poly facets. */
  cell: number;
  zones: { blue: Rect; red: Rect };
  palette: MapPalette;
}

const PLAY: Rect = { minX: -60, maxX: 60, minZ: -40, maxZ: 40 };
const ZONES = {
  blue: { minX: -56, maxX: -18, minZ: -34, maxZ: 34 },
  red: { minX: 18, maxX: 56, minZ: -34, maxZ: 34 },
};

export const MAPS: MapDef[] = [
  {
    id: 'meadow',
    name: 'Rolling Meadow',
    kind: 'meadow',
    seed: 1701,
    play: PLAY,
    margin: 40,
    cell: 2,
    zones: ZONES,
    palette: {
      grassLow: 0x5f9e45,
      grassHigh: 0x9cc957,
      rock: 0x8e8879,
      dirt: 0xa88a5c,
      underside: 0x6d5a48,
      skyTop: 0x3f7fd6,
      skyHorizon: 0xcbe3f2,
      skyBottom: 0xe4eedc,
      fogNear: 110,
      fogFar: 380,
      sun: 0xfff1d6,
      sunIntensity: 3.0,
      hemiSky: 0xd6e9ff,
      hemiGround: 0x5a7438,
      hemiIntensity: 0.95,
      farGround: 0x86ad62,
      foliage: 0x4f8f3c,
      trunk: 0x7a5636,
      stone: 0x9a968c,
    },
  },
  {
    id: 'plateaus',
    name: 'Twin Mesas',
    kind: 'plateaus',
    seed: 4242,
    play: PLAY,
    margin: 40,
    cell: 2,
    zones: ZONES,
    palette: {
      grassLow: 0xd2ad72,
      grassHigh: 0xb9b866,
      rock: 0xbd6e48,
      dirt: 0xc99560,
      underside: 0x8a4a33,
      skyTop: 0x5a8fd3,
      skyHorizon: 0xf4dcb4,
      skyBottom: 0xf0d7ae,
      fogNear: 110,
      fogFar: 380,
      sun: 0xffe6c2,
      sunIntensity: 3.1,
      hemiSky: 0xffe9cc,
      hemiGround: 0x9a5f3a,
      hemiIntensity: 0.9,
      farGround: 0xc9a06a,
      foliage: 0x7f9a45,
      trunk: 0x6e4a2e,
      stone: 0xb2714f,
    },
  },
  {
    id: 'island',
    name: 'Sky Island',
    kind: 'island',
    seed: 9001,
    play: PLAY,
    margin: 12,
    cell: 2,
    zones: ZONES,
    palette: {
      grassLow: 0x6cbf7e,
      grassHigh: 0xb4de78,
      rock: 0x8d84a3,
      dirt: 0xa69070,
      underside: 0x6a5f86,
      skyTop: 0x4a7fe8,
      skyHorizon: 0xd9e8ff,
      skyBottom: 0x8fb4f0,
      fogNear: 140,
      fogFar: 520,
      sun: 0xfff4e0,
      sunIntensity: 3.0,
      hemiSky: 0xdde9ff,
      hemiGround: 0x7a6f99,
      hemiIntensity: 1.0,
      farGround: null,
      foliage: 0x52a35f,
      trunk: 0x7d5a3c,
      stone: 0x9c94b0,
    },
  },
];

export function getMap(id: string): MapDef {
  for (let i = 0; i < MAPS.length; i++) if (MAPS[i].id === id) return MAPS[i];
  return MAPS[0];
}
