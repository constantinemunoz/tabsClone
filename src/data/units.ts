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
 * projectile: launches projectile(s) on a ballistic arc.
 */
export type WeaponKind = 'melee' | 'cone' | 'projectile';

export interface ProjectileDef {
  /** Launch angle above the line to the target, in degrees. Higher means loftier arcs. */
  launchAngle: number;
  /** Upper limit on launch speed (m/s); targets beyond reach at this speed are not fired upon. */
  maxSpeed: number;
  gravityScale: number;
  radius: number;
  /** Random aim error, degrees (seeded). */
  spread: number;
  /** Visual kind, interpreted by the renderer. */
  visual: 'arrow' | 'bomb' | 'boulder' | 'dart';
  /** Seconds before the projectile disappears if it hits nothing. */
  lifetime: number;
}

export interface WeaponDef {
  kind: WeaponKind;
  /** Melee/cone: reach beyond both bodies' radii. Projectile: maximum distance. */
  range: number;
  /** Targets closer than this are ignored (catapults can't hit their own feet). */
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
  /** Charger: after running at least minRunup metres, the next hit is multiplied. */
  charge?: { minRunup: number; damageMult: number; knockbackMult: number };
}

export type HatKind = 'none' | 'helmet' | 'hood' | 'horns' | 'propeller' | 'bandana' | 'crown' | 'cap' | 'goggles';
export type WeaponMesh =
  | 'club'
  | 'swordShield'
  | 'spear'
  | 'ram'
  | 'bow'
  | 'bomb'
  | 'bellows'
  | 'darts'
  | 'log'
  | 'catapult';

export interface UnitVisual {
  /** Uniform scale applied to the procedural body (1 = a 1.6 m tall unit). */
  scale: number;
  /** Body proportions, relative to the default build. */
  belly: number;
  headSize: number;
  limbThickness: number;
  hat: HatKind;
  weapon: WeaponMesh;
  /** Wobble spring: light units are floppy (low stiffness, low damping), giants are stiff. */
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
  weapon: WeaponDef;
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
  range: 0.6,
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

export const UNITS: UnitDef[] = [
  {
    id: 'scrapper',
    name: 'Scrapper',
    role: 'Brawler',
    blurb: 'Cheap, flimsy and extremely enthusiastic about a stick.',
    cost: 10,
    health: 60,
    mass: 50,
    radius: 0.4,
    height: 1.6,
    speed: 4.2,
    accel: 14,
    turnRate: 420,
    targeting: 'nearest',
    weapon: melee({ range: 0.65, arc: 100, windup: 0.38, recovery: 0.45, damage: 14, knockback: 140, knockUp: 45 }),
    flying: false,
    hoverHeight: 0,
    knockbackResist: 0,
    frontDamageMult: 1,
    visual: {
      scale: 1,
      belly: 1,
      headSize: 1,
      limbThickness: 1,
      hat: 'bandana',
      weapon: 'club',
      wobbleStiffness: 55,
      wobbleDamping: 3.2,
      wobbleGain: 1.15,
    },
  },
  {
    id: 'bulwark',
    name: 'Bulwark',
    role: 'Shield bearer',
    blurb: 'Slow, heavy, and hard to hurt from the front.',
    cost: 45,
    health: 260,
    mass: 140,
    radius: 0.55,
    height: 1.85,
    speed: 2.4,
    accel: 8,
    turnRate: 200,
    targeting: 'nearest',
    weapon: melee({ range: 0.75, arc: 80, windup: 0.6, recovery: 0.7, damage: 20, knockback: 260, knockUp: 50 }),
    flying: false,
    hoverHeight: 0,
    knockbackResist: 0.6,
    frontDamageMult: 0.3,
    visual: {
      scale: 1.15,
      belly: 1.25,
      headSize: 0.95,
      limbThickness: 1.25,
      hat: 'helmet',
      weapon: 'swordShield',
      wobbleStiffness: 120,
      wobbleDamping: 7,
      wobbleGain: 0.8,
    },
  },
  {
    id: 'pikeling',
    name: 'Pikeling',
    role: 'Spearman',
    blurb: 'Keeps the enemy at arm’s length. A very long arm.',
    cost: 25,
    health: 85,
    mass: 62,
    radius: 0.42,
    height: 1.75,
    speed: 3.6,
    accel: 12,
    turnRate: 300,
    targeting: 'nearest',
    weapon: melee({ range: 2.3, arc: 40, verticalReach: 1.4, windup: 0.5, recovery: 0.55, damage: 22, knockback: 190, knockUp: 50 }),
    flying: false,
    hoverHeight: 0,
    knockbackResist: 0,
    frontDamageMult: 1,
    visual: {
      scale: 1.05,
      belly: 0.9,
      headSize: 0.95,
      limbThickness: 0.95,
      hat: 'cap',
      weapon: 'spear',
      wobbleStiffness: 75,
      wobbleDamping: 4.2,
      wobbleGain: 1,
    },
  },
  {
    id: 'rammer',
    name: 'Rammer',
    role: 'Charger',
    blurb: 'Gets a run-up, then hits like a runaway wardrobe.',
    cost: 60,
    health: 170,
    mass: 110,
    radius: 0.6,
    height: 1.7,
    speed: 7.5,
    accel: 9,
    turnRate: 150,
    targeting: 'nearest',
    weapon: melee({
      range: 0.85,
      arc: 70,
      windup: 0.12,
      recovery: 0.9,
      damage: 24,
      knockback: 300,
      knockUp: 110,
      charge: { minRunup: 7, damageMult: 2, knockbackMult: 3.2 },
    }),
    flying: false,
    hoverHeight: 0,
    knockbackResist: 0.2,
    frontDamageMult: 1,
    visual: {
      scale: 1.1,
      belly: 1.35,
      headSize: 0.9,
      limbThickness: 1.2,
      hat: 'horns',
      weapon: 'ram',
      wobbleStiffness: 85,
      wobbleDamping: 4.5,
      wobbleGain: 1.1,
    },
  },
  {
    id: 'biglump',
    name: 'Big Lump',
    role: 'Giant',
    blurb: 'Enormous, patient, and swings a whole tree.',
    cost: 320,
    health: 2600,
    mass: 900,
    radius: 1.4,
    height: 4.8,
    speed: 2.1,
    accel: 4,
    turnRate: 90,
    targeting: 'nearest',
    weapon: melee({
      range: 2.6,
      arc: 160,
      verticalReach: 2.5,
      windup: 1.1,
      recovery: 1.0,
      damage: 70,
      knockback: 760,
      knockUp: 520,
      maxTargets: 8,
    }),
    flying: false,
    hoverHeight: 0,
    knockbackResist: 0.5,
    frontDamageMult: 1,
    visual: {
      scale: 3,
      belly: 1.4,
      headSize: 0.85,
      limbThickness: 1.3,
      hat: 'crown',
      weapon: 'log',
      wobbleStiffness: 22,
      wobbleDamping: 3.4,
      wobbleGain: 0.55,
    },
  },
];

export function unitIndex(id: string): number {
  for (let i = 0; i < UNITS.length; i++) if (UNITS[i].id === id) return i;
  return -1;
}

/** True if this unit's weapon can ever reach a hovering flyer. */
export function canTargetAir(d: UnitDef, referenceHover: number): boolean {
  if (d.weapon.kind === 'projectile') return true;
  return d.height + d.weapon.verticalReach >= referenceHover;
}

export function isRanged(d: UnitDef): boolean {
  return d.weapon.kind === 'projectile';
}
