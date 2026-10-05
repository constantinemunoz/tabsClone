import { STATE_NAMES } from './constants.ts';
import { EVENT_STRIDE } from './events.ts';
import type { Sim } from './sim.ts';

/**
 * Layout of the snapshot the worker posts after every tick. One ArrayBuffer, viewed as a
 * Float32Array, holding a header, per-unit render data, live projectiles and the tick's events.
 * Buffers ping-pong between worker and main thread, so the steady state allocates nothing.
 */
export const HEADER_FLOATS = 16;
export const H_TICK = 0;
export const H_UNITS = 1;
export const H_PROJECTILES = 2;
export const H_EVENTS = 3;
export const H_RESULT = 4;
export const H_TICK_MS = 5;
export const H_ALIVE_BLUE = 6;
export const H_ALIVE_RED = 7;
export const H_COST_BLUE = 8;
export const H_COST_RED = 9;
export const H_UNIT_CAP = 10;
export const H_PROJ_CAP = 11;
export const H_EVENT_CAP = 12;
export const H_LAST_DEATH = 13;
export const H_TICK_MS_MAX = 14;
/** Snapshot buffers the worker has ever allocated (should stop growing after the first ticks). */
export const H_BUFFERS_ALLOCATED = 15;

/** Per unit: x, y, z, yaw, vx, vy, vz, healthFraction, state, stateProgress, flags, runup. */
export const UNIT_STRIDE = 12;
export const U_X = 0;
export const U_Y = 1;
export const U_Z = 2;
export const U_YAW = 3;
export const U_VX = 4;
export const U_VY = 5;
export const U_VZ = 6;
export const U_HEALTH = 7;
export const U_STATE = 8;
export const U_PROGRESS = 9;
export const U_FLAGS = 10;
export const U_RUNUP = 11;

/** Per projectile: x, y, z, vx, vy, vz, visual kind, slot. */
export const PROJ_STRIDE = 8;

export function snapshotFloats(unitCap: number, projCap: number, eventCap: number): number {
  return HEADER_FLOATS + unitCap * UNIT_STRIDE + projCap * PROJ_STRIDE + eventCap * EVENT_STRIDE;
}

export function unitsOffset(): number {
  return HEADER_FLOATS;
}

export function projectilesOffset(unitCap: number): number {
  return HEADER_FLOATS + unitCap * UNIT_STRIDE;
}

export function eventsOffset(unitCap: number, projCap: number): number {
  return HEADER_FLOATS + unitCap * UNIT_STRIDE + projCap * PROJ_STRIDE;
}

/** Write the sim's current state into out (sized by snapshotFloats for this sim). */
export function writeSnapshot(sim: Sim, out: Float32Array, tickMs: number, tickMsMax: number): void {
  const w = sim.world;
  const p = sim.projectiles;
  const ev = sim.events;
  const unitCap = w.capacity;
  const projCap = p.capacity;
  out[H_TICK] = sim.tick;
  out[H_UNITS] = w.count;
  out[H_RESULT] = sim.result;
  out[H_TICK_MS] = tickMs;
  out[H_TICK_MS_MAX] = tickMsMax;
  out[H_ALIVE_BLUE] = sim.alive[0];
  out[H_ALIVE_RED] = sim.alive[1];
  out[H_COST_BLUE] = sim.aliveCost[0];
  out[H_COST_RED] = sim.aliveCost[1];
  out[H_UNIT_CAP] = unitCap;
  out[H_PROJ_CAP] = projCap;
  out[H_EVENT_CAP] = ev.capacity;
  out[H_LAST_DEATH] = sim.lastDeath;

  let o = HEADER_FLOATS;
  for (let i = 0; i < w.count; i++, o += UNIT_STRIDE) {
    out[o + U_X] = w.px[i];
    out[o + U_Y] = w.py[i];
    out[o + U_Z] = w.pz[i];
    out[o + U_YAW] = w.yaw[i];
    out[o + U_VX] = w.vx[i];
    out[o + U_VY] = w.vy[i];
    out[o + U_VZ] = w.vz[i];
    out[o + U_HEALTH] = w.health[i] > 0 ? w.health[i] / w.maxHealth[i] : 0;
    out[o + U_STATE] = w.state[i];
    const len = w.stateLength[i];
    out[o + U_PROGRESS] = len > 0 ? 1 - w.stateTimer[i] / len : 0;
    out[o + U_FLAGS] = w.flags[i];
    out[o + U_RUNUP] = w.runup[i];
  }

  o = projectilesOffset(unitCap);
  let pc = 0;
  for (let k = 0; k < projCap; k++) {
    if (!p.alive[k]) continue;
    out[o] = p.px[k];
    out[o + 1] = p.py[k];
    out[o + 2] = p.pz[k];
    out[o + 3] = p.vx[k];
    out[o + 4] = p.vy[k];
    out[o + 5] = p.vz[k];
    out[o + 6] = p.visual[k];
    out[o + 7] = k;
    o += PROJ_STRIDE;
    pc++;
  }
  out[H_PROJECTILES] = pc;

  const eo = eventsOffset(unitCap, projCap);
  const n = ev.count * EVENT_STRIDE;
  const src = ev.data;
  for (let k = 0; k < n; k++) out[eo + k] = src[k];
  out[H_EVENTS] = ev.count;
}

/** Debug helper: human-readable state name. */
export function stateName(s: number): string {
  return STATE_NAMES[s] ?? String(s);
}
