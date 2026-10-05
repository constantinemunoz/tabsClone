# Progress

## Done
- **M1 Skeleton**: Vite + TypeScript project; Three.js scene with gradient sky dome, fog matched
  to the horizon, directional + hemisphere light; flat-shaded vertex-coloured terrain built from
  a generated heightmap (meadow, plus early versions of the mesas and sky island); free camera
  (WASD, drag to orbit, wheel zoom, clamped); developer overlay (` or F3); quality-tier
  auto-detection; WebGL2 check with a friendly message; render loop stops while the tab is hidden.
  Tests: sim terrain height matches the rendered triangles on all three maps.

## Next
- M2 Sim core.

## Known issues
- The horizon band below the sky on the meadow and mesas (far ground plane through fog) is a bit
  muddy; revisit in the polish milestone.
- Browser frame rates measured in this container use SwiftShader (software WebGL), so they say
  nothing about real GPUs.
