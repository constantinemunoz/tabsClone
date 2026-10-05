import { Color, type DataTexture, type Material, MeshDepthMaterial, MeshLambertMaterial, RGBADepthPacking, Vector3 } from 'three';
import { TEAM_COLORS } from '../config.ts';
import type { BodyLayout } from './unit-model.ts';

/**
 * Unit materials: MeshLambertMaterial (so lights, fog and the optional shadow map just work)
 * with the body deformation injected into the vertex shader. Flat shading derives normals from
 * screen-space derivatives in the fragment shader, so the deformation needs no normal fix-ups.
 *
 * Two variants share the same body geometry:
 *  - live:  the wobble. Everything in this file is cosmetic; it never feeds back into gameplay.
 *  - posed: ragdolls and frozen corpses, each body part placed rigidly from a pose texture.
 */

/** Shared GLSL: rotations, team colour, hit flash. */
const COMMON = /* glsl */ `
  attribute float aPart;
  attribute vec3 aPivot;
  attribute float aTint;
  uniform vec3 uTeamBlue;
  uniform vec3 uTeamRed;
  uniform float uTime;
  uniform float uScale;
  mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
  mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
  mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
  vec3 teamTint(vec3 base, float team, float tint) {
    vec3 tc = team < 0.5 ? uTeamBlue : uTeamRed;
    return mix(base, base * tc, tint);
  }
`;

const LIVE_PARS = /* glsl */ `
  attribute vec4 iPosYaw;   // x, y, z, yaw
  attribute vec4 iSpring;   // wobble spring offset (world, m), unit scale
  attribute vec4 iSpringV;  // wobble spring velocity (world, m/s), hit flash
  attribute vec4 iAnim;     // walk phase, walk amount, attack phase, seed
  attribute vec4 iState;    // team, mode, mode time, mode param
  uniform float uHeight;
  uniform vec3 uNeck;
  uniform vec3 uHip;
  uniform float uAttackStyle;
  uniform float uFloppy;
`;

/**
 * The wobble. Order: limbs about their joints, head, pupils, waddle, whole-body bend along the
 * spring (weighted by height squared so the feet stay planted), squash and stretch, then the
 * fallback tumble / death flop / get-up poses, then scale, yaw and position.
 */
