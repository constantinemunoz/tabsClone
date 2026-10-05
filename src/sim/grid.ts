import type { World } from './world.ts';
import { S_DEAD } from './constants.ts';

/**
 * Uniform spatial hash over the ground plane, rebuilt from scratch every tick with a counting
 * sort into flat arrays. Units outside the grid are clamped into the edge cells. Only living
 * units are inserted. Within a cell, units are stored in slot order (deterministic).
 */
export class SpatialGrid {
  readonly cell: number;
  readonly invCell: number;
  readonly x0: number;
  readonly z0: number;
  readonly nx: number;
  readonly nz: number;
  /** cellStart[c] .. cellStart[c + 1] index into items. */
  readonly cellStart: Int32Array;
  readonly items: Int32Array;
  readonly unitCell: Int32Array;
  private readonly cursor: Int32Array;
  /** Largest radius among living units, for neighbour query ranges. */
  maxRadius = 0;

  constructor(x0: number, z0: number, width: number, depth: number, cell: number, capacity: number) {
    this.cell = cell;
    this.invCell = 1 / cell;
    this.x0 = x0;
    this.z0 = z0;
    this.nx = Math.max(1, Math.ceil(width / cell));
    this.nz = Math.max(1, Math.ceil(depth / cell));
    this.cellStart = new Int32Array(this.nx * this.nz + 1);
    this.cursor = new Int32Array(this.nx * this.nz);
    this.items = new Int32Array(capacity);
    this.unitCell = new Int32Array(capacity);
  }

  cellX(x: number): number {
    const c = Math.floor((x - this.x0) * this.invCell);
    return c < 0 ? 0 : c >= this.nx ? this.nx - 1 : c;
  }

  cellZ(z: number): number {
    const c = Math.floor((z - this.z0) * this.invCell);
    return c < 0 ? 0 : c >= this.nz ? this.nz - 1 : c;
  }

  rebuild(w: World): void {
    const start = this.cellStart;
    const n = w.count;
    start.fill(0);
    let maxR = 0;
    for (let i = 0; i < n; i++) {
      if (w.state[i] === S_DEAD) {
        this.unitCell[i] = -1;
        continue;
      }
      const c = this.cellZ(w.pz[i]) * this.nx + this.cellX(w.px[i]);
      this.unitCell[i] = c;
      start[c + 1]++;
      if (w.radius[i] > maxR) maxR = w.radius[i];
    }
    this.maxRadius = maxR;
    const cells = this.nx * this.nz;
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    const cursor = this.cursor;
    for (let c = 0; c < cells; c++) cursor[c] = start[c];
    for (let i = 0; i < n; i++) {
      const c = this.unitCell[i];
      if (c < 0) continue;
      this.items[cursor[c]++] = i;
    }
  }
}
