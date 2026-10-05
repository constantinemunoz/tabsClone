/** Quality tiers. Each controls the unit cap, ragdoll budget, shadows and resolution. */
export type QualityTier = 'low' | 'medium' | 'high';

export interface QualitySettings {
  tier: QualityTier;
  /** Maximum units per battle (both teams together). */
  unitCap: number;
  /** Simultaneous active ragdolls. */
  ragdollBudget: number;
  /** Frozen corpses kept before the oldest sink away. */
  corpseCap: number;
  /** Single shadow map (otherwise blob shadows only). */
  shadows: boolean;
  /** Upper bound on the device pixel ratio. */
  maxPixelRatio: number;
  /** Starting resolution scale (multiplies the pixel ratio); dynamic scaling lowers it. */
  resolutionScale: number;
  antialias: boolean;
  particleCap: number;
}

export const QUALITY_PRESETS: Record<QualityTier, QualitySettings> = {
  low: {
    tier: 'low',
    unitCap: 300,
    ragdollBudget: 8,
    corpseCap: 120,
    shadows: false,
    maxPixelRatio: 1,
    resolutionScale: 0.85,
    antialias: false,
    particleCap: 1024,
  },
  medium: {
    tier: 'medium',
    unitCap: 400,
    ragdollBudget: 24,
    corpseCap: 250,
    shadows: false,
    maxPixelRatio: 1.5,
    resolutionScale: 1,
    antialias: true,
    particleCap: 2048,
  },
  high: {
    tier: 'high',
    unitCap: 600,
    ragdollBudget: 48,
    corpseCap: 400,
    shadows: true,
    maxPixelRatio: 2,
    resolutionScale: 1,
    antialias: true,
    particleCap: 4096,
  },
};

/**
 * Picks a starting tier from what the browser tells us about the GPU and machine.
 * Deliberately conservative: integrated and software renderers start on low or medium.
 */
export function detectQualityTier(gl: WebGL2RenderingContext | null): QualityTier {
  if (!gl) return 'low';
  let renderer = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '');
  } catch {
    renderer = '';
  }
  const r = renderer.toLowerCase();
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  if (/swiftshader|llvmpipe|software|basic render/.test(r)) return 'low';
  if (/mali|adreno|powervr|apple gpu/.test(r) && cores <= 6) return 'low';
  const discrete = /nvidia|geforce|rtx|gtx|radeon rx|radeon pro|apple m\d (pro|max|ultra)/.test(r);
  if (discrete && cores >= 6 && mem >= 8) return 'high';
  if (cores <= 2 || mem <= 2) return 'low';
  return 'medium';
}
