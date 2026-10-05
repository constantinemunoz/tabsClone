import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { GearKind, HatKind, UnitDef } from '../data/units.ts';

/**
 * Procedural unit bodies: a rounded torso, a round head, stubby arms and legs, googly eyes,
 * plus a hat and gear per type, and optionally a horse underneath. Every vertex is tagged with:
 *   aPart  - which body part it moves with (see PART_*)
 *   aPivot - the joint that part rotates about (hip, shoulder, neck...)
 *   aTint  - how much of the team colour it takes (clothes 1, gear 0)
 *   aSet   - weapon set: always shown, main weapon only, or sidearm only
 * The model is built at a canonical size (a 1.6 m person, feet at y = 0, facing +z, the unit's
 * left toward +x) and scaled per unit type in the shader.
 */
export const PART_TORSO = 0;
export const PART_HEAD = 1;
export const PART_ARM_L = 2;
export const PART_ARM_R = 3;
export const PART_LEG_L = 4;
export const PART_LEG_R = 5;
export const PART_PUPIL_L = 6;
export const PART_PUPIL_R = 7;

/** The six rigid parts a ragdoll is made of, indexed like PART_TORSO..PART_LEG_R. */
export const RAGDOLL_PARTS = 6;

/** Weapon sets (aSet): shown always, only while the main weapon is out, or only with the sidearm. */
export const SET_ALWAYS = 0;
export const SET_MAIN = 1;
export const SET_SIDEARM = 2;

/** Shape of each ragdoll body: box (half set), capsule (halfHeight > 0) or ball, canonical units. */
export interface RagdollPartShape {
  center: Vector3;
  radius: number;
  halfHeight: number;
  half?: Vector3;
}

/** Where the joints are, in canonical units. For a horse, hipL/hipR are its front and back legs. */
export interface BodyLayout {
  height: number;
  neck: Vector3;
  hip: Vector3;
  shoulderL: Vector3;
  shoulderR: Vector3;
  hipL: Vector3;
  hipR: Vector3;
  parts: RagdollPartShape[];
}

export interface UnitModel {
  geometry: BufferGeometry;
  layout: BodyLayout;
  horse: boolean;
}

const SKIN = 0xffdcbc;
const HAIR = 0x4a3426;
const SANDAL = 0x6b4a32;
const EYE_WHITE = 0xffffff;
const PUPIL = 0x15151c;
const WOOD = 0x9a6a3f;
const DARK_WOOD = 0x6b4527;
const BRONZE = 0xc8913f;
const DARK_BRONZE = 0x8f6227;
const STEEL = 0xc3c9d1;
const LEATHER = 0x8a5a36;
const LINEN = 0xe6dcc4;
const HORSEHAIR = 0x3a2b26;
const CREAM_CREST = 0xeee2c4;
const STONE = 0x8e8a80;
const LEAD = 0x5b5f66;
const HORSE = 0x8a5a3b;
const MANE = 0x3a2a20;
const HOOF = 0x2c2622;

/**
 * Accumulates primitives into one indexed geometry. Primitives stay indexed so the vertex
 * shader (which does all the wobble work) runs once per shared vertex, not once per corner.
 * Flat shading comes from screen-space derivatives, so shared vertices don't smooth anything.
 */
class Builder {
  private pos: number[] = [];
  private col: number[] = [];
  private part: number[] = [];
  private pivot: number[] = [];
  private tint: number[] = [];
  private set: number[] = [];
  private index: number[] = [];
  private readonly c = new Color();
  private readonly v = new Vector3();

