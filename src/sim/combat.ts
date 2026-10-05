import type { WeaponDef } from '../data/units.ts';
import {
  DT,
  EV_HIT,
  EV_LAUNCH,
  EV_STRIKE,
  F_AIRBORNE,
  F_CHARGED,
  F_SIDEARM,
  GETUP_TICKS,
  MIN_TUMBLE_TICKS,
  S_DEAD,
  S_GETTING_UP,
  S_IDLE,
  S_RECOVER,
  S_SEEK,
  S_STRIKE,
  S_TUMBLING,
  S_WINDUP,
  STRIKE_TICKS,
  TICK_HZ,
  TUMBLE_THRESHOLD,
} from './constants.ts';
import type { Sim } from './sim.ts';
import { desiredDirection, turnToward, wrapAngle } from './steering.ts';
import { updateTargets } from './targeting.ts';

const DEG = Math.PI / 180;
/** A hit counts as frontal when it arrives within 60 degrees of where the target faces. */
const FRONT_DOT = 0.5;

function ticks(seconds: number): number {
  return Math.max(1, Math.round(seconds * TICK_HZ));
}

function enter(sim: Sim, i: number, state: number, duration: number): void {
  const w = sim.world;
  w.state[i] = state;
  w.stateTimer[i] = duration;
  w.stateLength[i] = duration;
}

/** The weapon unit i is using for its current attack. */
export function selectedWeapon(sim: Sim, i: number): WeaponDef {
  const d = sim.defs[sim.world.type[i]];
  return sim.world.weaponSel[i] === 1 && d.sidearm ? d.sidearm : d.weapon;
}

/**
 * Which weapon unit i should use against a target `surface` metres away (body to body):
 * 0 main, 1 sidearm. Ranged mains give way to the sidearm when out of ammunition or when the
 * enemy is already in reach of the sidearm; melee mains when the target is too close for them.
 */
export function chooseWeapon(sim: Sim, i: number, surface: number): number {
  const d = sim.defs[sim.world.type[i]];
  const side = d.sidearm;
  if (!side) return 0;
  if (d.weapon.kind === 'projectile') {
    return sim.world.ammo[i] === 0 || surface <= side.range * 1.3 ? 1 : 0;
  }
  return surface <= side.range ? 1 : 0;
}

/** Accelerate the unit's ground velocity toward (tvx, tvz), limited by its acceleration. */
function steerVelocity(sim: Sim, i: number, tvx: number, tvz: number, accel: number): void {
  const w = sim.world;
  if ((w.flags[i] & F_AIRBORNE) !== 0) return;
  const dvx = tvx - w.vx[i];
  const dvz = tvz - w.vz[i];
  const len = Math.sqrt(dvx * dvx + dvz * dvz);
  const max = accel * DT;
  if (len <= max) {
    w.vx[i] = tvx;
    w.vz[i] = tvz;
  } else {
    w.vx[i] += (dvx / len) * max;
    w.vz[i] += (dvz / len) * max;
  }
}

/** Can a melee weapon held by i reach j's body vertically (ignoring horizontal distance)? */
export function reachesVertically(sim: Sim, i: number, j: number, wp: WeaponDef): boolean {
  if (wp.kind === 'projectile') return true;
  const w = sim.world;
  const top = w.py[i] + w.height[i] + wp.verticalReach;
  const bottom = w.py[i] - 0.6 - wp.range * 0.4;
  return w.py[j] <= top && w.py[j] + w.height[j] >= bottom;
}

/**
 * Ranged reach adjusted for height: shooting down from a plateau reaches further, shooting up
 * reaches less far. This is what makes high ground worth holding.
 */
export function rangedReach(sim: Sim, i: number, j: number, wp: WeaponDef): number {
  const dy = sim.world.py[i] - sim.world.py[j];
  const bonus = Math.max(-wp.range * 0.3, Math.min(wp.range * 0.4, dy * 0.8));
  return wp.range + bonus;
}

