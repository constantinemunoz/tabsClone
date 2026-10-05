import {
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
  Vector3,
  BoxGeometry,
  TorusGeometry,
} from 'three';
import type { HatKind, UnitDef, WeaponMesh } from '../data/units.ts';

/**
 * Procedural unit bodies: a rounded torso, a round head, stubby arms and legs, googly eyes,
 * plus a hat and a weapon per type. Every vertex is tagged with:
 *   aPart  - which body part it moves with (see PART_*)
 *   aPivot - the joint that part rotates about (hip, shoulder, neck...)
 *   aTint  - how much of the team colour it takes (body 1, skin a little, gear 0)
 * The model is built at a canonical size (about 1.6 m tall, feet at y = 0, facing +z) and
 * scaled per unit type in the shader.
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

/** Attack animation styles understood by the wobble shader. */
export const ATTACK_SWING = 0;
export const ATTACK_THRUST = 1;
export const ATTACK_SWEEP = 2;
export const ATTACK_LUNGE = 3;
export const ATTACK_THROW = 4;
export const ATTACK_BLAST = 5;

/** Shape of each ragdoll body: capsule (halfHeight > 0) or ball, in canonical units. */
export interface RagdollPartShape {
  center: Vector3;
  radius: number;
  halfHeight: number;
}

/** Where the ragdoll joints are, in canonical units. */
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
  attackStyle: number;
}

const SKIN = 0xffdcbc;
const SHOE = 0x3b3442;
const EYE_WHITE = 0xffffff;
const PUPIL = 0x15151c;
const WOOD = 0x9a6a3f;
const DARK_WOOD = 0x6b4527;
const METAL = 0xb9c0c9;
const DARK_METAL = 0x6f7782;
const CLOTH = 0x4a4550;
const GOLD = 0xf2c14e;
const BONE = 0xf3ead8;
const LEATHER = 0x8a5a36;

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
  private index: number[] = [];
  private readonly c = new Color();
  private readonly v = new Vector3();

  add(geo: BufferGeometry, part: number, pivot: Vector3, color: number, tint: number, m?: Matrix4, shade = 1): void {
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
    }
    // A mirroring matrix would flip the winding; none of ours mirror.
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

/** Matrix placing a +y-aligned primitive centred at the origin along the segment a-b (no scaling). */
function along(a: Vector3, b: Vector3): Matrix4 {
  const dir = new Vector3().subVectors(b, a).normalize();
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
  return new Matrix4().compose(new Vector3().addVectors(a, b).multiplyScalar(0.5), q, new Vector3(1, 1, 1));
}

/** Matrix placing a +y-aligned primitive so it runs from a to b. */
function between(a: Vector3, b: Vector3): Matrix4 {
  const dir = new Vector3().subVectors(b, a);
  const len = dir.length();
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
  return new Matrix4().compose(new Vector3().addVectors(a, b).multiplyScalar(0.5), q, new Vector3(1, len, 1));
}

