import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three';
import type RAPIER_NS from '@dimforge/rapier3d-compat';
import { S_DEAD, S_GETTING_UP, S_TUMBLING } from '../sim/constants.ts';
import type { BodyLayout } from './unit-model.ts';
import { RAGDOLL_PARTS } from './unit-model.ts';

type Rapier = typeof RAPIER_NS;
type World = RAPIER_NS.World;
type RigidBody = RAPIER_NS.RigidBody;

/** Texels per pose row: (position, quaternion) per ragdoll part. */
export const POSE_TEXELS = RAGDOLL_PARTS * 2;

const KIND_FREE = 0;
const KIND_DEATH = 1;
const KIND_TUMBLE = 2;
const KIND_GETUP = 3;

const PHYS_DT = 1 / 60;
const MAX_SUBSTEPS = 2;
/** Death ragdolls freeze into corpses once at rest, or after this long if they're still moving. */
const DEATH_REST_TIME = 3;
const DEATH_MAX_TIME = 6;
const SINK_SPEED = 0.7;

// Collision filtering: ragdoll parts touch the terrain only (not each other, not living units).
const GROUP_TERRAIN = 0x0001;
const GROUP_RAGDOLL = 0x0002;
const TERRAIN_GROUPS = (GROUP_TERRAIN << 16) | GROUP_RAGDOLL;
const RAGDOLL_GROUPS = (GROUP_RAGDOLL << 16) | GROUP_TERRAIN;

/** Per-unit pose data the unit renderer fills in every frame; ragdolls read it. */
export interface UnitPoses {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  yaw: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  state: Uint8Array;
  progress: Float32Array;
}

/**
 * Real ragdolls (Rapier) for deaths and heavy tumbles, under a hard budget, plus frozen corpses.
 *
 * - Deaths have priority: a death may take the slot of a tumbling ragdoll, or freeze the oldest
 *   death ragdoll early. When nothing can be freed the caller falls back to shader-only poses.
 * - A tumbling unit's ragdoll root is pulled toward its sim capsule, so the visual follows the
 *   gameplay truth. When the unit gets up, the pose blends back to standing.
 * - A dead ragdoll freezes into a static corpse when it comes to rest or after ~3 s, and its
 *   bodies leave the physics world. Corpses are capped; the oldest sink into the ground.
 *
 * Purely visual: nothing here feeds back into the simulation.
 */
export class RagdollSystem {
  private R: Rapier | null = null;
  private world: World | null = null;
  private acc = 0;
  private killY = -1000;
  budget: number;
  readonly rows: number;
  readonly activeData: Float32Array;
  readonly activeTex: DataTexture;
  corpseCap: number;
  readonly corpseData: Float32Array;
  readonly corpseTex: DataTexture;

  // Active rows.
  readonly rowUnit: Int32Array;
  readonly rowKind: Uint8Array;
  readonly rowTime: Float32Array;
  private readonly bodies: (RigidBody | null)[];
  private readonly blendFrom: Float32Array;
  /** Number of rows that currently own physics bodies (counts against the budget). */
  physicsCount = 0;

  // Per unit.
  unitRow = new Int32Array(0);
  /** Corpse row for posed corpses, -1 otherwise. */
  unitCorpseRow = new Int32Array(0);
  /** How far the unit's corpse has sunk (m); used for shader-flop corpses too. */
  unitSink = new Float32Array(0);
  /** 1 once a corpse has fully sunk and should no longer be drawn. */
  unitGone = new Uint8Array(0);
  private unitType: Uint8Array = new Uint8Array(0);
  private unitTeam: Uint8Array = new Uint8Array(0);

  // Corpse FIFO (unit slots), oldest first.
  private corpseQueue = new Int32Array(0);
  private corpseHead = 0;
  private corpseCount = 0;
  private sinkingCount = 0;
  private readonly freeCorpseRows: Int32Array;
  private freeCorpseTop = 0;
  private corpseDirty = false;

  private layouts: BodyLayout[] = [];
  private scales: number[] = [];

  // Scratch objects reused so the per-frame path allocates nothing.
  private readonly tv = { x: 0, y: 0, z: 0 };
  private readonly tq = { x: 0, y: 0, z: 0, w: 1 };
  private readonly sv = { x: 0, y: 0, z: 0 };

