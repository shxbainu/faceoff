# Handoff: skater and goalie model work (2026-11-18)

Latest commits: `467deb0` real goalie gear, `475d6d5` goalie groundwork, `a9b05a5` stick IK, `e77c17f` hits and
stick drops. Everything is committed and pushed.

## How the skater GLB is built (Blender, via the MCP for Blender)

One file, `assets/models/skater.glb`, holds the skater, its clips and the goalie gear. It is rebuilt from scripts in
`assets/src/skater/`, run inside the live Blender scene in this order (the .blend is never saved):

1. `build_outfit.py` → `build_visor.py` → `pose_ready.py` → `rig_controls.py` → `animate.py`
2. `import_goalie_gear.py` (it runs `build_goalie_gear.py` first for helpers and placeholder pieces, then replaces
   them with the real Sketchfab gear)
3. `export_glb.py`

The snippet used every time (clears the old rig controls first):

```python
import bpy
SKDIR='/Users/brianyao/claude-web-game/assets/src/skater/'
arm=bpy.data.objects['Armature']
if arm.animation_data:
    arm.animation_data.action=None
    for tr in list(arm.animation_data.nla_tracks): arm.animation_data.nla_tracks.remove(tr)
for pb in arm.pose.bones:
    for c in list(pb.constraints): pb.constraints.remove(c)
for n in ('stick_ctl','hand_tgt_l','hand_tgt_r','foot_tgt_l','foot_tgt_r','knee_pole_l','knee_pole_r','pads_pair'):
    o=bpy.data.objects.get(n)
    if o: bpy.data.objects.remove(o)
for o in [o for o in bpy.data.objects if o.name.startswith('g_')]: bpy.data.objects.remove(o)
for o in bpy.data.objects:
    if o.name in ('helmet3','visor_half','stick'): o.hide_set(False)
for f in ('build_outfit.py','build_visor.py','pose_ready.py','rig_controls.py','animate.py','import_goalie_gear.py'): exec(open(SKDIR+f).read())
# then, in a separate call: exec(open(SKDIR+'export_glb.py').read())
```

Gotchas:
- **The export clears the animation.** After `export_glb.py` the armature has no action, so anything fitted or
  measured afterwards sees a standing pose. Always rerun the whole chain before refitting gear or checking poses.
- **Gear is fitted in the goalie stance** (frame 291, the start of the `goalie` clip in `clips.json`). Pieces are
  rigid meshes parented to bones, so they follow every clip.
- **The Sketchfab source models live only in the open Blender scene** (`Sketchfab_model.005` = gear set,
  `Sketchfab_model.006` = mask, hidden after import). If Blender restarts, re-import them with
  `mcp__blender__import_asset` (source `sketchfab`, ids below; Sketchfab must be ticked and signed in in the add-on
  sidebar). The script finds pieces by group name: `Cube_3` pads, `Cube.001_2` blocker, `Cube.003_5` +
  `NurbsPath.043_80` glove, `Cube.002_4` stick; mask shell = material with "back" in its name, cage = the rest.
- **Group names matter in the game.** Gear pieces are named `g_*`; multi-material pieces export as a group of meshes,
  and `src/render.ts` finds them by the group name. `g_cage*` gets no outline shell (thin bars).

## Goalie gear (what was done and why)

- First attempt: procedural boxes and spheres. Rejected by the user as "round and circular, should look like a
  human". Lesson: CLAUDE.md says search for CC0/CC-BY models first; do that before building anything.
- Now: two CC-BY 4.0 Sketchfab models (credited in `assets/PLAN.md`):
  - "True L12.2 CP31 Version" by YeaBoiiiiiiiii, id `5ace50e9a12d4c029614820d3112dcb3`: pads, blocker, glove, stick
  - "Hockey Goalie Mask" by matyprokop09, id `12fe01ffe0d4443b96292815bb79958a`: mask shell and cage
- `import_goalie_gear.py`: copies and joins each piece, drops tiny loose islands (lettering; pads use a very small
  threshold because they are built from many panels), decimates (about 11k tris in all), recolours to three
  materials the game tints per team (`gear_body` white → team colour, `gear_trim` → trim colour, `gear_dark`),
  then places each piece:
  - pads: from the boot resting on the ice to just above the knee, in front of the shin, lifted out of the ice
  - blocker on `hand_r`, glove on `hand_l`, mask and cage on `Head` (sized to the helmet, turned 90 degrees)
  - stick: shaft mapped from the blocker hand to a heel point on the ice, blade toward the glove side, one dark
    colour (hides the maker's name)
- Goalie stance in `animate.py` was made more upright (feet forward, hips higher) so the pads face the shooter.
- Goalie clips: `goalie` (stance), `g_butterfly`, `g_glove`, `g_blocker`, `g_pad_l`, `g_pad_r`. The glove hand is
  keyed off the stick (hand targets are keyed in every clip now).
- Game side (`src/render.ts`): gear shown on goalie views only (`setGoalieLook`); the skater helmet/stick are hidden
  only when a mask/goalie stick exists; goalies' jersey is pushed out over chest, shoulders and arms by a per-vertex
  `bulk` attribute from skin weights (outline follows). Saves: `src/sim.ts` picks the save when the goalie reads a
  shot (`gread` event, `saveKind`), the renderer times the clip so its reach meets the puck; caught pucks are hidden.

## Known issues / open items

- The blocker still shows the maker's "TRUE" lettering (it is part of the blocker's own colours).
- In the butterfly the pads press up to about 7 cm into the ice.
- The glove and pad-kick saves exist but were not seen in the last capture (the butterfly and blocker were).
- Not hand-played yet by the user.
- Bigger wishlist from the Tape to Tape comparison: player identity (looks, names, numbers), arena dressing, faceoff
  zoom and goal cards, abilities, attributes, smaller overhead marker, run structure.
- Animation source: video mocap (GVHMR) or text-to-motion (HY-Motion) was researched and proposed; nothing chosen.
  If clips change, re-measure the puck carry offset (`CARRY` in `src/sim.ts`) with `node tests/blade_probe.mjs --live`.

## Checks

- `npx tsc --noEmit` and `npm run build`
- `node tests/goalie_shots.mjs` – goalie close-ups in `tests/out/goalie-*.png`, plus gear shown on goalies only
- `node tests/look_probe.mjs normal nohull noink` (CLAUDE.md layer checks)
- gameplay probes: `tests/sim_probe.mjs`, `tests/defense_probe.mjs`, `tests/walkin_probe.mjs`, `tests/hit_probe.mjs`,
  `tests/physics_probe.mjs`, `tests/blade_probe.mjs --live`, `tests/camera_puck_probe.mjs`, `tests/clip_usage.mjs`
- `node tests/video.mjs --seconds 60 --out tests/out/x.mp4` for footage
