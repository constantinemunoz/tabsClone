/**
 * Unit definitions, entirely as data. Adding a unit means adding one entry here and, at most,
 * one small mesh function in src/render/unit-model.ts (if it needs a new hat or weapon shape).
 *
 * Units: metres, seconds, kilograms. Impulses are in kg*m/s, so the velocity a hit adds to a
 * target is impulse / target mass.
 */

export type TargetRule = 'nearest' | 'farthest' | 'preferRanged';

/**
 * melee: instant arc test on the strike tick.
 * cone: like melee but hits everything in the arc, with damage and knockback falling off with distance.
 * projectile: launches a projectile on a ballistic arc.
 */
export type WeaponKind = 'melee' | 'cone' | 'projectile';

export type ArmorClass = 'none' | 'light' | 'heavy';

export type ProjectileVisual = 'arrow' | 'javelin' | 'stone' | 'bullet';
export const PROJECTILE_VISUALS: ProjectileVisual[] = ['arrow', 'javelin', 'stone', 'bullet'];

export interface ProjectileDef {
  /** Elevation of the throw above horizontal, degrees (more when shooting uphill). */
  launchAngle: number;
  /** Upper limit on launch speed (m/s); farther targets get a shot that falls short. */
  maxSpeed: number;
  gravityScale: number;
  radius: number;
  /** Random aim error, degrees (seeded). */
  spread: number;
  visual: ProjectileVisual;
  /** Seconds before the projectile disappears if it hits nothing. */
  lifetime: number;
}

/** Attack animation the wobble shader plays for a weapon. */
export type AttackStyle = 'swing' | 'thrust' | 'sweep' | 'lunge' | 'throw' | 'blast' | 'bow' | 'sling';
export const ATTACK_STYLES: AttackStyle[] = ['swing', 'thrust', 'sweep', 'lunge', 'throw', 'blast', 'bow', 'sling'];

export interface WeaponDef {
  kind: WeaponKind;
  style: AttackStyle;
  /** Melee/cone: reach beyond both bodies' radii. Projectile: maximum distance on flat ground. */
  range: number;
  /** Targets closer than this are ignored (siege weapons can't hit their own feet). */
  minRange: number;
  /** Full width of the hit arc, degrees. */
  arc: number;
  /** How far above the attacker's head the weapon can reach. */
  verticalReach: number;
  windup: number;
  recovery: number;
  /** Extra wait after recovery before the next wind-up may start (reload time). */
  cooldown: number;
  damage: number;
  knockback: number;
  knockUp: number;
  /** Area-of-effect radius on impact; 0 for single-target. */
  areaRadius: number;
  friendlyFire: boolean;
  /** Maximum units hit by one melee/cone strike. */
  maxTargets: number;
  projectile?: ProjectileDef;
  /** After running at least minRunup metres, the next hit is multiplied. */
  charge?: { minRunup: number; damageMult: number; knockbackMult: number };
  /** Damage multiplier by the target's armour (e.g. sling bullets against heavy armour). */
  vsArmor?: Partial<Record<ArmorClass, number>>;
  /** Damage multiplier for hits landing outside the target's front arc. */
  flankMult?: number;
}

export type HatKind = 'none' | 'corinthian' | 'spartan' | 'thracian' | 'headband' | 'scythian' | 'pilos' | 'petasos';
export type GearKind =
  | 'hoplite'
  | 'spartan'
  | 'peltast'
  | 'skirmisher'
  | 'archer'
  | 'slinger'
  | 'horseman'
  | 'marine';

export interface UnitVisual {
  /** Uniform scale applied to the procedural body (1 = a 1.65 m tall person). */
  scale: number;
  /** Body proportions relative to the default: shoulder and chest breadth, head and limb size. */
  build: number;
  headSize: number;
  limbThickness: number;
  /** 'horse' puts the person on a horse. */
  body: 'person' | 'horse';
  hat: HatKind;
  gear: GearKind;
  /** Metres covered per full walk cycle (two steps). */
  stride: number;
  /** Wobble spring: light units are floppy (low stiffness, low damping), heavy ones stiffer. */
  wobbleStiffness: number;
  wobbleDamping: number;
  /** How strongly acceleration and hits shove the wobble spring. */
  wobbleGain: number;
}