const LIVE_BODY = /* glsl */ `
  vec3 p = position;
  float part = aPart;
  float seed = iAnim.w;
  float walk = iAnim.x;
  float spd = iAnim.y;
  float atk = iAnim.z;
  float mode = iState.y;
  float mt = iState.z;
  float t = uTime + seed * 50.0;

  // Spring offset and velocity in the unit's local frame (undo the yaw).
  float cyw = cos(iPosYaw.w);
  float syw = sin(iPosYaw.w);
  vec3 sl = vec3(iSpring.x * cyw - iSpring.z * syw, iSpring.y, iSpring.x * syw + iSpring.z * cyw);
  vec3 vl = vec3(iSpringV.x * cyw - iSpringV.z * syw, iSpringV.y, iSpringV.x * syw + iSpringV.z * cyw);

  // Lean at head height: the spring plus an idle sway that never syncs across a crowd.
  vec2 lean = sl.xz + vec2(sin(t * 1.3), sin(t * 0.9 + 1.7)) * 0.025;

  // Attack curve. atk: 0 rest, 0..1 wind-up, 1..1.25 strike, 1.25..2 recovery.
  float swing = 0.0;    // forward rotation of the weapon arm (rad)
  float thrust = 0.0;   // forward push of the weapon arm (m)
  float sweep = 0.0;    // sideways rotation of the weapon arm (rad)
  float lunge = 0.0;    // whole-body forward pitch
  if (atk > 0.0) {
    float wind = atk < 1.0 ? 1.0 - (1.0 - atk) * (1.0 - atk) : 0.0;
    float shake = atk < 1.0 ? sin(uTime * 47.0 + seed * 9.0) * 0.05 * atk : 0.0;
    float hit = atk >= 1.0 && atk < 1.25 ? (atk - 1.0) / 0.25 : (atk >= 1.25 ? 1.0 : 0.0);
    float rec = atk >= 1.25 ? (atk - 1.25) / 0.75 : 0.0;
    float settle = (1.0 - rec) * (1.0 - rec);
    float wobbleBack = sin(rec * 11.0) * (1.0 - rec) * 0.35;
    if (uAttackStyle < 0.5) {
      // Overhead swing: big wind-up behind the head, slam with overshoot.
      if (atk < 1.0) swing = -2.6 * wind + shake;
      else if (atk < 1.25) swing = mix(-2.6, 1.6, hit * hit);
      else swing = 1.6 * settle + wobbleBack;
      lean.y += (atk < 1.0 ? -0.12 * wind : 0.22 * settle);
    } else if (uAttackStyle < 1.5) {
      // Thrust: pull back, then jab forward.
      swing = -0.25 + (atk < 1.0 ? -0.35 * wind : 0.25 * settle);
      if (atk < 1.0) thrust = -0.35 * wind + shake;
      else if (atk < 1.25) thrust = mix(-0.35, 0.6, hit);
      else thrust = 0.6 * settle + wobbleBack * 0.4;
      lean.y += thrust * 0.25;
    } else if (uAttackStyle < 2.5) {
      // Sweep: arm raised out to the side, then swung across the front.
      swing = 1.3 * (atk < 1.0 ? wind : settle) + 0.3;
      if (atk < 1.0) sweep = 1.5 * wind + shake;
      else if (atk < 1.25) sweep = mix(1.5, -1.8, hit);
      else sweep = -1.8 * settle + wobbleBack;
      lean.x += sweep * -0.06;
    } else if (uAttackStyle < 3.5) {
      // Lunge: the whole body throws itself forward.
      if (atk < 1.0) lunge = -0.25 * wind;
      else if (atk < 1.25) lunge = mix(-0.25, 0.9, hit);
      else lunge = 0.9 * settle + wobbleBack;
      swing = -lunge * 1.2;
    } else if (uAttackStyle < 4.5) {
      // Throw: arm back, then whip over the top.
      if (atk < 1.0) swing = -2.2 * wind + shake;
      else if (atk < 1.25) swing = mix(-2.2, 2.0, hit);
      else swing = 2.0 * settle + wobbleBack;
    } else {
      // Blast: squeeze the bellows.
      thrust = atk < 1.0 ? -0.15 * wind : (atk < 1.25 ? 0.25 : 0.25 * settle);
      swing = 0.2;
      lean.y += thrust * -0.6;
    }
  }

  float side = (part == 2.0 || part == 4.0 || part == 6.0) ? 1.0 : -1.0;

  // Legs: swing about the hip from the walk phase, with a little stumble.
  if (part == 4.0 || part == 5.0) {
    float ph = walk + (part == 4.0 ? 0.0 : 3.14159);
    float stumble = sin(walk * 0.5 + seed * 6.28 + side) * 0.2;
    float legSwing = (sin(ph) * 0.8 + stumble) * spd;
    vec3 q = p - aPivot;
    q = rotX(-legSwing) * q;
    q.y += max(0.0, cos(ph)) * 0.06 * spd;
    p = aPivot + q;
  }

  // Arms hang loose, swing opposite the legs with noise, and lag behind the lean.
  if (part == 2.0 || part == 3.0) {
    float ph = walk + (part == 2.0 ? 3.14159 : 0.0);
    float noise = sin(t * 2.3 + side * 1.7) * 0.14 + sin(t * 5.1 + side) * 0.05;
    float armSwing = sin(ph) * 0.6 * spd + noise * uFloppy - lean.y * 2.2 - vl.z * 0.06;
    float flap = 0.14 + abs(lean.x) * 0.8 + spd * 0.12 + 0.06 * sin(t * 3.1 + side) * uFloppy - side * lean.x * 0.9;
    if (part == 3.0 && atk > 0.0) {
      armSwing = swing + noise * 0.2;
      flap = 0.12 + abs(sweep) * 0.1;
    }
    if (part == 2.0 && uAttackStyle > 2.5 && uAttackStyle < 3.5) armSwing = swing;
    vec3 q = p - aPivot;
    if (part == 3.0) q.z += thrust;
    q = rotX(-armSwing) * q;
    q = rotZ(side * flap) * q;
    if (part == 3.0) q = rotY(sweep) * q;
    p = aPivot + q;
  }

  // Head: extra, slightly delayed wobble from the spring (velocity term adds the lag).
  if (part == 1.0 || part >= 6.0) {
    if (part >= 6.0) {
      // Pupils slide inside the eyeballs, driven by the same spring.
      vec2 look = vec2(-sl.x * 0.22, -sl.y * 0.35 - sl.z * 0.08) - vl.xy * 0.012;
      look += vec2(sin(t * 0.7 + side * 2.0), cos(t * 0.53 + side)) * 0.012;
      float ll = length(look);
      if (ll > 0.032) look *= 0.032 / ll;
      p.xy += look;
    }
    vec2 hl = lean * 1.5 - vl.xz * 0.06 + vec2(sin(t * 1.7), sin(t * 2.3)) * 0.03 * uFloppy;
    vec3 q = p - uNeck;
    q = rotZ(-hl.x * 1.3) * rotX(hl.y * 1.3) * q;
    p = uNeck + q;
  }

  // Waddle: the upper body rolls from side to side with each step, and bobs at twice the rate.
  if (part != 4.0 && part != 5.0) {
    float waddle = sin(walk) * 0.11 * spd;
    p = uHip + rotZ(waddle) * (p - uHip);
    p.y += abs(sin(walk)) * 0.07 * spd;
  }

  // Lunge pitches everything above the hips forward.
  if (lunge != 0.0 && part != 4.0 && part != 5.0) {
    p = uHip + rotX(lunge * 0.6) * (p - uHip);
  }

  // Bend the whole body along the spring: weight by height squared so feet stay planted.
  float h = clamp(p.y / uHeight, 0.0, 1.4);
  float bend = h * h;
  p.x += lean.x * bend;
  p.z += lean.y * bend;
  p.y -= (lean.x * lean.x + lean.y * lean.y) * bend * 0.35;

  // Squash and stretch from the spring's vertical component (strongest on landing).
  float sq = clamp(1.0 + sl.y * 1.6, 0.62, 1.3);
  p.y *= sq;
  p.xz *= inversesqrt(sq);

  // Fallback poses when no ragdoll is available.
  vec3 c = vec3(0.0, uHeight * 0.5, 0.0);
  if (mode > 0.5 && mode < 1.5) {
    // Shader-only tumble: spin about the body centre and flail every limb.
    float spin = mt * (7.0 + seed * 5.0);
    vec3 q = p - c;
    if (part >= 2.0 && part <= 5.0) {
      vec3 jp = aPivot - c;
      q = jp + rotX(sin(mt * 23.0 + part * 1.7 + seed * 9.0) * 1.3) * (q - jp);
    }
    q = rotX(spin) * rotZ(spin * (seed - 0.5) * 0.8) * q;
    p = c + q;
  } else if (mode > 1.5 && mode < 2.5) {
    // Shader-only death flop: topple backwards with a bounce, limbs splayed.
    float k = clamp(mt / 0.45, 0.0, 1.0);
    float fall = k < 1.0 ? k * k : 1.0;
    float bounce = mt > 0.45 ? exp(-(mt - 0.45) * 7.0) * sin((mt - 0.45) * 18.0) * 0.18 : 0.0;
    float ang = (1.5708 + bounce) * fall;
    if (part >= 2.0 && part <= 5.0) {
      vec3 jp = aPivot;
      p = jp + rotZ(side * 0.9 * fall) * (p - jp);
    }
    if (part >= 6.0) p.y += 0.02 * fall;
    p = rotX(-ang * (iState.w > 0.5 ? -1.0 : 1.0)) * p;
    p.y += 0.22 * fall;
  } else if (mode > 2.5 && mode < 3.5) {
    // Shader-only getting up: the reverse of the flop.
    float k = clamp(iState.w, 0.0, 1.0);
    float ang = 1.5708 * (1.0 - k * k * (3.0 - 2.0 * k));
    p = rotX(-ang) * p;
    p.y += 0.22 * (1.0 - k);
  }

  vec3 transformed = p * iSpring.w;
  transformed = vec3(transformed.x * cyw + transformed.z * syw, transformed.y, -transformed.x * syw + transformed.z * cyw);
  transformed += iPosYaw.xyz;
  // Mode 4: hidden (a ragdoll is standing in for this unit).
  if (mode > 3.5) transformed = vec3(0.0, -10000.0, 0.0);
  #ifdef USE_COLOR
    vColor.rgb = teamTint(vColor.rgb, iState.x, aTint);
    vColor.rgb = mix(vColor.rgb, vec3(1.0, 0.97, 0.9), iSpringV.w * 0.4);
  #endif
`;

