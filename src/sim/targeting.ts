import { isRanged } from '../data/units.ts';
import { F_FLYING, RETARGET_TICKS, S_DEAD, S_IDLE, S_SEEK, S_TUMBLING } from './constants.ts';
import type { Sim } from './sim.ts';

/** Rings of grid cells searched outward before falling back to a scan of every unit. */
const MAX_RING = 6;

/** Can unit i attack unit j at all (alive, enemy, reachable if flying)? */
export function isValidTarget(sim: Sim, i: number, j: number): boolean {
  const w = sim.world;
  if (j < 0 || j >= w.count || j === i) return false;
  if (w.state[j] === S_DEAD) return false;
  if (w.team[j] === w.team[i]) return false;
  // A hovering flyer can only be targeted by weapons that reach it. Once it has been knocked
  // out of the sky (tumbling), anyone may have a go.
  if ((w.flags[j] & F_FLYING) !== 0 && w.state[j] !== S_TUMBLING && sim.canAir[w.type[i]] === 0) return false;
  return true;
}

function tooClose(sim: Sim, i: number, d2: number): boolean {
  const min = sim.defs[sim.world.type[i]].weapon.minRange;
  return min > 0 && d2 < min * min;
}

/**
 * Step 2 of the tick. Units re-pick a target every RETARGET_TICKS ticks, staggered by slot so the
 * cost spreads evenly, or immediately when their target is gone. Only units free to choose
 * (Idle or Seek) retarget; a unit mid-swing keeps its target.
 */
export function updateTargets(sim: Sim): void {
  const w = sim.world;
  const phase = sim.tick % RETARGET_TICKS;
  for (let i = 0; i < w.count; i++) {
    const st = w.state[i];
    if (st !== S_IDLE && st !== S_SEEK) continue;
    const t = w.target[i];
    if (!isValidTarget(sim, i, t) || i % RETARGET_TICKS === phase) {
      w.target[i] = findTarget(sim, i);
    }
  }
}

export function findTarget(sim: Sim, i: number): number {
  const rule = sim.defs[sim.world.type[i]].targeting;
  if (rule === 'nearest') return findNearest(sim, i);
  return scanAll(sim, i, rule === 'farthest' ? 1 : 2);
}

/**
 * Nearest valid enemy, searching rings of grid cells outward from the unit's cell. Any unit in
 * ring r + 1 or beyond is at least r cells away, so once the best candidate is closer than that
 * the search can stop. Falls back to a full scan if nothing is found nearby.
 */
function findNearest(sim: Sim, i: number): number {
  const w = sim.world;
  const g = sim.grid;
  const x = w.px[i];
  const z = w.pz[i];
  // A unit outside the grid is clamped into an edge cell, which breaks the ring distance bound.
  if (x < g.x0 || z < g.z0 || x >= g.x0 + g.nx * g.cell || z >= g.z0 + g.nz * g.cell) return scanAll(sim, i, 0);
  const cx = g.cellX(x);
  const cz = g.cellZ(z);
  let best = -1;
  let bestD2 = Infinity;
  for (let ring = 0; ring <= MAX_RING; ring++) {
    for (let gz = cz - ring; gz <= cz + ring; gz++) {
      if (gz < 0 || gz >= g.nz) continue;
      const edgeRow = gz === cz - ring || gz === cz + ring;
      const step = edgeRow || ring === 0 ? 1 : 2 * ring;
      for (let gx = cx - ring; gx <= cx + ring; gx += step) {
        if (gx < 0 || gx >= g.nx) continue;
        const c = gz * g.nx + gx;
        const end = g.cellStart[c + 1];
        for (let k = g.cellStart[c]; k < end; k++) {
          const j = g.items[k];
          if (!isValidTarget(sim, i, j)) continue;
          const dx = w.px[j] - x;
          const dz = w.pz[j] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD2 && !tooClose(sim, i, d2)) {
            bestD2 = d2;
            best = j;
          }
        }
      }
    }
    const bound = ring * g.cell;
    if (best >= 0 && bestD2 <= bound * bound) return best;
  }
  return scanAll(sim, i, 0);
}

/**
 * Linear scan over every unit.
 * mode 0: nearest, 1: farthest, 2: nearest but ranged enemies count as half the distance.
 */
function scanAll(sim: Sim, i: number, mode: number): number {
  const w = sim.world;
  const x = w.px[i];
  const z = w.pz[i];
  let best = -1;
  let bestScore = mode === 1 ? -Infinity : Infinity;
  for (let j = 0; j < w.count; j++) {
    if (!isValidTarget(sim, i, j)) continue;
    const dx = w.px[j] - x;
    const dz = w.pz[j] - z;
    const d2 = dx * dx + dz * dz;
    if (tooClose(sim, i, d2)) continue;
    if (mode === 1) {
      if (d2 > bestScore) {
        bestScore = d2;
        best = j;
      }
    } else {
      const score = mode === 2 && isRanged(sim.defs[w.type[j]]) ? d2 * 0.25 : d2;
      if (score < bestScore) {
        bestScore = score;
        best = j;
      }
    }
  }
  return best;
}