export interface UnitDef {
  id: string;
  name: string;
  role: string;
  blurb: string;
  cost: number;
  health: number;
  mass: number;
  radius: number;
  height: number;
  speed: number;
  accel: number;
  /** Degrees per second. */
  turnRate: number;
  targeting: TargetRule;
  /** Swings out around the enemy's flank instead of walking straight at the target. */
  flanker: boolean;
  /** Main weapon. */
  weapon: WeaponDef;
  /**
   * Backup melee weapon: used once the main weapon's ammunition is spent, when an enemy gets
   * inside its reach while the main weapon is ranged, or (for melee mains) when the target is
   * too close for the main weapon.
   */
  sidearm?: WeaponDef;
  /** Shots for a ranged main weapon, as [min, max] (seeded per unit). Unlimited if absent. */
  ammo?: [number, number];
  armor: ArmorClass;
  /** Shield wall: less damage and knockback for each same-type ally standing beside this unit. */
  shieldWall?: { radius: number; reductionPerAlly: number; maxAllies: number };
  flying: boolean;
  hoverHeight: number;
  /** Fraction of incoming knockback ignored (0..1). */
  knockbackResist: number;
  /** Damage multiplier for hits arriving from the front (shields). 1 = no reduction. */
  frontDamageMult: number;
  visual: UnitVisual;
}

const melee = (w: Partial<WeaponDef>): WeaponDef => ({
  kind: 'melee',
  style: 'swing',
  range: 0.65,
  minRange: 0,
  arc: 90,
  verticalReach: 0.6,
  windup: 0.4,
  recovery: 0.5,
  cooldown: 0,
  damage: 10,
  knockback: 100,
  knockUp: 30,
  areaRadius: 0,
  friendlyFire: false,
  maxTargets: 1,
  ...w,
});

const ranged = (w: Partial<WeaponDef>, p: Partial<ProjectileDef>): WeaponDef => ({
  ...melee({ kind: 'projectile', style: 'throw', arc: 360, ...w }),
  projectile: {
    launchAngle: 15,
    maxSpeed: 25,
    gravityScale: 1,
    radius: 0.1,
    spread: 3,
    visual: 'javelin',
    lifetime: 4,
    ...p,
  },
});

/** A small knife for ranged units that get caught: weak on purpose. */
const dagger = (damage: number): WeaponDef =>
  melee({ style: 'swing', range: 0.55, arc: 80, windup: 0.35, recovery: 0.5, damage, knockback: 70, knockUp: 20 });

const person = (v: Partial<UnitVisual>): UnitVisual => ({
  scale: 1,
  build: 1,
  headSize: 1,
  limbThickness: 1,
  body: 'person',
  hat: 'none',
  gear: 'hoplite',
  stride: 1.7,
  wobbleStiffness: 60,
  wobbleDamping: 3.6,
  wobbleGain: 1,
  ...v,
});

