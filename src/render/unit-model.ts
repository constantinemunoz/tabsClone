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
  LatheGeometry,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { GearKind, HatKind, UnitDef } from '../data/units.ts';

/**
 * Procedural unit bodies: a low-poly person with roughly real proportions (about seven heads
 * tall, shoulders wider than the waist, two-segment arms and legs), dressed per type in a tunic,
 * armour, a hat or helmet and gear, and optionally riding a horse. Every vertex is tagged with:
 *   aPart  - which body part it moves with (see PART_*)
 *   aPivot - the joint that part rotates about (hip, shoulder, neck...)
 *   aTint  - how much of the team colour it takes (clothes 1, gear 0)
 *   aSet   - weapon set: always shown, main weapon only, or sidearm only
 * Each part is rigid: elbows and knees are baked in, not animated. The model is built at a
 * canonical size (a 1.65 m person, feet at y = 0, facing +z, the unit's left toward +x) and
 * scaled per unit type in the shader.
 */
export const PART_TORSO = 0;
export const PART_HEAD = 1;
export const PART_ARM_L = 2;
export const PART_ARM_R = 3;
export const PART_LEG_L = 4;
export const PART_LEG_R = 5;

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

const SKIN = 0xe0a681;
const SKIN_SHADE = 0xc98c69;
const HAIR = 0x34251c;
const BEARD = 0x4a3426;
const EYE = 0x1e1815;
const SANDAL = 0x6b4a32;
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
/** Team-coloured cloth: white tinted by the team colour in the shader. */
const CLOTH = 0xffffff;

/** Head proportions: a little narrower than deep, a little taller than wide. */
const HEAD_SX = 0.94;
const HEAD_SY = 1.06;

/** What a body wears under its gear. */
interface Outfit {
  armor: 'none' | 'bronze' | 'linen';
  greaves: boolean;
  beard: boolean;
  trousers: boolean;
}

const OUTFITS: Record<GearKind, Outfit> = {
  hoplite: { armor: 'bronze', greaves: true, beard: true, trousers: false },
  spartan: { armor: 'bronze', greaves: true, beard: true, trousers: false },
  peltast: { armor: 'none', greaves: false, beard: false, trousers: false },
  skirmisher: { armor: 'none', greaves: false, beard: false, trousers: false },
  archer: { armor: 'none', greaves: false, beard: true, trousers: true },
  slinger: { armor: 'none', greaves: false, beard: false, trousers: false },
  horseman: { armor: 'none', greaves: false, beard: false, trousers: false },
  marine: { armor: 'linen', greaves: false, beard: true, trousers: false },
};

/** Torso silhouette as (radius, height) pairs, hips to neck; closed at both ends. */
const TORSO_PROFILE: [number, number][] = [
  [0, 0.76],
  [0.15, 0.78],
  [0.165, 0.9],
  [0.148, 1.0],
  [0.165, 1.12],
  [0.188, 1.23],
  [0.194, 1.3],
  [0.165, 1.365],
  [0.07, 1.41],
  [0, 1.415],
];

/**
 * An armoured torso: the cuirass, a little outside the tunic, from the waist to the shoulders.
 * It replaces the tunic torso (the skirt covers everything below it).
 */
const CUIRASS_PROFILE: [number, number][] = [
  [0, 0.92],
  [0.168, 0.94],
  [0.16, 1.0],
  [0.178, 1.12],
  [0.202, 1.23],
  [0.207, 1.3],
  [0.177, 1.37],
  [0.085, 1.415],
  [0, 1.42],
];

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

/** A six-sided capsule whose rounded ends sit on the joints a and b. */
function limb(r: number, a: Vector3, b: Vector3): [CapsuleGeometry, Matrix4] {
  return [new CapsuleGeometry(r, Math.max(0.01, a.distanceTo(b)), 1, 6), along(a, b)];
}

function lathe(profile: [number, number][]): LatheGeometry {
  return new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), 8);
}

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
 * The person: torso, head and face, arms, and (unless seated on a horse) legs, dressed in a
 * team-coloured tunic and whatever armour the outfit calls for. `base` lifts the whole person
 * (a rider sits on the saddle).
 */
