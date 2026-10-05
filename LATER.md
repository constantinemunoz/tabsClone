# Later

Ideas that are outside the brief's scope. Not built.

- Touch controls (pinch zoom, two-finger orbit, tap to place).
- Switch to the non-compat Rapier build with a separate `.wasm` file (needs a WASM bundler
  plugin) to shrink the lazily loaded chunk (now 1.67 MB gzipped because the WASM is base64).
- Joint limits on ragdolls for less rubbery limbs.
- Weapon trails and simple weapon-body clipping avoidance.
- Water and boats, where Marines would get their "good on boats" bonus.
- A flow field for `desiredDirection` so units use the mesa ramps instead of stalling at cliffs.
- Optional hit-and-run for horsemen (ride through after a charge, then charge again).
- Arrows and javelins that stick in bodies, not only in the ground.
