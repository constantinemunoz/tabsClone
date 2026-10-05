import type { Sim } from './sim.ts';

/**
 * The direction unit i wants to walk to reach (tx, tz), written to out[0], out[1] as a unit
 * vector on the ground plane (zero if already there).
 *
 * Today this is a straight line. It is the single place to swap in a flow field if maps gain
 * walls: every seeking unit gets its direction from here.
 */
export function desiredDirection(sim: Sim, i: number, tx: number, tz: number, out: Float32Array): void {
  const w = sim.world;
  const dx = tx - w.px[i];
  const dz = tz - w.pz[i];
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 1e-5) {
    out[0] = 0;
    out[1] = 0;
    return;
  }
  out[0] = dx / len;
  out[1] = dz / len;
}

/** Wraps an angle to [-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** Turns yaw toward goal by at most maxStep radians. Returns the new yaw. */
export function turnToward(yaw: number, goal: number, maxStep: number): number {
  const d = wrapAngle(goal - yaw);
  if (d > maxStep) return wrapAngle(yaw + maxStep);
  if (d < -maxStep) return wrapAngle(yaw - maxStep);
  return wrapAngle(goal);
}