function addPerson(b: Builder, def: UnitDef, base: Vector3, seated: boolean): Person {
  const v = def.visual;
  const kit = OUTFITS[v.gear];
  const w = v.build;
  const lt = v.limbThickness;
  const o = (x: number, y: number, z: number) => v3(x + base.x, y + base.y, z + base.z);
  // Chest depth relative to its width; broad builds are a little deeper too.
  const depth = 0.64 * (0.5 + 0.5 * w);

  const hipY = 0.84;
  const hipX = 0.088 * Math.max(0.9, w);
  const shX = 0.18 * w + 0.015;
  const neck = o(0, 1.4, 0);
  const headR = 0.115 * v.headSize;
  const headC = o(0, 1.43 + headR * HEAD_SY, 0.015);
  const torsoC = o(0, 1.1, 0);
  const torsoR = v3(0.19 * w, 0.3, 0.194 * w * depth);
  const shoulderL = o(shX, 1.33, 0);
  const shoulderR = o(-shX, 1.33, 0);
  const handL = o(shX + 0.03, 0.78, 0.05);
  const handR = o(-shX - 0.03, 0.78, 0.05);
  const hipL = o(hipX, hipY, 0);
  const hipR = o(-hipX, hipY, 0);
  const hip = o(0, hipY, 0);
  const T = PART_TORSO;

  if (kit.armor === 'none') {
    // Torso in a team-coloured tunic: shoulders wider than the waist, closed top and bottom.
    b.add(lathe(TORSO_PROFILE), T, hip, CLOTH, 1, mat(base.x, base.y, base.z, 0, 0, 0, w, 1, w * depth), 0.95);
    b.add(new CylinderGeometry(0.152, 0.152, 0.045, 8, 1, true), T, hip, LEATHER, 0, mat(base.x, base.y + 1.0, base.z, 0, 0, 0, w, 1, w * depth * 1.06));
  } else {
    const color = kit.armor === 'bronze' ? BRONZE : LINEN;
    b.add(lathe(CUIRASS_PROFILE), T, hip, color, 0, mat(base.x, base.y, base.z, 0, 0, 0, w, 1, w * depth * 1.02));
  }
  // Tunic skirt, flaring out over the thighs.
  b.add(new CylinderGeometry(0.158, 0.205, 0.36, 8, 1, true), T, hip, CLOTH, 1, mat(base.x, base.y + 0.83, base.z, 0, 0, 0, w, 1, w * depth * 1.3), 0.86);

  // Neck and head.
  const r = headR;
  b.add(new CylinderGeometry(0.044, 0.05, 1, 6, 1, true), PART_HEAD, neck, SKIN, 0, between(o(0, 1.36, 0), o(0, 1.47, 0.01)));
  b.add(new SphereGeometry(1, 8, 6), PART_HEAD, neck, SKIN, 0, mat(headC.x, headC.y, headC.z, 0, 0, 0, r * HEAD_SX, r * HEAD_SY, r));
  // Face: nose, small dark eyes, stern brows and ears.
  b.add(new ConeGeometry(1, 1, 4), PART_HEAD, neck, SKIN_SHADE, 0, mat(headC.x, headC.y - r * 0.12, headC.z + r * 1.02, Math.PI / 2 + 0.3, 0, 0, r * 0.13, r * 0.3, r * 0.13));
  for (const side of [1, -1]) {
    b.add(new SphereGeometry(1, 4, 2), PART_HEAD, neck, EYE, 0, mat(headC.x + side * r * 0.34, headC.y + r * 0.12, headC.z + r * 0.9, 0, 0, 0, r * 0.1, r * 0.12, r * 0.08));
    b.add(new BoxGeometry(1, 1, 1), PART_HEAD, neck, HAIR, 0, mat(headC.x + side * r * 0.35, headC.y + r * 0.33, headC.z + r * 0.86, 0, side * 0.3, side * 0.2, r * 0.36, r * 0.08, r * 0.1));
    b.add(new SphereGeometry(1, 4, 2), PART_HEAD, neck, SKIN_SHADE, 0, mat(headC.x + side * r * 0.92, headC.y, headC.z - r * 0.05, 0, 0, 0, r * 0.1, r * 0.22, r * 0.14));
  }
  if (kit.beard) {
    // Lower half-shell hanging from the jaw; its rim is buried in the cheeks.
    b.add(new SphereGeometry(1, 7, 3, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), PART_HEAD, neck, BEARD, 0, mat(headC.x, headC.y - r * 0.42, headC.z + r * 0.22, 0, 0, 0, r * 0.78, r * 0.55, r * 0.64));
  }

  // Arms: team sleeve over the upper arm, bare forearm with a slight bend, hand.
  for (const side of [1, -1]) {
    const sh = side > 0 ? shoulderL : shoulderR;
    const hand = side > 0 ? handL : handR;
    const part = side > 0 ? PART_ARM_L : PART_ARM_R;
    const elbow = o(side * (shX + 0.025), 1.06, -0.03);
    const wrist = hand.clone().add(v3(0, 0.05, -0.015));
    const [ug, um] = limb(0.056 * lt, sh, elbow);
    b.add(ug, part, sh, CLOTH, 1, um, 0.9);
    const [fg, fm] = limb(0.046 * lt, elbow, wrist);
    b.add(fg, part, sh, SKIN, 0, fm);
    b.add(new SphereGeometry(1, 5, 4), part, sh, SKIN, 0, mat(hand.x, hand.y, hand.z, 0, 0, 0, 0.038 * lt, 0.052 * lt, 0.046 * lt));
  }

  const thighColor = kit.trousers ? CLOTH : SKIN;
  const shinColor = kit.greaves ? BRONZE : thighColor;
  const legTint = kit.trousers ? 1 : 0;
  const legShade = kit.trousers ? 0.62 : 1;
  if (seated) {
    // A rider's legs straddle the horse; they ride along with the body.
    for (const side of [1, -1]) {
      const hp = side > 0 ? hipL : hipR;
      const knee = hp.clone().add(v3(side * 0.17, -0.1, 0.3));
      const ankle = knee.clone().add(v3(side * 0.04, -0.38, -0.08));
      const [tg, tm] = limb(0.074 * lt, hp, knee);
      b.add(tg, T, hip, thighColor, legTint, tm, legShade);
      const [sg, sm] = limb(0.056 * lt, knee, ankle);
      b.add(sg, T, hip, shinColor, kit.greaves ? 0 : legTint, sm, kit.greaves ? 1 : legShade);
      b.add(new BoxGeometry(0.08 * lt, 0.055, 0.2), T, hip, SANDAL, 0, mat(ankle.x, ankle.y - 0.05, ankle.z + 0.05));
    }
  } else {
    // Legs: thigh and shin with a slight knee bend, and a sandalled foot.
    for (const side of [1, -1]) {
      const hp = side > 0 ? hipL : hipR;
      const part = side > 0 ? PART_LEG_L : PART_LEG_R;
      const knee = o(side * hipX, 0.46, 0.012);
      const ankle = o(side * hipX, 0.09, -0.012);
      const [tg, tm] = limb(0.074 * lt, hp, knee);
      b.add(tg, part, hp, thighColor, legTint, tm, legShade);
      const [sg, sm] = limb(0.056 * lt, knee, ankle);
      b.add(sg, part, hp, shinColor, kit.greaves ? 0 : legTint, sm, kit.greaves ? 1 : legShade);
      b.add(new BoxGeometry(0.08 * lt, 0.055, 0.2), part, hp, SANDAL, 0, mat(ankle.x, base.y + 0.028, ankle.z + 0.05));
    }
  }
  return { neck, hip, headC, headR, torsoC, torsoR, shoulderL, shoulderR, handL, handR, hipL, hipR };
}

