# Character skins

`models/gladiator.glb` is the fighter skin — a Mixamo "X Bot" that was split in
Blender into separate, origin-centred meshes named per body part (`torso`,
`head`, `upper_arm_l/r`, `lower_arm_l/r`, `upper_leg_l/r`, `lower_leg_l/r`, plus
`sword_blade`/`sword_guard`). It came from the sibling `gladiator-web` repo.

`src/skin.js` (`GlbAvatar`) loads it and swaps each box mesh for the matching
GLB mesh; the ragdoll's `syncMeshes` then poses them from physics every frame —
no skeleton/bone driving needed. Both fighters use this one model, tinted per
side (player gold, enemy red). If a part is missing or the load fails, that
fighter falls back to its box meshes.

## Using a second, distinct model
Drop another GLB here (same per-part mesh names) and point one fighter at it in
`Game.start()`:

    new GlbAvatar(this.scene, this.enemy, { url: '/models/other.glb', tint: 0x6b1e1e })

## Calibration knobs (`GlbAvatar` options)
- `tint`    — emissive team colour (null = use the model's own materials).
- `faceYaw` — extra Y rotation if the character faces the wrong way.
- `url`     — which GLB to load.
