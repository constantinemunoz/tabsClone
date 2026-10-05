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

## Next
- M3 Wobble and ragdolls.

## Known issues
- The horizon band below the sky on the meadow and mesas (far ground plane through fog) is a bit
  muddy; revisit in the polish milestone.
- Browser frame rates measured in this container use SwiftShader (software WebGL), so they say
  nothing about real GPUs.
