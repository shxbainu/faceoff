# Handoff: game-feel layer and hockey feel pass (2026-11-18)

## State

- **Committed on branch `hockey-feel`** (feedback layer plus the hockey feel pass: head/arm/stick fixes, facing,
  movement, handedness, momentum checks, AI defense). See PLAN.md for the pass and CLAUDE.md for how it works.
  Sim fingerprint now `a4e21c0c016c58d4` (gameplay changed on purpose). Next: the user's feel tuning.
- Files: `src/feedback/` (events.ts, config.ts, settings.ts, time.ts, system.ts, hud.ts), edits to `src/sim.ts`
  (event emits only), `src/render.ts` (fx API, particles, rings, chroma pass), `src/main.ts` (wiring, input latch,
  P feel panel, backtick debug panel), `src/audio.ts` (voice pool, cues), `index.html` (HUD styles), new
  `PLAN.md`, `tests/fx_probe.mjs`, `tests/fx_determinism.mjs`, `tests/fx_hitch.mjs`. CLAUDE.md has a section on
  how the system works and how to add an event.

## Verified

- `npm run build` passes. `node tests/fx_probe.mjs`: 22 of 22 pass (every event at 3 levels, 60 fps with worst frame
  16.8 ms through five max goals, toggles, live config, goal skip, input buffer, net mode, real play).
- `node tests/fx_determinism.mjs`: the feedback layer left the fingerprint unchanged (`a03d0311ac598cbb`); the later hockey pass changed it to `a4e21c0c016c58d4`.
- Playbot clean, no console errors.

## Next

- Tune by feel from the user's playtest: all numbers live in `src/feedback/config.ts`. Don't change the sim.
- Open questions for the playtest: hit-stop length, goal slow-mo on repeat goals, wind-up hum and vignette,
  top-speed lines, how quiet getting hit is, flow rank pace, streak pitch, shake vs puck readability.
- Known, not from this work: a ~300 ms frame when a round starts (same on the previous commit).
- Placeholders to replace later (synth sounds, box particles, plain rings, text-only goal card) are listed in PLAN.md.

---

# Earlier handoff: skater and goalie model work (2026-11-18)

Latest commits:
- `33f7088`: GitHub Pages deploy.
- `475361b`: goalie fixes, rounds 2 and 3.
- `467deb0`: real goalie gear.
- `475d6d5`: goalie groundwork.

Everything is committed and pushed.

## Next up (user's call, 2026-11-18)

Work on animations and give the game more snap. The goalie model work below is done for now. The Safari bugs below
are parked; don't start on them unless asked.

## Live build: GitHub Pages

- **Live site:** https://shxbainu.github.io/faceoff/
- **Repo:** https://github.com/shxbainu/faceoff. It is public; it went public on 2026-11-18 because Pages needs a
  paid plan for a private repo.
- **Deploy:** `.github/workflows/pages.yml` type-checks, builds with `--base=/<repo>/`, and deploys on every push to
  `main`. Local dev and `npm run build` are unchanged (base `/`).
- **Chromium:** loads into a match in about 1.2 s with no errors.

## Parked: Safari bugs (Safari 26.6, the only browser on the user's Mac)

The game had never been tested in Safari before this.

