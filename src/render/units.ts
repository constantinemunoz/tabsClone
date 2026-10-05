import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  type MeshLambertMaterial,
  type Scene,
} from 'three';
import { attackStyleIndex, type UnitDef } from '../data/units.ts';
import type { SimClient } from '../game/sim-client.ts';
import {
  EV_DEATH,
  EV_HIT,
  EV_LAND,
  EV_LAUNCH,
  EV_STRIKE,
  F_AIRBORNE,
  F_SIDEARM,
  S_DEAD,
  S_GETTING_UP,
  S_RECOVER,
  S_STRIKE,
  S_TUMBLING,
  S_WINDUP,
} from '../sim/constants.ts';
import { EVENT_STRIDE } from '../sim/events.ts';
import { groundHeight, type Terrain, VOID_HEIGHT } from '../sim/terrain.ts';
import { HEADER_FLOATS, U_AUX, U_FLAGS, U_PROGRESS, U_STATE, U_VX, U_VY, U_VZ, UNIT_STRIDE } from '../sim/snapshot.ts';
import { BlobShadows } from './blob-shadows.ts';
import { POSE_TEXELS, type RagdollSystem, type UnitPoses } from './ragdolls.ts';
import { createLiveMaterial, createPosedMaterial, unitTime } from './unit-material.ts';
import { getUnitModel } from './model-cache.ts';
import type { UnitModel } from './unit-model.ts';

/** Floats per live instance: posYaw, spring+scale, springVel+flash, anim, state. */
const LIVE_FLOATS = 20;

export const MODE_ALIVE = 0;
export const MODE_TUMBLE = 1;
export const MODE_FLOP = 2;
export const MODE_GETUP = 3;
export const MODE_HIDDEN = 4;

interface LiveBatch {
  type: number;
  slots: Int32Array;
  data: Float32Array;
  buffer: InstancedInterleavedBuffer;
  mesh: Mesh;
}

interface PosedBatch {
  type: number;
  data: Float32Array;
  attr: InstancedBufferAttribute;
  geo: InstancedBufferGeometry;
  mesh: Mesh;
  count: number;
}

/**
 * Draws every unit. Living units use one instanced draw per type with the wobble shader;
 * ragdolls and corpses use a second instanced draw per type that reads per-part poses from a
 * texture. All the wobble state here (springs, walk phase, flashes) is cosmetic: it is driven
 * by sim snapshots and events but never feeds back into the simulation.
 */
export class UnitRenderer {
  private readonly scene: Scene;
  private defs: UnitDef[] = [];
  private models: (UnitModel | null)[] = [];
  private live: LiveBatch[] = [];
  private posed: (PosedBatch | null)[] = [];
  readonly shadows: BlobShadows;
  ragdolls: RagdollSystem;

  private count = 0;
  private types: Uint8Array = new Uint8Array(0);
  private teams: Uint8Array = new Uint8Array(0);
  /** Interpolated pose of each unit this frame (also read by the ragdoll system). */
  readonly poses: UnitPoses = {
    x: new Float32Array(0),
    y: new Float32Array(0),
    z: new Float32Array(0),
    yaw: new Float32Array(0),
    vx: new Float32Array(0),
    vy: new Float32Array(0),
    vz: new Float32Array(0),
    state: new Uint8Array(0),
    progress: new Float32Array(0),
  };
  // Wobble springs: a 3D offset and its velocity per unit.
  private sx = new Float32Array(0);
  private sy = new Float32Array(0);
  private sz = new Float32Array(0);
  private svx = new Float32Array(0);
  private svy = new Float32Array(0);
  private svz = new Float32Array(0);
  private walk = new Float32Array(0);
  private flash = new Float32Array(0);
  private seed = new Float32Array(0);
  private modeStart = new Float32Array(0);
  private modeParam = new Float32Array(0);
  /** 1 if the unit's current tumble is shader-only (so its get-up is too). */
  private shaderTumble = new Uint8Array(0);
  private flopped = new Uint8Array(0);
  // Shader-flop corpses fly on a simple ballistic arc from the death velocity (visual only).
  private fx = new Float32Array(0);
  private fy = new Float32Array(0);
  private fz = new Float32Array(0);
  private fvx = new Float32Array(0);
  private fvy = new Float32Array(0);
  private fvz = new Float32Array(0);
  private fAir = new Uint8Array(0);
  private terrain: Terrain | null = null;
  private airborne = new Uint8Array(0);
  /** 1 while the unit has its sidearm out. */
  private sidearm = new Uint8Array(0);
  /** Shield-wall brace (0..1), eased toward whether the unit stands in a wall. */
  private brace = new Float32Array(0);
  private aux = new Float32Array(0);
  private readonly pose4 = new Float32Array(4);
  /** Visual clock (seconds), advanced by real time x battle speed. */
  time = 0;

