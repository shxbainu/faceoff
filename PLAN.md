# Faceoff plan: skating gait, stick physics, ragdolls, abilities (started 2026-11-18, late)

## State before this pass (from git log, HANDOFF.md and the probes)

- Done and live (PR #1, `9b2bf81`): game-feel layer, hockey feel pass (facing, movement, handedness, momentum checks,
  AI defense, head and arm layering fixes). All probes passed at hand-off.
- Broken or weak, found again at the start of this pass:
  - Skating reads as a shimmy. Measured (`tests/gait_probe.mjs --old`): the baked stride clip keeps both skates splayed
    all the time (median spread 0.84 leg lengths while striding, 0.74 standing), so from the camera the skater is a
    wide squat whose feet shuffle; cadence is set by clip playback rate, not by the pushes; carriers under 6.5 u/s
    play the `handle` clip and glide with no stride at all. Blade skid while striding 14-18 degrees.
  - Sticks have no collision: pokes and lifts resolve instantly on a distance check; pass pickoffs are a dice roll
    within 0.65 of the blade; nothing stops a blade or a carried puck passing through bodies, boards or nets.
  - Knockdowns play one fall clip for every hit; the get-up is a 0.15 s crossfade (a pop).
  - No ability system (O is reserved). `collideNet` pushed a point already inside the net out by only r (bug).
- Open from earlier: feel tuning by the user; Safari bugs parked; pivots have no animation (now covered by the gait).

## Status of this pass (branch `skating-sticks-ragdolls`, not merged)

- [x] Skating gait: procedural legs over the clips (stride, crossover, C-cuts, pivot, hockey stop, glide, ready).
      gait_probe: stride skid 14-18 deg -> 7 deg; spread now changes with state (glide 0.34, push 0.79 leg lengths).
- [x] Stick colliders: 22 checks pass (stick_physics_probe), incl. no tunnelling and no blade in a body or a net.
- [x] Ragdolls: 5 at once at 60 fps, link stretch at most about 6%, everyone back up (ragdoll_probe).
- [~] Abilities: system and 4 prototypes built, then switched off at the user's request until the skill and passive
      design (DESIGN.md, from the Tape to Tape study in RESEARCH.md) is chosen.
- [ ] Tuning by feel (user): stride size and cadence, lean, hockey stop, ragdoll kick, poke and lift reach.
- Seen, not changed: bots spend about 18% of the time in a real hockey stop (their velocity matching pushes against
  their own motion); an AI tuning question.
