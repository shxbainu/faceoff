# CLAUDE.md

## Project
- The game is **Faceoff**: arcade ice hockey as a roguelite run with a Heat meter and stacking power-ups.
- Read DESIGN.md before doing anything. It holds the full design, controls, HUD, build order and what the user has rejected.
- Controls are keyboard only and must be easy on a laptop trackpad.
- End goal is multiplayer (co-op, versus, drop-in). The game server is not chosen yet.

## Stack
- TypeScript + Vite
- Three.js r186, WebGPU renderer with WebGL2 fallback
- Rapier for physics

## Art
- Moving from procedural to GLB assets one at a time (see assets/PLAN.md). Online CC0 or CC-BY models first, text-to-3D only as fallback.
- Every GLB keeps its procedural model as the fallback if it fails to load
- No realistic faces

## Goals
- 60fps
- Starts in seconds
- Restart in 1 second

## Verification
- Verify every build with `npm run build` and Playwright screenshots

## Rendering rules (skaters and any outlined mesh)
- Outlines use an inflated back-face shell. Never put the shell on thin or see-through parts (visor, glass,
  skate blades, straps, wires); outline those with surface contour ink or screen-space edges instead.
- Keep shell inflation minimal (currently 0.014), and lower it or mask it by vertex weight around tight joints,
  necklines and limb sockets, where the shell pokes through the body as dark blotches.
- Team-colour textures ship uncompressed (PNG). Lossy compression bleeds colour across zones and the team tint
  turns the bled pixels into specks.
- New visual artifacts (clipping, specks, blotches): isolate the pass first with the layer switches
  (`?nohull`, `?noink`, plus the base mesh) and `node tests/look_probe.mjs normal nohull noink`, then fix
  the pass that is responsible. No shader or material tweaks before the culprit is isolated.


## Feedback (game feel) system
- Gameplay never calls an effect. `src/sim.ts` only emits events with an intensity `i` (0..1) through `this.fx({...})`;
  the names and fields are in `src/feedback/events.ts`. Events carry actor `id` and victim/receiver `vid` so each client
  decides "was this me" itself. The sim must not use `rnd()` or change state for feedback.
- `src/feedback/system.ts` is the only place events turn into effects. It resolves an event to a config entry
  (`variant`: e.g. `check_landed` becomes `check_board`, `check_shove` or `got_hit`), scales it by quality, chaining
  (flow rank and pass streak), involvement (your skater or not), distance and the player's settings, then queues it.
  Each frame the queue is applied biggest priority first; only the lead event may start hit stop, slow-mo or a flash.
- All tuning is data in `src/feedback/config.ts` (`FEEDBACK`): per event hit stop frames, slow-mo, trauma, kick, punch,
  fov, flash, chroma, vignette, squash, particles, layered sounds, popup, flow points, priority, cooldown; global caps
  (hit stop 2 to 8 frames, flash at most 0.32 alpha and ~3 a second, particle budget 900, voice cap 26).
- Time: `src/feedback/time.ts`. Hit stop and slow-mo only scale the wall-clock time fed to the fixed 120 Hz step, and
  pressed keys are latched until a step sees them (`latched` in main.ts), so results and inputs are unchanged. With
  `?netfx` (and later any multiplayer match) sim time is never scaled; only drawn animation and particles freeze.
- Player settings (`src/feedback/settings.ts`, saved): intensity 0 to 150%, shake, flashes, slow-mo, chroma. P opens
  the feel panel in game. URL overrides: `?fx=0.5 ?noshake ?noflash ?noslowmo ?nochroma ?nopost`.