  add(geo: BufferGeometry, part: number, pivot: Vector3, color: number, tint: number, m?: Matrix4, shade = 1, set = SET_ALWAYS): void {
    const p = geo.getAttribute('position');
    const base = this.pos.length / 3;
    this.c.setHex(color).multiplyScalar(shade);
    for (let k = 0; k < p.count; k++) {
      this.v.set(p.getX(k), p.getY(k), p.getZ(k));
      if (m) this.v.applyMatrix4(m);
      this.pos.push(this.v.x, this.v.y, this.v.z);
      this.col.push(this.c.r, this.c.g, this.c.b);
      this.part.push(part);
      this.pivot.push(pivot.x, pivot.y, pivot.z);
      this.tint.push(tint);
      this.set.push(set);
    }
    // None of our placement matrices mirror, so the winding stays front-facing.
    if (geo.index) {
      const idx = geo.index;
      for (let k = 0; k < idx.count; k++) this.index.push(base + idx.getX(k));
    } else {
      for (let k = 0; k < p.count; k++) this.index.push(base + k);
    }
    geo.dispose();
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aPart', new BufferAttribute(new Float32Array(this.part), 1));
    g.setAttribute('aPivot', new BufferAttribute(new Float32Array(this.pivot), 3));
    g.setAttribute('aTint', new BufferAttribute(new Float32Array(this.tint), 1));
    g.setAttribute('aSet', new BufferAttribute(new Float32Array(this.set), 1));
    const n = this.pos.length / 3;
    g.setIndex(new BufferAttribute(n > 65535 ? new Uint32Array(this.index) : new Uint16Array(this.index), 1));
    g.computeBoundingSphere();
    return g;
  }
}

function mat(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): Matrix4 {
  return new Matrix4().compose(
    new Vector3(x, y, z),
    new Quaternion().setFromEuler(new Euler(rx, ry, rz)),
    new Vector3(sx, sy, sz),
  );
}

/** Matrix placing a +y-aligned primitive centred on the segment a-b (no scaling). */
function along(a: Vector3, b: Vector3): Matrix4 {
  const dir = new Vector3().subVectors(b, a).normalize();
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
  return new Matrix4().compose(new Vector3().addVectors(a, b).multiplyScalar(0.5), q, new Vector3(1, 1, 1));
}

/** Matrix stretching a unit-height +y primitive so it runs from a to b. */
function between(a: Vector3, b: Vector3): Matrix4 {
  const dir = new Vector3().subVectors(b, a);
  const len = dir.length();
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
  return new Matrix4().compose(new Vector3().addVectors(a, b).multiplyScalar(0.5), q, new Vector3(1, len, 1));
}

/** A cone tip placed at `tip`, pointing away from `from`. */
function tipAt(from: Vector3, tip: Vector3, r: number, len: number): Matrix4 {
  const dir = new Vector3().subVectors(tip, from).normalize();
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
  return new Matrix4().compose(tip.clone().addScaledVector(dir, len * 0.5), q, new Vector3(r, len, r));
}

const v3 = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** Joints and landmarks of a person, as built. */
interface Person {
  neck: Vector3;
  hip: Vector3;
  headC: Vector3;
  headR: number;
  torsoC: Vector3;
  torsoR: Vector3;
  shoulderL: Vector3;
  shoulderR: Vector3;
  handL: Vector3;
  handR: Vector3;
  hipL: Vector3;
  hipR: Vector3;
}

/**
 * The person: torso, head with googly eyes, arms, and (unless seated on a horse) legs.
 * `base` lifts the whole person (a rider sits on the saddle).
 */