  constructor(scene: Scene, ragdolls: RagdollSystem, shadowCapacity: number) {
    this.scene = scene;
    this.ragdolls = ragdolls;
    this.shadows = new BlobShadows(scene, shadowCapacity);
  }

  setTerrain(t: Terrain): void {
    this.terrain = t;
    this.shadows.setTerrain(t);
  }

  build(defs: UnitDef[], types: Uint8Array, teams: Uint8Array, count: number): void {
    this.dispose();
    this.defs = defs;
    this.count = count;
    this.types = types;
    this.teams = teams;
    const f = () => new Float32Array(count);
    this.poses.x = f();
    this.poses.y = f();
    this.poses.z = f();
    this.poses.yaw = f();
    this.poses.vx = f();
    this.poses.vy = f();
    this.poses.vz = f();
    this.poses.state = new Uint8Array(count);
    this.poses.progress = f();
    this.sx = f();
    this.sy = f();
    this.sz = f();
    this.svx = f();
    this.svy = f();
    this.svz = f();
    this.walk = f();
    this.flash = f();
    this.seed = f();
    this.modeStart = f();
    this.modeParam = f();
    this.shaderTumble = new Uint8Array(count);
    this.flopped = new Uint8Array(count);
    this.fx = f();
    this.fy = f();
    this.fz = f();
    this.fvx = f();
    this.fvy = f();
    this.fvz = f();
    this.fAir = new Uint8Array(count);
    this.airborne = new Uint8Array(count);
    this.sidearm = new Uint8Array(count);
    this.brace = f();
    this.aux = f();
    for (let i = 0; i < count; i++) {
      // A per-unit random seed for the shader (idle sway, stumble, flail), stable per slot.
      this.seed[i] = ((Math.imul(i + 1, 2654435761) >>> 0) % 10007) / 10007;
      this.walk[i] = this.seed[i] * 6.28;
    }

    if (this.models.length !== defs.length) this.models = new Array(defs.length).fill(null);
    this.posed = new Array(defs.length).fill(null);
    const layouts = [];
    const scales = [];
    for (let t = 0; t < defs.length; t++) {
      let n = 0;
      for (let i = 0; i < count; i++) if (types[i] === t) n++;
      if (!this.models[t]) this.models[t] = getUnitModel(defs[t]);
      const model = this.models[t]!;
      layouts.push(model.layout);
      scales.push(defs[t].visual.scale);
      if (n === 0) continue;
      const v = defs[t].visual;
      // Live batch.
      const slots = new Int32Array(n);
      let k = 0;
      for (let i = 0; i < count; i++) if (types[i] === t) slots[k++] = i;
      const data = new Float32Array(n * LIVE_FLOATS);
      const buffer = new InstancedInterleavedBuffer(data, LIVE_FLOATS, 1);
      buffer.setUsage(DynamicDrawUsage);
      const geo = new InstancedBufferGeometry();
      for (const name of ['position', 'color', 'aPart', 'aPivot', 'aTint', 'aSet']) geo.setAttribute(name, model.geometry.getAttribute(name));
      geo.setIndex(model.geometry.index);
      geo.setAttribute('iPosYaw', new InterleavedBufferAttribute(buffer, 4, 0));
      geo.setAttribute('iSpring', new InterleavedBufferAttribute(buffer, 4, 4));
      geo.setAttribute('iSpringV', new InterleavedBufferAttribute(buffer, 4, 8));
      geo.setAttribute('iAnim', new InterleavedBufferAttribute(buffer, 4, 12));
      geo.setAttribute('iState', new InterleavedBufferAttribute(buffer, 4, 16));
      geo.instanceCount = n;
      const floppy = Math.min(1.6, Math.max(0.4, 70 / v.wobbleStiffness));
      const def = defs[t];
      const lm = createLiveMaterial(model.layout, {
        scale: v.scale,
        attackStyle: attackStyleIndex(def.weapon.style),
        sidearmStyle: attackStyleIndex((def.sidearm ?? def.weapon).style),
        floppy,
        horse: model.horse,
      });
      const mesh = new Mesh(geo, lm.material);
      mesh.customDepthMaterial = lm.depth;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.live.push({ type: t, slots, data, buffer, mesh });

      // Posed batch (ragdolls and corpses of this type).
      const pdata = new Float32Array(n * 4);
      const attr = new InstancedBufferAttribute(pdata, 4);
      attr.setUsage(DynamicDrawUsage);
      const pgeo = new InstancedBufferGeometry();
      for (const name of ['position', 'color', 'aPart', 'aPivot', 'aTint', 'aSet']) pgeo.setAttribute(name, model.geometry.getAttribute(name));
      pgeo.setIndex(model.geometry.index);
      pgeo.setAttribute('iPose', attr);
      pgeo.instanceCount = 0;
      const pm = createPosedMaterial(model.layout, v.scale, this.ragdolls.activeTex, this.ragdolls.corpseTex);
      const pmesh = new Mesh(pgeo, pm.material);
      pmesh.customDepthMaterial = pm.depth;
      pmesh.frustumCulled = false;
      pmesh.matrixAutoUpdate = false;
      pmesh.castShadow = true;
      this.scene.add(pmesh);
      this.posed[t] = { type: t, data: pdata, attr, geo: pgeo, mesh: pmesh, count: 0 };
    }
    this.ragdolls.setBattle(count, types, teams, layouts, scales);
  }