- Debug: backtick opens the panel; in a match keys fire every event (`,` `.` `/` pick low, medium, high; `\` fires all
  of them at three levels). `?fxdebug` opens it on load. `window.__faceoff.fx` has `fire`, `state`, `set`, `sweep`, `config`.
- To add an event: (1) add the name to `FxName` in `events.ts`; (2) emit it from gameplay with `this.fx({ t, i, x, y,
  team, id, vid, ... })`, intensity from how good the play was; (3) add an entry under `FEEDBACK.events` in `config.ts`
  (or a variant line in `system.ts` `variant` if it needs a good/bad or tag split); (4) add a debug key in `DEBUG` in
  `main.ts`; (5) run the checks below.
- Checks: `node tests/fx_determinism.mjs` (sim fingerprint must not change from feedback work: `a4e21c0c016c58d4` since the hockey feel pass of 2026-11-18),
  `node tests/fx_probe.mjs` (every event x3, frame rate in the heaviest goal sequence, toggles, live config, skip,
  input buffer, net mode, real play), `node tests/fx_hitch.mjs 60` (logs frames over 40 ms).


## Movement, facing, handedness, checks and bot defense (sim.ts)
- All tuning is data at the top of `src/sim.ts`: `SKATE_BASE` (per-skater stats upgrades can raise: accel, top speed,
  glide, turn rates, brake), `MOVE` (backward speed, pivot rate, turn and cut cost, push lost while carving, hockey
  stop, backward-skating range, input buffer), `HANDS` (backhand penalties, drag, one-timer windows), `CHECK` (body checks; `send` and `slide` set how far a hit sends someone), `SHOT` (momentum carried into shots), `AI` (difficulty, reaction, read rate, bite rate, coverage).
  `window.__faceoff.tuning` exposes them live.
- Movement never waits on animation: input turns the heading the same step. Hard cuts cost speed and weaken the push
  for `MOVE.carveTime`; a reversed input at speed is a hockey stop. Pass, shot, check and poke presses are buffered
  for `MOVE.buffer` s (human only).
- Facing is separate from skating direction. A defender (bot via `ai.look`, you via `humanLook`) faces the carrier
  and skates backward while he comes at him; sprint, being beaten, or a carrier faster than a backward skater makes
  him pivot to forward. `s.faceMode` says which (forward, back, square, pivot). Every shot turns the shooter to face
  the net (`doShot`).
- Handedness: `handOf(id)` gives each skater a shot side without random numbers (6 left, 4 right; `?hands=r|l`
  forces one). The puck rides on the shot side; cutting across the body moves it to the backhand (`s.bh`, held for
  `HANDS.hold`), where passes and shots are weaker and less accurate. A pass landing on the backhand side gives a
  shorter one-timer window. The renderer mirrors a left shot's model (`model.scale.x < 0`).
- Body checks are momentum-based (`Game.hit`): value = closing speed along the line of the hit, scaled down for a
  glancing blow; below `CHECK.knock` it only ties him up; the victim keeps his own velocity plus an impulse, so how
  far he slides follows how fast the checker came in. Stun length scales with the hit.
- Bot defense: one presser keeps a gap (`gap x.x` in the overlay), angles the carrier to the boards, pokes when in
  reach, lifts the stick when beaten (the poke key from behind is a stick lift for you too) and sometimes bites
  early (`AI.bite`). Everyone else has a man (`markOf`, sticky, assigned nearest-to-net first), plays goal-side of him
  (tight in our zone, loose in the neutral zone) and lays the stick in the lane to him. `?ai=0..1` sets difficulty.
- Debug: `;` (or `?movedbg`) shows facing (white) and skating (yellow) arrows and a panel with your head yaw and each
  bot's AI state. Bot skill is `AI.baseSkill` in round 1 plus `AI.roundSkill` by round 8.
- Checks: `node tests/move_probe.mjs` (skating timings, stop, turn cost, buffer, backward facing, shot facing,
  handedness, knockback vs speed, bot defense over 4 matches).

## Skater rendering layers (render.ts)
- After the clip, the upper-body look (`microBlend`) and the stick IK turn bones on top of it. three.js's mixer skips
  writing a bone whose clip value didn't change, so `layerRestore` puts any bone the mixer left alone back to its clip
  pose before layering, and `layerSave` remembers what was left. Without it the turns stack on static frames (title,
  pre-game, hit stop, held wind-up) and the head, spine and arms spin (`?nolayerfix` shows the old bug).
- Bone turns go through `rotWorld`, which is correct under the mirrored (left shot) model.
- Stick IK: the stick turns in the bottom glove first (`ARM.stickAim`), the arms only make small corrections, and a
  guard drops the arm part if a hand or elbow would end up inside or behind the torso. `stickFloor` then turns the
  stick up in the glove until the blade's heel, middle and toe are on the ice (`?nofloor` turns it off). A carried
  puck is drawn on the blade, so it moves with the stick; the sim's puck stays the truth for play. The sim's `CARRY` point is
  where the clips naturally hold the blade (measure with `?noik`); a target near the feet drags the hands through
  the body. `?noik` turns the IK off.
- Checks: `node tests/spin_probe.mjs` (30 s of spinning, bones stay near the clip pose), `node tests/twist_probe.mjs
  --idle 60` (title idle and play), `node tests/arm_probe.mjs` (arm-to-torso distance and carrier close-ups), `node tests/stick_probe.mjs` (blade
  below the ice, carried puck on the blade, stickhandling sweep).
