# Progress

## Done
- **M1 Skeleton**: Vite + TypeScript project; Three.js scene with gradient sky dome, fog matched
  to the horizon, directional + hemisphere light; flat-shaded vertex-coloured terrain built from
  a generated heightmap (meadow, plus early versions of the mesas and sky island); free camera
  (WASD, drag to orbit, wheel zoom, clamped); developer overlay (` or F3); quality-tier
  auto-detection; WebGL2 check with a friendly message; render loop stops while the tab is hidden.
  Tests: sim terrain height matches the rendered triangles on all three maps.

- **M2 Sim core**: pure-TypeScript simulation over typed arrays (`src/sim`), running in a module
  Web Worker at a fixed 30 Hz. Spatial hash (counting sort, rebuilt per tick), staggered
  targeting with an outward ring search, the full state machine, steering through one
  `desiredDirection` function, terrain following with the 45 degree slope limit, falling and kill
  plane, mass-weighted separation, melee arcs resolved on the strike tick, knockback and tumbling,
  deaths, win check and the 20 s stalemate rule. Snapshots go to the main thread in pooled,
  transferred buffers; the renderer interpolates the two latest. Units are drawn as instanced
  capsules (one draw call per type). Five melee archetypes exist as data already (Scrapper,
  Bulwark, Pikeling, Rammer, Big Lump). Dev battles from URL parameters; `?stress=N`.
  Measured: `npm run bench` 150 v 150 on the meadow, busy-stretch tick mean 0.33 ms, p99 1.24 ms
  (Node 22, this container). In the browser (SwiftShader), a 150 v 150 battle ran to "Blue wins"
  at tick 1854 with no errors; the worker allocated 5 snapshot buffers in total.

- **M3 Wobble and ragdolls**: procedural unit bodies (rounded torso, round head, stubby limbs,
  googly eyes with sliding pupils, a hat and a weapon per type; 790-930 triangles each, indexed).
  The wobble lives in the vertex shader: walk cycle with stumble and waddle, body bend weighted
  by height squared along a per-unit damped spring, delayed head wobble, arms that lag the lean,
  squash and stretch, idle sway, and per-style attack curves (overhead swing, spear thrust,
  giant sweep, charger lunge). Springs are driven on the main thread by acceleration, hits,
  landings and swings. Rapier ragdolls (six bodies, ball joints) for deaths and tumbles under the
  tier budget, root-pulled to the sim capsule while tumbling, blending back to standing on
  get-up, freezing into corpses at rest; the corpse cap sinks the oldest. Shader-only tumble,
  flop and get-up fallbacks when the budget is spent (flops fly on a cheap ballistic arc).
  Instanced blob shadows. A temporary test-battle panel (presets, map picker, controls).
  Measured: `npm run bench:ragdolls` (Node, meadow) 8 / 24 / 48 ragdolls in flight cost
  0.45 / 0.91 / 1.14 ms mean per frame (p95 0.73 / 1.68 / 1.75 ms). In the browser at 300 units
  the unit update (springs, interpolation, instance writes) measured 0.25 ms mean before any
  ragdolls were active; browser numbers here run on SwiftShader with a contended CPU.

- **M4 Full 3D combat**, with the roster replaced at the user's request by eight ancient Greek
  units: Hoplite, Spartan, Peltast, Skirmisher, Archer, Slinger, Horseman and Marine.
  Projectiles are pooled typed arrays launched on ballistic arcs (leading the target, seeded
  spread) with swept-segment hits against terrain and unit capsules; area damage with falloff
  and per-weapon friendly fire is in the engine. Units can carry a sidearm (used when out of
  ammo, when an enemy is inside its reach, or for a Spartan when too close for the spear),
  ammunition per unit (Peltasts 2-3 javelins, Marines 1-2), armour classes, a shield wall for
  Hoplites (less damage and knockback per Hoplite standing beside them, shields visibly raised),
  slinger bullets that do 2.4x against heavy armour, a Horseman charge (4.5x damage, big launch)
  with flank damage and a flanking path, and height-aware ranged reach. Flying units still work
  in the engine (tested with a made-up flyer); no current unit flies. A cliff-creep bug was found
  and fixed (slope is now measured over a fixed probe distance). New procedural kit: Corinthian
  helmets, aspis shields with team emblems, javelins, bows, slings, a horse and rider. Projectiles
  render instanced per kind; arrows and javelins stick in the ground for a while.
  Measured: `npm run bench` 150 v 150 meadow, busy-stretch tick mean 0.38 ms, p99 1.30 ms; sky
  island mean 0.43 ms, p99 2.12 ms. Tests: 41 pass, including every unit type dealing damage on
  every map. An equal-cost round robin (2 seeds, both sides) has each unit winning 29-71% of
  match-ups.

## Next
- M5 Game loop: menu, placement with a budget, ten campaign levels, sandbox, results, saving,
  share links.

## Known issues
- Units walk in straight lines, so on the mesas melee units drop into the canyon and stand at the
  foot of the far cliff instead of using the ramps. A flow field (the brief's planned upgrade
  for `desiredDirection`) would fix this.
- Mirror battles have so far favoured blue slightly (20-12 over 32 battles); not conclusive,
  to re-check with a larger sample in M7.
- Weapons clip through bodies (no visual collision); the spear especially.
- After a shader-only tumble (ragdoll budget spent), the get-up starts from a lying pose, so the
  landing pose pops. Ragdoll tumbles blend properly.
- Ragdolls use unconstrained ball joints, so limbs can bend unnaturally far (intentionally floppy).
- The test-battle panel is temporary and is replaced by the real menus in M5.
- The horizon band below the sky on the meadow and mesas (far ground plane through fog) is a bit
  muddy; revisit in the polish milestone.
- Browser frame rates measured in this container use SwiftShader (software WebGL), so they say
  nothing about real GPUs.