/** Short hair: a cap over the crown and down the back of the head, leaving the forehead clear. */
function addHair(b: Builder, p: Person): void {
  const { headC: c, headR: r, neck } = p;
  b.add(new SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.55), PART_HEAD, neck, HAIR, 0, mat(c.x, c.y + r * 0.04, c.z - r * 0.06, -0.45, 0, 0, r * 1.0, r * 1.1, r * 1.06));
}

/** Bronze Corinthian helmet: dome, cheek guards, nose guard, dark eye openings and a crest. */
function addCorinthian(b: Builder, p: Person, crest: 'long' | 'transverse'): void {
  const { headC: c, headR: r, neck } = p;
  b.add(new SphereGeometry(1, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.62), PART_HEAD, neck, BRONZE, 0, mat(c.x, c.y + r * 0.04, c.z, 0, 0, 0, r * 1.07, r * 1.15, r * 1.1));
  for (const side of [1, -1]) {
    b.add(new BoxGeometry(r * 0.14, r * 0.62, r * 0.55), PART_HEAD, neck, BRONZE, 0, mat(c.x + side * r * 0.66, c.y - r * 0.42, c.z + r * 0.58, 0, side * 0.55, 0), 0.92);
    b.add(new BoxGeometry(r * 0.3, r * 0.14, r * 0.06), PART_HEAD, neck, EYE, 0, mat(c.x + side * r * 0.34, c.y + r * 0.1, c.z + r * 1.04, 0, side * 0.32, 0));
  }
  b.add(new BoxGeometry(r * 0.12, r * 0.42, r * 0.1), PART_HEAD, neck, DARK_BRONZE, 0, mat(c.x, c.y - r * 0.08, c.z + r * 1.1));
  if (crest === 'long') {
    b.add(new TorusGeometry(r * 0.9, r * 0.2, 3, 8, Math.PI), PART_HEAD, neck, HORSEHAIR, 0, mat(c.x, c.y + r * 0.5, c.z - r * 0.08, 0, Math.PI / 2, 0, 1, 1.45, 1.6));
  } else {
    b.add(new TorusGeometry(r * 0.95, r * 0.17, 3, 8, Math.PI), PART_HEAD, neck, CREAM_CREST, 0, mat(c.x, c.y + r * 0.5, c.z, 0, 0, 0, 1, 1.2, 1));
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
      // A cloak in the team colour, hung from the shoulders and flaring out behind.
      const t = p.torsoC;
      b.add(new BoxGeometry(p.torsoR.x * 2.0, 0.8, 0.03), PART_TORSO, p.hip, CLOTH, 1, mat(t.x, t.y - 0.1, t.z - p.torsoR.z - 0.04, 0.12), 0.7);
      break;
    }
    case 'thracian':
      // Phrygian cap with its tip flopping forward.
      b.add(new SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.5), PART_HEAD, neck, 0xb98d4a, 0, mat(c.x, c.y + r * 0.08, c.z, 0, 0, 0, r * 1.06, r * 1.12, r * 1.1));
      b.add(new ConeGeometry(r * 0.5, r * 0.95, 7), PART_HEAD, neck, 0xb98d4a, 0, mat(c.x, c.y + r * 1.12, c.z + r * 0.18, 0.75), 0.92);
      break;
    case 'headband':
      addHair(b, p);
      b.add(new CylinderGeometry(1, 1, 1, 8, 1, true), PART_HEAD, neck, LINEN, 0, mat(c.x, c.y + r * 0.42, c.z, 0, 0, 0, r * 1.0, r * 0.16, r * 1.06));
      break;
    case 'scythian':
      // Tall pointed cap with ear flaps.
      b.add(new ConeGeometry(r * 1.06, r * 1.6, 8), PART_HEAD, neck, 0x6f7a3a, 0, mat(c.x, c.y + r * 1.0, c.z - r * 0.08, -0.18));
      for (const side of [1, -1]) {
        b.add(new BoxGeometry(r * 0.12, r * 0.65, r * 0.45), PART_HEAD, neck, 0x5f6a32, 0, mat(c.x + side * r * 0.95, c.y - r * 0.15, c.z - r * 0.12));
      }
      break;
    case 'pilos':
      b.add(new ConeGeometry(r * 1.08, r * 1.1, 9), PART_HEAD, neck, BRONZE, 0, mat(c.x, c.y + r * 0.85, c.z));
      b.add(new TorusGeometry(r * 1.02, r * 0.07, 3, 10), PART_HEAD, neck, DARK_BRONZE, 0, mat(c.x, c.y + r * 0.32, c.z, Math.PI / 2));
      break;
    case 'petasos':
      // Wide-brimmed traveller's hat.
      addHair(b, p);
      b.add(new CylinderGeometry(r * 1.75, r * 1.75, r * 0.07, 12), PART_HEAD, neck, 0xd2b06a, 0, mat(c.x, c.y + r * 0.55, c.z));
      b.add(new SphereGeometry(r * 0.98, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.5), PART_HEAD, neck, 0xc4a05a, 0, mat(c.x, c.y + r * 0.5, c.z));
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
  b.add(new CylinderGeometry(0.024, 0.024, 1, 5), PART_ARM_R, p.shoulderR, WOOD, 0, between(back, front), 1, set);
  b.add(new ConeGeometry(1, 1, 5), PART_ARM_R, p.shoulderR, BRONZE, 0, tipAt(back, front, 0.045, 0.24), 1, set);
  b.add(new ConeGeometry(1, 1, 4), PART_ARM_R, p.shoulderR, DARK_BRONZE, 0, tipAt(front, back, 0.028, 0.1), 1, set);
}

