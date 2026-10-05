import { hash2 } from './rng.ts';

/** Eight unit gradient directions, so no trig is needed per lattice point. */
const GX = [1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071];
const GZ = [0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071];

function grad(ix: number, iz: number, seed: number, dx: number, dz: number): number {
  const g = hash2(ix, iz, seed) & 7;
  return GX[g] * dx + GZ[g] * dz;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 2D gradient noise, roughly in [-0.7, 0.7]. Deterministic for a given seed. */
export function noise2(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fade(fx);
  const v = fade(fz);
  const n00 = grad(ix, iz, seed, fx, fz);
  const n10 = grad(ix + 1, iz, seed, fx - 1, fz);
  const n01 = grad(ix, iz + 1, seed, fx, fz - 1);
  const n11 = grad(ix + 1, iz + 1, seed, fx - 1, fz - 1);
  const a = n00 + (n10 - n00) * u;
  const b = n01 + (n11 - n01) * u;
  return a + (b - a) * v;
}

/** Fractal sum of noise2 octaves. Output roughly in [-1, 1]. */
export function fbm(x: number, z: number, seed: number, octaves: number, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise2(x * freq, z * freq, seed + o * 1013) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return (sum / norm) * 1.6;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
