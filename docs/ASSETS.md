# Replacing the placeholder with official Calmlings assets

The character is the official Calmling still (`public/assets/calmling/calmling.png`,
background removed). `manifest.json → character.image` gives its size, eye
positions (for drawn blinking eyelids) and eyelid colour. The renderer animates
the still with breathing, squash, tilt and bob. If `image` is removed, it falls
back to the procedural placeholder. The simulation never
references any visual asset, so official art can be dropped in without
touching the simulation, database or API.

## 1. 2D sprite sheets (Phaser renderer, no code changes)

Put files in `apps/web/public/assets/` and list them in
`apps/web/public/assets/manifest.json`:

```json
{
  "version": 1,
  "character": {
    "placeholder": false,
    "label": "",
    "scale": 1,
    "anchor": { "x": 0.5, "y": 1 },
    "animations": {
      "idle":     { "url": "/assets/calmling/idle.png",     "frameWidth": 256, "frameHeight": 256, "frames": 24, "frameRate": 12 },
      "walking":  { "url": "/assets/calmling/walk.png",     "frameWidth": 256, "frameHeight": 256, "frames": 16, "frameRate": 16 },
      "sleeping": { "url": "/assets/calmling/sleep.png",    "frameWidth": 256, "frameHeight": 256, "frames": 32, "frameRate": 8 },
      "drinking_tea": { "url": "/assets/calmling/tea.png",  "frameWidth": 256, "frameHeight": 256, "frames": 30, "frameRate": 12 }
    }
  },
  "objects": {
    "teddy_bear": { "url": "/assets/objects/teddy.png" }
  },
  "environment": {}
}
```

Animation keys are the `AnimationId`s in `packages/core/src/types.ts`
(idle, breathing, blinking, looking_around, walking, sitting, sleeping,
waking_up, stretching, picking_up, carrying, inspecting, react_happy,
react_curious, react_surprised, drinking_tea, eating, gardening, watering,
painting, reading, fishing, dancing, watching_sunset, resting, hugging,
playing, photographing, waving). Object keys are object kinds from
`packages/core/src/world.ts`.

Status: the manifest loader, sprite-sheet preloading, animation creation and
per-object image substitution are implemented. **The swap from the procedural
body to a sprite for character clips is not yet wired**: `PhaserRenderer`
loads `anim_<id>` animations but still draws the procedural body. Finishing it
means adding a `Sprite` to the character container and calling
`sprite.play('anim_' + animation)` in `poseCharacter` when the clip exists.
This is a short change once real sheets exist to test against.

## 2. Rigged 3D / Unity / Godot

Implement `CalmlingRenderer` (`apps/web/game/types.ts`). Each frame it receives:

- the authoritative public frame (character position, activity, world objects, weather, time)
- an `AnimationCommand` from `resolveAnimation()` in `@calmling/core`
  (clip id, intro/loop/outro stage, progress 0–1, duration, props, interruptibility)

The command is deterministic from state, so every viewer — and a future
headless broadcast renderer — shows the same pose, including people who join
late. Map each `AnimationId` to a rigged clip and use `progress` to seek.
