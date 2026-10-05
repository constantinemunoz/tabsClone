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
- **Who drives the clock**: the main thread. Each frame it advances `simTime` by real time x speed
  and asks the worker for the ticks now due (at most 4 per frame; extra time is dropped so a slow
  machine slows the battle). It renders one tick behind the previous frame's `simTime`, which is
  always between the two latest snapshots once the worker has answered.
- **Snapshot transport**: one ArrayBuffer per tick (header, units, projectiles, events), transferred
  and returned with the next step request. The only per-tick allocation left is the small
  `Float32Array` view wrapper a transferred buffer needs, which the transfer API makes unavoidable.
- **Who retargets**: only units in Idle or Seek; a unit mid-swing keeps its target.
- **Melee reach**: a melee unit only starts a wind-up if its weapon can reach the target
  vertically, so units below a cliff don't swing at people standing on top of it.
- **Variety without chaos**: hits deal 90-110% of listed damage (seeded RNG), and each unit's first
  swing is delayed by 0-11 ticks so crowds never attack in lockstep.
- **Tumbling**: a hit tumbles its target when the velocity change exceeds 5.5 m/s. Gravity is
  18 m/s^2. A killing blow does not set Tumbling; the death event carries the launch velocity.
- **Map edges**: on maps without void, units are kept inside the heightmap domain. On the sky
  island they simply fall.
- **Extra event type**: `strike` (a swing or shot happened), alongside the brief's list, for swish
  sounds and the body lurch.
- **Unit order**: the five melee archetypes are defined as data in M2 (tests use them); their
  procedural looks arrive in M3, the other five units in M4.
- **Wobble spring units**: a 3D offset in metres at head height of a 1.6 m unit, kept in world
  space on the main thread; the shader rotates it into the unit's frame. Locomotion drives it
  with minus the per-tick velocity change, clamped to 1.2 m/s, so knockback (which is a big
  velocity jump) is driven by the hit event instead and the upper body moves with the blow.
- **Hit flash**: proportional to damage over max health, so chip damage on a giant barely shows.
- **Unit meshes stay indexed**: flat shading comes from screen-space derivatives, so shared
  vertices don't smooth anything, and the wobble shader runs about 4x fewer times per unit.
- **Two materials per unit type**: live (wobble) and posed (ragdoll/corpse parts from a float
  texture). Each gets a matching depth material so the optional shadow map deforms too.
- **Pose textures**: one small texture for active ragdolls (fully re-uploaded per frame, at most
  64 rows x 12 texels) and one for frozen corpses (uploaded only when a corpse is added).
  three's per-range texture updates allocate per range, so they aren't used.
- **Ragdoll budget policy**: a death may take a tumbling unit's ragdoll (that unit continues
  with the shader tumble); in-flight death ragdolls are never frozen early, because that leaves
  bodies hanging in mid-air. Without a slot, a death uses the shader flop, which flies a simple
  ballistic arc from the death velocity before toppling.
- **Ragdolls freeze** when at rest, at 3 s if moving slowly, or at 6 s regardless; below the kill
  plane they are discarded. Physics steps at 60 Hz, at most 2 substeps per frame.
- **Physics warm-up**: the first Rapier steps are slow (WASM tier-up), so a throwaway body is
  dropped when the terrain collider is built. Measured: the first-death spike went from 80 ms
  to none; the one-off cost moved to loading.
- **Ragdoll collider**: a trimesh of the walkable terrain mesh (plus the top band of island
  cliffs), shared with the renderer's data so ragdolls rest exactly on the drawn ground.
- **Skin is not team-tinted**: tinted skin looked muddy. Team colour is on clothes and limbs.
- **Temporary dev panel**: preset battles and a map picker until the real menus exist (M5).
- **Hosted play-test build** (`npm run build:hosted`, output in `dist-hosted/`): for hosts that only
  allow scripts from public CDNs, three and Rapier are imported from pinned jsDelivr URLs and the
  game's own code ships unminified. The normal `npm run build` stays fully self-contained.
  Where a host forbids WebAssembly compilation, Rapier fails to load, the game falls back to the
  shader-only ragdolls, and the test panel says so.
- **Roster**: replaced the brief's ten archetypes with the user's eight Greek units. Flyers, area
  damage, cone attacks and minimum range remain as tested engine features without a unit using
  them. "Hoplite" and "Archer" also exist as TABS unit names; they are generic historical words
  and were the user's explicit choice. Marines are "good on boats" in the request; the game has
  no water, so that is in LATER.md.
- **Armour classes**: none / light / heavy. Heavy: Hoplite, Spartan, Marine. Light: Peltast,
  Horseman. None: Skirmisher, Archer, Slinger. Weapons can carry a damage multiplier per class
  (only sling bullets use one: 2.4x against heavy).