/**
 * Round shield on the left forearm with a bronze rim and boss. Hoplite shields are painted in
 * the team colour (so a shield wall reads from across the field); light shields are wicker with
 * a team-coloured emblem.
 */
function aspis(b: Builder, p: Person, r: number, painted: boolean): void {
  const c = p.handL.clone().add(v3(0.04, 0.2, 0.2));
  const L = PART_ARM_L;
  if (painted) {
    b.add(new CylinderGeometry(r, r, 0.06, 10), L, p.shoulderL, CLOTH, 1, mat(c.x, c.y, c.z, Math.PI / 2), 0.92);
    b.add(new TorusGeometry(r, 0.03, 3, 10), L, p.shoulderL, BRONZE, 0, mat(c.x, c.y, c.z + 0.03));
    b.add(new SphereGeometry(r * 0.2, 6, 3, 0, Math.PI * 2, 0, Math.PI * 0.5), L, p.shoulderL, BRONZE, 0, mat(c.x, c.y, c.z + 0.03, Math.PI / 2));
  } else {
    b.add(new CylinderGeometry(r, r, 0.05, 10), L, p.shoulderL, 0xa88a52, 0, mat(c.x, c.y, c.z, Math.PI / 2));
    b.add(new TorusGeometry(r, 0.025, 3, 10), L, p.shoulderL, DARK_WOOD, 0, mat(c.x, c.y, c.z + 0.025));
    b.add(new CylinderGeometry(r * 0.45, r * 0.45, 0.02, 8), L, p.shoulderL, CLOTH, 1, mat(c.x, c.y, c.z + 0.035, Math.PI / 2), 1.05);
  }
}

