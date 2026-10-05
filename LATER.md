# Later

Ideas that are outside the brief's scope. Not built.

- Touch controls (pinch zoom, two-finger orbit, tap to place).
- Switch to the non-compat Rapier build with a separate `.wasm` file (needs a WASM bundler
  plugin) to shrink the lazily loaded chunk (now 1.67 MB gzipped because the WASM is base64).
- Joint limits on ragdolls for less rubbery limbs.
- Weapon trails and simple weapon-body clipping avoidance.