1. **Black screen on the default WebGPU path.** `?webgl` (forced WebGL2) shows the game.
   - `View.init` in `src/render.ts` falls back to WebGL2 only if `renderer.init()` throws. Safari starts WebGPU
     fine, then presumably rejects a TSL shader or pipeline, which leaves a black canvas.
   - Fix plan: catch WebGPU errors early (the device's `uncapturederror`) and switch to WebGL2 on its own, then find
     and fix what Safari rejects.
   - Careful: Chromium also logs harmless "swapchain texture of size 0" errors while its canvas has no size, for
     example in a hidden pane. Don't treat those as a WebGPU failure.
2. **Skaters spin constantly on the title screen** (seen in Safari with `?webgl`; not checked on the WebGPU path,
   which is black).
   - In Chromium the body yaw holds still on the title screen with both renderers (`__faceoff.body(i).rot`).
   - Not diagnosed. The yaw smoothing is in `skateFeel` (`src/render.ts`, `f.yaw`).
3. **To test Safari, one of these is needed.** Neither is set up yet; the user didn't choose.
   - Playwright WebKit: `npx playwright install webkit`, a download of about 100 MB. Per memory, ask the user before
     installing.
   - The user's real Safari: Settings → Advanced → "Show features for web developers", then Develop → "Allow
     JavaScript from Apple Events", then drive it with `osascript`.

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
  rigid meshes parented to bones, so they follow every clip, except the pads, which are skinned (Armature modifier,
  stored in the rest shape).
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
  - pads: from the boot resting on the ice to just above the knee, in front of the shin, lifted out of the ice;
    skinned (calf below the knee, thigh on the knee block, blended over 10 cm) so a bent knee carries the knee block
  - blocker on `hand_r`, glove on `hand_l`, mask and cage on `Head` (sized to the helmet, turned 90 degrees)
  - stick: 1.5 m, held at the top of the paddle (found from the shaft-to-paddle width step) in the blocker, blade
    flat on the ice with the toe to the glove side, paddle tilted back to the hand; one dark colour (hides the name)
- Goalie stance in `animate.py` was made more upright (feet forward, hips higher) so the pads face the shooter.
- Goalie clips: `goalie` (stance), `g_butterfly`, `g_glove`, `g_blocker`, `g_pad_l`, `g_pad_r`. Both hand targets
  are keyed in world space (position and rotation), not through the stick control: `glove_at` (palm to the shooter,
  fingers up, wrist bend capped at 50 degrees) and `blocker_at` (the stance rotation, turned by `flat`/`yaw` per save,
  so the goalie stick keeps a goalie's angle). Goalie keys skip `blade_on_ice()`: that lifts the stick control for
  the hidden skater stick, and it had raised both hands about 0.5 m, to head height.
- Game side (`src/render.ts`): gear shown on goalie views only (`setGoalieLook`); the skater helmet/stick are hidden
  only when a mask/goalie stick exists; goalies' jersey is pushed out over chest, shoulders and arms by a per-vertex
  `bulk` attribute from skin weights (outline follows). Saves: `src/sim.ts` picks the save when the goalie reads a
  shot (`gread` event, `saveKind`), the renderer times the clip so its reach meets the puck; caught pucks are hidden.

## Gear clean-up (2026-11-18, later)

The goalie showed black scribbles, the maker's "TRUE" lettering, pads and stick in the ice and bare hands beside the
glove and blocker. Fixed:
- **Scribbles:** the Sketchfab meshes are split at every UV seam; decimating them left loose triangles (the mask had
  3,549 non-manifold edges on 2,600 faces), and the outline shell pushed out along those split normals broke into
  splinters. `prep()` now welds (exact seams first, then 0.05% of the piece's size) before and after decimating.
  In `src/render.ts` gear shells inflate along smoothed normals (`outlineNormals`, the `outlineN` attribute), only
  the blocker keeps a shell, and the mask, pads, glove, stick and cage use contour ink alone (thin parts, vent holes,
  overlapping panels: their shells showed through or poked out).
- **Lettering:** `absorb_decals()` floods regions of one material across the welded mesh; one smaller than 8% of the
  piece takes the material around it. That removes "TRUE" on the pads, blocker and glove, and stitch marks.
  Small dark materials go to the body colour too (`recolour`).
- **Ice:** a settle pass at the end of `import_goalie_gear.py` lifts the foot targets (pads) and the stick control
  (goalie stick) on each keyed frame of the goalie clips. The lowest gear point is now 0.4 to 1 cm above the ice in
  every clip (it was −10 cm in the butterfly, −7 in the pad saves, −4 for the stick in the blocker save).
- **Hands:** the glove and blocker are centred on the posed hand mesh, not the wrist bone, and goalies' hands are
  pulled in 1.8 cm along their normals in the game (`ghand` attribute) so no finger pokes through.
- New probe: `node tests/goalie_closeup.mjs [normal|nohull|noink|hulldbg ...]` saves close-ups of a goalie in each
  save pose, front and side, to `tests/out/gclose-*.png` (runs on the Vite dev server).

## Round 2 (2026-11-18, later): stick grip, arms, left wrist, legs, torso line

- **Hands at head height, stick held like a staff:** `blade_on_ice()` ran on goalie keys (see above). Hands now sit at
  0.54 m (blocker) and 0.66 m (glove) in the stance, head 1.03 m; the stick is refitted at the paddle top.
- **Left hand twisted in on itself:** the glove hand kept the stick-grip rotation (its target rides on the stick
  control) while moved off the stick: the wrist bent 130-170 degrees. Now keyed by `glove_at`; `animate.py` prints the
  wrist bend per goalie clip (all at or under 52 degrees, twist under 15).
- **Leg cutting through the pads:** pads are skinned (above); the game also pulls goalies' shins, knees and boots in
  2 cm (`gleg` attribute, like `ghand`). Front-facing check in Blender: under 1% of leg vertices poke out (deep butterfly).
- **Dark line across the torso:** the goalie outline shell poked out where the bulked arm and torso cut into each
  other. `goalieBulk` now pushes the inner arm and the flanks out less and smooths the bulk over the surface.
- **Export bug found on the way:** the IK-driven bones are not keyed, so each clip's bake started from the last
  clip's pose and Blender's IK settled 8 cm short in `g_pad_l` (stick in the ice in the game). `export_glb.py` resets
  those bones before each clip; every clip now bakes to within 0 cm of the live pose (skater clips unchanged).
- The settle pass now lifts the blocker hand target (`hand_tgt_r`), not the stick control (that also carried the glove).
- `node tests/goalie_closeup.mjs` also prints per pose the hand and head heights, where the blocker holds the stick
  (0.54 = paddle top) and the stick's lowest point, and shoots a glove-hand close-up; `HIDE=g_glove,g_blocker` shows the
  bare hands.

## Round 3 (2026-11-18, later): black streaks, colour bleeding, too low poly

Isolated per layer (`?nohull`, `?noink`, base mesh) on close-ups of the pads, glove, blocker and mask. The gear has
no texture (three flat materials); the streaks were three separate things:
- **Hard black shards = the blocker's outline shell** (the last gear piece with one). No `g_*` piece has a shell now;
  `gearInk` and `View.outlineNormals` are gone. Gear outlines are the contour ink with a narrow band (`GEAR_INK`,
  0.03-0.09 instead of 0.1-0.24) on their own materials (`gearBodyMat`, `gearTrimMat`, gear dark).
- **Soft black smears = smooth normals across hard creases** (a third of the gear edges fold past 30 degrees).
  `hard_normals()` shades smooth inside a panel and splits at creases over 30 degrees and at colour borders.
- **Jagged colour zones + faceting = the decimator** (cut to 15-30% of the source). Budgets now keep 50-100%: pads
  and blocker at full detail, glove 14k, mask 14k, cage 6.6k (about 60k faces per goalie; outfits are 23k each).
  Slots are merged per game colour before decimating; needle triangles the decimator makes are collapsed (the
  thin line sticking out of the blocker). Locking colour-border vertices was tried: no better borders, more needles.
- At full detail the "TRUE" lettering showed again (it was hidden by the old decimation): `absorb_decals` now also
  presses raised lettering flat onto the panel (only where the rim is flat), with larger limits on the blocker (14%)
  and glove (10%) measured from their colour regions.
- Goalies' bare hands are not drawn at all (alpha-tested out by the `ghand` weight): at full detail the catching glove
  is thinner and the knuckles showed through its pocket. The glove sits 4 cm further forward on the hand.
- Jersey texture: bake margin 4 -> 32 px, adjacent-faces margins (the black between UV islands bled into the island
  edges at lower mips).

## Known issues / open items

- The catching glove at 14k faces still shows some faceting on its curved back (crease split at 30 degrees).
- The bulked goalie jersey still shows a few small shell specks on the shoulders with `?hulldbg` (in the navy, barely
  visible in normal).
- In the blocker save the stick comes 23 cm off the ice as the hand punches out (meant), and in the deep butterfly
  the boots show a little behind the flared pads.
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
