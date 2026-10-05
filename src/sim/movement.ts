import {
  DT,
  EV_LAND,
  F_AIRBORNE,
  F_FELL,
  F_FLYING,
  GRAVITY,
  MAX_WALK_SLOPE,
  S_DEAD,
  S_TUMBLING,
} from './constants.ts';
import type { Sim } from './sim.ts';
import { groundHeight, surfaceHeight, VOID_HEIGHT } from './terrain.ts';

/** Bounce restitution and ground friction for tumbling capsules. */
const TUMBLE_BOUNCE = 0.32;
const TUMBLE_FRICTION_DECEL = 11;
/** Landings harder than this (m/s downward) emit a landing event. */
const LAND_EVENT_SPEED = 3.5;
/**
 * Slope is judged over this fixed distance ahead, not over the tick's step, so a unit inching
 * forward a centimetre at a time can't creep up a cliff that a full step would refuse.
 */
const SLOPE_PROBE = 0.4;

/** Try to move unit i horizontally to (nx, nz) along the ground. Returns false if a slope blocks it. */
function walkTo(sim: Sim, i: number, nx: number, nz: number): boolean {
  const w = sim.world;
  const t = sim.terrain;
  const h1 = groundHeight(t, nx, nz);
  const ddx = nx - w.px[i];
  const ddz = nz - w.pz[i];
  const run = Math.sqrt(ddx * ddx + ddz * ddz);
  if (h1 === VOID_HEIGHT) {
    // Walked (or slid) off the edge of the world.
    w.px[i] = nx;
    w.pz[i] = nz;
    w.flags[i] |= F_AIRBORNE;
    return true;
  }
  if (run > 1e-6) {
    const k = SLOPE_PROBE / run;
    const ahead = groundHeight(t, w.px[i] + ddx * k, w.pz[i] + ddz * k);
    const here = groundHeight(t, w.px[i], w.pz[i]);
    if (ahead !== VOID_HEIGHT && here !== VOID_HEIGHT && ahead - here > SLOPE_PROBE * MAX_WALK_SLOPE) return false;
  }
  const rise = h1 - w.py[i];
  if (rise > run * MAX_WALK_SLOPE + 0.005) return false;
  w.px[i] = nx;
  w.pz[i] = nz;
  if (rise < -(run * MAX_WALK_SLOPE * 1.25 + 0.08)) {
    // The ground fell away faster than a walkable slope: go airborne and fall.
    w.flags[i] |= F_AIRBORNE;
  } else {
    w.py[i] = h1;
  }
  return true;
}

/**
 * Step 4: integrate movement. Grounded units follow the terrain and can't walk up slopes steeper
 * than 45 degrees; airborne units fall under gravity; tumbling units bounce and slide with
 * friction; flyers hold their hover height. Falling below the kill plane is fatal.
 */
export function integrate(sim: Sim): void {
  const w = sim.world;
  const t = sim.terrain;
  const voidMap = t.mask !== null;
  for (let i = 0; i < w.count; i++) {
    if (w.state[i] === S_DEAD) continue;
    const tumbling = w.state[i] === S_TUMBLING;

    if ((w.flags[i] & F_FLYING) !== 0 && !tumbling) {
      // Hover: chase a height above the terrain; over the void keep the last altitude.
      const g = groundHeight(t, w.px[i], w.pz[i]);
      if (g !== VOID_HEIGHT) w.hoverY[i] = g + sim.defs[w.type[i]].hoverHeight;
      let vy = (w.hoverY[i] - w.py[i]) * 3;
      if (vy > 6) vy = 6;
      else if (vy < -6) vy = -6;
      w.vy[i] = vy;
      w.px[i] += w.vx[i] * DT;
      w.py[i] += vy * DT;
      w.pz[i] += w.vz[i] * DT;
      w.flags[i] &= ~F_AIRBORNE;
    } else if ((w.flags[i] & F_AIRBORNE) !== 0 || w.vy[i] > 0.01) {
      w.flags[i] |= F_AIRBORNE;
      w.vy[i] -= GRAVITY * DT;
      w.px[i] += w.vx[i] * DT;
      w.py[i] += w.vy[i] * DT;
      w.pz[i] += w.vz[i] * DT;
      const g = groundHeight(t, w.px[i], w.pz[i]);
      if (g !== VOID_HEIGHT && w.py[i] <= g) {
        const impact = -w.vy[i];
        // Landed inside a cliff face rather than on top of it: slide back out horizontally.
        if (g - w.py[i] > 1.2) {
          w.px[i] -= w.vx[i] * DT;
          w.pz[i] -= w.vz[i] * DT;
          w.vx[i] *= -0.25;
          w.vz[i] *= -0.25;
          const g2 = surfaceHeight(t, w.px[i], w.pz[i]);
          if (w.py[i] < g2) w.py[i] = g2;
        } else {
          w.py[i] = g;
        }
        if (tumbling && impact > 3) {
          w.vy[i] = impact * TUMBLE_BOUNCE;
          w.vx[i] *= 0.72;
          w.vz[i] *= 0.72;
        } else {
          w.vy[i] = 0;
          w.flags[i] &= ~F_AIRBORNE;
        }
        if (impact > LAND_EVENT_SPEED) {
          sim.events.push(EV_LAND, i, w.px[i], w.py[i], w.pz[i], impact, w.vx[i], w.vy[i], w.vz[i], tumbling ? 1 : 0);
        }
      }
    } else {
      // Grounded. Tumbling units slide with friction.
      if (tumbling) {
        const sp = Math.sqrt(w.vx[i] * w.vx[i] + w.vz[i] * w.vz[i]);
        if (sp > 1e-4) {
          const k = Math.max(0, sp - TUMBLE_FRICTION_DECEL * DT) / sp;
          w.vx[i] *= k;
          w.vz[i] *= k;
        }
      }
      const vx = w.vx[i];
      const vz = w.vz[i];
      if (vx !== 0 || vz !== 0) {
        const nx = w.px[i] + vx * DT;
        const nz = w.pz[i] + vz * DT;
        if (!walkTo(sim, i, nx, nz)) {
          // Blocked by a steep slope: slide along it on one axis if possible.
          if (walkTo(sim, i, nx, w.pz[i])) {
            w.vz[i] = tumbling ? -vz * 0.3 : 0;
          } else if (walkTo(sim, i, w.px[i], nz)) {
            w.vx[i] = tumbling ? -vx * 0.3 : 0;
          } else {
            w.vx[i] = tumbling ? -vx * 0.3 : 0;
            w.vz[i] = tumbling ? -vz * 0.3 : 0;
          }
        }
      }
    }

    // Keep units inside the heightmap on maps that have no void around them.
    if (!voidMap) {
      if (w.px[i] < sim.minX + 1) {
        w.px[i] = sim.minX + 1;
        w.vx[i] = 0;
      } else if (w.px[i] > sim.maxX - 1) {
        w.px[i] = sim.maxX - 1;
        w.vx[i] = 0;
      }
      if (w.pz[i] < sim.minZ + 1) {
        w.pz[i] = sim.minZ + 1;
        w.vz[i] = 0;
      } else if (w.pz[i] > sim.maxZ - 1) {
        w.pz[i] = sim.maxZ - 1;
        w.vz[i] = 0;
      }
    }

    if (w.py[i] < t.killY) {
      w.health[i] = 0;
      w.flags[i] |= F_FELL;
    }
  }
}