function swordInHand(b: Builder, p: Person, set: number, length = 0.46): void {
  const h = p.handR;
  const tip = h.clone().add(v3(0, 0.28 * (length / 0.46), 0.36 * (length / 0.46)));
  b.add(new BoxGeometry(0.05, 1, 0.018), PART_ARM_R, p.shoulderR, STEEL, 0, between(h.clone().add(v3(0, 0.04, 0.04)), tip), 1, set);
  b.add(new BoxGeometry(0.06 + 0.17 * length, 0.03, 0.04), PART_ARM_R, p.shoulderR, BRONZE, 0, mat(h.x, h.y + 0.05, h.z + 0.06, -0.9), 1, set);
}

function sheath(b: Builder, p: Person, set: number): void {
  const t = p.torsoC;
  b.add(new BoxGeometry(0.055, 0.38, 0.045), PART_TORSO, p.hip, LEATHER, 0, mat(t.x + p.torsoR.x * 0.95, t.y - 0.26, t.z + 0.05, 0.5, 0, 0.15), 0.9, set);
}

function javelinInHand(b: Builder, p: Person, set: number): void {
  const h = p.handR;
  const back = h.clone().add(v3(0, -0.15, -0.4));
  const front = h.clone().add(v3(0, 0.55, 0.85));
  b.add(new CylinderGeometry(0.018, 0.018, 1, 4), PART_ARM_R, p.shoulderR, WOOD, 0, between(back, front), 1, set);
  b.add(new ConeGeometry(1, 1, 4), PART_ARM_R, p.shoulderR, STEEL, 0, tipAt(back, front, 0.032, 0.15), 1, set);
}