const POSED_PARS = /* glsl */ `
  attribute vec4 iPose;   // pose row, which texture (0 active, 1 corpse), team, sink depth
  uniform sampler2D uPoseActive;
  uniform sampler2D uPoseCorpse;
  uniform vec3 uCenters[6];
  vec3 quatRotate(vec4 q, vec3 v) {
    vec3 u = q.xyz;
    return v + 2.0 * cross(u, cross(u, v) + q.w * v);
  }
`;

const POSED_BODY = /* glsl */ `
  int bp = int(aPart + 0.5);
  if (bp >= 6) bp = 1;
  int row = int(iPose.x + 0.5);
  vec4 tp;
  vec4 tq;
  if (iPose.y < 0.5) {
    tp = texelFetch(uPoseActive, ivec2(bp * 2, row), 0);
    tq = texelFetch(uPoseActive, ivec2(bp * 2 + 1, row), 0);
  } else {
    tp = texelFetch(uPoseCorpse, ivec2(bp * 2, row), 0);
    tq = texelFetch(uPoseCorpse, ivec2(bp * 2 + 1, row), 0);
  }
  vec3 local = position;
  if (aPart > 5.5) local.y += 0.015;
  vec3 transformed = tp.xyz + quatRotate(tq, (local - uCenters[bp]) * uScale);
  transformed.y -= iPose.w;
  #ifdef USE_COLOR
    vColor.rgb = teamTint(vColor.rgb, iPose.z, aTint);
  #endif
`;

