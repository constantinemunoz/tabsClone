import type { QualityTier } from './quality.ts';
import { loadJSON, saveJSON } from './storage.ts';

export interface Settings {
  /** 'auto' uses the tier detected for this machine. */
  quality: QualityTier | 'auto';
  /** Master volume, 0..1. */
  volume: number;
  muted: boolean;
}

const DEFAULTS: Settings = { quality: 'auto', volume: 0.8, muted: false };

export function loadSettings(): Settings {
  const raw = loadJSON<Partial<Settings>>('settings', {});
  const q = raw.quality;
  return {
    quality: q === 'low' || q === 'medium' || q === 'high' || q === 'auto' ? q : DEFAULTS.quality,
    volume: typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1 ? raw.volume : DEFAULTS.volume,
    muted: typeof raw.muted === 'boolean' ? raw.muted : DEFAULTS.muted,
  };
}

export function saveSettings(s: Settings): void {
  saveJSON('settings', s);
}