function spareJavelins(b: Builder, p: Person, n: number, set: number): void {
  for (let k = 0; k < n; k++) {
    const h = p.handL.clone().add(v3(0.04 + k * 0.05, 0, -0.05 + k * 0.04));
    const back = h.clone().add(v3(0, -0.35, -0.35));
    const front = h.clone().add(v3(0, 0.75, 0.55));
    b.add(new CylinderGeometry(0.016, 0.016, 1, 4), PART_ARM_L, p.shoulderL, WOOD, 0, between(back, front), 0.95, set);
    b.add(new ConeGeometry(1, 1, 4), PART_ARM_L, p.shoulderL, STEEL, 0, tipAt(back, front, 0.028, 0.13), 1, set);
  }
}

function dagger(b: Builder, p: Person): void {
  swordInHand(b, p, SET_SIDEARM, 0.26);
}

function hipPouch(b: Builder, p: Person, color: number): void {
  const t = p.torsoC;
  b.add(new IcosahedronGeometry(0.07, 0), PART_TORSO, p.hip, color, 0, mat(t.x - p.torsoR.x * 0.95, t.y - 0.24, t.z + 0.06));
}

function bow(b: Builder, p: Person): void {
  const h = p.handL;
  b.add(new TorusGeometry(0.44, 0.02, 3, 10, Math.PI * 0.85), PART_ARM_L, p.shoulderL, DARK_WOOD, 0, mat(h.x + 0.02, h.y + 0.08, h.z + 0.12, 0, Math.PI / 2, Math.PI / 2 + Math.PI * 0.075));
  b.add(new CylinderGeometry(0.005, 0.005, 0.8, 3), PART_ARM_L, p.shoulderL, LINEN, 0, mat(h.x + 0.02, h.y + 0.08, h.z - 0.04));
}

function quiver(b: Builder, p: Person): void {
  const t = p.torsoC;
  const c = v3(t.x - 0.08, t.y + 0.12, t.z - p.torsoR.z - 0.06);
  b.add(new CylinderGeometry(0.065, 0.055, 0.48, 6), PART_TORSO, p.hip, LEATHER, 0, mat(c.x, c.y, c.z, -0.25, 0, 0.35));
  for (let k = 0; k < 3; k++) {
    b.add(new ConeGeometry(0.028, 0.09, 3), PART_TORSO, p.hip, LINEN, 0, mat(c.x - 0.09 + k * 0.025, c.y + 0.27, c.z - 0.06, -0.25, 0, 0.35));
  }
}

function sling(b: Builder, p: Person): void {
  const h = p.handR;
  const end = h.clone().add(v3(0, -0.34, 0.06));
  b.add(new CylinderGeometry(0.008, 0.008, 1, 3), PART_ARM_R, p.shoulderR, LINEN, 0, between(h, end), 1, SET_MAIN);
  b.add(new SphereGeometry(0.04, 5, 3), PART_ARM_R, p.shoulderR, LEATHER, 0, mat(end.x, end.y, end.z), 1, SET_MAIN);
}

function stoneInHand(b: Builder, p: Person): void {
  const h = p.handR;
  b.add(new IcosahedronGeometry(0.06, 0), PART_ARM_R, p.shoulderR, STONE, 0, mat(h.x, h.y + 0.04, h.z + 0.07), 1, SET_MAIN);
}