function addPerson(b: Builder, def: UnitDef, base: Vector3, seated: boolean): Person {
  const v = def.visual;
  const belly = v.belly;
  const headS = v.headSize;
  const limb = v.limbThickness;
  const o = (x: number, y: number, z: number) => v3(x + base.x, y + base.y, z + base.z);

  const hipY = 0.48;
  const hipX = 0.12 * Math.max(0.9, belly);
  const torsoC = o(0, 0.79, 0);
  const torsoR = v3(0.27 * belly, 0.33, 0.24 * belly);
  const neck = o(0, 1.08, 0);
  const headR = 0.25 * headS;
  const headC = o(0, 1.08 + headR * 0.92, 0.01);
  const shX = torsoR.x * 0.86 + 0.04;
  const shoulderL = o(shX, 0.99, 0);
  const shoulderR = o(-shX, 0.99, 0);
  const handL = o(shX + 0.05, 0.6, 0.03);
  const handR = o(-shX - 0.05, 0.6, 0.03);
  const hipL = o(hipX, hipY, 0);
  const hipR = o(-hipX, hipY, 0);
  const hip = o(0, hipY, 0);

  // Torso in a team-coloured tunic, with a leather belt.
  b.add(new SphereGeometry(1, 9, 6), PART_TORSO, hip, 0xffffff, 1, mat(torsoC.x, torsoC.y, torsoC.z, 0, 0, 0, torsoR.x, torsoR.y, torsoR.z), 0.97);
  b.add(new CylinderGeometry(torsoR.x * 0.96, torsoR.x * 0.98, 0.06, 9, 1, true), PART_TORSO, hip, LEATHER, 0, mat(torsoC.x, base.y + 0.6, torsoC.z, 0, 0, 0, 1, 1, torsoR.z / torsoR.x));

  // Head with a little nose.
  b.add(new SphereGeometry(headR, 9, 7), PART_HEAD, neck, SKIN, 0, mat(headC.x, headC.y, headC.z));
  b.add(new IcosahedronGeometry(headR * 0.2, 0), PART_HEAD, neck, 0xf6b892, 0, mat(headC.x, headC.y - headR * 0.12, headC.z + headR * 0.98));

  // Googly eyes: big whites, pupils that slide (their own part ids so the shader can move them).
  const eyeR = headR * 0.36;
  for (const side of [1, -1]) {
    const ec = v3(headC.x + side * headR * 0.38, headC.y + headR * 0.18, headC.z + headR * 0.78);
    b.add(new SphereGeometry(eyeR, 6, 4), PART_HEAD, neck, EYE_WHITE, 0, mat(ec.x, ec.y, ec.z));
    b.add(new SphereGeometry(eyeR * 0.48, 5, 3), side > 0 ? PART_PUPIL_L : PART_PUPIL_R, neck, PUPIL, 0, mat(ec.x, ec.y, ec.z + eyeR * 0.72, 0, 0, 0, 1, 1, 0.5));
  }

  // Arms: stubby capsules with round hands.
  for (const side of [1, -1]) {
    const sh = side > 0 ? shoulderL : shoulderR;
    const hand = side > 0 ? handL : handR;
    const part = side > 0 ? PART_ARM_L : PART_ARM_R;
    const a0 = sh.clone().add(v3(0, 0.02, 0));
    const a1 = hand.clone().add(v3(0, 0.05, 0));
    const ar = 0.065 * limb;
    b.add(new CapsuleGeometry(ar, Math.max(0.01, a0.distanceTo(a1) - ar), 2, 6), part, sh, 0xffffff, 1, along(a0, a1), 0.9);
    b.add(new IcosahedronGeometry(0.075 * limb, 0), part, sh, SKIN, 0, mat(hand.x, hand.y, hand.z));
  }

  if (seated) {
    // A rider's legs straddle the horse; they ride along with the body.
    for (const side of [1, -1]) {
      const hp = side > 0 ? hipL : hipR;
      const knee = hp.clone().add(v3(side * 0.2, -0.12, 0.22));
      const foot = knee.clone().add(v3(side * 0.04, -0.34, -0.05));
      b.add(new CapsuleGeometry(0.085 * limb, 0.22, 2, 6), PART_TORSO, hip, 0xffffff, 1, along(hp, knee), 0.78);
      b.add(new CylinderGeometry(0.07 * limb, 0.075 * limb, 0.34, 6), PART_TORSO, hip, SKIN, 0, along(knee, foot));
      b.add(new SphereGeometry(1, 5, 3), PART_TORSO, hip, SANDAL, 0, mat(foot.x, foot.y, foot.z + 0.05, 0, 0, 0, 0.08, 0.06, 0.13));
    }
  } else {
    // Legs: short capsules with bare shins and sandals.
    for (const side of [1, -1]) {
      const hp = side > 0 ? hipL : hipR;
      const part = side > 0 ? PART_LEG_L : PART_LEG_R;
      b.add(new CapsuleGeometry(0.09 * limb, 0.12, 2, 6), part, hp, 0xffffff, 1, mat(hp.x, base.y + 0.36, base.z), 0.78);
      b.add(new CylinderGeometry(0.07 * limb, 0.075 * limb, 0.24, 6), part, hp, SKIN, 0, mat(hp.x, base.y + 0.18, base.z));
      b.add(new SphereGeometry(1, 5, 3), part, hp, SANDAL, 0, mat(hp.x, base.y + 0.05, base.z + 0.05, 0, 0, 0, 0.1 * limb, 0.06, 0.15));
    }
  }
  return { neck, hip, headC, headR, torsoC, torsoR, shoulderL, shoulderR, handL, handR, hipL, hipR };
}