export const UNITS: UnitDef[] = [
  {
    id: 'hoplite',
    name: 'Hoplite',
    role: 'Spear and shield',
    blurb: 'Stabs with a spear from behind a big round shield. Much tougher standing shoulder to shoulder.',
    cost: 45,
    health: 180,
    mass: 95,
    radius: 0.48,
    height: 1.75,
    speed: 2.8,
    accel: 9,
    turnRate: 220,
    targeting: 'nearest',
    flanker: false,
    weapon: melee({ style: 'thrust', range: 1.9, arc: 40, verticalReach: 1.0, windup: 0.45, recovery: 0.55, damage: 20, knockback: 160, knockUp: 30 }),
    armor: 'heavy',
    shieldWall: { radius: 2.4, reductionPerAlly: 0.12, maxAllies: 3 },
    flying: false,
    hoverHeight: 0,
    knockbackResist: 0.35,
    frontDamageMult: 0.45,
    visual: person({ scale: 1.08, build: 1.15, hat: 'corinthian', gear: 'hoplite', wobbleStiffness: 85, wobbleDamping: 5, wobbleGain: 0.9 }),
  },
  {
    id: 'spartan',
    name: 'Spartan',
    role: 'Elite hoplite',
    blurb: 'Hits harder and faster than a hoplite, and draws a short sword when things get close.',
    cost: 70,
    health: 260,
    mass: 100,
    radius: 0.5,
    height: 1.85,
    speed: 3.2,
    accel: 11,
    turnRate: 280,
    targeting: 'nearest',
    flanker: false,
    weapon: melee({ style: 'thrust', range: 1.9, arc: 45, verticalReach: 1.0, windup: 0.28, recovery: 0.4, damage: 32, knockback: 220, knockUp: 40 }),
    sidearm: melee({ style: 'swing', range: 0.75, arc: 100, windup: 0.22, recovery: 0.3, damage: 24, knockback: 150, knockUp: 40 }),
    armor: 'heavy',
    flying: false,
    hoverHeight: 0,
    knockbackResist: 0.45,
    frontDamageMult: 0.4,
    visual: person({ scale: 1.14, build: 1.05, limbThickness: 1.15, hat: 'spartan', gear: 'spartan', wobbleStiffness: 95, wobbleDamping: 5.5, wobbleGain: 0.85 }),
  },
  {
    id: 'peltast',
    name: 'Peltast',
    role: 'Javelins, then light shield',
    blurb: 'Throws two or three javelins from medium range, then runs in with a light shield. Quick and fragile.',
    cost: 32,
    health: 110,
    mass: 60,
    radius: 0.42,
    height: 1.65,
    speed: 4.8,
    accel: 15,
    turnRate: 380,
    targeting: 'nearest',
    flanker: false,
    weapon: ranged(
      { style: 'throw', range: 20, windup: 0.5, recovery: 0.4, cooldown: 0.4, damage: 26, knockback: 140, knockUp: 30 },
      { visual: 'javelin', launchAngle: 12, maxSpeed: 24, radius: 0.12, spread: 3 },
    ),
    sidearm: melee({ style: 'swing', range: 0.7, arc: 90, windup: 0.3, recovery: 0.4, damage: 12, knockback: 110, knockUp: 30 }),
    ammo: [2, 3],
    armor: 'light',
    flying: false,
    hoverHeight: 0,
    knockbackResist: 0,
    frontDamageMult: 0.75,
    visual: person({ hat: 'thracian', gear: 'peltast', wobbleStiffness: 55, wobbleDamping: 3.2, wobbleGain: 1.1 }),
  },
  {
    id: 'skirmisher',
    name: 'Skirmisher',
    role: 'Stone thrower',
    blurb: 'No armour, a pile of stones and a lot of confidence at a distance. Hopeless up close.',
    cost: 16,
    health: 80,
    mass: 55,
    radius: 0.4,
    height: 1.6,
    speed: 4.4,
    accel: 14,
    turnRate: 400,
    targeting: 'nearest',
    flanker: false,
    weapon: ranged(
      { style: 'throw', range: 24, windup: 0.45, recovery: 0.35, cooldown: 0.9, damage: 9, knockback: 70, knockUp: 15 },
      { visual: 'stone', launchAngle: 18, maxSpeed: 22, radius: 0.1, spread: 4 },
    ),
    sidearm: dagger(4),
    armor: 'none',
    flying: false,
    hoverHeight: 0,
    knockbackResist: 0,
    frontDamageMult: 1,
    visual: person({ build: 0.9, hat: 'headband', gear: 'skirmisher', wobbleStiffness: 48, wobbleDamping: 2.9, wobbleGain: 1.2 }),
  },
  {
    id: 'archer',
    name: 'Archer',
    role: 'Long-range bow',
    blurb: 'Long range and a hard hit, but a slow reload, and not much use once someone reaches them.',
    cost: 36,
    health: 90,
    mass: 55,
    radius: 0.4,
    height: 1.65,
    speed: 3.8,
    accel: 12,
    turnRate: 320,
    targeting: 'nearest',
    flanker: false,
    weapon: ranged(
      { style: 'bow', range: 46, windup: 0.8, recovery: 0.4, cooldown: 1.8, damage: 34, knockback: 90, knockUp: 15 },
      { visual: 'arrow', launchAngle: 20, maxSpeed: 40, radius: 0.06, spread: 2.5 },
    ),
    sidearm: dagger(6),
    armor: 'none',
    flying: false,
    hoverHeight: 0,
    knockbackResist: 0,
    frontDamageMult: 1,
    visual: person({ build: 0.92, hat: 'scythian', gear: 'archer', wobbleStiffness: 50, wobbleDamping: 3, wobbleGain: 1.1 }),
  },
  {
    id: 'slinger',
    name: 'Slinger',
    role: 'Lead bullets',
    blurb: 'Whirls lead bullets at long range, fast. Bullets hurt heavy armour much more than you would think.',
    cost: 36,
    health: 85,
    mass: 55,
    radius: 0.4,
    height: 1.6,
    speed: 4.0,
    accel: 13,
    turnRate: 360,
    targeting: 'nearest',
    flanker: false,
    weapon: ranged(
      { style: 'sling', range: 38, windup: 0.4, recovery: 0.25, cooldown: 0.5, damage: 10, knockback: 80, knockUp: 15, vsArmor: { heavy: 2.4 } },
      { visual: 'bullet', launchAngle: 10, maxSpeed: 42, radius: 0.06, spread: 3 },
    ),
    sidearm: dagger(5),
    armor: 'none',
    flying: false,
    hoverHeight: 0,
    knockbackResist: 0,
    frontDamageMult: 1,
    visual: person({ build: 0.95, hat: 'none', gear: 'slinger', wobbleStiffness: 50, wobbleDamping: 3, wobbleGain: 1.1 }),
  },
  {
    id: 'horseman',
    name: 'Horseman',
    role: 'Charging cavalry',
    blurb: 'Rides around the flank and hits like a cart on the first charge. Weak once stuck in a melee.',
    cost: 50,
    health: 200,
    mass: 450,
    radius: 0.85,
    height: 2.3,
    speed: 9,
    accel: 7,
    turnRate: 120,
    targeting: 'preferRanged',
    flanker: true,
    weapon: melee({
      style: 'thrust',
      range: 1.6,
      arc: 60,
      verticalReach: 0.6,
      windup: 0.15,
      recovery: 0.6,
      damage: 18,
      knockback: 170,
      knockUp: 70,
      charge: { minRunup: 10, damageMult: 4.5, knockbackMult: 5 },
      flankMult: 1.5,
    }),
    armor: 'light',
    flying: false,
    hoverHeight: 0,
    knockbackResist: 0.6,
    frontDamageMult: 1,
    visual: person({ body: 'horse', hat: 'petasos', gear: 'horseman', stride: 3.2, wobbleStiffness: 70, wobbleDamping: 4.2, wobbleGain: 0.8 }),
  },
  {
    id: 'marine',
    name: 'Marine',
    role: 'Javelin and short sword',
    blurb: 'A hoplite who packs a javelin and a short sword: a throw or two, then a solid all-round fighter.',
    cost: 46,
    health: 150,
    mass: 85,
    radius: 0.46,
    height: 1.72,
    speed: 3.4,
    accel: 11,
    turnRate: 280,
    targeting: 'nearest',
    flanker: false,
    weapon: ranged(
      { style: 'throw', range: 18, windup: 0.5, recovery: 0.4, cooldown: 0.4, damage: 24, knockback: 140, knockUp: 30 },
      { visual: 'javelin', launchAngle: 12, maxSpeed: 23, radius: 0.12, spread: 3 },
    ),
    sidearm: melee({ style: 'swing', range: 0.75, arc: 100, windup: 0.28, recovery: 0.35, damage: 18, knockback: 140, knockUp: 35 }),
    ammo: [1, 2],
    armor: 'heavy',
    flying: false,
    hoverHeight: 0,
    knockbackResist: 0.25,
    frontDamageMult: 0.55,
    visual: person({ scale: 1.05, build: 1.08, hat: 'pilos', gear: 'marine', wobbleStiffness: 75, wobbleDamping: 4.5, wobbleGain: 0.95 }),
  },
];

export function unitIndex(id: string): number {
  for (let i = 0; i < UNITS.length; i++) if (UNITS[i].id === id) return i;
  return -1;
}

/** True if this unit's weapons can ever reach a hovering flyer. */
export function canTargetAir(d: UnitDef, referenceHover: number): boolean {
  if (d.weapon.kind === 'projectile') return true;
  return d.height + d.weapon.verticalReach >= referenceHover;
}

export function isRanged(d: UnitDef): boolean {
  return d.weapon.kind === 'projectile';
}

/** Index of an attack style for the shader. */
export function attackStyleIndex(s: AttackStyle): number {
  return ATTACK_STYLES.indexOf(s);
}