  /** Snapshot arrived: drive the springs with the opposite of each unit's acceleration. */
  onSnapshot = (prev: Float32Array, curr: Float32Array): void => {
    for (let i = 0; i < this.count; i++) {
      const o = HEADER_FLOATS + i * UNIT_STRIDE;
      const st = curr[o + U_STATE];
      if (st === S_DEAD || st === S_TUMBLING || (curr[o + U_FLAGS] & F_AIRBORNE) !== 0) continue;
      let dvx = curr[o + U_VX] - prev[o + U_VX];
      let dvz = curr[o + U_VZ] - prev[o + U_VZ];
      // Big velocity jumps are knockback; hit events handle those, so only small ones count here.
      const len = Math.sqrt(dvx * dvx + dvz * dvz);
      if (len > 1.2) {
        dvx *= 1.2 / len;
        dvz *= 1.2 / len;
      }
      const g = this.defs[this.types[i]].visual.wobbleGain * 1.5;
      this.svx[i] -= dvx * g;
      this.svz[i] -= dvz * g;
    }
  };

  /** Sim events for this tick: hits shove the spring, landings squash, deaths spawn ragdolls. */
  onEvents = (ev: Float32Array, offset: number, count: number): void => {
    for (let k = 0; k < count; k++) {
      const o = offset + k * EVENT_STRIDE;
      const type = ev[o];
      const u = ev[o + 1];
      if (u < 0 || u >= this.count) continue;
      const d = this.defs[this.types[u]];
      const g = d.visual.wobbleGain;
      if (type === EV_HIT) {
        const shove = Math.min(ev[o + 9] / d.mass, 7) * 0.55 * g + 0.4 * g;
        this.svx[u] += ev[o + 6] * shove;
        this.svy[u] += 0.6 * g;
        this.svz[u] += ev[o + 8] * shove;
        // Flash in proportion to how much of the unit's health the hit took.
        this.flash[u] = Math.min(1, this.flash[u] + ev[o + 5] / (d.health * 0.12));
      } else if (type === EV_LAND) {
        this.svy[u] -= Math.min(ev[o + 5], 14) * 0.12;
      } else if (type === EV_STRIKE) {
        this.svx[u] += ev[o + 6] * 1.1 * g;
        this.svz[u] += ev[o + 8] * 1.1 * g;
      } else if (type === EV_LAUNCH) {
        const r = this.ragdolls;
        if (r.unitRow[u] < 0 && r.spawn(u, false, this.poses, this.poses.vx[u] + ev[o + 6] * ev[o + 5], this.poses.vy[u] + ev[o + 7] * ev[o + 5], this.poses.vz[u] + ev[o + 8] * ev[o + 5], this.time)) {
          this.shaderTumble[u] = 0;
        } else if (r.unitRow[u] < 0) {
          this.shaderTumble[u] = 1;
          this.modeStart[u] = this.time;
        }
      } else if (type === EV_DEATH) {
        const fell = ev[o + 9] > 0.5;
        if (fell) {
          // Fell off the world: nothing left to show.
          this.ragdolls.discard(u);
          continue;
        }
        if (!this.ragdolls.spawn(u, true, this.poses, ev[o + 6], ev[o + 7], ev[o + 8], this.time)) {
          this.flopped[u] = 1;
          this.modeStart[u] = this.time;
          this.fx[u] = this.poses.x[u];
          this.fy[u] = this.poses.y[u];
          this.fz[u] = this.poses.z[u];
          this.fvx[u] = ev[o + 6];
          this.fvy[u] = ev[o + 7];
          this.fvz[u] = ev[o + 8];
          this.fAir[u] = ev[o + 6] * ev[o + 6] + ev[o + 7] * ev[o + 7] + ev[o + 8] * ev[o + 8] > 4 ? 1 : 0;
          const yaw = this.poses.yaw[u];
          this.modeParam[u] = ev[o + 6] * Math.sin(yaw) + ev[o + 8] * Math.cos(yaw) > 0 ? 1 : 0;
          this.ragdolls.addFlopCorpse(u);
        }
      }
    }
  };