  constructor(budget: number, corpseCap: number) {
    this.budget = budget;
    // A few extra rows so units blending back to their feet don't use physics budget.
    this.rows = budget + 16;
    this.activeData = new Float32Array(this.rows * POSE_TEXELS * 4);
    this.activeTex = new DataTexture(this.activeData, POSE_TEXELS, this.rows, RGBAFormat, FloatType);
    this.activeTex.magFilter = this.activeTex.minFilter = NearestFilter;
    this.activeTex.needsUpdate = true;
    this.corpseCap = corpseCap;
    this.corpseData = new Float32Array(Math.max(1, corpseCap) * POSE_TEXELS * 4);
    this.corpseTex = new DataTexture(this.corpseData, POSE_TEXELS, Math.max(1, corpseCap), RGBAFormat, FloatType);
    this.corpseTex.magFilter = this.corpseTex.minFilter = NearestFilter;
    this.corpseTex.needsUpdate = true;
    this.rowUnit = new Int32Array(this.rows).fill(-1);
    this.rowKind = new Uint8Array(this.rows);
    this.rowTime = new Float32Array(this.rows);
    this.bodies = new Array(this.rows * RAGDOLL_PARTS).fill(null);
    this.blendFrom = new Float32Array(this.rows * RAGDOLL_PARTS * 7);
    this.freeCorpseRows = new Int32Array(Math.max(1, corpseCap));
  }

  get ready(): boolean {
    return this.world !== null;
  }

  /** Called once Rapier has loaded (lazily, after the menu is up). */
  attachPhysics(R: Rapier): void {
    this.R = R;
  }

  /** (Re)build the physics world around a terrain mesh. Drops any active ragdolls. */
  setTerrain(terrainVertices: Float32Array, terrainIndices: Uint32Array, killY: number): void {
    this.killY = killY;
    const R = this.R;
    if (!R) return;
    this.clearAll();
    this.world?.free();
    const world = new R.World({ x: 0, y: -18, z: 0 });
    world.timestep = PHYS_DT;
    const desc = R.ColliderDesc.trimesh(terrainVertices, terrainIndices)
      .setCollisionGroups(TERRAIN_GROUPS)
      .setFriction(0.9)
      .setRestitution(0.1);
    world.createCollider(desc);
    this.world = world;
    this.physicsCount = 0;
    this.prewarm();
  }

