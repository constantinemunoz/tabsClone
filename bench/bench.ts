/**
 * Headless simulation benchmark: `npm run bench` (Node 22+, runs the TypeScript directly).
 * Builds an N-vs-N battle and times every tick of the pure simulation, as it runs in the worker.
 *
 *   npm run bench                 # 150 vs 150 on the meadow
 *   npm run bench -- 250 island   # 250 vs 250 on the sky island
 */
import { stressSetup } from '../src/data/army-gen.ts';
import { Sim } from '../src/sim/sim.ts';
import { RESULT_BLUE, RESULT_RED, RESULT_RUNNING } from '../src/sim/constants.ts';

const perSide = Number(process.argv[2] ?? 150);
const mapId = process.argv[3] ?? 'meadow';
const maxTicks = 30 * 300;

function stats(xs: number[]): { mean: number; p50: number; p95: number; p99: number; max: number } {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { mean: xs.reduce((a, b) => a + b, 0) / xs.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s[s.length - 1] };
}

function fmt(v: number): string {
  return v.toFixed(3).padStart(7);
}

// Warm up the JIT on a throwaway battle so the measured run reflects steady-state code.
{
  const warm = new Sim(stressSetup(perSide, mapId, 1));
  for (let k = 0; k < 600 && warm.result === RESULT_RUNNING; k++) warm.step();
}

const setup = stressSetup(perSide, mapId, 12345);
const sim = new Sim(setup);
const times: number[] = [];
const alive: number[] = [];
while (sim.tick < maxTicks) {
  const t0 = performance.now();
  sim.step();
  times.push(performance.now() - t0);
  alive.push(sim.alive[0] + sim.alive[1]);
  if (sim.result !== RESULT_RUNNING && sim.tick > 30) break;
}

const all = stats(times);
// The busiest stretch: ticks while at least 80% of the armies are still alive.
const busy = times.filter((_, k) => alive[k] >= setup.units.length * 0.8);
const b = busy.length > 0 ? stats(busy) : all;
const winner = sim.result === RESULT_BLUE ? 'blue' : sim.result === RESULT_RED ? 'red' : sim.result === RESULT_RUNNING ? 'unfinished' : 'draw';

console.log(`Battle Sim headless benchmark`);
console.log(`  map ${mapId}, ${perSide} vs ${perSide} (${setup.units.length} units), node ${process.version}`);
console.log(`  ran ${sim.tick} ticks (${(sim.tick / 30).toFixed(1)} s of battle), result: ${winner}, survivors: ${sim.alive[0]} blue / ${sim.alive[1]} red`);
console.log(`  tick ms               mean     p50     p95     p99     max`);
console.log(`  all ticks          ${fmt(all.mean)} ${fmt(all.p50)} ${fmt(all.p95)} ${fmt(all.p99)} ${fmt(all.max)}`);
console.log(`  >=80% alive (${String(busy.length).padStart(4)}) ${fmt(b.mean)} ${fmt(b.p50)} ${fmt(b.p95)} ${fmt(b.p99)} ${fmt(b.max)}`);
console.log(`  budget: < 4 ms per tick at 300 units -> ${b.p99 < 4 ? 'met' : 'NOT met'} (p99 of the busy stretch)`);
