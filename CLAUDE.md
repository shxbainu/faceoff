# CLAUDE.md

## Project
- The game is **Faceoff**: arcade ice hockey as a roguelite run with a Heat meter and stacking power-ups.
- Read DESIGN.md before doing anything. It holds the full design, controls, HUD, build order and what the user has rejected.
- Controls are keyboard only and must be easy on a laptop trackpad.
- End goal is multiplayer (co-op, versus, drop-in). The game server is not chosen yet.

## Stack
- TypeScript + Vite
- Three.js r186, WebGPU renderer with WebGL2 fallback
- Rapier for physics (the original stack). The sim still uses hand-written 2D physics in `src/sim.ts` (fixed 120 Hz,
  seeded) and a verlet ragdoll (`src/ragdoll.ts`); PHYSICS_PLAN.md moves them onto Rapier's deterministic build.
  Steps 1-3 are in: `?rapier` moves the puck (boards, nets) and the skaters (own world, `skatersStep`; checks and
  momentum rules stay in `collide`) through Rapier, and sticks use Rapier queries (`bladeWalls` casts the blade from
  the hands to the first wall, `sweepHit` gives the exact puck-vs-blade contact; trap/deflect/poke rules stay in
  sim.ts) (`src/physics/rink.ts`). Next: step 4, ragdolls. Checks:
  `node tests/rapier_compare.mjs [--matches 16] [--seed N]` (old vs Rapier over bot matches, determinism, puck and
  skaters stay in, stick contacts), `node tests/move_probe.mjs --rapier`, `node tests/stick_physics_probe.mjs --rapier`,
  `node tests/rapier_spike.mjs`.

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
- Checks: `node tests/fx_determinism.mjs` (sim fingerprint must not change from feedback work: `3b74b3d094685dbe` since the carried puck slides along the boards on 2026-11-19 (`carryPoint`, `CARRY.wall`; before: faster passes, `PASS_BASE.speed` 1.4)),
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
- Stick hold (`stickIK`, `topGrip`, `hingeIK`): anchored on the clip's own top hand, which the clip puts somewhere
  natural. The blade goes on the ice at its target (puck, lane, or the sim's resting stick, `STICK.rest`), the shaft
  runs from it up through the top hand's palm, the bottom hand goes to its grip on that line, the stick turns in that
  glove onto the target, and last (after `stickFloor`) the top hand grips the shaft where it passes, up to
  `STICK_HOLD.slide` below the knob. Arms use `hingeIK`: the elbow bends only about the clip's own hinge axis (kept in
  the upper arm's frame, sign-corrected under the left-shot mirror), the arm swings from the shoulder onto the target,
  then rolls until the elbow points where the clip had it. Earlier versions (a free two-bone solve, a chosen knob
  spot, a fixed elbow pole, a wrist wrap) each bent the top-hand elbow inward, swung it back or cranked the wrist.
  Proportions: the drawn stick is shortened to `STICK_HOLD.len` (0.9: to the chin) and the arms lengthened by
  `ANAT.arm` (1.12, joints moved, nothing scaled; `?noarmlen`); with the model's own (91% stick, short arms) both
  hands could not hold the stick below the chest with the blade on the ice.
  Arms and head are judged against anatomy, not the clip (`ANAT` in render.ts): the stick is fitted between the blade
  target and the top hand (in front of the belly, `ANAT.clear` off the spine, under the shoulder); the bottom hand
  grips at `STICK_HOLD.bottom` and its collarbone drops (`ANAT.shrug`) if out of reach; elbows point down and back;
  wrists within 28 deg of the bind pose; the head's axes come from the helmet and visor meshes (the bind pose's were
  70-100 deg off) and it looks at the ice `ANAT.gaze` ahead (`visorTilt` calibrated by review), level, yaw capped
  (`?noanat` turns the head layer off). Shots keep the clip's arms.
  Smoothness: the blade target, the top hand's spot and the fitted stick top all ease at `IK_EASE` (18/s), measured
  from the skater or pelvis so they never trail him; the fitted top is re-clamped clear of the belly after easing.
  Without it a switching target (puck, lane, rest) or a flipping fit rule popped the stick and top hand in one frame.
  `node tests/arm_motion_probe.mjs [&noik]` reports top-hand sway, speed (p99 near the clip's own, about 9), how much
  it follows the shoulder, single-frame jumps and what moved on those frames.
  Grip rig (`gripSolve`, runs last every frame, after the ragdoll): both hands always hold the stick. Two fixed grips
  (bottom at `STICK_HOLD.bottom`, top `STICK_HOLD.slide` under the knob grip `gripT`); the stick pose so far gives
  them; a grip out of reach (or closer than the elbow folds, `ANAT.elbowMax` 145 deg) or inside the torso moves the
  stick, never the hand; each arm is solved onto the palm (`middle_01`) with the clip's hinge and an elbow pole down,
  back and a little out (`ANAT.pole`), the hand turned to wrap the shaft, wrist clamped; the stick is seated in the
  bottom glove and the top hand solved last onto the stick's own grip. The one-handed hold was removed (2026-11-20,
  user: hands must always be on the stick). Hard check: `node tests/grip_check.mjs [60]` (every frame of a bot
  match, each palm within 1 cm of its grip; prints the worst; exit 1 on any frame over).
  `node tests/arm_strip.mjs out.png [query] [dist] [angle]` makes a strip.
  Verify poses with `node tests/arm_shots.mjs verify/roundN` (6 shots at the game camera) and a fresh subagent that
  sees only the images and the anatomy rules (verify/VERDICT.md); numeric probes are a secondary check.
  Verify arm changes with close-ups against `?noik` (`?sidecam`, `?sidecam=l`), not only numbers.
  `node tests/stick_state_probe.mjs` (and with `&noik` for the clip's own values) checks every state: shaft angle,
  blade height, top hand on the shaft, drawn blade vs collider, twist, inverted elbows, elbows swung behind the clip's,
  wrists bent past the clip's, knockdowns.
- Checks: `node tests/spin_probe.mjs` (30 s of spinning, bones stay near the clip pose), `node tests/twist_probe.mjs
  --idle 60` (title idle and play), `node tests/arm_probe.mjs` (arm-to-torso distance and carrier close-ups), `node tests/stick_probe.mjs` (blade
  below the ice, carried puck on the blade, stickhandling sweep).


## Skinning (render.ts smoothJoints, spreadTwist)
- The outfit's skin weights were nearly hard at the joints (elbow: 918 of 1043 vertices on one bone), so bends folded
  into sharp corners. `smoothJoints` averages weights with neighbouring vertices (welded across UV seams) for 4 rounds
  at load, on arm and leg vertices only, never gloves, skates or head (`?nosmooth`). `spreadTwist` gives the three
  forearm twist bones a quarter, half and three quarters of the hand's roll each frame (`?notwist`).
- `node tests/joint_probe.mjs [secs] [&noik]`: each limb joint's swing and twist off the bind pose (p50..max), and the
  clip/mode of frames past 150 deg bend or 120 deg twist. `node tests/pinch_shots.mjs dir [query] [mode]`: close-ups.

## Skating gait (render.ts: gaitStep, gaitFoot, gaitLegs; GAIT config)
- Legs are procedural, over the clips: each skate gets a target from a stride phase that advances with distance
  skated (`GAIT.cycle` per cycle, shorter when digging hard, cadence clamped by `minHz`/`maxHz`), then two-bone IK
  (thigh aimed at a pole-placed knee, calf at the target) and the foot turned flat at the target's toe angle. Push
  toe-out comes from the blade's own path, so the blade runs along its edge (no skid).
- Modes from the sim (`v.gait.mode`): stride, cross (crossovers on a hard carve), back (C-cuts), pivot (mohawk),
  stop (both blades across, spray), glide, ready, off (shots, checks, falls: the clip owns the legs). Stride
  amplitude grows with speed. Hips drop and sway over the gliding skate; the chest leans in with speed.
- The upper-body clip (stride, crossover, back) is scrubbed to the same phase (`scrubLoop`), so the chest and stick
  sway with the pushing legs. `?nogait` restores the old clip playback. Legs, pelvis (incl. its position), spine_01
  and neck are in the layer restore list.
- Posture is absolute, not added to the clip: hip height (`GAIT.hip`, about a 100-115 degree knee) and torso lean
  per mode (`GAIT.lean`, a pure pitch about the side axis). Hip and shoulder counter-rotation come from the stride
  clip only; the look layer turns mostly the head (`HEAD.chest` is the spine's share). Extra counter-rotation or a
  bigger chest share twisted the shoulders 30-45 degrees off the hips. `__faceoff.gait()` reports knee, lean, hip,
  twist (shoulder line vs hip line). `?sidecam` puts the camera beside your skater; `?nolook` turns the look off.
- Body motion (`GAIT.body`, in `gaitLegs` and the end of `headGaze`): the absolute lean and the head levelling had
  frozen the chest and head (chest pitch +-0.5 deg, head pitch and roll under 0.5 deg, bob +-1 cm in a sprint). Now
  the chest dips as each push extends (`pitch`), leans over the gliding skate (`roll`) and breathes (`breath`); the
  hips bob more (`hipDip` 0.045); the head keeps `head` (0.6) of the chest's motion, eased at `headLag` so it trails.
  `?nobody` turns it off. Checks: `node tests/torso_probe.mjs [query]` (per mode, p95 motion off a 0.4 s mean and
  p99 per-frame step) and `node tests/torso_trace.mjs` (frame by frame in a straight sprint).
- Ankle and knee (`GAIT.flick`, `toeUp`, `toeLen`, `modeEase`): the toe flicks down at full extension (heel lifts, target
  raised so the toe stays on the ice) and comes up as the skate swings forward; each knee bends out to its own hip's
  side (by where the skate is, a crossover flipped it into the other knee); a change of mode eases for `modeEase` s.
- Hand clearance (render.ts `clearBody`): grips are kept out of a torso capsule and off the helmet (`ANAT.botClear`,
  `ANAT.clear`). Review images: verify/limbs_r1..r3, verify/grip_r1..r3 (verify/limbs_before is the baseline).
- No free human-made hockey skating exists (checked 2026-11-18, see PLAN.md); look for one before re-authoring.
- Checks: `node tests/gait_probe.mjs` (and `--old`): skate spread, alternation and blade skid per phase, close-ups.

## Stick colliders (sim.ts: STICK, placeBlade, bladeSweep, pokeContact)
- Every skater's stick is a shaft (hands to heel) and a blade capsule (`bx, by, ba`), placed every step from the
  carry point, lane stick (`stickX`), poke sweep or knock-aside, kept within `STICK.reach` and out of other bodies,
  boards and nets (iterated). A carried puck rides the blade, so it can't pass through anything either.
- Puck vs blades is swept (`STICK.step`) with both moving, so nothing tunnels. Soft contact traps (`catch`, the
  receiver's `recvCatch`), harder contact deflects; a teammate's blade tips a shot (still a shot), an opponent's
  blocks it. Saucer passes skip blades. Bodies bounce passes off the skates (`bodyBounce`), no dice rolls.
- Pokes and lifts only aim the blade (`startPoke`); `pokeContact` sweeps it and acts on what it touches: the puck
  (knocked loose), the carrier's shaft from behind (stick lifted, `liftT`), his stick from the front (knocked
  aside, `tieT`; a fast low hit jars the puck loose). The carrier's body between the poker and the contact blocks it.
- The renderer aims the drawn stick at the sim blade during pokes and knocks, lifts it during `liftT`.
- Debug: `[` or `?colliders` draws shafts, blades, body circles and the puck radius. Sim event `stick` (text: trap,
  deflect, tip, poke, lift, tie, body) plays the clack.
- Checks: `node tests/stick_physics_probe.mjs` (lane blocks, no tunnelling, pokes, shielding, lifts, handedness, a
  full bot match with no blade in a body, the boards or a net).

## Ragdolls and staggers (ragdoll.ts, render.ts ragApply; RAGDOLL config)
- The sim is the truth (knockdown, slide, stun, puck and stick drops, juice events); the ragdoll is display only.
- Big hits launch: upward speed (`RAGDOLL.up`), push away (`launch`) and a tumble (`spin`, `twist`) scaled by the
  hit value up to `hitTop`, shaped by the hit kind. Partly active: limbs spring toward their pose in the torso frame
  (`stiff`), so they flail without folding. `friction` sets the slide on landing; `getup` the get-up time.
  A `hit` event with value `n >= RAGDOLL.min` starts a 13-particle verlet ragdoll from the skater's current bone
  positions (no pop), kicked by the hit kind the sim reports (`text`: open, hip, board), carried by the sim's slide.
  Its particles become bone rotations (pelvis frame, then aim per limb), blended by a weight that eases in on impact
  and out once stun drops to `RAGDOLL.getup`, where the get-up (the fall clip run backward) takes over.
- Light checks (`bump`, value >= `RAGDOLL.stagger`) rock the torso along the hit. At most `RAGDOLL.max` at once.
- Debug (with `?movedbg`, `?fxdebug` or `?colliders`, never in a normal game): `]` knocks the nearest opponent down (shift+] a light one); `?norag`; `__faceoff.knock(i, imp, dx, dy)`.
- Checks: `node tests/ragdoll_probe.mjs` (5 at once: finite, link stretch, above the ice, lying flat, back up and
  skating, gradual blend, frame rate, stagger).

## Puck height and goalie saves (render.ts, display only; the sim is flat)
- Shots are drawn in the air (`SHOT_ARC`, `puckAir`): they rise to a height by the goal line (a hash of the release
  spot, so every client draws the same), re-aimed when the goalie reads them (glove high, blocker mid, pads and
  butterfly capped low), and fall and bounce once they stop being a shot. On a goal the sim parks the puck behind the
  end boards; the renderer draws it going into the back of the net where it crossed.
- Saves: the clip waits in the stance after an early read so its reach peaks when the puck arrives; a save he didn't
  read starts `GOALIE_REACT` before the peak (no snap); the puck hitting him jolts him back (`crunch`, shared with
  skater hits).
- Checks: `node tests/shot_air_probe.mjs` (heights, back on the ice, goal puck in the net, close-ups),
  `node tests/goalie_timing_probe.mjs` (where the save clip is at contact).

## Abilities (abilities.ts data, sim.ts useAbility/tickAbility/aiAbility)
- **Off by default** (`ABILITY_ON`, sim.ts): the skill and passive design is being reworked from the Tape to Tape
  study (DESIGN.md "Skills and passives"); `?abilities` or `?ability=id` turns them on. Don't build more until the
  user picks from that design.
- O uses the controlled skater's ability (buffered like other presses). Each has a cooldown and a sprint-bar cost;
  built: burst (burst skates), charge (shoulder charge), bender (curling shot), reach (long stick). Default by slot
  (`LOADOUT`). Bots use them through `aiAbility` only when the moment is right, at a skill-scaled rate (`ABILITY_AI`).
- Every use emits the `ability_used` feedback event (tag = id), tuned in `feedback/config.ts`.
- HUD: the chip under the sprint bar (`#abil` in index.html, `hud()` in main.ts).
- Add one: id and def in abilities.ts, effect in `useAbility`/`tickAbility`, bot rule in `aiAbility`, then the probe.
- Debug (only with abilities on): `'` cycles your skater's ability and readies it; `?ability=id` gives everyone one; `__faceoff.ability(i, id)`.
- Checks: `node tests/ability_probe.mjs` (each effect, cooldown and cost, bots use all four, balance on vs off).
- Proposals and backlog in DESIGN.md; research in RESEARCH.md.
