/**
 * Unit state as a structure of arrays in preallocated typed arrays.
 * Capacity is fixed per battle, and a unit keeps its slot for the whole battle
 * (dead units are flagged, not removed), so sim and renderer always agree on identity.
 */
export class World {
  readonly capacity: number;
  count = 0;

  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly pz: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;
  readonly yaw: Float32Array;
  readonly radius: Float32Array;
  readonly height: Float32Array;
  readonly mass: Float32Array;
  readonly health: Float32Array;
  readonly maxHealth: Float32Array;
  readonly team: Uint8Array;
  readonly type: Uint8Array;
  readonly state: Uint8Array;
  readonly flags: Uint8Array;
  /** Ticks left in the current state (wind-up, recover, getting up...). */
  readonly stateTimer: Int16Array;
  /** Length of the current timed state, for animation progress. */
  readonly stateLength: Int16Array;
  readonly target: Int32Array;
  /** Ticks until the next wind-up may begin. */
  readonly attackCooldown: Int16Array;
  /** Charger run-up distance since the last attack (m). */
  readonly runup: Float32Array;
  /** Last impulse received (kg*m/s), used to launch the death ragdoll. */
  readonly lastImpX: Float32Array;
  readonly lastImpY: Float32Array;
  readonly lastImpZ: Float32Array;
  /** Ticks spent nearly at rest while tumbling. */
  readonly restTicks: Int16Array;
  /** Hover altitude for flyers, remembered while over the void. */
  readonly hoverY: Float32Array;

  constructor(capacity: number) {
    this.capacity = capacity;
    const f = () => new Float32Array(capacity);
    this.px = f();
    this.py = f();
    this.pz = f();
    this.vx = f();
    this.vy = f();
    this.vz = f();
    this.yaw = f();
    this.radius = f();
    this.height = f();
    this.mass = f();
    this.health = f();
    this.maxHealth = f();
    this.team = new Uint8Array(capacity);
    this.type = new Uint8Array(capacity);
    this.state = new Uint8Array(capacity);
    this.flags = new Uint8Array(capacity);
    this.stateTimer = new Int16Array(capacity);
    this.stateLength = new Int16Array(capacity);
    this.target = new Int32Array(capacity).fill(-1);
    this.attackCooldown = new Int16Array(capacity);
    this.runup = f();
    this.lastImpX = f();
    this.lastImpY = f();
    this.lastImpZ = f();
    this.restTicks = new Int16Array(capacity);
    this.hoverY = f();
  }
}