/**
 * Shield wall: for every unit with a shieldWall rule, count same-type allies standing beside it
 * (within the radius and mostly to its side rather than in front or behind), so a line of
 * shields protects itself better than a blob does.
 */
export function updateShieldWalls(sim: Sim): void {
  const w = sim.world;
  const g = sim.grid;
  for (let i = 0; i < w.count; i++) {
    const sw = sim.defs[w.type[i]].shieldWall;
    w.wallCount[i] = 0;
    if (!sw || w.state[i] === S_DEAD || w.state[i] === S_TUMBLING) continue;
    const x = w.px[i];
    const z = w.pz[i];
    const fx = Math.sin(w.yaw[i]);
    const fz = Math.cos(w.yaw[i]);
    const r2 = sw.radius * sw.radius;
    const cx0 = g.cellX(x - sw.radius);
    const cx1 = g.cellX(x + sw.radius);
    const cz0 = g.cellZ(z - sw.radius);
    const cz1 = g.cellZ(z + sw.radius);
    let n = 0;
    for (let gz = cz0; gz <= cz1 && n < sw.maxAllies; gz++) {
      for (let gx = cx0; gx <= cx1 && n < sw.maxAllies; gx++) {
        const c = gz * g.nx + gx;
        const end = g.cellStart[c + 1];
        for (let k = g.cellStart[c]; k < end; k++) {
          const j = g.items[k];
          if (j === i || w.type[j] !== w.type[i] || w.team[j] !== w.team[i]) continue;
          if (w.state[j] === S_DEAD || w.state[j] === S_TUMBLING) continue;
          const dx = w.px[j] - x;
          const dz = w.pz[j] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 > r2 || d2 < 1e-6) continue;
          // Beside, not in front or behind: |cos| of the angle to the ally below 0.6.
          if (Math.abs(dx * fx + dz * fz) / Math.sqrt(d2) > 0.6) continue;
          if (++n >= sw.maxAllies) break;
        }
      }
    }
    w.wallCount[i] = n;
  }
}

/**
 * Steps 2 and 3 of the tick: targeting, then the per-unit state machine
 * (Idle, Seek, Windup, Strike, Recover, Tumbling, GettingUp, Dead). Seeking units steer
 * toward their target with a maximum speed, acceleration and turn rate.
 */