function addHat(b: Builder, hat: HatKind, head: Vector3, hr: number, neck: Vector3): void {
  const P = PART_HEAD;
  switch (hat) {
    case 'bandana':
      b.add(new CylinderGeometry(hr * 1.03, hr * 1.05, hr * 0.32, 10, 1, true), P, neck, 0xc0392b, 0, mat(head.x, head.y + hr * 0.3, head.z));
      b.add(new IcosahedronGeometry(hr * 0.22, 0), P, neck, 0xc0392b, 0, mat(head.x, head.y + hr * 0.3, head.z - hr * 1.05));
      b.add(new ConeGeometry(hr * 0.16, hr * 0.5, 4), P, neck, 0xc0392b, 0, mat(head.x + hr * 0.12, head.y + hr * 0.1, head.z - hr * 1.15, 2.2, 0, 0.4));
      break;
    case 'helmet':
      b.add(new SphereGeometry(hr * 1.1, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.55), P, neck, METAL, 0, mat(head.x, head.y + hr * 0.08, head.z));
      b.add(new BoxGeometry(hr * 0.14, hr * 0.55, hr * 0.12), P, neck, DARK_METAL, 0, mat(head.x, head.y + hr * 0.05, head.z + hr * 1.05));
      b.add(new ConeGeometry(hr * 0.14, hr * 0.5, 5), P, neck, 0xd9473b, 0, mat(head.x, head.y + hr * 1.25, head.z));
      break;
    case 'cap':
      b.add(new SphereGeometry(hr * 1.06, 8, 3, 0, Math.PI * 2, 0, Math.PI * 0.45), P, neck, LEATHER, 0, mat(head.x, head.y + hr * 0.12, head.z));
      b.add(new CylinderGeometry(hr * 0.75, hr * 0.75, hr * 0.06, 10, 1, false, -Math.PI / 2, Math.PI), P, neck, DARK_WOOD, 0, mat(head.x, head.y + hr * 0.42, head.z + hr * 0.55));
      break;
    case 'horns':
      b.add(new SphereGeometry(hr * 1.1, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.55), P, neck, DARK_METAL, 0, mat(head.x, head.y + hr * 0.06, head.z));
      b.add(new ConeGeometry(hr * 0.2, hr * 0.95, 6), P, neck, BONE, 0, mat(head.x + hr * 1.0, head.y + hr * 0.75, head.z + hr * 0.1, 0, 0, -0.9));
      b.add(new ConeGeometry(hr * 0.2, hr * 0.95, 6), P, neck, BONE, 0, mat(head.x - hr * 1.0, head.y + hr * 0.75, head.z + hr * 0.1, 0, 0, 0.9));
      break;
    case 'crown': {
      b.add(new CylinderGeometry(hr * 0.8, hr * 0.85, hr * 0.32, 8, 1, true), P, neck, GOLD, 0, mat(head.x, head.y + hr * 1.0, head.z));
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        b.add(new ConeGeometry(hr * 0.13, hr * 0.32, 4), P, neck, GOLD, 0, mat(head.x + Math.sin(a) * hr * 0.75, head.y + hr * 1.3, head.z + Math.cos(a) * hr * 0.75));
      }
      break;
    }
    case 'propeller':
      b.add(new SphereGeometry(hr * 1.05, 8, 3, 0, Math.PI * 2, 0, Math.PI * 0.45), P, neck, 0x3d9fd6, 0, mat(head.x, head.y + hr * 0.12, head.z));
      b.add(new CylinderGeometry(hr * 0.05, hr * 0.05, hr * 0.35, 4), P, neck, DARK_METAL, 0, mat(head.x, head.y + hr * 1.2, head.z));
      b.add(new BoxGeometry(hr * 1.6, hr * 0.03, hr * 0.18), P, neck, 0xf2c14e, 0, mat(head.x, head.y + hr * 1.38, head.z));
      break;
    case 'hood':
      b.add(new SphereGeometry(hr * 1.12, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.62), P, neck, 0x4f6b3a, 0, mat(head.x, head.y + hr * 0.05, head.z - hr * 0.08, -0.35));
      break;
    case 'goggles':
      b.add(new TorusGeometry(hr * 0.2, hr * 0.06, 4, 8), P, neck, DARK_METAL, 0, mat(head.x + hr * 0.38, head.y + hr * 0.55, head.z + hr * 0.8, -0.5));
      b.add(new TorusGeometry(hr * 0.2, hr * 0.06, 4, 8), P, neck, DARK_METAL, 0, mat(head.x - hr * 0.38, head.y + hr * 0.55, head.z + hr * 0.8, -0.5));
      b.add(new CylinderGeometry(hr * 1.02, hr * 1.02, hr * 0.12, 10, 1, true), P, neck, LEATHER, 0, mat(head.x, head.y + hr * 0.55, head.z));
      break;
    case 'none':
      break;
  }
}