  /**
   * The first physics steps are slow (WASM tier-up, lazily built query structures). Drop a
   * throwaway body onto the terrain now so that cost lands during loading, not on the first death.
   */
  private prewarm(): void {
    const R = this.R;
    const world = this.world;
    if (!R || !world) return;
    const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0, 40, 0).setLinvel(0, -30, 0));
    world.createCollider(R.ColliderDesc.capsule(0.2, 0.2).setCollisionGroups(RAGDOLL_GROUPS), body);
    for (let k = 0; k < 90; k++) world.step();
    world.removeRigidBody(body);
  }

  /** Reset for a new battle. */
  setBattle(unitCount: number, types: Uint8Array, teams: Uint8Array, layouts: BodyLayout[], scales: number[]): void {
    this.clearAll();
    this.layouts = layouts;
    this.scales = scales;
    this.unitRow = new Int32Array(unitCount).fill(-1);
    this.unitCorpseRow = new Int32Array(unitCount).fill(-1);
    this.unitSink = new Float32Array(unitCount);
    this.unitGone = new Uint8Array(unitCount);
    this.unitType = types;
    this.unitTeam = teams;
    this.corpseQueue = new Int32Array(Math.max(1, unitCount));
    this.corpseHead = 0;
    this.corpseCount = 0;
    this.sinkingCount = 0;
    this.freeCorpseTop = 0;
    for (let r = this.corpseCap - 1; r >= 0; r--) this.freeCorpseRows[this.freeCorpseTop++] = r;
  }

  private clearAll(): void {
    for (let r = 0; r < this.rows; r++) {
      this.removeBodies(r);
      this.rowKind[r] = KIND_FREE;
      this.rowUnit[r] = -1;
    }
    this.physicsCount = 0;
  }

  setBudget(budget: number): void {
    this.budget = Math.min(budget, this.rows - 16);
  }

  private removeBodies(r: number): void {
    if (!this.world) return;
    let had = false;
    for (let p = 0; p < RAGDOLL_PARTS; p++) {
      const b = this.bodies[r * RAGDOLL_PARTS + p];
      if (b) {
        this.world.removeRigidBody(b);
        this.bodies[r * RAGDOLL_PARTS + p] = null;
        had = true;
      }
    }
    if (had) this.physicsCount--;
  }

  private freeRow(): number {
    for (let r = 0; r < this.rows; r++) if (this.rowKind[r] === KIND_FREE) return r;
    return -1;
  }

  /**
   * Find a row with physics budget for a new ragdoll. A death may take over the slot of a
   * tumbling ragdoll (that unit falls back to the shader tumble); otherwise the caller uses the
   * shader-only fallback. Death ragdolls are never frozen early: they would stop in mid-air.
   */
  private acquire(forDeath: boolean): number {
    if (this.physicsCount < this.budget) return this.freeRow();
    if (!forDeath) return -1;
    for (let r = 0; r < this.rows; r++) {
      if (this.rowKind[r] === KIND_TUMBLE) {
        this.release(r);
        return this.freeRow();
      }
    }
    return -1;
  }

  private release(r: number): void {
    this.removeBodies(r);
    const u = this.rowUnit[r];
    if (u >= 0 && this.unitRow[u] === r) this.unitRow[u] = -1;
    this.rowUnit[r] = -1;
    this.rowKind[r] = KIND_FREE;
  }

  /**
   * Start a ragdoll for unit u at its current visual pose, moving with velocity (vx, vy, vz).
   * Returns false if there is no budget (the caller uses the shader-only fallback).
   */
  spawn(u: number, death: boolean, poses: UnitPoses, vx: number, vy: number, vz: number, now: number): boolean {
    const R = this.R;
    const world = this.world;
    if (!R || !world) return false;
    let r = this.unitRow[u];
    if (r >= 0 && this.rowKind[r] === KIND_TUMBLE && death) {
      // Already flailing: the tumble simply becomes a death.
      this.rowKind[r] = KIND_DEATH;
      this.rowTime[r] = now;
      return true;
    }
    if (r >= 0) this.release(r);
    r = this.acquire(death);
    if (r < 0) return false;
    const type = this.unitType[u];
    const layout = this.layouts[type];
    const s = this.scales[type];
    const px = poses.x[u];
    const py = poses.y[u];
    const pz = poses.z[u];
    const yaw = poses.yaw[u];
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const qy = Math.sin(yaw / 2);
    const qw = Math.cos(yaw / 2);
    // A bit of random spin so identical hits don't produce identical tumbles (visual only).
    const spinX = (Math.random() - 0.5) * 9;
    const spinZ = (Math.random() - 0.5) * 9;
    for (let p = 0; p < RAGDOLL_PARTS; p++) {
      const shape = layout.parts[p];
      const lx = shape.center.x * s;
      const ly = shape.center.y * s;
      const lz = shape.center.z * s;
      const bd = R.RigidBodyDesc.dynamic()
        .setTranslation(px + lx * cy + lz * sy, py + ly, pz - lx * sy + lz * cy)
        .setRotation({ x: 0, y: qy, z: 0, w: qw })
        .setLinvel(vx, vy, vz)
        .setLinearDamping(0.05)
        .setAngularDamping(p === 0 ? 0.4 : 0.9);
      const body = world.createRigidBody(bd);
      this.sv.x = spinX;
      this.sv.y = 0;
      this.sv.z = spinZ;
      body.setAngvel(this.sv, true);
      const cd = (shape.halfHeight > 0 ? R.ColliderDesc.capsule(shape.halfHeight * s, shape.radius * s) : R.ColliderDesc.ball(shape.radius * s))
        .setDensity(p === 0 ? 1.4 : 0.9)
        .setFriction(0.9)
        .setRestitution(0.2)
        .setCollisionGroups(RAGDOLL_GROUPS);
      world.createCollider(cd, body);
      this.bodies[r * RAGDOLL_PARTS + p] = body;
    }
    // Joints: neck, shoulders and hips, all ball joints (as floppy as it gets).
    const torso = this.bodies[r * RAGDOLL_PARTS]!;
    const tc = layout.parts[0].center;
    const joint = (part: number, ax: number, ay: number, az: number) => {
      const c = layout.parts[part].center;
      const data = R.JointData.spherical(
        { x: (ax - tc.x) * s, y: (ay - tc.y) * s, z: (az - tc.z) * s },
        { x: (ax - c.x) * s, y: (ay - c.y) * s, z: (az - c.z) * s },
      );
      world.createImpulseJoint(data, torso, this.bodies[r * RAGDOLL_PARTS + part]!, true);
    };
    joint(1, layout.neck.x, layout.neck.y, layout.neck.z);
    joint(2, layout.shoulderL.x, layout.shoulderL.y, layout.shoulderL.z);
    joint(3, layout.shoulderR.x, layout.shoulderR.y, layout.shoulderR.z);
    joint(4, layout.hipL.x, layout.hipL.y, layout.hipL.z);
    joint(5, layout.hipR.x, layout.hipR.y, layout.hipR.z);
    this.physicsCount++;
    this.rowUnit[r] = u;
    this.rowKind[r] = death ? KIND_DEATH : KIND_TUMBLE;
    this.rowTime[r] = now;
    this.unitRow[u] = r;
    return true;
  }

  /** Copy row r's current pose into a corpse row and release the physics bodies. */
  private freezeCorpse(r: number): void {
    const u = this.rowUnit[r];
    this.writeRowPose(r);
    if (u >= 0) {
      const cr = this.takeCorpseRow();
      if (cr >= 0) {
        const src = r * POSE_TEXELS * 4;
        const dst = cr * POSE_TEXELS * 4;
        for (let k = 0; k < POSE_TEXELS * 4; k++) this.corpseData[dst + k] = this.activeData[src + k];
        this.unitCorpseRow[u] = cr;
        this.corpseDirty = true;
        this.pushCorpse(u);
      } else {
        this.unitGone[u] = 1;
      }
    }
    this.release(r);
  }

  private takeCorpseRow(): number {
    if (this.freeCorpseTop === 0) this.forceRemoveOldestCorpse();
    if (this.freeCorpseTop === 0) return -1;
    return this.freeCorpseRows[--this.freeCorpseTop];
  }

  /** Drop unit u's ragdoll (if any) without leaving a corpse, e.g. it fell off the world. */
  discard(u: number): void {
    const r = this.unitRow[u];
    if (r >= 0) this.release(r);
    this.unitGone[u] = 1;
  }

  /** A shader-only death flop also counts as a corpse (it can sink away like the others). */
  addFlopCorpse(u: number): void {
    this.pushCorpse(u);
  }

  private pushCorpse(u: number): void {
    const cap = this.corpseQueue.length;
    this.corpseQueue[(this.corpseHead + this.corpseCount) % cap] = u;
    this.corpseCount++;
    this.unitSink[u] = 0;
  }

  private forceRemoveOldestCorpse(): void {
    if (this.corpseCount === 0) return;
    const u = this.corpseQueue[this.corpseHead];
    this.corpseHead = (this.corpseHead + 1) % this.corpseQueue.length;
    this.corpseCount--;
    if (this.sinkingCount > 0) this.sinkingCount--;
    this.retireCorpse(u);
  }

  private retireCorpse(u: number): void {
    this.unitGone[u] = 1;
    const cr = this.unitCorpseRow[u];
    if (cr >= 0) {
      this.freeCorpseRows[this.freeCorpseTop++] = cr;
      this.unitCorpseRow[u] = -1;
    }
  }

  /** Physics, lifecycle and pose output. dt is visual time (already scaled by battle speed). */
  update(dt: number, poses: UnitPoses, now: number): void {
    // Lifecycle of active rows.
    for (let r = 0; r < this.rows; r++) {
      const kind = this.rowKind[r];
      if (kind === KIND_FREE) continue;
      const u = this.rowUnit[r];
      const st = poses.state[u];
      if (kind === KIND_TUMBLE) {
        if (st === S_GETTING_UP) this.beginGetUp(r);
        else if (st !== S_TUMBLING && st !== S_DEAD) this.release(r);
      } else if (kind === KIND_GETUP) {
        if (st !== S_GETTING_UP) this.release(r);
      } else if (kind === KIND_DEATH) {
        const age = now - this.rowTime[r];
        const torso = this.bodies[r * RAGDOLL_PARTS];
        if (torso) torso.translation(this.tv);
        if (torso && this.tv.y < this.killY) {
          // Fell off the world.
          this.discard(u);
        } else if (age > DEATH_MAX_TIME || (age > 0.7 && this.atRest(r)) || (age > DEATH_REST_TIME && this.slow(r))) {
          this.freezeCorpse(r);
        }
      }
    }

    if (this.world && this.physicsCount > 0) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= PHYS_DT && steps < MAX_SUBSTEPS) {
        this.pullTumblers(poses);
        this.world.step();
        this.acc -= PHYS_DT;
        steps++;
      }
      if (this.acc > PHYS_DT) this.acc = 0;
    } else {
      this.acc = 0;
    }

    let any = false;
    for (let r = 0; r < this.rows; r++) {
      if (this.rowKind[r] === KIND_FREE) continue;
      any = true;
      if (this.rowKind[r] === KIND_GETUP) this.writeGetUpPose(r, poses);
      else this.writeRowPose(r);
    }
    if (any) this.activeTex.needsUpdate = true;
    if (this.corpseDirty) {
      this.corpseTex.needsUpdate = true;
      this.corpseDirty = false;
    }

    // Corpse cap: the oldest corpses sink into the ground, then are recycled.
    while (this.corpseCount - this.sinkingCount > this.corpseCap) this.sinkingCount++;
    const cap = this.corpseQueue.length;
    for (let k = 0; k < this.sinkingCount; k++) {
      const u = this.corpseQueue[(this.corpseHead + k) % cap];
      this.unitSink[u] += dt * SINK_SPEED;
    }
    while (this.sinkingCount > 0) {
      const u = this.corpseQueue[this.corpseHead];
      const depth = 1.4 * this.scales[this.unitType[u]] + 0.4;
      if (this.unitSink[u] < depth) break;
      this.corpseHead = (this.corpseHead + 1) % cap;
      this.corpseCount--;
      this.sinkingCount--;
      this.retireCorpse(u);
    }
  }

  /** Moving slowly enough to freeze without a visible pop. */
  private slow(r: number): boolean {
    const b = this.bodies[r * RAGDOLL_PARTS];
    if (!b) return true;
    b.linvel(this.tv);
    return this.tv.x * this.tv.x + this.tv.y * this.tv.y + this.tv.z * this.tv.z < 1.5;
  }

  private atRest(r: number): boolean {
    for (let p = 0; p < RAGDOLL_PARTS; p++) {
      const b = this.bodies[r * RAGDOLL_PARTS + p];
      if (!b) continue;
      if (b.isSleeping()) continue;
      b.linvel(this.tv);
      if (this.tv.x * this.tv.x + this.tv.y * this.tv.y + this.tv.z * this.tv.z > 0.09) return false;
    }
    return true;
  }

  /** Tumbling ragdolls: pull the torso toward the sim capsule so the visual follows gameplay. */
  private pullTumblers(poses: UnitPoses): void {
    for (let r = 0; r < this.rows; r++) {
      if (this.rowKind[r] !== KIND_TUMBLE) continue;
      const u = this.rowUnit[r];
      const torso = this.bodies[r * RAGDOLL_PARTS];
      if (!torso) continue;
      const layout = this.layouts[this.unitType[u]];
      const s = this.scales[this.unitType[u]];
      torso.translation(this.tv);
      const gx = poses.x[u];
      const gy = poses.y[u] + layout.parts[0].center.y * s * 0.7;
      const gz = poses.z[u];
      const k = 12;
      this.sv.x = poses.vx[u] + (gx - this.tv.x) * k;
      this.sv.y = poses.vy[u] + (gy - this.tv.y) * k;
      this.sv.z = poses.vz[u] + (gz - this.tv.z) * k;
      torso.setLinvel(this.sv, true);
    }
  }

  /** Read a physics row's six body transforms into the active pose texture. */
  private writeRowPose(r: number): void {
    const d = this.activeData;
    for (let p = 0; p < RAGDOLL_PARTS; p++) {
      const b = this.bodies[r * RAGDOLL_PARTS + p];
      if (!b) return;
      b.translation(this.tv);
      b.rotation(this.tq);
      const o = (r * POSE_TEXELS + p * 2) * 4;
      d[o] = this.tv.x;
      d[o + 1] = this.tv.y;
      d[o + 2] = this.tv.z;
      d[o + 3] = 1;
      d[o + 4] = this.tq.x;
      d[o + 5] = this.tq.y;
      d[o + 6] = this.tq.z;
      d[o + 7] = this.tq.w;
    }
  }

  private beginGetUp(r: number): void {
    this.writeRowPose(r);
    const d = this.activeData;
    for (let p = 0; p < RAGDOLL_PARTS; p++) {
      const o = (r * POSE_TEXELS + p * 2) * 4;
      const b = (r * RAGDOLL_PARTS + p) * 7;
      this.blendFrom[b] = d[o];
      this.blendFrom[b + 1] = d[o + 1];
      this.blendFrom[b + 2] = d[o + 2];
      this.blendFrom[b + 3] = d[o + 4];
      this.blendFrom[b + 4] = d[o + 5];
      this.blendFrom[b + 5] = d[o + 6];
      this.blendFrom[b + 6] = d[o + 7];
    }
    this.removeBodies(r);
    this.rowKind[r] = KIND_GETUP;
  }

  /** Blend from the ragdoll's last pose to the standing pose as the unit gets up. */
  private writeGetUpPose(r: number, poses: UnitPoses): void {
    const u = this.rowUnit[r];
    const type = this.unitType[u];
    const layout = this.layouts[type];
    const s = this.scales[type];
    const t0 = Math.min(1, Math.max(0, poses.progress[u] * 1.15));
    const t = t0 * t0 * (3 - 2 * t0);
    const yaw = poses.yaw[u];
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const ty = Math.sin(yaw / 2);
    const tw = Math.cos(yaw / 2);
    const d = this.activeData;
    for (let p = 0; p < RAGDOLL_PARTS; p++) {
      const c = layout.parts[p].center;
      const lx = c.x * s;
      const ly = c.y * s;
      const lz = c.z * s;
      const rx = poses.x[u] + lx * cy + lz * sy;
      const ry = poses.y[u] + ly;
      const rz = poses.z[u] - lx * sy + lz * cy;
      const b = (r * RAGDOLL_PARTS + p) * 7;
      const o = (r * POSE_TEXELS + p * 2) * 4;
      d[o] = this.blendFrom[b] + (rx - this.blendFrom[b]) * t;
      d[o + 1] = this.blendFrom[b + 1] + (ry - this.blendFrom[b + 1]) * t;
      d[o + 2] = this.blendFrom[b + 2] + (rz - this.blendFrom[b + 2]) * t;
      // Normalised lerp toward the upright quaternion (0, ty, 0, tw), the shorter way round.
      const fx = this.blendFrom[b + 3];
      const fy = this.blendFrom[b + 4];
      const fz = this.blendFrom[b + 5];
      const fw = this.blendFrom[b + 6];
      const flip = fy * ty + fw * tw < 0 ? -1 : 1;
      const qx = fx * (1 - t);
      const qy = fy + (ty * flip - fy) * t;
      const qz = fz * (1 - t);
      const qw = fw + (tw * flip - fw) * t;
      const n = 1 / Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
      d[o + 4] = qx * n;
      d[o + 5] = qy * n;
      d[o + 6] = qz * n;
      d[o + 7] = qw * n;
    }
  }

  get activeRagdolls(): number {
    return this.physicsCount;
  }

  dispose(): void {
    this.clearAll();
    this.world?.free();
    this.world = null;
    this.activeTex.dispose();
    this.corpseTex.dispose();
  }

  /** Team of unit u (for the posed instances). */
  team(u: number): number {
    return this.unitTeam[u];
  }

  type(u: number): number {
    return this.unitType[u];
  }

  get corpseTotal(): number {
    return this.corpseCount;
  }

  corpseAt(k: number): number {
    return this.corpseQueue[(this.corpseHead + k) % this.corpseQueue.length];
  }
}

/** Load Rapier lazily (its WASM is inlined in a separate chunk) and initialise it. */
export async function loadRapier(): Promise<Rapier> {
  const mod = await import('@dimforge/rapier3d-compat');
  const R = (mod as unknown as { default?: Rapier }).default ?? (mod as unknown as Rapier);
  await R.init();
  return R;
}