  /** Per frame: interpolate, integrate springs, pick modes, write instance data. dt is visual time. */
  update(client: SimClient, alpha: number, dt: number): void {
    const prev = client.prev;
    const curr = client.curr;
    if (!prev || !curr) return;
    this.time += dt;
    unitTime.value = this.time;
    const P = this.poses;
    const pose = this.pose4;

    // 1. Interpolate the sim state for every unit.
    for (let i = 0; i < this.count; i++) {
      const o = HEADER_FLOATS + i * UNIT_STRIDE;
      client.unitPose(i, alpha, pose);
      P.x[i] = pose[0];
      P.y[i] = pose[1];
      P.z[i] = pose[2];
      P.yaw[i] = pose[3];
      P.vx[i] = prev[o + U_VX] + (curr[o + U_VX] - prev[o + U_VX]) * alpha;
      P.vy[i] = prev[o + U_VY] + (curr[o + U_VY] - prev[o + U_VY]) * alpha;
      P.vz[i] = prev[o + U_VZ] + (curr[o + U_VZ] - prev[o + U_VZ]) * alpha;
      const st = curr[o + U_STATE];
      P.state[i] = st;
      const pp = prev[o + U_STATE] === st ? prev[o + U_PROGRESS] : 0;
      P.progress[i] = pp + (curr[o + U_PROGRESS] - pp) * alpha;
      const flags = curr[o + U_FLAGS];
      this.airborne[i] = (flags & F_AIRBORNE) !== 0 ? 1 : 0;
      this.sidearm[i] = (flags & F_SIDEARM) !== 0 ? 1 : 0;
      this.aux[i] = curr[o + U_AUX];
    }

    // 2. Ragdolls step and write their poses.
    this.ragdolls.update(dt, P, this.time);

    // 3. Springs, walk cycle, modes, instance data.
    const steps = Math.max(1, Math.ceil(dt / (1 / 90)));
    const h = dt / steps;
    const sh = this.shadows;
    sh.begin();
    for (let b = 0; b < this.live.length; b++) {
      const batch = this.live[b];
      const d = this.defs[batch.type];
      const v = d.visual;
      const k = v.wobbleStiffness;
      const c = v.wobbleDamping;
      const data = batch.data;
      const slots = batch.slots;
      for (let n = 0; n < slots.length; n++) {
        const i = slots[n];
        const o = n * LIVE_FLOATS;
        const st = P.state[i];

        // Damped spring, deliberately under-damped so each shove rings two or three times.
        let x = this.sx[i], y = this.sy[i], z = this.sz[i];
        let vx = this.svx[i], vy = this.svy[i], vz = this.svz[i];
        for (let s = 0; s < steps; s++) {
          vx += (-k * x - c * vx) * h;
          vy += (-k * 1.6 * y - c * 1.3 * vy) * h;
          vz += (-k * z - c * vz) * h;
          x += vx * h;
          y += vy * h;
          z += vz * h;
        }
        const hl = Math.sqrt(x * x + z * z);
        if (hl > 0.55) {
          x *= 0.55 / hl;
          z *= 0.55 / hl;
        }
        if (y > 0.28) y = 0.28;
        else if (y < -0.38) y = -0.38;
        this.sx[i] = x; this.sy[i] = y; this.sz[i] = z;
        this.svx[i] = vx; this.svy[i] = vy; this.svz[i] = vz;
        this.flash[i] = Math.max(0, this.flash[i] - dt * 7);

        // Walk cycle from ground speed; airborne units pedal their legs.
        const speed = Math.sqrt(P.vx[i] * P.vx[i] + P.vz[i] * P.vz[i]);
        let amount: number;
        if (this.airborne[i] && st !== S_TUMBLING) {
          this.walk[i] += dt * 15;
          amount = 1;
        } else {
          // One full cycle (two steps) per stride length, scaled with the body.
          this.walk[i] += (speed / (v.stride * v.scale)) * dt * 6.283185;
          amount = Math.min(1.25, speed / (1.4 * Math.sqrt(v.scale)));
        }
        if (this.walk[i] > 1000) this.walk[i] -= 6.283185 * 159;

        // Attack phase: 0 rest, 0..1 wind-up, 1..1.25 strike, 1.25..2 recovery; +4 with the sidearm.
        const pr = P.progress[i];
        let atk = 0;
        if (st === S_WINDUP) atk = pr;
        else if (st === S_STRIKE) atk = 1 + 0.25 * pr;
        else if (st === S_RECOVER) atk = 1.25 + 0.75 * pr;
        if (atk > 0 && this.sidearm[i]) atk += 4;

        // Shield wall: raise the shield while standing in one.
        const wallTarget = d.shieldWall && st !== S_TUMBLING ? Math.min(1, this.aux[i]) : 0;
        this.brace[i] += (wallTarget - this.brace[i]) * Math.min(1, dt * 6);

        // Which body is showing: the wobbly live one, a fallback pose, or a ragdoll/corpse.
        let mode = MODE_ALIVE;
        let mt = 0;
        let mp = 0;
        let sink = 0;
        let px = P.x[i];
        let py = P.y[i];
        let pz = P.z[i];
        if (this.ragdolls.unitGone[i] || this.ragdolls.unitRow[i] >= 0 || this.ragdolls.unitCorpseRow[i] >= 0) {
          mode = MODE_HIDDEN;
        } else if (st === S_DEAD) {
          if (this.flopped[i]) {
            if (this.fAir[i]) this.flyCorpse(i, dt);
            px = this.fx[i];
            py = this.fy[i];
            pz = this.fz[i];
            // Spin while flying, then topple over where it lands.
            mode = this.fAir[i] ? MODE_TUMBLE : MODE_FLOP;
            mt = this.time - this.modeStart[i];
            mp = this.modeParam[i];
            sink = this.ragdolls.unitSink[i];
            if (this.ragdolls.unitGone[i]) mode = MODE_HIDDEN;
          } else {
            mode = MODE_HIDDEN;
          }
        } else if (st === S_TUMBLING) {
          mode = MODE_TUMBLE;
          if (!this.shaderTumble[i]) {
            this.shaderTumble[i] = 1;
            this.modeStart[i] = this.time;
          }
          mt = this.time - this.modeStart[i];
        } else if (st === S_GETTING_UP && this.shaderTumble[i]) {
          mode = MODE_GETUP;
          mp = pr;
        } else if (st !== S_GETTING_UP) {
          this.shaderTumble[i] = 0;
        }

        data[o] = px;
        data[o + 1] = py - sink;
        data[o + 2] = pz;
        data[o + 3] = P.yaw[i];
        data[o + 4] = x;
        data[o + 5] = y;
        data[o + 6] = z;
        data[o + 7] = v.scale;
        data[o + 8] = vx;
        data[o + 9] = vy;
        data[o + 10] = vz;
        data[o + 11] = this.flash[i];
        data[o + 12] = this.walk[i];
        data[o + 13] = mode === MODE_ALIVE ? amount : 0;
        data[o + 14] = mode === MODE_ALIVE ? atk : 0;
        data[o + 15] = this.seed[i];
        data[o + 16] = this.teams[i] + 2 * this.sidearm[i];
        data[o + 17] = mode;
        data[o + 18] = mt;
        data[o + 19] = mode === MODE_ALIVE ? this.brace[i] : mp;

        if (mode === MODE_ALIVE || mode === MODE_TUMBLE || mode === MODE_GETUP) {
          sh.add(px, py, pz, d.radius * 1.25);
        } else if (mode === MODE_FLOP && sink < 0.3) {
          sh.add(px, py, pz, d.radius * 1.6);
        }
      }
      batch.buffer.needsUpdate = true;
    }

    // 4. Posed instances: active ragdolls, then corpses.
    for (let t = 0; t < this.posed.length; t++) {
      const pb = this.posed[t];
      if (pb) pb.count = 0;
    }
    const rd = this.ragdolls;
    const ad = rd.activeData;
    for (let r = 0; r < rd.rows; r++) {
      const u = rd.rowUnit[r];
      if (u < 0) continue;
      const pb = this.posed[this.types[u]];
      if (!pb) continue;
      const o = pb.count * 4;
      pb.data[o] = r;
      pb.data[o + 1] = 0;
      pb.data[o + 2] = this.teams[u] + 2 * this.sidearm[u];
      pb.data[o + 3] = 0;
      pb.count++;
      const to = r * POSE_TEXELS * 4;
      sh.add(ad[to], ad[to + 1] - 0.3, ad[to + 2], this.defs[this.types[u]].radius * 1.4);
    }
    const cd = rd.corpseData;
    for (let k = 0; k < rd.corpseTotal; k++) {
      const u = rd.corpseAt(k);
      const cr = rd.unitCorpseRow[u];
      if (cr < 0 || rd.unitGone[u]) continue;
      const pb = this.posed[this.types[u]];
      if (!pb) continue;
      const o = pb.count * 4;
      pb.data[o] = cr;
      pb.data[o + 1] = 1;
      pb.data[o + 2] = this.teams[u] + 2 * this.sidearm[u];
      pb.data[o + 3] = rd.unitSink[u];
      pb.count++;
      if (rd.unitSink[u] < 0.3) {
        const to = cr * POSE_TEXELS * 4;
        sh.add(cd[to], cd[to + 1] - 0.3, cd[to + 2], this.defs[this.types[u]].radius * 1.4);
      }
    }
    for (let t = 0; t < this.posed.length; t++) {
      const pb = this.posed[t];
      if (!pb) continue;
      pb.geo.instanceCount = pb.count;
      if (pb.count > 0) pb.attr.needsUpdate = true;
    }
    sh.end();
  }

