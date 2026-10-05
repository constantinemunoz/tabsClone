import type { BattleSetup } from './sim.ts';

/** Main thread -> worker. */
export type ToWorker =
  | { t: 'init'; setup: BattleSetup; capacity: number }
  | { t: 'step'; n: number; ret: ArrayBuffer[] };

/** Worker -> main thread (snapshots are posted as bare ArrayBuffers). */
export type FromWorker = { t: 'ready'; floats: number; unitCap: number; projCap: number; eventCap: number } | ArrayBuffer;