/** Weapon (and off-hand gear) in the rest pose, attached to the arms. Returns the attack style. */
function addWeapon(b: Builder, w: WeaponMesh, handR: Vector3, handL: Vector3, shoulderR: Vector3, shoulderL: Vector3): number {
  const R = PART_ARM_R;
  const L = PART_ARM_L;
  switch (w) {
    case 'club': {
      const tip = new Vector3(handR.x, handR.y + 0.32, handR.z + 0.42);
      b.add(new CylinderGeometry(0.075, 0.035, 1, 6), R, shoulderR, WOOD, 0, between(handR.clone().add(new Vector3(0, -0.04, -0.05)), tip));
      b.add(new IcosahedronGeometry(0.06, 0), R, shoulderR, DARK_WOOD, 0, mat(tip.x + 0.02, tip.y - 0.06, tip.z - 0.06));
      return ATTACK_SWING;
    }
    case 'swordShield': {
      const tip = new Vector3(handR.x, handR.y + 0.3, handR.z + 0.5);
      b.add(new BoxGeometry(0.06, 1, 0.025), R, shoulderR, METAL, 0, between(handR.clone().add(new Vector3(0, 0.03, 0.04)), tip));
      b.add(new BoxGeometry(0.2, 0.04, 0.05), R, shoulderR, DARK_METAL, 0, mat(handR.x, handR.y + 0.04, handR.z + 0.06, -0.86));
      // Shield on the left forearm, facing forward.
      b.add(new CylinderGeometry(0.3, 0.3, 0.06, 9), L, shoulderL, WOOD, 0, mat(handL.x + 0.02, handL.y + 0.16, handL.z + 0.17, Math.PI / 2));
      b.add(new TorusGeometry(0.29, 0.03, 3, 10), L, shoulderL, DARK_METAL, 0, mat(handL.x + 0.02, handL.y + 0.16, handL.z + 0.2));
      b.add(new SphereGeometry(0.07, 6, 4), L, shoulderL, METAL, 0, mat(handL.x + 0.02, handL.y + 0.16, handL.z + 0.22));
      return ATTACK_SWING;
    }
    case 'spear': {
      const back = new Vector3(handR.x, handR.y + 0.02, handR.z - 0.55);
      const front = new Vector3(handR.x, handR.y + 0.12, handR.z + 1.55);
      b.add(new CylinderGeometry(0.03, 0.03, 1, 5), R, shoulderR, WOOD, 0, between(back, front));
      b.add(new ConeGeometry(0.07, 0.3, 5), R, shoulderR, METAL, 0, mat(front.x, front.y + 0.01, front.z + 0.12, Math.PI / 2 - 0.05));
      return ATTACK_THRUST;
    }
    case 'ram':
      // Big padded gauntlets; the charger attacks with its whole body.
      b.add(new IcosahedronGeometry(0.13, 0), R, shoulderR, DARK_METAL, 0, mat(handR.x, handR.y, handR.z));
      b.add(new IcosahedronGeometry(0.13, 0), L, shoulderL, DARK_METAL, 0, mat(handL.x, handL.y, handL.z));
      b.add(new SphereGeometry(0.14, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), R, shoulderR, METAL, 0, mat(shoulderR.x, shoulderR.y + 0.02, shoulderR.z, 0, 0, 0.5));
      b.add(new SphereGeometry(0.14, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), L, shoulderL, METAL, 0, mat(shoulderL.x, shoulderL.y + 0.02, shoulderL.z, 0, 0, -0.5));
      return ATTACK_LUNGE;
    case 'log': {
      const tip = new Vector3(handR.x - 0.05, handR.y + 0.45, handR.z + 0.62);
      b.add(new CylinderGeometry(0.15, 0.08, 1, 7), R, shoulderR, DARK_WOOD, 0, between(handR.clone().add(new Vector3(0, -0.06, -0.08)), tip));
      b.add(new ConeGeometry(0.05, 0.22, 4), R, shoulderR, DARK_WOOD, 0, mat(tip.x + 0.1, tip.y - 0.25, tip.z - 0.2, 0.6, 0, -0.9));
      b.add(new IcosahedronGeometry(0.12, 0), R, shoulderR, 0x5e8a3c, 0, mat(tip.x + 0.16, tip.y - 0.3, tip.z - 0.26));
      return ATTACK_SWEEP;
    }
    case 'bow': {
      // Bow held upright in the left hand; right hand draws.
      b.add(new TorusGeometry(0.42, 0.025, 4, 10, Math.PI * 0.9), L, shoulderL, WOOD, 0, mat(handL.x + 0.02, handL.y + 0.1, handL.z + 0.14, 0, Math.PI / 2, Math.PI / 2 + Math.PI * 0.05));
      b.add(new CylinderGeometry(0.005, 0.005, 0.82, 3), L, shoulderL, 0xeeeeee, 0, mat(handL.x + 0.02, handL.y + 0.1, handL.z + 0.0));
      return ATTACK_THROW;
    }
    case 'bomb': {
      b.add(new IcosahedronGeometry(0.14, 1), R, shoulderR, 0x2b2b33, 0, mat(handR.x, handR.y + 0.06, handR.z + 0.08));
      b.add(new CylinderGeometry(0.015, 0.015, 0.12, 3), R, shoulderR, 0xd9b24a, 0, mat(handR.x, handR.y + 0.24, handR.z + 0.08, 0.3));
      return ATTACK_THROW;
    }
    case 'bellows': {
      const c = new Vector3((handR.x + handL.x) / 2, handR.y + 0.1, handR.z + 0.32);
      b.add(new BoxGeometry(0.42, 0.2, 0.34), R, shoulderR, LEATHER, 0, mat(c.x, c.y, c.z));
      b.add(new ConeGeometry(0.07, 0.38, 6), R, shoulderR, METAL, 0, mat(c.x, c.y, c.z + 0.34, Math.PI / 2));
      b.add(new BoxGeometry(0.44, 0.04, 0.36), R, shoulderR, WOOD, 0, mat(c.x, c.y + 0.12, c.z));
      return ATTACK_BLAST;
    }
    case 'darts': {
      b.add(new ConeGeometry(0.03, 0.3, 4), R, shoulderR, METAL, 0, mat(handR.x, handR.y + 0.1, handR.z + 0.1, Math.PI / 2));
      return ATTACK_THROW;
    }
    case 'catapult': {
      // A small wheeled catapult the unit pushes; the arm of the catapult moves with the right arm.
      b.add(new BoxGeometry(0.7, 0.14, 1.0), PART_TORSO, new Vector3(), DARK_WOOD, 0, mat(0, 0.32, 0.75));
      for (const sx of [-0.38, 0.38]) {
        for (const sz of [0.38, 1.12]) {
          b.add(new CylinderGeometry(0.16, 0.16, 0.08, 8), PART_TORSO, new Vector3(), WOOD, 0, mat(sx, 0.18, sz, 0, 0, Math.PI / 2));
        }
      }
      const pivot = new Vector3(0, 0.45, 0.85);
      b.add(new BoxGeometry(0.08, 0.08, 0.95), R, shoulderR, WOOD, 0, mat(0, 0.5, 0.52, -0.25));
      b.add(new CylinderGeometry(0.16, 0.12, 0.1, 8), R, shoulderR, DARK_WOOD, 0, mat(0, 0.62, 0.08));
      b.add(new BoxGeometry(0.5, 0.36, 0.08), PART_TORSO, pivot, DARK_WOOD, 0, mat(0, 0.6, 0.98));
      return ATTACK_THROW;
    }
  }
  return ATTACK_SWING;
}

