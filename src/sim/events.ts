/**
 * Fixed-capacity event list for one tick: hits, deaths, launches, landings, projectile spawns
 * and impacts. Each record is EVENT_STRIDE floats:
 *   [type, unit, x, y, z, magnitude, dx, dy, dz, extra]
 * Events past capacity are dropped (and counted), never allocated.
 */
export const EVENT_STRIDE = 10;

export class EventBuffer {
  readonly data: Float32Array;
  readonly capacity: number;
  count = 0;
  dropped = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * EVENT_STRIDE);
  }

  clear(): void {
    this.count = 0;
  }

  push(
    type: number,
    unit: number,
    x: number,
    y: number,
    z: number,
    mag: number,
    dx: number,
    dy: number,
    dz: number,
    extra: number,
  ): void {
    if (this.count >= this.capacity) {
      this.dropped++;
      return;
    }
    const o = this.count * EVENT_STRIDE;
    const d = this.data;
    d[o] = type;
    d[o + 1] = unit;
    d[o + 2] = x;
    d[o + 3] = y;
    d[o + 4] = z;
    d[o + 5] = mag;
    d[o + 6] = dx;
    d[o + 7] = dy;
    d[o + 8] = dz;
    d[o + 9] = extra;
    this.count++;
  }
}