- A human-made get-up clip (Mixamo needs the user's Adobe login) would replace the reversed fall.

## Animation sources (checked first, 2026-11-18)

No free human-made ice hockey skating exists (mocap or keyed): CMU mocap has skateboarding only; Xsens/Movella give
free speed-skating mocap behind a sign-up; paid hand-keyed packs exist (Unity "Hockey Player Animated" $19, Ice Slyder
Hockey Pack, Flipped Normals "Ice Hockey" 160 clips), none lists crossovers and all need retargeting to our rig. The
CC0 Quaternius UAL1 we already have gives the fall (`Death01`) and hit reactions but no get-up; Mixamo has get-up clips
(needs the user's Adobe account). Decision: procedural legs (speed-matched strides and no skid are things a baked clip
can't do), get-up = the fall clip backward until a human-made get-up clip is chosen (see "Next ideas").

# Faceoff plan: hockey feel pass (movement, facing, defense, head, stick hand)

Started 2026-11-18 (evening). Goal: play like real hockey and like Tape to Tape, still arcade and rewarding. Fix
root causes, not symptoms. Everything tunable from config. The feedback layer below must keep working.

## Reference: what Tape to Tape does vs. what we do

Studied from `~/Downloads/YTDown.com_YouTube_Media_wTGC_-PaM5E_Tape-to-Tape-...720p.mp4`: a 1-per-10 s contact sheet,
then 5 fps and 8 fps crops of play at 0:42-0:45, 1:38, 6:45 and 7:50.

| Area | Tape to Tape | Faceoff before this pass |
|---|---|---|
| Defending | Defenders hold ice **facing the carrier**, back to their own net, crouched, blade flat on the ice in front. They give ground backward and only turn when beaten or chasing. | Bots do this. **Your own skater always turns to face where it skates**, so backing up means turning your back on the play. |
| Pressure | One defender closes on the carrier; the other two hold the slot and the far post. Nobody else chases. | Same idea (one presser, shape for the rest). Second defender collapses in our zone. No stick lifts. |
| Sticks | Mixed handedness: blades on the left of some skaters, the right of others. | Every skater is a right shot. No backhand. |
| Skating | Quick to speed, long glides, carving arcs; turning at speed swings wide and bleeds speed. Stops throw spray. | Quick to speed (0.32 s), but a 90 degree turn at full speed takes 0.27 s and keeps **99%** of speed: weightless. A hockey stop ends in an instant velocity flip. |
| Camera | Follows the puck, high three-quarter view. | Same (already matched earlier). |
| Passing / shooting | Passes lead the receiver; one-timers off the forehand. | Passes lead; one-timers equal from either side. |

## Audit of movement, AI and animation (root causes)

1. **Head and spine spin, worse before the game** (`render.ts` `microBlend`, `stickIK`). The upper-body layer and the
   stick IK *premultiply* onto bone rotations each frame, trusting the animation mixer to overwrite those bones first.
   three.js's `PropertyMixer.apply` skips the write when a bone's mixed value is unchanged from last frame. So on any
   frame where the clip pose is static (title screen and pre-game: `main.ts` passes animation dt = 0; hit stop; a
   held slapshot wind-up; other scrubbed clips) the offsets stack, frame after frame: the head, spine and arms spin.
   Fix: snapshot each layered bone's clip pose and restore it before layering when the mixer did not write.
2. **Head snaps side to side when the puck is behind** (`microBlend`). The look angle is clamped to +-0.75, so a puck
   directly behind flips the target from +0.75 to -0.75 as the skater turns through it. Fix: hysteresis behind the
   back, a small deadzone, finite-value guards.
3. **"Always turning around" on defense** (`sim.ts` facing). Facing follows velocity above 2.5 speed for the human
   skater; only bots have the `ai.look` face-the-carrier path. Fix: one shared rule decides when a skater faces the
   carrier and skates backward, for bots and for you. Pivot to forward on sprint, when beaten, or when the gap is gone.
4. **Turns cost nothing; stops snap** (`updateSkater`). Speed loss in a turn is about 1%. The skid ends by setting
   the heading straight to the new direction at 2.5 speed. Fix: real turn cost that grows with speed and sharpness,
   a stronger hockey stop that kills speed fast, then push off from near zero.
5. **Presses dropped**: a check pressed during cooldown or a shot pressed a moment before the pass lands is lost.
   Fix: a short sim-side input buffer (pass, shot, check, poke).
6. **No stick handedness** (`CARRY.lat`, stick parented to the right hand). Fix: a shot side per skater, mirrored model
   for left shots (clips, stick curve and IK follow), puck on that side, forehand/backhand.
7. **Tuning is scattered** (SKATE_BASE, SPRINT, literals in updateSkater and ai). Fix: one `MOVE` config, one `AI`
   config with a difficulty setting.

## Plan

1. Head and pre-game spin: pose restore before layering; head hysteresis, deadzone, NaN guards. Test: spin the skater
   both ways for 30 s, idle the title screen and pre-game for 60 s; no NaN, head yaw within limits.
2. Facing: shared defend-facing rule; backward skating speed and pivot in `MOVE`; human defender included.
3. Movement: turn cost, hockey stop, input buffer, `MOVE` config.
4. Handedness: per-skater shot side, mirrored model, forehand/backhand drag, weaker backhand passes and shots,
   one-timers easier off the forehand.
5. AI defense: `AI` config (difficulty, reaction, mistakes); stick lifts; backchecking forwards pick up open
   attackers; man coverage in our zone with sensible switches.
6. Debug overlay (facing, movement, head yaw, AI state), tests (`tests/move_probe.mjs`), playbot in a real match,
   review, CLAUDE.md.

## Status

- [x] Reference study, audit, plan
- [x] Head and pre-game spin: layer restore (verified: 30 s spin, spine 0.05 rad off the clip pose; old code 3.02)
- [x] Arm clipping: root cause was the carry point near the feet forcing the IK to drag hands through the torso.
      Carry point moved to where the clips hold the blade; stick turns in the glove first; torso guard.
- [x] Facing and backward skating (you and bots); shots face the net
- [x] Movement: turn cost (hard cut dips to about 83% and recovers in about 0.2 s), hockey stop 0.22 s, buffer, `MOVE`
- [x] Handedness: mirrored left shots, forehand/backhand, one-timers off the forehand
- [x] Momentum-based checks (`CHECK`): knockback 2.1 / 9.1 / 12.1 / 15.1 / 18.1 for checker speed 6 to 18
- [x] AI defense: `AI` config and difficulty, man coverage, lane sticks drawn, stick lifts, bites
- [x] Game-dev skill pass (threejs-game-director, threejs-gameplay-systems game-feel order): shots carry skater
      momentum (`SHOT.carry`), defenders' lane sticks drawn, ice spray along a knocked-down skater's slide
- [x] Verification: build, move_probe 26/26, fx_probe all pass, playbot match 58.8 fps no errors, spin and idle probes
- [ ] Tuning by feel (user playtest)

## Next ideas (not built)

- Pass reception quality by speed and side (hard pass to the backhand bobbles).
- Defender gap tied to the carrier's speed stat once skater stats exist.
- Boards: puck rims around the corners at speed instead of a plain bounce.

---

# Faceoff plan: game-feel (juice) layer

Started 2026-11-18. Aim: the snappy, layered feedback of ULTRAKILL and Karlson, where the response grows with how
good the play was and how well it chains. Asset work has its own plan in `assets/PLAN.md`.

## Rules for this work

- Gameplay (`src/sim.ts`) only emits events with an intensity from 0 to 1. It never calls an effect, and no effect
  writes back into the sim. The sim may not consume random numbers or change state for feedback.
- One central system (`src/feedback/system.ts`) maps events to effects. All tuning sits in one data file
  (`src/feedback/config.ts`).
- Hit stop and slow-mo only scale how much wall-clock time is fed to the fixed 120 Hz step. The sim still runs the
  same steps with the same inputs, so results stay identical. In network mode (`?netfx`, and later any multiplayer
  match) sim time is never scaled. Hit stop then freezes only the drawn animation and particles, and slow-mo is
  replaced by camera work. A headless fingerprint test (`tests/fx_determinism.mjs`) proves the sim is unchanged.
- Input stays snappy. Presses during hit stop or slow-mo are latched and reach the next sim step, and no input
  path waits on an effect.
- Negative moments (losing the puck, getting hit, conceding) get short, quiet feedback so the good ones stand out.
- The puck and players stay readable. No effect hides the puck: flashes are capped, shake is capped, and particles
  never draw over the puck cue.
- HUD follows DESIGN.md: neutral ramp, one accent, sentence case, Archivo 500/800. Popups read "One-timer" and
  "Nice pass x3", not all caps.

## Events (gameplay → feedback)

`pass_released`, `pass_completed`, `one_touch`, `one_timer`, `streak_end`, `shot_released`, `post_hit`,
`near_miss`, `save_made`, `check_landed` (tags: shove, board, timed, big, over), `spin_move`, `beat_defender`,
`speed_burst`, `turnover`, `faceoff_won`, `goal_scored`. Events carry actor and victim ids, so each client works
out "was this me?" itself (needed for multiplayer). Existing sim events (`pop`, `tier`, `fire`, `slam`, `board`,
saves for the goalie animation) stay. The sim's presentation events (`freeze`, `slowmo`, `shake`) move out of it.

## Build order

1. Event contract and config: events, config, settings (intensity slider and toggles, saved), time director
   (hit stop and eased slow-mo with priorities), trauma shake, the effect budget, determinism test.
2. Goals: hit stop, eased slow-mo, camera punch toward the net, flash, chromatic pulse, confetti, net bulge, lamp,
   horn and crowd, goal card. Skippable with J, Space, Enter or K; repeat goals in a match get a shorter version.
3. Hits: hit stop 2 to 8 frames by closing speed, trauma, kick along the hit, squash on the victim, spray and
   sparks. Board hits get a boom, rattle and a board-side kick; open-ice hits get a cleaner crack and a ring.
   Getting hit is short and dull.
4. Passes and shots: crisp release, puck trail, receiver catch pulse, pass streak meter with rising pitch that
   resets on a break, wind-up tension (vignette tightens, FOV narrows, rising hum), release snap, speed lines,
   post ping, near-miss reaction, close-save reaction.
5. Good moves: spin, beating a defender, speed burst, timed (sweet-spot) shots and timed checks.
6. Flow rank: D to S, rises with good play, decays when idle, drops on bad moments, nudges good-event intensity.

Then: debug hotkeys for every event at low, medium and high intensity, a feel settings panel, CLAUDE.md notes,
verification (build, every event fires, frame rate in the heaviest goal sequence, toggles and config work).

## Status (2026-11-18)

- [x] Plan
- [x] Event contract, config, settings, time director, shake
- [x] Goals
- [x] Hits
- [x] Passes and shots
- [x] Good moves
- [x] Flow rank
- [x] Debug hotkeys and feel panel
- [x] Verification: `npm run build`; `tests/fx_probe.mjs` 22 of 22 pass (60 fps, worst frame 16.8 ms through five
  back-to-back max-intensity goals with 723 particles); `tests/fx_determinism.mjs` fingerprint unchanged; playbot clean.
- [ ] Tuning by feel (user playtest)

Known: starting a round (restart or next round) has a ~300 ms frame. It was there before this work (same on the
previous commit), from the round setup, not the feedback layer.

## Placeholders to replace later

- Sounds (all synthesised in `src/audio.ts`, by cue name in `config.ts`): goal horn, crowd roar, crowd groan, crowd
  "ooh" on posts and near misses, post ping, body-check thud and crack, board boom and glass rattle, stick clack,
  pass snap and tape catch, shot crack and whoosh, save thump, glove pop, spin swish, skate scrape on a sprint start,
  rank-up chime, the streak note, the sting on one-timers and dekes, the slapshot wind-up hum. Recorded sounds can
  replace any cue one at a time; keep the cue names so the config does not change.
- Particles are coloured boxes from one instanced mesh: ice spray and snow, sparks, confetti, speed lines, puck trail.
  Candidates: a soft snow sprite for ice spray, a paper confetti sprite, a tapered streak for speed lines and trails.
- Ring pulses on the ice are a plain ring mesh; an ice-crack decal would suit board hits.
- The goal card is text only; a team crest or scorer name and number belongs there once skaters have identities.