function addHair(b: Builder, p: Person): void {
  const { headC: c, headR: r, neck } = p;
  b.add(new SphereGeometry(r * 1.05, 9, 4, 0, Math.PI * 2, 0, Math.PI * 0.42), PART_HEAD, neck, HAIR, 0, mat(c.x, c.y + r * 0.04, c.z - r * 0.1, -0.25));
}

/** Bronze Corinthian helmet with cheek and nose guards and a horsehair crest. */
function addCorinthian(b: Builder, p: Person, crest: 'long' | 'transverse'): void {
  const { headC: c, headR: r, neck } = p;
  b.add(new SphereGeometry(r * 1.12, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.6), PART_HEAD, neck, BRONZE, 0, mat(c.x, c.y + r * 0.05, c.z - r * 0.02));
  for (const side of [1, -1]) {
    b.add(new BoxGeometry(r * 0.16, r * 0.62, r * 0.46), PART_HEAD, neck, BRONZE, 0, mat(c.x + side * r * 0.86, c.y - r * 0.22, c.z + r * 0.42, 0, side * 0.35, 0), 0.92);
  }
  b.add(new BoxGeometry(r * 0.12, r * 0.42, r * 0.1), PART_HEAD, neck, DARK_BRONZE, 0, mat(c.x, c.y + r * 0.02, c.z + r * 1.07));
  if (crest === 'long') {
    b.add(new TorusGeometry(r * 0.9, r * 0.2, 3, 8, Math.PI), PART_HEAD, neck, HORSEHAIR, 0, mat(c.x, c.y + r * 0.45, c.z - r * 0.08, 0, Math.PI / 2, 0, 1, 1.45, 1.6));
  } else {
    b.add(new TorusGeometry(r * 0.95, r * 0.17, 3, 8, Math.PI), PART_HEAD, neck, CREAM_CREST, 0, mat(c.x, c.y + r * 0.45, c.z, 0, 0, 0, 1, 1.2, 1));
  }
}

