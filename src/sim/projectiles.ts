import type { Sim } from './sim.ts';

/**
 * Pooled projectiles in their own typed arrays. Slots are reused; `alive` marks live ones.
 * (Launching and flight are implemented in Milestone 4.)
 */
export class Projectiles {
  readonly capacity: number;
  readonly alive: Uint8Array;
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly gravityScale: Float32Array;
  readonly radius: Float32Array;
  readonly damage: Float32Array;
  readonly knockback: Float32Array;
  readonly knockUp: Float32Array;
  readonly areaRadius: Float32Array;
  readonly team: Uint8Array;
  readonly owner: Int32Array;
  readonly friendlyFire: Uint8Array;
  readonly lifetime: Int16Array;
  readonly visual: Uint8Array;
  count = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    const f = () => new Float32Array(capacity);
    this.alive = new Uint8Array(capacity);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.gravityScale = f();
    this.radius = f();
    this.damage = f();
    this.knockback = f();
    this.knockUp = f();
    this.areaRadius = f();
    this.team = new Uint8Array(capacity);
    this.owner = new Int32Array(capacity);
    this.friendlyFire = new Uint8Array(capacity);
    this.lifetime = new Int16Array(capacity);
    this.visual = new Uint8Array(capacity);
  }

  fire(_sim: Sim, _shooter: number): void {}

  update(_sim: Sim): void {}
}