function addGear(b: Builder, gear: GearKind, p: Person): void {
  switch (gear) {
    case 'hoplite':
      spear(b, p, 2.1, SET_ALWAYS);
      aspis(b, p, 0.42, true);
      break;
    case 'spartan':
      spear(b, p, 2.1, SET_MAIN);
      swordInHand(b, p, SET_SIDEARM);
      sheath(b, p, SET_MAIN);
      aspis(b, p, 0.45, true);
      break;
    case 'peltast':
      javelinInHand(b, p, SET_MAIN);
      spareJavelins(b, p, 2, SET_MAIN);
      swordInHand(b, p, SET_SIDEARM, 0.36);
      aspis(b, p, 0.3, false);
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
      aspis(b, p, 0.36, true);
      break;
  }
}

/** Horse heights in canonical units. */
const SADDLE_Y = 1.3;
const BODY_Y = 1.08;
const LEG_TOP = 1.0;
const FRONT_Z = 0.5;
const BACK_Z = -0.55;

/**
 * A light horse. Its front legs move as part LEG_L and back legs as LEG_R, so the walk cycle
 * becomes a bounding gallop. Everything else rides along with the body (PART_TORSO).
 */
function addHorse(b: Builder): { front: Vector3; back: Vector3; hip: Vector3 } {
  const hip = v3(0, BODY_Y, 0);
  const front = v3(0, LEG_TOP, FRONT_Z);
  const back = v3(0, LEG_TOP, BACK_Z);
  const T = PART_TORSO;
  // Barrel, deep chest and rounded rump.
  b.add(new SphereGeometry(1, 10, 6), T, hip, HORSE, 0, mat(0, BODY_Y, -0.02, 0, 0, 0, 0.25, 0.3, 0.78));
  b.add(new SphereGeometry(1, 7, 5), T, hip, HORSE, 0, mat(0, BODY_Y + 0.03, 0.45, 0, 0, 0, 0.24, 0.32, 0.3), 1.03);
  b.add(new SphereGeometry(1, 7, 5), T, hip, HORSE, 0, mat(0, BODY_Y + 0.05, -0.52, 0, 0, 0, 0.27, 0.3, 0.32), 0.97);
  // Neck tapering up to a long head with a darker muzzle.
  const n0 = v3(0, 1.18, 0.6);
  const n1 = v3(0, 1.72, 0.9);
  b.add(new CylinderGeometry(0.1, 0.19, 1, 7), T, hip, HORSE, 0, between(n0, n1));
  const h0 = v3(0, 1.8, 0.92);
  const h1 = v3(0, 1.52, 1.3);
  b.add(new CylinderGeometry(0.065, 0.1, 1, 7), T, hip, HORSE, 0, between(h0, h1), 1.02);
  b.add(new SphereGeometry(1, 6, 4), T, hip, HORSE, 0, mat(h0.x, h0.y - 0.04, h0.z + 0.03, 0, 0, 0, 0.1, 0.11, 0.12));
  b.add(new SphereGeometry(1, 6, 4), T, hip, 0x5e3d29, 0, mat(h1.x, h1.y, h1.z, 0, 0, 0, 0.07, 0.07, 0.07));
  for (const side of [1, -1]) {
    b.add(new ConeGeometry(0.035, 0.12, 4), T, hip, HORSE, 0, mat(side * 0.055, 1.92, 0.9, -0.15), 0.9);
    b.add(new SphereGeometry(1, 4, 2), T, hip, EYE, 0, mat(side * 0.085, 1.76, 1.02, 0, 0, 0, 0.02, 0.026, 0.026));
  }
  // Mane along the top of the neck, and the tail.
  b.add(new BoxGeometry(0.05, 1, 0.09), T, hip, MANE, 0, between(v3(0, 1.3, 0.47), v3(0, 1.86, 0.84)));
  b.add(new ConeGeometry(0.075, 1, 5), T, hip, MANE, 0, between(v3(0, 1.2, -0.84), v3(0, 0.55, -1.02)));
  // Team-coloured saddle cloth hanging down both flanks.
  b.add(new BoxGeometry(0.56, 0.04, 0.58), T, hip, CLOTH, 1, mat(0, SADDLE_Y - 0.05, -0.02), 0.85);
  for (const side of [1, -1]) {
    b.add(new BoxGeometry(0.03, 0.3, 0.56), T, hip, CLOTH, 1, mat(side * 0.27, SADDLE_Y - 0.2, -0.02, 0, 0, side * 0.12), 0.8);
  }
  // Legs: front pair (LEG_L) and back pair (LEG_R): muscled upper leg, slim cannon, dark hoof.
  for (const [part, z, pivot] of [[PART_LEG_L, FRONT_Z, front], [PART_LEG_R, BACK_Z, back]] as const) {
    for (const side of [1, -1]) {
      const top = v3(side * 0.14, LEG_TOP, z);
      const knee = v3(side * 0.14, 0.52, z + (part === PART_LEG_L ? 0.02 : -0.04));
      const bottom = v3(side * 0.14, 0.1, z + 0.02);
      const [ug, um] = limb(0.075, top, knee);
      b.add(ug, part, pivot, HORSE, 0, um, 0.95);
      const [lg, lm] = limb(0.042, knee, bottom);
      b.add(lg, part, pivot, HORSE, 0, lm, 0.88);
      b.add(new CylinderGeometry(0.052, 0.062, 0.1, 6), part, pivot, HOOF, 0, mat(bottom.x, 0.05, bottom.z));
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
  const p = addPerson(b, def, horse ? v3(0, SADDLE_Y - 0.84, -0.05) : v3(0, 0, 0), horse);
  addHat(b, v.hat, p);
  addGear(b, v.gear, p);

  const lt = v.limbThickness;
  const armR = 0.056 * lt;
  const armHalf = p.shoulderL.distanceTo(p.handL) * 0.5;
  const arm = (sh: Vector3, hand: Vector3): RagdollPartShape => ({
    center: sh.clone().add(hand).multiplyScalar(0.5),
    radius: armR,
    halfHeight: Math.max(0.02, armHalf - armR),
  });
  const top = p.headC.y + p.headR * HEAD_SY;
  let parts: RagdollPartShape[];
  let layout: BodyLayout;
  if (horseJoints) {
    // Horse and rider: one box body, the rider's head and arms, and the two pairs of legs.
    parts = [
      { center: v3(0, 1.25, 0), radius: 0.35, halfHeight: 0, half: v3(0.3, 0.45, 0.95) },
      { center: p.headC.clone(), radius: p.headR * 1.1, halfHeight: 0 },
      arm(p.shoulderL, p.handL),
      arm(p.shoulderR, p.handR),
      { center: v3(0, 0.5, FRONT_Z), radius: 0.08, halfHeight: 0, half: v3(0.22, 0.48, 0.09) },
      { center: v3(0, 0.5, BACK_Z), radius: 0.08, halfHeight: 0, half: v3(0.22, 0.48, 0.09) },
    ];
    layout = {
      height: top,
      neck: p.neck,
      hip: horseJoints.hip,
      shoulderL: p.shoulderL,
      shoulderR: p.shoulderR,
      hipL: horseJoints.front,
      hipR: horseJoints.back,
      parts,
    };
  } else {
    const tr = 0.15 * v.build;
    const legR = 0.074 * lt;
    const legHalf = p.hipL.y * 0.5;
    parts = [
      // Torso capsule from the hips to the shoulders.
      { center: p.torsoC.clone().setY(1.08), radius: tr, halfHeight: Math.max(0.02, 0.3 - tr) },
      { center: p.headC.clone(), radius: p.headR * 1.1, halfHeight: 0 },
      arm(p.shoulderL, p.handL),
      arm(p.shoulderR, p.handR),
      { center: v3(p.hipL.x, legHalf, 0), radius: legR, halfHeight: Math.max(0.02, legHalf - legR) },
      { center: v3(p.hipR.x, legHalf, 0), radius: legR, halfHeight: Math.max(0.02, legHalf - legR) },
    ];
    layout = {
      height: top,
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