function addHat(b: Builder, hat: HatKind, p: Person): void {
  const { headC: c, headR: r, neck } = p;
  switch (hat) {
    case 'corinthian':
      addCorinthian(b, p, 'long');
      break;
    case 'spartan': {
      addCorinthian(b, p, 'transverse');
      // A cape in the team colour, hung from the shoulders.
      const t = p.torsoC;
      b.add(new BoxGeometry(p.torsoR.x * 2.1, 0.72, 0.035), PART_TORSO, p.hip, 0xffffff, 1, mat(t.x, t.y - 0.05, t.z - p.torsoR.z - 0.05, 0.12), 0.7);
      break;
    }
    case 'thracian':
      // Phrygian cap with its tip flopping forward.
      b.add(new SphereGeometry(r * 1.08, 9, 4, 0, Math.PI * 2, 0, Math.PI * 0.5), PART_HEAD, neck, 0xb98d4a, 0, mat(c.x, c.y + r * 0.06, c.z));
      b.add(new ConeGeometry(r * 0.5, r * 0.95, 7), PART_HEAD, neck, 0xb98d4a, 0, mat(c.x, c.y + r * 1.08, c.z + r * 0.18, 0.75), 0.92);
      break;
    case 'headband':
      addHair(b, p);
      b.add(new CylinderGeometry(r * 1.03, r * 1.04, r * 0.18, 9, 1, true), PART_HEAD, neck, LINEN, 0, mat(c.x, c.y + r * 0.38, c.z));
      break;
    case 'scythian':
      // Tall pointed cap with ear flaps.
      b.add(new ConeGeometry(r * 1.02, r * 1.55, 8), PART_HEAD, neck, 0x6f7a3a, 0, mat(c.x, c.y + r * 0.95, c.z - r * 0.08, -0.18));
      for (const side of [1, -1]) {
        b.add(new BoxGeometry(r * 0.12, r * 0.6, r * 0.45), PART_HEAD, neck, 0x5f6a32, 0, mat(c.x + side * r * 0.95, c.y - r * 0.2, c.z - r * 0.1));
      }
      break;
    case 'pilos':
      b.add(new ConeGeometry(r * 1.06, r * 1.05, 9), PART_HEAD, neck, BRONZE, 0, mat(c.x, c.y + r * 0.78, c.z));
      b.add(new TorusGeometry(r * 1.0, r * 0.07, 3, 10), PART_HEAD, neck, DARK_BRONZE, 0, mat(c.x, c.y + r * 0.28, c.z, Math.PI / 2));
      break;
    case 'petasos':
      // Wide-brimmed traveller's hat.
      b.add(new CylinderGeometry(r * 1.65, r * 1.65, r * 0.06, 12), PART_HEAD, neck, 0xd2b06a, 0, mat(c.x, c.y + r * 0.5, c.z));
      b.add(new SphereGeometry(r * 0.92, 9, 4, 0, Math.PI * 2, 0, Math.PI * 0.5), PART_HEAD, neck, 0xc4a05a, 0, mat(c.x, c.y + r * 0.5, c.z));
      break;
    case 'none':
      addHair(b, p);
      break;
  }
}

// ---- Gear pieces ------------------------------------------------------------------------------

function spear(b: Builder, p: Person, length: number, set: number): void {
  const back = p.handR.clone().add(v3(0, 0.02, -0.5));
  const front = p.handR.clone().add(v3(0, 0.12, length - 0.5));
  b.add(new CylinderGeometry(0.028, 0.028, 1, 5), PART_ARM_R, p.shoulderR, WOOD, 0, between(back, front), 1, set);
  b.add(new ConeGeometry(1, 1, 5), PART_ARM_R, p.shoulderR, BRONZE, 0, tipAt(back, front, 0.055, 0.26), 1, set);
  b.add(new ConeGeometry(1, 1, 4), PART_ARM_R, p.shoulderR, DARK_BRONZE, 0, tipAt(front, back, 0.03, 0.1), 1, set);
}

/** Big round hoplite shield on the left forearm, with a team-coloured emblem. */
function aspis(b: Builder, p: Person, r: number, face = BRONZE): void {
  const c = p.handL.clone().add(v3(0.03, 0.17, 0.2));
  b.add(new CylinderGeometry(r, r, 0.07, 10), PART_ARM_L, p.shoulderL, face, 0, mat(c.x, c.y, c.z, Math.PI / 2));
  b.add(new TorusGeometry(r, 0.035, 3, 10), PART_ARM_L, p.shoulderL, DARK_BRONZE, 0, mat(c.x, c.y, c.z + 0.03));
  b.add(new CylinderGeometry(r * 0.36, r * 0.36, 0.02, 8), PART_ARM_L, p.shoulderL, 0xffffff, 1, mat(c.x, c.y, c.z + 0.045, Math.PI / 2), 1.05);
}

function swordInHand(b: Builder, p: Person, set: number, length = 0.46): void {
  const h = p.handR;
  const tip = h.clone().add(v3(0, 0.28 * (length / 0.46), 0.36 * (length / 0.46)));
  b.add(new BoxGeometry(0.055, 1, 0.02), PART_ARM_R, p.shoulderR, STEEL, 0, between(h.clone().add(v3(0, 0.04, 0.04)), tip), 1, set);
  b.add(new BoxGeometry(0.17, 0.035, 0.045), PART_ARM_R, p.shoulderR, BRONZE, 0, mat(h.x, h.y + 0.05, h.z + 0.06, -0.9), 1, set);
}

