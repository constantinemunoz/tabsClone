# Decisions

Choices the brief did not settle, one or two lines each.

- **Library versions**: three 0.186.1, @dimforge/rapier3d-compat 0.21.0, vite 8.3.2, vitest 5.0.3,
  typescript 7.0.2 (latest stable at the time of writing).
- **Rapier package**: `rapier3d-compat` (WASM inlined as base64) so it needs no bundler WASM plugin;
  it is loaded with a dynamic `import()` so it lands in its own lazily-fetched chunk.
- **Benchmark runner**: `npm run bench` uses Node 22's built-in TypeScript type stripping, so there
  is no extra runner dependency. Consequence: imports use explicit `.ts` extensions and the code
  avoids non-erasable syntax (no enums, no parameter properties); `erasableSyntaxOnly` enforces it.
- **Coordinates**: y up, metres. Play area x in [-60, 60], z in [-40, 40]. Blue deploys on -x, red on +x.
- **Terrain sampling matches the mesh**: each heightmap cell is split into two triangles along a
  checkerboard-alternating diagonal, and the sim interpolates on those same triangles, so feet sit
  exactly on the drawn ground and the island coastline in the sim equals the drawn coastline.
- **Terrain grid**: 2 m cells. Chunkier facets read as low-poly and keep the mesh near 17k triangles.
- **Sky island edge**: the island has a mask field; the render mesh clips grid triangles against the
  mask's zero contour (marching triangles) for a smooth coastline, and hangs a rocky skirt below it.
  The sim treats negative mask as void (no ground: units fall to the kill plane).
- **Mesas**: map is mirrored across x = 0 for fairness; cliffs rise over 1.6 m (well above 45 deg),
  with two ramp wedges per side that are walkable.
- **UI typeface**: a system font stack (rounded where the OS has one) declared once in CSS, so no
  font file or licence is involved.
- **Static hosting**: Vite `base: './'` so the build works from a domain root or any subfolder.
- **Quality auto-detect**: from the unmasked GPU renderer string, core count and device memory.
  Software renderers (SwiftShader, llvmpipe) and mobile GPUs start on low.