/** Build the merged mesh for one unit type. */
export function buildUnitModel(def: UnitDef): UnitModel {
  const v = def.visual;
  const b = new Builder();
  const belly = v.belly;
  const headS = v.headSize;
  const limb = v.limbThickness;

  // Joints and part placement (canonical units, feet at 0, facing +z, unit's left is +x).
  const hipY = 0.48;
  const hipX = 0.12 * Math.max(0.9, belly);
  const torsoC = new Vector3(0, 0.79, 0);
  const torsoR = new Vector3(0.27 * belly, 0.33, 0.24 * belly);
  const neck = new Vector3(0, 1.08, 0);
  const headR = 0.25 * headS;
  const headC = new Vector3(0, 1.08 + headR * 0.92, 0.01);
  const shX = torsoR.x * 0.86 + 0.04;
  const shoulderL = new Vector3(shX, 0.99, 0);
  const shoulderR = new Vector3(-shX, 0.99, 0);
  const armLen = 0.32;
  const handL = new Vector3(shX + 0.05, 0.99 - armLen - 0.07, 0.03);
  const handR = new Vector3(-shX - 0.05, 0.99 - armLen - 0.07, 0.03);
  const hipL = new Vector3(hipX, hipY, 0);
  const hipR = new Vector3(-hipX, hipY, 0);
  const hip = new Vector3(0, hipY, 0);

  // Torso: a squashed, slightly pear-shaped ball; a belt for a bit of detail.
  b.add(new SphereGeometry(1, 9, 6), PART_TORSO, hip, 0xffffff, 1, mat(torsoC.x, torsoC.y, torsoC.z, 0, 0, 0, torsoR.x, torsoR.y, torsoR.z), 0.97);
  b.add(new CylinderGeometry(torsoR.x * 0.96, torsoR.x * 0.98, 0.06, 9, 1, true), PART_TORSO, hip, CLOTH, 0, mat(0, 0.6, 0, 0, 0, 0, 1, 1, torsoR.z / torsoR.x));

  // Head with a little nose. Skin takes a hint of team colour so heads read as part of the team.
  b.add(new SphereGeometry(headR, 9, 7), PART_HEAD, neck, SKIN, 0, mat(headC.x, headC.y, headC.z));
  b.add(new IcosahedronGeometry(headR * 0.2, 0), PART_HEAD, neck, 0xf6b892, 0, mat(headC.x, headC.y - headR * 0.12, headC.z + headR * 0.98));

  // Googly eyes: big whites, pupils that slide (their own part ids so the shader can move them).
  const eyeR = headR * 0.36;
  for (const side of [1, -1]) {
    const ec = new Vector3(headC.x + side * headR * 0.38, headC.y + headR * 0.18, headC.z + headR * 0.78);
    b.add(new SphereGeometry(eyeR, 6, 4), PART_HEAD, neck, EYE_WHITE, 0, mat(ec.x, ec.y, ec.z));
    b.add(new SphereGeometry(eyeR * 0.48, 5, 3), side > 0 ? PART_PUPIL_L : PART_PUPIL_R, neck, PUPIL, 0, mat(ec.x, ec.y, ec.z + eyeR * 0.72, 0, 0, 0, 1, 1, 0.5));
  }

  // Arms: stubby capsules with round hands.
  for (const side of [1, -1]) {
    const sh = side > 0 ? shoulderL : shoulderR;
    const hand = side > 0 ? handL : handR;
    const part = side > 0 ? PART_ARM_L : PART_ARM_R;
    const a0 = sh.clone().add(new Vector3(0, 0.02, 0));
    const a1 = hand.clone().add(new Vector3(0, 0.05, 0));
    const ar = 0.065 * limb;
    // CapsuleGeometry's length is the straight section between the two round caps.
    const armGeo = new CapsuleGeometry(ar, Math.max(0.01, a0.distanceTo(a1) - ar), 2, 6);
    b.add(armGeo, part, sh, 0xffffff, 1, along(a0, a1), 0.9);
    b.add(new IcosahedronGeometry(0.075 * limb, 0), part, sh, SKIN, 0, mat(hand.x, hand.y, hand.z));
  }

  // Legs: short capsules and big shoes.
  for (const side of [1, -1]) {
    const hp = side > 0 ? hipL : hipR;
    const part = side > 0 ? PART_LEG_L : PART_LEG_R;
    b.add(new CapsuleGeometry(0.09 * limb, 0.26, 2, 6), part, hp, 0xffffff, 1, mat(hp.x, 0.28, 0), 0.78);
    b.add(new SphereGeometry(1, 6, 4), part, hp, SHOE, 0, mat(hp.x, 0.055, 0.05, 0, 0, 0, 0.1 * limb, 0.065, 0.15));
  }

  addHat(b, v.hat, headC, headR, neck);
  const attackStyle = addWeapon(b, v.weapon, handR, handL, shoulderR, shoulderL);

  const parts: RagdollPartShape[] = [
    { center: torsoC.clone(), radius: Math.min(torsoR.x, torsoR.z) * 0.95, halfHeight: Math.max(0.02, torsoR.y - Math.min(torsoR.x, torsoR.z)) },
    { center: headC.clone(), radius: headR, halfHeight: 0 },
    { center: shoulderL.clone().add(handL).multiplyScalar(0.5), radius: 0.07 * limb, halfHeight: armLen * 0.45 },
    { center: shoulderR.clone().add(handR).multiplyScalar(0.5), radius: 0.07 * limb, halfHeight: armLen * 0.45 },
    { center: new Vector3(hipL.x, 0.27, 0), radius: 0.09 * limb, halfHeight: 0.14 },
    { center: new Vector3(hipR.x, 0.27, 0), radius: 0.09 * limb, halfHeight: 0.14 },
  ];

  return {
    geometry: b.build(),
    layout: {
      height: headC.y + headR,
      neck,
      hip,
      shoulderL,
      shoulderR,
      hipL,
      hipR,
      parts,
    },
    attackStyle,
  };
}