function sheath(b: Builder, p: Person, set: number): void {
  const t = p.torsoC;
  b.add(new BoxGeometry(0.06, 0.4, 0.05), PART_TORSO, p.hip, LEATHER, 0, mat(t.x + p.torsoR.x * 0.95, t.y - 0.26, t.z + 0.05, 0.5, 0, 0.15), 0.9, set);
}

function javelinInHand(b: Builder, p: Person, set: number): void {
  const h = p.handR;
  const back = h.clone().add(v3(0, -0.15, -0.4));
  const front = h.clone().add(v3(0, 0.55, 0.85));
  b.add(new CylinderGeometry(0.02, 0.02, 1, 4), PART_ARM_R, p.shoulderR, WOOD, 0, between(back, front), 1, set);
  b.add(new ConeGeometry(1, 1, 4), PART_ARM_R, p.shoulderR, STEEL, 0, tipAt(back, front, 0.035, 0.16), 1, set);
}

function spareJavelins(b: Builder, p: Person, n: number, set: number): void {
  for (let k = 0; k < n; k++) {
    const h = p.handL.clone().add(v3(0.04 + k * 0.05, 0, -0.05 + k * 0.04));
    const back = h.clone().add(v3(0, -0.35, -0.35));
    const front = h.clone().add(v3(0, 0.75, 0.55));
    b.add(new CylinderGeometry(0.018, 0.018, 1, 4), PART_ARM_L, p.shoulderL, WOOD, 0, between(back, front), 0.95, set);
    b.add(new ConeGeometry(1, 1, 4), PART_ARM_L, p.shoulderL, STEEL, 0, tipAt(back, front, 0.03, 0.14), 1, set);
  }
}

function dagger(b: Builder, p: Person): void {
  swordInHand(b, p, SET_SIDEARM, 0.26);
}

function hipPouch(b: Builder, p: Person, color: number): void {
  const t = p.torsoC;
  b.add(new IcosahedronGeometry(0.085, 0), PART_TORSO, p.hip, color, 0, mat(t.x - p.torsoR.x * 0.9, t.y - 0.24, t.z + 0.08));
}

function bow(b: Builder, p: Person): void {
  const h = p.handL;
  b.add(new TorusGeometry(0.44, 0.022, 3, 10, Math.PI * 0.85), PART_ARM_L, p.shoulderL, DARK_WOOD, 0, mat(h.x + 0.02, h.y + 0.08, h.z + 0.12, 0, Math.PI / 2, Math.PI / 2 + Math.PI * 0.075));
  b.add(new CylinderGeometry(0.005, 0.005, 0.8, 3), PART_ARM_L, p.shoulderL, LINEN, 0, mat(h.x + 0.02, h.y + 0.08, h.z - 0.04));
}

function quiver(b: Builder, p: Person): void {
  const t = p.torsoC;
  const c = v3(t.x - 0.08, t.y + 0.12, t.z - p.torsoR.z - 0.06);
  b.add(new CylinderGeometry(0.07, 0.06, 0.48, 6), PART_TORSO, p.hip, LEATHER, 0, mat(c.x, c.y, c.z, -0.25, 0, 0.35));
  for (let k = 0; k < 3; k++) {
    b.add(new ConeGeometry(0.03, 0.09, 3), PART_TORSO, p.hip, LINEN, 0, mat(c.x - 0.09 + k * 0.025, c.y + 0.27, c.z - 0.06, -0.25, 0, 0.35));
  }
}

function sling(b: Builder, p: Person): void {
  const h = p.handR;
  const end = h.clone().add(v3(0, -0.34, 0.06));
  b.add(new CylinderGeometry(0.008, 0.008, 1, 3), PART_ARM_R, p.shoulderR, LINEN, 0, between(h, end), 1, SET_MAIN);
  b.add(new SphereGeometry(0.045, 5, 3), PART_ARM_R, p.shoulderR, LEATHER, 0, mat(end.x, end.y, end.z), 1, SET_MAIN);
}

function stoneInHand(b: Builder, p: Person): void {
  const h = p.handR;
  b.add(new IcosahedronGeometry(0.07, 0), PART_ARM_R, p.shoulderR, STONE, 0, mat(h.x, h.y + 0.04, h.z + 0.07), 1, SET_MAIN);
}