- **Shield wall**: counts same-type allies within 2.4 m that stand beside the unit (the angle to
  them is more than about 53 degrees off its facing), up to 3. Each cuts damage by 12% and
  knockback by about 10%. Allies directly in front or behind don't count, so a line beats a blob.
- **Shields**: a shield cuts damage from the front 120 degrees (projectiles included) and 40% of
  the knockback; flank hits (outside the front 160 degrees) take the weapon's flank multiplier.
- **Sidearms**: a unit's main weapon gives way to its sidearm when out of ammo, when an enemy is
  inside 1.3x the sidearm's reach (ranged mains), or inside the sidearm's reach (melee mains).
  The drawn weapon is a unit flag, so the model shows the right gear.
- **Horseman**: prefers ranged targets, rides out to the flank (the battle line runs along x, so
  it aims at a point offset in z, shrinking as it closes), and its first hit after a 10 m run-up
  does 4.5x damage with 5x knockback. Ordinary melee is weak, as asked; no hit-and-run.
- **Horse animation**: front legs and back legs move as the two leg parts, giving a bounding
  gallop; the horse falls on its side in the shader-only death flop.
- **Ranged reach and height**: effective range grows by 0.8 m per metre the shooter stands above
  the target (up to +40%) and shrinks when shooting uphill (down to -30%).
- **Balance method**: equal-cost round robin in Node (single-type armies, 450 cost a side,
  two seeds, both sides). Tuned costs until every unit wins some match-ups: Hoplite 45,
  Spartan 70, Peltast 32, Skirmisher 16, Archer 36, Slinger 36, Horseman 50, Marine 46.
- **Slope rule**: walkability is judged over a fixed 0.4 m probe ahead, not the tick's step, so a
  slowly accelerating unit can't creep up a cliff a centimetre at a time.
- **Shield emblem in team colour**: shields are the biggest thing in a phalanx, so a small team-
  coloured centre disc helps tell sides apart; the rest of the gear stays neutral.
- **No campaign**: the user asked to skip the ten-level campaign. The menu has Sandbox, Open a
  shared battle and Settings; the result screen has no Next Level button; there is no campaign
  progress to save.
- **Budget without a campaign**: the sandbox defaults to no budget (as the brief's sandbox), with
  an optional per-side limit (300 to 2500). The counters always show what each side has spent.
- **Share format**: version byte, map index, u32 seed, u16 count, then 3 bytes per unit
  (type and team, x, z in whole metres), base64url without padding. Only URL-safe characters,
  so it also survives hosts that pass nothing but plain #anchors. The dialog shows the code as
  well as the link, because a page inside a host's frame can't know its outer URL; the menu can
  open a pasted code.
- **Seeds**: a battle started from an unchanged shared (or just-shared) placement uses that
  seed, so it replays exactly; any edit gets a fresh random seed. Replay reuses the seed.
- **Saving**: settings and the sandbox (map, budget, units) go to localStorage through the guarded
  wrapper, saved 0.4 s after the last change.
- **UI identity**: Greek pottery palette (parchment, black-figure ink, terracotta, bronze) with a
  meander band on panels, one system typeface, 180 ms fades between screens. Unit cards show
  portraits rendered from the real unit meshes at start-up, in the selected side's colours.
- **Clicks reach the battlefield** unless they land on an actual control: the UI layer is
  pointer-transparent except for panels, buttons and dialogs.
- **Placement view**: placed units are drawn with the same wobble shader (idle sway) in their own
  instanced batches, plus a pale ghost of the unit under the cursor when the spot is valid.
- **Human proportions** (after M5, at the user's request: the big-headed, googly-eyed bodies read
  as cartoon mascots): bodies are about seven heads tall, with a shaped torso (a lathe:
  shoulders wider than the waist), a neck, two-segment arms and legs with elbows and knees baked
  into the rigid parts, a small face (dark eyes, brows, nose, ears) and per-type outfits (bronze
  or linen cuirass, greaves, beards, Scythian trousers). The comedy now comes from the wobble,
  not the proportions. The rig is unchanged (six rigid parts, same pivots, same ragdoll bodies),
  so animation, ragdolls and corpses needed only new sizes.
- **Team colour on the new bodies**: tunic, skirt and sleeves stay team-coloured, armour hides
  the chest, so hoplite-type shields are painted in the team colour (with a bronze rim and boss)
  and the horse wears a team-coloured saddle cloth down both flanks.
- **Walk cycle for long legs**: hip swing is a per-material amplitude (0.5 rad for people, 0.8
  for horses) and the default stride is 1.7 m per cycle, so feet don't skate.
