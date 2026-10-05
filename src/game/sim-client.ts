import { TICK_HZ } from '../sim/constants.ts';
import type { FromWorker, ToWorker } from '../sim/messages.ts';
import type { BattleSetup } from '../sim/sim.ts';
import { EVENT_STRIDE } from '../sim/events.ts';
import {
  eventsOffset,
  H_EVENTS,
  H_TICK,
  HEADER_FLOATS,
  projectilesOffset,
  U_X,
  U_Y,
  U_YAW,
  U_Z,
  UNIT_STRIDE,
} from '../sim/snapshot.ts';

/** At most this many ticks are requested per frame; a slow machine slows the battle instead. */
const MAX_CATCH_UP = 4;
/** Stop requesting ticks if this many are still outstanding. */
const MAX_IN_FLIGHT = 6;

export type EventSink = (events: Float32Array, offset: number, count: number) => void;
/** Called after every snapshot arrives, with the previous and new snapshot. */
export type SnapshotSink = (prev: Float32Array, curr: Float32Array) => void;

/**
 * Main-thread side of the simulation worker.
 *
 * Timing: `simTime` advances with real time x battle speed (in ticks). Each frame the client
 * requests the ticks up to floor(simTime). It renders the time one tick behind the previous
 * frame's simTime, which is always between the two most recent snapshots once the worker has
 * answered, so interpolation needs only those two.
 */
export class SimClient {
  private worker: Worker | null = null;
  prev: Float32Array | null = null;
  curr: Float32Array | null = null;
  unitCap = 0;
  projCap = 0;
  eventCap = 0;
  floats = 0;
  ready = false;
  private simTime = 0;
  private requested = 0;
  private readonly returnList: ArrayBuffer[] = [];
  private readonly stepMsg: { t: 'step'; n: number; ret: ArrayBuffer[] } = { t: 'step', n: 0, ret: [] };
  private onReady: (() => void) | null = null;
  eventSink: EventSink | null = null;
  snapshotSink: SnapshotSink | null = null;
  /** Diagnostic: snapshot buffers the main thread has seen created (should stay small). */
  buffersSeen = 0;

  start(setup: BattleSetup, capacity: number): Promise<void> {
    this.dispose();
    this.worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = this.onMessage;
    this.ready = false;
    this.prev = this.curr = null;
    this.simTime = 0;
    this.requested = 0;
    this.returnList.length = 0;
    const msg: ToWorker = { t: 'init', setup, capacity };
    return new Promise((resolve) => {
      this.onReady = resolve;
      this.worker!.postMessage(msg);
    });
  }

  dispose(): void {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.terminate();
      this.worker = null;
    }
    this.ready = false;
  }

  private onMessage = (e: MessageEvent<FromWorker>): void => {
    const m = e.data;
    if (m instanceof ArrayBuffer) {
      const view = new Float32Array(m);
      this.buffersSeen++;
      const n = view[H_EVENTS];
      if (n > 0 && this.eventSink) this.eventSink(view, eventsOffset(this.unitCap, this.projCap), n);
      if (this.prev) this.returnList.push(this.prev.buffer as ArrayBuffer);
      this.prev = this.curr;
      this.curr = view;
      if (this.prev && this.snapshotSink) this.snapshotSink(this.prev, view);
      if (!this.ready && this.prev) {
        this.ready = true;
        this.onReady?.();
        this.onReady = null;
      }
      return;
    }
    if (m.t === 'ready') {
      this.floats = m.floats;
      this.unitCap = m.unitCap;
      this.projCap = m.projCap;
      this.eventCap = m.eventCap;
    }
  };

  get currTick(): number {
    return this.curr ? this.curr[H_TICK] : 0;
  }

  /** Interpolation factor between prev and curr for this frame. Call before advance(). */
  alpha(): number {
    if (!this.prev || !this.curr) return 0;
    const prevTick = this.prev[H_TICK];
    if (this.curr[H_TICK] === prevTick) return 1;
    // simTime has not been advanced yet this frame; its ticks up to floor(simTime) have arrived.
    const a = this.simTime - 1 - prevTick;
    return a < 0 ? 0 : a > 1 ? 1 : a;
  }

  /** Advance simulated time by dt seconds at the given speed and request the ticks now due. */
  advance(dt: number, speed: number): void {
    if (!this.worker || !this.ready) return;
    const inFlight = this.requested - this.currTick;
    if (inFlight < MAX_IN_FLIGHT) this.simTime += dt * TICK_HZ * speed;
    let n = Math.floor(this.simTime) - this.requested;
    if (n > MAX_CATCH_UP) {
      // Too far behind: drop the extra time so the battle slows down instead of spiralling.
      n = MAX_CATCH_UP;
      this.simTime = this.requested + n + (this.simTime - Math.floor(this.simTime));
    }
    if (n <= 0 && this.returnList.length < 4) return;
    this.requested += Math.max(0, n);
    this.stepMsg.n = Math.max(0, n);
    this.stepMsg.ret = this.returnList;
    this.worker.postMessage(this.stepMsg, this.returnList);
    this.returnList.length = 0;
  }

  /** Interpolated position and yaw of unit slot i, written to out[0..3]. */
  unitPose(i: number, alpha: number, out: Float32Array): void {
    const a = this.prev!;
    const b = this.curr!;
    const o = HEADER_FLOATS + i * UNIT_STRIDE;
    out[0] = a[o + U_X] + (b[o + U_X] - a[o + U_X]) * alpha;
    out[1] = a[o + U_Y] + (b[o + U_Y] - a[o + U_Y]) * alpha;
    out[2] = a[o + U_Z] + (b[o + U_Z] - a[o + U_Z]) * alpha;
    out[3] = lerpAngle(a[o + U_YAW], b[o + U_YAW], alpha);
  }

  projectilesOffset(): number {
    return projectilesOffset(this.unitCap);
  }
}

/** Interpolate angles along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export { EVENT_STRIDE };