function addGear(b: Builder, gear: GearKind, p: Person): void {
  switch (gear) {
    case 'hoplite':
      spear(b, p, 2.1, SET_ALWAYS);
      aspis(b, p, 0.42);
      break;
    case 'spartan':
      spear(b, p, 2.1, SET_MAIN);
      swordInHand(b, p, SET_SIDEARM);
      sheath(b, p, SET_MAIN);
      aspis(b, p, 0.45);
      break;
    case 'peltast':
      javelinInHand(b, p, SET_MAIN);
      spareJavelins(b, p, 2, SET_MAIN);
      swordInHand(b, p, SET_SIDEARM, 0.36);
      aspis(b, p, 0.3, 0xa88a52);
      break;
    case 'skirmisher':
      stoneInHand(b, p);
      hipPouch(b, p, 0x9a8a62);
      dagger(b, p);
      break;
    case 'archer':
      bow(b, p);
      quiver(b, p);
      dagger(b, p);
      break;
    case 'slinger':
      sling(b, p);
      hipPouch(b, p, LEAD);
      dagger(b, p);
      break;
    case 'horseman':
      spear(b, p, 2.4, SET_ALWAYS);
      break;
    case 'marine':
      javelinInHand(b, p, SET_MAIN);
      swordInHand(b, p, SET_SIDEARM, 0.42);
      sheath(b, p, SET_MAIN);
      aspis(b, p, 0.36);
      break;
  }
}

/** Horse heights in canonical units. */
const SADDLE_Y = 1.28;
const BODY_Y = 1.02;
const LEG_TOP = 0.95;
const FRONT_Z = 0.55;
const BACK_Z = -0.58;

/**
 * A stocky horse. Its front legs move as part LEG_L and back legs as LEG_R, so the walk cycle
 * becomes a bounding gallop. Everything else rides along with the body (PART_TORSO).
 */
function addHorse(b: Builder): { front: Vector3; back: Vector3; hip: Vector3 } {
  const hip = v3(0, BODY_Y, 0);
  const front = v3(0, LEG_TOP, FRONT_Z);
  const back = v3(0, LEG_TOP, BACK_Z);
  const T = PART_TORSO;
  b.add(new SphereGeometry(1, 9, 6), T, hip, HORSE, 0, mat(0, BODY_Y, 0, 0, 0, 0, 0.33, 0.36, 0.88));
  // Neck, head, ears, mane, tail.
  const n0 = v3(0, 1.22, 0.62);
  const n1 = v3(0, 1.68, 0.92);
  b.add(new CapsuleGeometry(0.15, 0.36, 2, 7), T, hip, HORSE, 0, along(n0, n1));
  b.add(new SphereGeometry(1, 8, 6), T, hip, HORSE, 0, mat(0, 1.68, 1.1, -0.35, 0, 0, 0.14, 0.15, 0.3), 0.96);
  b.add(new SphereGeometry(1, 6, 4), T, hip, 0x6e4730, 0, mat(0, 1.6, 1.33, -0.35, 0, 0, 0.1, 0.1, 0.1));
  for (const side of [1, -1]) {
    b.add(new ConeGeometry(0.04, 0.13, 4), T, hip, HORSE, 0, mat(side * 0.07, 1.86, 0.96, -0.2));
    // Googly horse eyes (they don't slide; only the rider's do).
    b.add(new SphereGeometry(0.055, 6, 4), T, hip, EYE_WHITE, 0, mat(side * 0.11, 1.74, 1.1));
    b.add(new SphereGeometry(0.026, 5, 3), T, hip, PUPIL, 0, mat(side * 0.15, 1.74, 1.12));
  }
  b.add(new BoxGeometry(0.06, 0.12, 0.62), T, hip, MANE, 0, mat(0, 1.6, 0.74, -0.85));
  b.add(new ConeGeometry(0.1, 0.62, 5), T, hip, MANE, 0, mat(0, 0.92, -0.98, -2.5));
  // Team-coloured saddle cloth.
  b.add(new BoxGeometry(0.72, 0.05, 0.62), T, hip, 0xffffff, 1, mat(0, SADDLE_Y - 0.04, -0.02, 0, 0, 0), 0.85);
  // Legs: front pair (LEG_L) and back pair (LEG_R), with dark hooves.
  for (const [part, z, pivot] of [[PART_LEG_L, FRONT_Z, front], [PART_LEG_R, BACK_Z, back]] as const) {
    for (const side of [1, -1]) {
      const top = v3(side * 0.18, LEG_TOP, z);
      const bottom = v3(side * 0.18, 0.12, z + 0.04);
      b.add(new CapsuleGeometry(0.075, 0.68, 2, 6), part, pivot, HORSE, 0, along(top, bottom), 0.92);
      b.add(new CylinderGeometry(0.08, 0.09, 0.1, 5), part, pivot, HOOF, 0, mat(bottom.x, 0.05, bottom.z));
    }
  }
  return { front, back, hip };
}