  /** Ballistic flight of a shader-flop corpse until it lands (or falls off the world). */
  private flyCorpse(i: number, dt: number): void {
    const t = this.terrain;
    this.fvy[i] -= 18 * dt;
    this.fx[i] += this.fvx[i] * dt;
    this.fy[i] += this.fvy[i] * dt;
    this.fz[i] += this.fvz[i] * dt;
    if (!t) return;
    const g = groundHeight(t, this.fx[i], this.fz[i]);
    if (g === VOID_HEIGHT) {
      if (this.fy[i] < t.killY) this.ragdolls.unitGone[i] = 1;
      return;
    }
    if (this.fy[i] > g) return;
    this.fy[i] = g;
    if (this.fvy[i] < -4) {
      this.fvy[i] *= -0.3;
      this.fvx[i] *= 0.6;
      this.fvz[i] *= 0.6;
    } else {
      this.fAir[i] = 0;
      this.modeStart[i] = this.time;
    }
  }

  get activeRagdolls(): number {
    return this.ragdolls.activeRagdolls;
  }

  dispose(): void {
    for (const b of this.live) {
      this.scene.remove(b.mesh);
      b.mesh.geometry.dispose();
      (b.mesh.material as MeshLambertMaterial).dispose();
      b.mesh.customDepthMaterial?.dispose();
    }
    for (const p of this.posed) {
      if (!p) continue;
      this.scene.remove(p.mesh);
      p.geo.dispose();
      (p.mesh.material as MeshLambertMaterial).dispose();
      p.mesh.customDepthMaterial?.dispose();
    }
    this.live = [];
    this.posed = [];
  }
}