/**
 * Step 5: push overlapping capsules apart on the ground plane when their vertical ranges
 * overlap, weighted by mass. Each pair is handled once (j > i), in slot order.
 */
export function separate(sim: Sim): void {
  const w = sim.world;
  const g = sim.grid;
  const t = sim.terrain;
  const n = w.count;
  for (let i = 0; i < n; i++) {
    sim.preSepX[i] = w.px[i];
    sim.preSepZ[i] = w.pz[i];
  }
  for (let i = 0; i < n; i++) {
    if (w.state[i] === S_DEAD) continue;
    const ri = w.radius[i];
    const span = ri + g.maxRadius + 0.6;
    const cx0 = g.cellX(w.px[i] - span);
    const cx1 = g.cellX(w.px[i] + span);
    const cz0 = g.cellZ(w.pz[i] - span);
    const cz1 = g.cellZ(w.pz[i] + span);
    const yi0 = w.py[i];
    const yi1 = yi0 + w.height[i];
    const mi = w.mass[i];
    for (let gz = cz0; gz <= cz1; gz++) {
      for (let gx = cx0; gx <= cx1; gx++) {
        const c = gz * g.nx + gx;
        const end = g.cellStart[c + 1];
        for (let k = g.cellStart[c]; k < end; k++) {
          const j = g.items[k];
          if (j <= i || w.state[j] === S_DEAD) continue;
          const yj0 = w.py[j];
          if (yj0 > yi1 || yj0 + w.height[j] < yi0) continue;
          let dx = w.px[j] - w.px[i];
          let dz = w.pz[j] - w.pz[i];
          const rr = ri + w.radius[j];
          const d2 = dx * dx + dz * dz;
          if (d2 >= rr * rr) continue;
          let d = Math.sqrt(d2);
          if (d < 1e-4) {
            // Exactly on top of each other: pick a direction from the slot numbers.
            const a = (i * 7919 + j * 104729) % 628;
            dx = Math.cos(a * 0.01);
            dz = Math.sin(a * 0.01);
            d = 1;
          } else {
            dx /= d;
            dz /= d;
          }
          const overlap = (rr - Math.min(d, rr)) * 0.8;
          const mj = w.mass[j];
          const wi = mj / (mi + mj);
          const wj = 1 - wi;
          w.px[i] -= dx * overlap * wi;
          w.pz[i] -= dz * overlap * wi;
          w.px[j] += dx * overlap * wj;
          w.pz[j] += dz * overlap * wj;
        }
      }
    }
  }
  // Grounded units follow the ground after being pushed; a push up a cliff is undone.
  for (let i = 0; i < n; i++) {
    if (w.state[i] === S_DEAD) continue;
    if ((w.flags[i] & (F_AIRBORNE | F_FLYING)) !== 0) continue;
    if (w.px[i] === sim.preSepX[i] && w.pz[i] === sim.preSepZ[i]) continue;
    const h = groundHeight(t, w.px[i], w.pz[i]);
    if (h === VOID_HEIGHT) {
      w.flags[i] |= F_AIRBORNE;
    } else if (h - w.py[i] > 0.6) {
      w.px[i] = sim.preSepX[i];
      w.pz[i] = sim.preSepZ[i];
    } else if (w.py[i] - h > 0.6) {
      w.flags[i] |= F_AIRBORNE;
    } else {
      w.py[i] = h;
    }
  }
}
