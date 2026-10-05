/// <reference lib="webworker" />
import type { FromWorker, ToWorker } from './messages.ts';
import { EVENT_CAPACITY, PROJECTILE_CAPACITY, Sim } from './sim.ts';
import { H_BUFFERS_ALLOCATED, snapshotFloats, writeSnapshot } from './snapshot.ts';

/**
 * Simulation worker. The main thread asks for N ticks per frame; after each tick the worker
 * posts a snapshot in a recycled ArrayBuffer (transferred, not copied). Buffers come back
 * with the next step request.
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope;
let sim: Sim | null = null;
let floats = 0;
const pool: ArrayBuffer[] = [];
let tickMsAvg = 0;
let tickMsMax = 0;
let maxDecay = 0;
let allocated = 0;

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

function emitSnapshot(ms: number): void {
  if (!sim) return;
  let buf = pool.pop();
  if (!buf) {
    buf = new ArrayBuffer(floats * 4);
    allocated++;
  }
  const view = new Float32Array(buf);
  writeSnapshot(sim, view, ms, tickMsMax);
  view[H_BUFFERS_ALLOCATED] = allocated;
  post(buf, [buf]);
}

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.t === 'init') {
    sim = new Sim(m.setup, undefined, m.capacity);
    floats = snapshotFloats(sim.world.capacity, PROJECTILE_CAPACITY, EVENT_CAPACITY);
    pool.length = 0;
    allocated = 0;
    tickMsAvg = 0;
    tickMsMax = 0;
    post({ t: 'ready', floats, unitCap: sim.world.capacity, projCap: PROJECTILE_CAPACITY, eventCap: EVENT_CAPACITY });
    // Two snapshots of the starting state so the renderer can interpolate immediately.
    emitSnapshot(0);
    emitSnapshot(0);
    return;
  }
  if (m.t === 'step') {
    for (let k = 0; k < m.ret.length; k++) {
      if (m.ret[k].byteLength === floats * 4) pool.push(m.ret[k]);
    }
    if (!sim) return;
    for (let k = 0; k < m.n; k++) {
      const t0 = performance.now();
      sim.step();
      const ms = performance.now() - t0;
      tickMsAvg = tickMsAvg === 0 ? ms : tickMsAvg * 0.95 + ms * 0.05;
      if (ms > tickMsMax || ++maxDecay > 150) {
        tickMsMax = ms;
        maxDecay = 0;
      }
      emitSnapshot(tickMsAvg);
    }
  }
};
