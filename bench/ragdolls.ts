/**
 * Ragdoll physics benchmark: `npm run bench:ragdolls` (Node 22+).
 * Times the main-thread ragdoll system (Rapier) with each quality tier's budget of ragdolls
 * tumbling across the real terrain mesh. Purely CPU; no rendering.
 */
import { getMap } from '../src/data/maps.ts';
import { UNITS } from '../src/data/units.ts';
import { QUALITY_PRESETS } from '../src/platform/quality.ts';
import { loadRapier, RagdollSystem, type UnitPoses } from '../src/render/ragdolls.ts';
import { buildTerrainMesh } from '../src/render/terrain-mesh.ts';
import { buildUnitModel } from '../src/render/unit-model.ts';
import { S_DEAD } from '../src/sim/constants.ts';
import { createTerrain } from '../src/sim/terrain.ts';

const mapId = process.argv[2] ?? 'meadow';
const R = await loadRapier();
const def = getMap(mapId);
const terrain = createTerrain(def);
const mesh = buildTerrainMesh(terrain, def.palette, def.seed);
const layouts = UNITS.map((d) => buildUnitModel(d).layout);
const scales = UNITS.map((d) => d.visual.scale);

console.log(`Ragdoll benchmark on ${mapId}: terrain collider ${mesh.physicsIndices.length / 3} triangles`);
for (const tier of ['low', 'medium', 'high'] as const) {
  const q = QUALITY_PRESETS[tier];
  const n = q.ragdollBudget;
  const sys = new RagdollSystem(n, q.corpseCap);
  sys.attachPhysics(R);
  const t0 = performance.now();
  sys.setTerrain(mesh.physicsVertices, mesh.physicsIndices, terrain.killY);
  const build = performance.now() - t0;
  const types = new Uint8Array(n);
  const teams = new Uint8Array(n);
  sys.setBattle(n, types, teams, layouts, scales);
  const f = () => new Float32Array(n);
  const poses: UnitPoses = { x: f(), y: f(), z: f(), yaw: f(), vx: f(), vy: f(), vz: f(), state: new Uint8Array(n).fill(S_DEAD), progress: f() };
  for (let i = 0; i < n; i++) {
    poses.x[i] = -20 + (i % 8) * 5;
    poses.z[i] = -15 + Math.floor(i / 8) * 5;
    poses.y[i] = 2;
    sys.spawn(i, true, poses, 6, 8, (i % 3) - 1, 0);
  }
  // Time frames at 60 fps: each frame steps the 60 Hz physics once.
  const times: number[] = [];
  let now = 0;
  for (let frame = 0; frame < 150; frame++) {
    now += 1 / 60;
    const s = performance.now();
    sys.update(1 / 60, poses, now);
    times.push(performance.now() - s);
  }
  const live = times.slice(0, 60);
  const mean = live.reduce((a, b) => a + b, 0) / live.length;
  const sorted = [...live].sort((a, b) => a - b);
  console.log(
    `  ${tier.padEnd(6)} ${String(n).padStart(2)} ragdolls flying: mean ${mean.toFixed(3)} ms, p95 ${sorted[Math.floor(live.length * 0.95)].toFixed(3)} ms, max ${sorted[sorted.length - 1].toFixed(3)} ms per frame; collider build ${build.toFixed(1)} ms; still active after 2.5 s: ${sys.activeRagdolls}`,
  );
  sys.dispose();
}