function teamUniforms(): { uTeamBlue: { value: Vector3 }; uTeamRed: { value: Vector3 } } {
  const b = new Color(TEAM_COLORS.blue);
  const r = new Color(TEAM_COLORS.red);
  return { uTeamBlue: { value: new Vector3(b.r, b.g, b.b) }, uTeamRed: { value: new Vector3(r.r, r.g, r.b) } };
}

/** Shared time uniform so every unit material animates from one clock. */
export const unitTime = { value: 0 };

type Uniforms = Record<string, { value: unknown }>;

function inject(m: Material, uniforms: Uniforms, pars: string, body: string, key: string): void {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + COMMON + pars)
      .replace('#include <begin_vertex>', body);
  };
  m.customProgramCacheKey = () => key;
}

function liveUniforms(layout: BodyLayout, scale: number, attackStyle: number, floppy: number): Uniforms {
  return {
    ...teamUniforms(),
    uTime: unitTime,
    uScale: { value: scale },
    uHeight: { value: layout.height },
    uNeck: { value: layout.neck.clone() },
    uHip: { value: layout.hip.clone() },
    uAttackStyle: { value: attackStyle },
    uFloppy: { value: floppy },
  };
}

function posedUniforms(layout: BodyLayout, scale: number, poseActive: DataTexture, poseCorpse: DataTexture): Uniforms {
  return {
    ...teamUniforms(),
    uTime: unitTime,
    uScale: { value: scale },
    uPoseActive: { value: poseActive },
    uPoseCorpse: { value: poseCorpse },
    uCenters: { value: layout.parts.map((p) => p.center.clone()) },
  };
}

/** Wobbly living units. Also returns the matching depth material for the optional shadow map. */
export function createLiveMaterial(
  layout: BodyLayout,
  scale: number,
  attackStyle: number,
  floppy: number,
): { material: MeshLambertMaterial; depth: MeshDepthMaterial } {
  const u = liveUniforms(layout, scale, attackStyle, floppy);
  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  inject(material, u, LIVE_PARS, LIVE_BODY, 'unit-live');
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  inject(depth, u, LIVE_PARS, LIVE_BODY, 'unit-live-depth');
  return { material, depth };
}

/** Ragdolls and corpses posed from the pose textures. */
export function createPosedMaterial(
  layout: BodyLayout,
  scale: number,
  poseActive: DataTexture,
  poseCorpse: DataTexture,
): { material: MeshLambertMaterial; depth: MeshDepthMaterial } {
  const u = posedUniforms(layout, scale, poseActive, poseCorpse);
  const material = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  inject(material, u, POSED_PARS, POSED_BODY, 'unit-posed');
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  inject(depth, u, POSED_PARS, POSED_BODY, 'unit-posed-depth');
  return { material, depth };
}