export function updateStates(sim: Sim): void {
  updateTargets(sim);
  const w = sim.world;
  const dir = sim.dir;
  for (let i = 0; i < w.count; i++) {
    const st = w.state[i];
    if (st === S_DEAD) continue;
    const d = sim.defs[w.type[i]];
    if (w.attackCooldown[i] > 0) w.attackCooldown[i]--;

    if (st === S_TUMBLING) {
      if (w.stateTimer[i] > 0) w.stateTimer[i]--;
      const grounded = (w.flags[i] & F_AIRBORNE) === 0;
      const v2 = w.vx[i] * w.vx[i] + w.vy[i] * w.vy[i] + w.vz[i] * w.vz[i];
      if (grounded && v2 < 0.36) w.restTicks[i]++;
      else w.restTicks[i] = 0;
      if (w.stateTimer[i] <= 0 && w.restTicks[i] >= 4) {
        w.vx[i] = 0;
        w.vz[i] = 0;
        enter(sim, i, S_GETTING_UP, GETUP_TICKS);
      }
      continue;
    }

    if (st === S_GETTING_UP) {
      steerVelocity(sim, i, 0, 0, d.accel * 2);
      if (--w.stateTimer[i] <= 0) enter(sim, i, S_SEEK, 0);
      continue;
    }

    if (st === S_WINDUP) {
      const t = w.target[i];
      if (t >= 0 && w.state[t] !== S_DEAD) {
        const goal = Math.atan2(w.px[t] - w.px[i], w.pz[t] - w.pz[i]);
        w.yaw[i] = turnToward(w.yaw[i], goal, d.turnRate * DEG * DT * 0.5);
      }
      steerVelocity(sim, i, 0, 0, d.accel);
      if (--w.stateTimer[i] <= 0) enter(sim, i, S_STRIKE, STRIKE_TICKS);
      continue;
    }

    if (st === S_STRIKE) {
      steerVelocity(sim, i, 0, 0, d.accel);
      if (--w.stateTimer[i] <= 0) enter(sim, i, S_RECOVER, ticks(selectedWeapon(sim, i).recovery));
      continue;
    }

    if (st === S_RECOVER) {
      steerVelocity(sim, i, 0, 0, d.accel * 0.6);
      if (--w.stateTimer[i] <= 0) enter(sim, i, S_SEEK, 0);
      continue;
    }

    // Idle or Seek.
    const t = w.target[i];
    if (t < 0) {
      w.state[i] = S_IDLE;
      steerVelocity(sim, i, 0, 0, d.accel);
      w.runup[i] = 0;
      continue;
    }
    w.state[i] = S_SEEK;
    const dx = w.px[t] - w.px[i];
    const dz = w.pz[t] - w.pz[i];
    const dist = Math.sqrt(dx * dx + dz * dz);
    const surface = dist - w.radius[i] - w.radius[t];
    const sel = chooseWeapon(sim, i, surface);
    const wp = sel === 1 && d.sidearm ? d.sidearm : d.weapon;
    if (sel === 1) w.flags[i] |= F_SIDEARM;
    else w.flags[i] &= ~F_SIDEARM;

    let inRange: boolean;
    let stopDist: number;
    if (wp.kind === 'projectile') {
      const reach = rangedReach(sim, i, t, wp);
      inRange = dist <= reach && dist >= wp.minRange;
      stopDist = reach * 0.85;
    } else {
      inRange = surface <= wp.range * 0.9 && reachesVertically(sim, i, t, wp);
      stopDist = w.radius[i] + w.radius[t] + wp.range * 0.55;
    }
    desiredDirection(sim, i, w.px[t], w.pz[t], dir);
    // Face the target itself once close, even if the path swings wide.
    const faceX = dist < 8 ? dx : dir[0];
    const faceZ = dist < 8 ? dz : dir[1];
    const goalYaw = faceX === 0 && faceZ === 0 ? w.yaw[i] : Math.atan2(faceX, faceZ);
    w.yaw[i] = turnToward(w.yaw[i], goalYaw, d.turnRate * DEG * DT);
    const facingErr = Math.abs(wrapAngle(Math.atan2(dx, dz) - w.yaw[i]));

    const aimTolerance = wp.kind === 'projectile' ? 15 * DEG : 25 * DEG;
    if (inRange && w.attackCooldown[i] === 0 && facingErr < aimTolerance && (w.flags[i] & F_AIRBORNE) === 0) {
      w.weaponSel[i] = sel;
      if (wp.charge && w.runup[i] >= wp.charge.minRunup) w.flags[i] |= F_CHARGED;
      enter(sim, i, S_WINDUP, ticks(wp.windup));
      continue;
    }

    // Walk forward, slower while still turning; stop once close enough.
    let speed = 0;
    if (dist > stopDist) {
      const err = Math.abs(wrapAngle(goalYaw - w.yaw[i]));
      const align = Math.cos(Math.min(err, Math.PI / 2));
      speed = d.speed * align * align;
    }
    const fx = Math.sin(w.yaw[i]);
    const fz = Math.cos(w.yaw[i]);
    steerVelocity(sim, i, fx * speed, fz * speed, d.accel);
    if (wp.charge) {
      const v = Math.sqrt(w.vx[i] * w.vx[i] + w.vz[i] * w.vz[i]);
      if (v > d.speed * 0.6) w.runup[i] += v * DT;
      else w.runup[i] *= 0.9;
    }
  }
}

/**
 * Apply damage and a knockback impulse (kg*m/s) to unit j, from a hit that came from
 * (fromX, fromZ) with weapon wp (null for hazards). Applies armour and flank multipliers, the
 * shield's front arc and the shield wall. Big enough velocity changes send the target tumbling.
 * Returns the damage actually dealt.
 */
