/** Fixed simulation rate. Battle speed changes how many ticks run per second, never the tick size. */
export const TICK_HZ = 30;
export const DT = 1 / TICK_HZ;

/** m/s^2. A bit heavier than Earth so launches arc quickly and read well on screen. */
export const GRAVITY = 18;

/** Velocity change (m/s) from a single hit above which a unit is sent tumbling. */
export const TUMBLE_THRESHOLD = 5.5;

/** Spatial hash cell size in metres. */
export const GRID_CELL = 2;

/** Units re-pick their target every this many ticks (staggered by slot). */
export const RETARGET_TICKS = 10;

/** Battle ends in favour of the stronger side if nobody takes damage for this long. */
export const STALEMATE_TICKS = 20 * TICK_HZ;

/** Steepest slope (rise over run) a unit can walk up: 45 degrees. */
export const MAX_WALK_SLOPE = 1;

/** Typical hover height used to decide whether a melee weapon can ever reach a flyer. */
export const FLYER_REFERENCE_HOVER = 4;

// Unit states. Plain numbers so they fit in a Uint8Array and cost nothing to compare.
export const S_IDLE = 0;
export const S_SEEK = 1;
export const S_WINDUP = 2;
export const S_STRIKE = 3;
export const S_RECOVER = 4;
export const S_TUMBLING = 5;
export const S_GETTING_UP = 6;
export const S_DEAD = 7;

export const STATE_NAMES = ['Idle', 'Seek', 'Windup', 'Strike', 'Recover', 'Tumbling', 'GettingUp', 'Dead'];

/** Ticks a unit stays in Strike (purely the visible slam; damage lands on the first tick). */
export const STRIKE_TICKS = 3;
/** Ticks spent getting up after a tumble. */
export const GETUP_TICKS = 27;
/** Minimum ticks a tumble lasts before the unit may come to rest. */
export const MIN_TUMBLE_TICKS = 12;

// Unit flags (bit field).
export const F_AIRBORNE = 1;
export const F_FELL = 2;
export const F_FLYING = 4;
export const F_CHARGED = 8;

// Event types written to the per-tick event buffer.
export const EV_HIT = 1;
export const EV_DEATH = 2;
export const EV_LAUNCH = 3;
export const EV_LAND = 4;
export const EV_PROJ_SPAWN = 5;
export const EV_PROJ_IMPACT = 6;
/** A unit swung or fired (used for swish sounds and the body lurch). */
export const EV_STRIKE = 7;

// Battle results.
export const RESULT_RUNNING = -1;
export const RESULT_BLUE = 0;
export const RESULT_RED = 1;
export const RESULT_DRAW = 2;