/** Build the merged mesh for one unit type. */
export function buildUnitModel(def: UnitDef): UnitModel {
  const v = def.visual;
  const b = new Builder();
  const horse = v.body === 'horse';
  let horseJoints: { front: Vector3; back: Vector3; hip: Vector3 } | null = null;
  if (horse) horseJoints = addHorse(b);
  const p = addPerson(b, def, horse ? v3(0, SADDLE_Y - 0.48, -0.05) : v3(0, 0, 0), horse);
  addHat(b, v.hat, p);
  addGear(b, v.gear, p);

  const limb = v.limbThickness;
  let parts: RagdollPartShape[];
  let layout: BodyLayout;
  if (horseJoints) {
    // Horse and rider: one box body, the rider's head and arms, and the two pairs of legs.
    parts = [
      { center: v3(0, 1.22, 0.1), radius: 0.35, halfHeight: 0, half: v3(0.34, 0.42, 0.95) },
      { center: p.headC.clone(), radius: p.headR, halfHeight: 0 },
      { center: p.shoulderL.clone().add(p.handL).multiplyScalar(0.5), radius: 0.07 * limb, halfHeight: 0.15 },
      { center: p.shoulderR.clone().add(p.handR).multiplyScalar(0.5), radius: 0.07 * limb, halfHeight: 0.15 },
      { center: v3(0, 0.52, FRONT_Z), radius: 0.08, halfHeight: 0, half: v3(0.26, 0.42, 0.09) },
      { center: v3(0, 0.52, BACK_Z), radius: 0.08, halfHeight: 0, half: v3(0.26, 0.42, 0.09) },
    ];
    layout = {
      height: p.headC.y + p.headR,
      neck: p.neck,
      hip: horseJoints.hip,
      shoulderL: p.shoulderL,
      shoulderR: p.shoulderR,
      hipL: horseJoints.front,
      hipR: horseJoints.back,
      parts,
    };
  } else {
    const r = Math.min(p.torsoR.x, p.torsoR.z);
    parts = [
      { center: p.torsoC.clone(), radius: r * 0.95, halfHeight: Math.max(0.02, p.torsoR.y - r) },
      { center: p.headC.clone(), radius: p.headR, halfHeight: 0 },
      { center: p.shoulderL.clone().add(p.handL).multiplyScalar(0.5), radius: 0.07 * limb, halfHeight: 0.15 },
      { center: p.shoulderR.clone().add(p.handR).multiplyScalar(0.5), radius: 0.07 * limb, halfHeight: 0.15 },
      { center: v3(p.hipL.x, 0.27, 0), radius: 0.09 * limb, halfHeight: 0.14 },
      { center: v3(p.hipR.x, 0.27, 0), radius: 0.09 * limb, halfHeight: 0.14 },
    ];
    layout = {
      height: p.headC.y + p.headR,
      neck: p.neck,
      hip: p.hip,
      shoulderL: p.shoulderL,
      shoulderR: p.shoulderR,
      hipL: p.hipL,
      hipR: p.hipR,
      parts,
    };
  }
  return { geometry: b.build(), layout, horse };
}