export function applyHit(
  sim: Sim,
  j: number,
  damage: number,
  ix: number,
  iy: number,
  iz: number,
  attacker: number,
  fromX: number,
  fromZ: number,
  wp: WeaponDef | null,
): number {
  const w = sim.world;
  if (w.state[j] === S_DEAD) return 0;
  const d = sim.defs[w.type[j]];
  if (wp?.vsArmor) damage *= wp.vsArmor[d.armor] ?? 1;

  const ax = fromX - w.px[j];
  const az = fromZ - w.pz[j];
  const len = Math.sqrt(ax * ax + az * az);
  const frontDot = len > 1e-4 ? (ax * Math.sin(w.yaw[j]) + az * Math.cos(w.yaw[j])) / len : 1;
  const braced = w.state[j] !== S_TUMBLING && w.state[j] !== S_GETTING_UP;
  if (braced && d.frontDamageMult < 1 && frontDot > FRONT_DOT) {
    // The shield takes it.
    damage *= d.frontDamageMult;
    ix *= 0.6;
    iz *= 0.6;
  }
  if (wp?.flankMult && frontDot < 0.2) damage *= wp.flankMult;
  if (braced && d.shieldWall && w.wallCount[j] > 0) {
    const cut = Math.min(w.wallCount[j], d.shieldWall.maxAllies) * d.shieldWall.reductionPerAlly;
    damage *= 1 - cut;
    const hold = 1 - cut * 0.8;
    ix *= hold;
    iy *= hold;
    iz *= hold;
  }
  damage *= 0.9 + sim.rng.next() * 0.2;
  w.health[j] -= damage;
  if (attacker >= 0) w.damageDealt[attacker] += damage;
  sim.lastDamageTick = sim.tick;

  const res = 1 - d.knockbackResist;
  ix *= res;
  iy *= res;
  iz *= res;
  w.lastImpX[j] = ix;
  w.lastImpY[j] = iy;
  w.lastImpZ[j] = iz;
  const inv = 1 / w.mass[j];
  const dvx = ix * inv;
  const dvy = iy * inv;
  const dvz = iz * inv;
  w.vx[j] += dvx;
  w.vy[j] += dvy;
  w.vz[j] += dvz;
  const dv = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);
  if (dvy > 0.4 || dv > TUMBLE_THRESHOLD) w.flags[j] |= F_AIRBORNE;

  const imp = Math.sqrt(ix * ix + iy * iy + iz * iz);
  const ni = imp > 1e-5 ? 1 / imp : 0;
  if (dv > TUMBLE_THRESHOLD && w.health[j] > 0) {
    w.restTicks[j] = 0;
    w.flags[j] &= ~F_CHARGED;
    enter(sim, j, S_TUMBLING, MIN_TUMBLE_TICKS);
    sim.events.push(EV_LAUNCH, j, w.px[j], w.py[j], w.pz[j], dv, ix * ni, iy * ni, iz * ni, attacker);
  }
  sim.events.push(
    EV_HIT,
    j,
    w.px[j],
    w.py[j] + w.height[j] * 0.6,
    w.pz[j],
    damage,
    ix * ni,
    iy * ni,
    iz * ni,
    imp,
  );
  return damage;
}

/** Melee and cone strikes: hit enemies inside an arc in front of the attacker, right now. */
function performMelee(sim: Sim, i: number, wp: WeaponDef): void {
  const w = sim.world;
  const g = sim.grid;
  const cone = wp.kind === 'cone';
  const fx = Math.sin(w.yaw[i]);
  const fz = Math.cos(w.yaw[i]);
  const cosHalf = Math.cos(wp.arc * 0.5 * DEG);
  const x = w.px[i];
  const z = w.pz[i];
  const reach = w.radius[i] + wp.range + g.maxRadius + 0.5;
  const cx0 = g.cellX(x - reach);
  const cx1 = g.cellX(x + reach);
  const cz0 = g.cellZ(z - reach);
  const cz1 = g.cellZ(z + reach);
  const idx = sim.candIdx;
  const dist = sim.candDist;
  let n = 0;
  for (let gz = cz0; gz <= cz1; gz++) {
    for (let gx = cx0; gx <= cx1; gx++) {
      const c = gz * g.nx + gx;
      const end = g.cellStart[c + 1];
      for (let k = g.cellStart[c]; k < end; k++) {
        const j = g.items[k];
        if (j === i || w.state[j] === S_DEAD) continue;
        if (!wp.friendlyFire && w.team[j] === w.team[i]) continue;
        const dx = w.px[j] - x;
        const dz = w.pz[j] - z;
        const dd = Math.sqrt(dx * dx + dz * dz);
        const surface = dd - w.radius[i] - w.radius[j];
        if (surface > wp.range) continue;
        if (dd > 1e-4) {
          const dot = (dx * fx + dz * fz) / dd;
          // Bodies already touching get hit unless they are behind the attacker.
          if (dot < cosHalf && !(surface < 0.15 && dot > -0.2)) continue;
        }
        if (!reachesVertically(sim, i, j, wp)) continue;
        if (n < idx.length) {
          idx[n] = j;
          dist[n] = j === w.target[i] ? -1 : surface;
          n++;
        }
      }
    }
  }
  // Insertion sort by distance (the current target sorts first).
  for (let a = 1; a < n; a++) {
    const ji = idx[a];
    const jd = dist[a];
    let b = a - 1;
    while (b >= 0 && dist[b] > jd) {
      idx[b + 1] = idx[b];
      dist[b + 1] = dist[b];
      b--;
    }
    idx[b + 1] = ji;
    dist[b + 1] = jd;
  }
  let dmgMult = 1;
  let kbMult = 1;
  const charged = (w.flags[i] & F_CHARGED) !== 0;
  if (charged && wp.charge) {
    dmgMult = wp.charge.damageMult;
    kbMult = wp.charge.knockbackMult;
  }
  w.flags[i] &= ~F_CHARGED;
  w.runup[i] = 0;
  const hits = Math.min(n, wp.maxTargets);
  for (let h = 0; h < hits; h++) {
    const j = idx[h];
    let dx = w.px[j] - x;
    let dz = w.pz[j] - z;
    const dd = Math.sqrt(dx * dx + dz * dz);
    if (dd > 1e-4) {
      dx /= dd;
      dz /= dd;
    } else {
      dx = fx;
      dz = fz;
    }
    let fall = 1;
    if (cone) {
      const surface = Math.max(0, dd - w.radius[i] - w.radius[j]);
      fall = 1 - 0.65 * Math.min(1, surface / Math.max(0.01, wp.range));
    }
    const kb = wp.knockback * kbMult * fall;
    applyHit(sim, j, wp.damage * dmgMult * fall, dx * kb, wp.knockUp * kbMult * fall, dz * kb, i, x, z, wp);
  }
  sim.events.push(
    EV_STRIKE,
    i,
    x + fx * (w.radius[i] + wp.range * 0.5),
    w.py[i] + w.height[i] * 0.6,
    z + fz * (w.radius[i] + wp.range * 0.5),
    hits,
    fx,
    0,
    fz,
    charged ? 1 : 0,
  );
}

/** Step 6: resolve every strike that lands this tick, then update projectiles. */
export function resolveAttacks(sim: Sim): void {
  const w = sim.world;
  for (let i = 0; i < w.count; i++) {
    if (w.state[i] !== S_STRIKE || w.stateTimer[i] !== STRIKE_TICKS) continue;
    const wp = selectedWeapon(sim, i);
    if (wp.kind === 'projectile') {
      sim.projectiles.fire(sim, i, wp);
      if (w.ammo[i] !== 255 && w.ammo[i] > 0) w.ammo[i]--;
    } else {
      performMelee(sim, i, wp);
    }
    w.attackCooldown[i] = Math.round(wp.cooldown * TICK_HZ);
  }
  sim.projectiles.update(sim);
}
