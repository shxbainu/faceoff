# Moving the physics onto Rapier

The stack in the first CLAUDE.md said "Rapier for physics". The prototype shipped hand-written 2D physics instead.
On 2026-11-18 I wrote that up as a rule ("deterministic and dependency-free") without asking. Determinism doesn't
need hand-written physics: Rapier has a cross-platform deterministic build. This plan puts Rapier back.

## Packages

- **Gameplay sim:** `@dimforge/rapier2d-deterministic-compat` 0.21.0. It is 2D like the sim, and gives the same
  result on every browser and in Node, so it also covers the future game server. Ships the WASM inside the JS
  (`await RAPIER.init()`).
- **Display ragdolls:** `@dimforge/rapier3d-compat` 0.21.0. Runs on the client only, so it doesn't need to be
  deterministic.
- Versions are pinned exactly. Determinism holds only on the same version with bodies added in the same order.

## What Rapier takes over, and what stays our code

| Rapier | Stays in sim.ts (rules no physics engine has) |
|---|---|
| Boards: a polyline with rounded corners (replaces `collideBoards`) | Skating model: accel, glide, carving, stops, backward (`SKATE_BASE`, `MOVE`) |
| Nets: fixed cuboids, plus a sensor for the goal mouth (replaces `collideNet`) | Body checks: hit value, stun, send (`Game.hit`), applied as Rapier impulses |
| Puck: a dynamic ball with CCD, so fast shots can't tunnel (replaces the puck part of `updatePuck` and the board/net calls) | Pass and shot aim, one-timers, handedness, backhand |
| Skater bodies: dynamic balls, contacts solved by Rapier (replaces the body part of `collide`) | Catch, deflect, tip and block outcomes, read from contact events (`bladeSweep` rules) |
| Stick shafts and blades: kinematic capsules with CCD, kept out of bodies, boards and nets by shape casts (replaces the push-out loop in `placeBlade` and `bladeSweep`'s sweep) | Pokes and lifts: what a contact does (`pokeContact` rules) |
| Ragdolls: 3D bodies with joints and limits (replaces the verlet in `ragdoll.ts`) | AI, goalies, Heat, powers, the clock and rules |

Ice settings: zero friction on the ice, linear damping as the glide, and restitution per pair (puck and boards,
puck and blade) from the current `rest` and `STICK.e` values.

## Steps (one at a time, each behind `?rapier` until it plays the same, then the old code is deleted)

0. **Spike.** Install the package, build the rink, nets and 12 bodies, step at 120 Hz. Measure WASM init time and
   bundle size against "starts in seconds", and the step cost against 60fps. Run it twice in Chrome and once in
   Node and compare fingerprints. Stop and report if any of these fails.
1. **Rink and puck.** Boards, nets, goal sensor, CCD puck. Check: shots and rebounds off the boards, no goal
   through the side of the net, puck speeds unchanged.
2. **Skaters.** The skating model sets each body's velocity, Rapier solves the contacts, and the keep-momentum rules
   (carrier keeps more, glancing contact keeps 88%) are applied after the step. Checks call `applyImpulse`.
3. **Sticks.** Kinematic blade and shaft capsules, shape casts instead of the push-out loop, contact events into
   the existing trap, deflect, tip and block rules.
4. **Ragdolls.** A 3D Rapier ragdoll per knocked-down skater (pelvis, spine, head, arms, legs with joint limits),
   driven by the sim's knockdown and slide as now. Keep the existing blend into the get-up.
5. **Clean up.** Remove `collideBoards`, `collideNet`, the old push-outs and the verlet. Update CLAUDE.md.

## Checks for every step

- `node tests/fx_determinism.mjs`: the fingerprint changes once per step. Each new one gets recorded in CLAUDE.md.
  Two runs must still match, and so must Chrome against Node.
- `move_probe`, `stick_physics_probe`, `ragdoll_probe`, `stick_probe`, `fx_probe`, `npm run build`, screenshots.
- Same feel, measured over 4 bot matches, old against new: shot speed, pass completion, knockback against closing
  speed, goals per match.

## Risks

- **Load time:** the WASM adds to the bundle, measured in step 0. It can load in parallel with the GLBs.
- **Feel drift:** a solver behaves differently from hand-written pushes, so steps 2 and 3 need tuning. The
  `?rapier` switch keeps the old physics playable for comparison until it matches.
- **Netcode later:** `world.takeSnapshot()` and restore come with Rapier, so rollback works.

## Step 0 results (2026-11-19, `node tests/rapier_spike.mjs`)

The spike world (`src/physics/spike.ts`, not used by the game) has the boards as a rounded polyline, both nets with
goal-mouth sensors, 12 dynamic skater bodies with kinematic blades and shafts, and a CCD puck shot hard every
2 s. It runs 60 s at 120 Hz (7200 steps).

| Check | Result |
|---|---|
| Same fingerprint: Node, Chromium, Firefox, WebKit (2 pages each) | pass, `8b7cd83b6c078983` on all seven runs |
| Puck never tunnels out (shots up to 54 u/s) | pass |
| Step cost | 0.03 ms average (two steps a frame is 0.06 ms of the 16.7 ms budget), worst 2 ms after warm-up |
| First step | 17-20 ms one-time compile: run a warm-up step while the GLBs load, not at the faceoff |
| `RAPIER.init()` | 14-38 ms |
| Download | compat build is a 3.45 MB chunk (1.30 MB gzip, WASM inlined as base64). The plain build ships the WASM as a file: 2.4 MB, 0.92 MB gzip, compiled while it streams |

Cross-engine: Node, and two fresh pages each in Chromium, Firefox and WebKit (Safari's engine), all give
`8b7cd83b6c078983`. That covers V8, SpiderMonkey and JavaScriptCore, including our own `Math.cos` and `Math.atan2`
around Rapier in this spike. Step cost is 0.024-0.033 ms in every engine.

Verdict: step cost, init and determinism (all three browser engines) pass. Load size is the one cost: about 1 MB gzip more, loaded alongside
the 5.5 MB skater GLB.

## Step 1 results (2026-11-19): rink and puck, behind `?rapier`

`src/physics/rink.ts` holds the boards (2-unit solid boxes outside the rounded rectangle; corner boxes run 1 unit
past their ends so a puck pushed in leaves through the inner face), and the nets (sides and back, open mouth). It
also has one CCD puck body that moves each free puck a step (`puckStep`, damping 0.4, restitution 0.55 boards and
0.4 net, as before). The puck's state stays on the `Puck`, so the world keeps no game state. `puckOut` moves a puck
that game code left inside a wall (a blade deflection, a carry) to the wall surface; it runs once per puck at the end
of the play step. Rapier loads as its own chunk only with `?rapier`, in parallel with the renderer.

`node tests/rapier_compare.mjs` (8 bot matches, old against Rapier, Node):

| | old | Rapier |
|---|---|---|
| goals / shots / saves | 25 / 91 / 60 | 28 / 82 / 61 |
| board hits / posts | 60 / 1 | 55 / 3 |
| steps with the puck outside the rink | 0 | 0 |
| deterministic (two runs) | | yes |

A single bounce (sides, ends, 45 degrees, corner, back of the net) leaves at the same speed within 0.1 u/s. The
average speed off the boards in matches (19.7 old, 14.9 Rapier) differs because the two count different light
contacts, not because bounces are weaker. Browser: 60 fps either way; the sim costs 0.21 ms a frame with Rapier
against 0.15 without; ready in 0.9 s against 0.66 s (localhost). With the flag off the fingerprint is unchanged
(`8f6475929cc84fc5`).

Found on the way: the old carry path never kept a carried puck inside the boards when the blade collider was off.
The end-of-step `puckOut` covers it under Rapier.

## Step 2 results (2026-11-19): skaters, behind `?rapier`

Skaters have their own Rapier world in `src/physics/rink.ts` (`skatersStep`): a dynamic ball of radius `BODY` per
skater (CCD, created in index order), the boards moved in by `SR - BODY` so the body ball stops where the old
`collideBoards(s, SR)` did, and each net as a closed box. Bounciness 0.2 off walls, 0.15 between skaters, 0.4 for a
knocked-down skater; contacts stiffened (8 solver iterations, natural frequency 60) so a pinned skater doesn't sink.
In `collide`, checks land first (a rule, from where the step starts), then Rapier moves every skater and solves the
contacts with mass `1 + 0.12 speed (+0.8 carrying)`, the same weighting the old impulse used. The rules after a contact
(glancing contact keeps 88%, carrier peels off, tangles push apart) still run in sim.ts on the velocities going in.
Slams come from Rapier's contact-start events. Skaters in the air, off the ice or in the box are left out.

Found and fixed for step 1 on the way: the net frame's inner face sat inside where the goal rule counts a goal, so a
puck the rule called in could ring off the inside of the post, and a sliver could slip into the net with no goal.
The frame is now a 0.03 wall whose inner face is at 2.145 (the goal rule's puck edge reaches 2.175), outside 2.175
(old box 2.1), with no overhang past the goal line.

`node tests/rapier_compare.mjs --matches 16` over three seed sets (48 matches):

| | old | Rapier |
|---|---|---|
| goals | 158 | 168 |
| shots | 544 | 503 |
| pass completion | 70-73% | 69-71% |
| checks landed / average hit value | 170 / 13.2-13.8 | 175 / 13.2-14.2 |
| slams | 45 | 43 |
| post hits | 20 | 25 |
| skaters sunk into each other | 0 | 0 |
| deepest a skater went into the boards | 0 | 0.14 (2-10 steps of ~150k) |

Single-skater checks in `node tests/move_probe.mjs --rapier` (skating timings, stop, turns, knockback against
checker speed) give the same numbers as without. Browser: 60 fps either way, no errors, no frames over 40 ms.
With the flag off the fingerprint is unchanged (`8f6475929cc84fc5`).

## Step 3 results (2026-11-19): sticks, behind `?rapier`

`src/physics/rink.ts` adds two queries; game rules stay in sim.ts:
- `bladeWalls` (in `placeBlade`): the blade's ball is cast from the hands toward where it is aimed and stops at the
  first board or net, so a blade can't reach through one (the old push-out could pop it out the far side of a net).
  Each net also has a closed sensor box in the puck world: the puck passes through it, blade casts don't, so no blade
  reaches in through the mouth. `puckOut` ignores sensors. Pushes off other skaters' bodies stay in sim.ts (they
  have a rule: the shaft gets a little give over the hips).
- `sweepHit` (in `bladeSweep` and `pokeContact`): exact time of contact between the moving puck and each moving
  blade capsule (Rapier's two-shape cast), replacing up to 48 samples per blade. The trap, deflect, tip and block
  rules run on that contact unchanged. Pokes cast the poke blade against the puck and against the carrier's
  whole shaft; the first contact not shielded by his body counts, and a shaft contact counts only where its closest
  point is clear of his body (the old rule, checked at the contact).
- Like the old sweep, the blade doesn't turn within a step.

`node tests/stick_physics_probe.mjs --rapier`: all 22 checks pass (as without). Two failed on the first try and
were fixed: a blade reached into the net through its mouth (the puck world's net is open; fixed with the sensor
boxes), and a poke from behind lifted a stick the carrier's body shielded (a clipped-shaft shortcut wasn't the old
rule).

`node tests/rapier_compare.mjs --matches 16` (now also counts stick contacts) on seeds 777, 101, 4242:

| 48 matches | old | step 2 | step 3 |
|---|---|---|---|
| traps | 183 | 144 | 146 |
| deflects | 341 | 305 | 320 |
| tips | 15 | 13 | 17 |
| pokes / ties | 20 / 80 | 17 / 76 | 21 / 72 |
| goals / shots | 155 / 556 | 167 / 498 | 175 / 510 |

Step 3 doesn't move stick contacts compared with step 2. Rapier traps about 20% fewer pucks than the old physics
since step 2 (not counted then), with fewer shots; one seed's fewer saves and board hits was also already there in
step 2. Deterministic on every seed; the puck never leaves the rink. Sim cost in Node: 36 -> 52 us a step with
Rapier (old 13-20), about 0.03 ms a frame. Browser: 60 fps with and without `?rapier`, no errors, worst frame
23-26 ms either way. With the flag off the fingerprint is unchanged (`8f6475929cc84fc5`).

Found after step 3 (2026-11-19), a step 2 bug: the goalie's "skaters slide off the crease" push ran after Rapier's
step and moved skaters without Rapier knowing, so a skater squeezed between the goalie and the net was pushed into
another skater every step (49 steps of deep overlap in one match once passes got faster). The goalies are now
kinematic balls in the skater world (`skatersStep(..., goalies)`), placed at the goalie each step (no state kept,
so the result doesn't depend on what ran before), and the old push only runs without Rapier. Overlaps 0 on all
three seeds, deterministic. Skaters touching a goalie don't count as a wall hit (no slam).

Faster passes (`PASS_BASE.speed` 1 -> 1.4, `STICK.recvCatch` 40 -> 56): release about 26 -> 37 u/s, a typical pass
lands in 0.20 s instead of 0.28-0.32; pass completion 70% -> 75-79% in both. New fingerprint without `?rapier`:
`5ee778febb9f033e`. Checks landed under Rapier are lower than old over three seeds (145 vs 179); watch it.

## Step 4, revised (2026-11-20): powered ragdolls, display only

The user asked for real physics on the characters instead of fixed attachments and set animations. Every skater gets a
3D Rapier body (`@dimforge/rapier3d-compat`, client only, not deterministic, the sim never reads it): about 16 parts
joined at the joints, each pulled toward its animated pose every step (velocity drive, like Unreal's world-space
physics controls), so contacts and hits push the body off the pose and the drive pulls it back. The stick is its own
body, joined to both palms. The existing layers (clip, gait, look, stick IK, grip rig) become the target pose.

**Sim stays in charge.** The 2D sim decides every pass, block, poke and check from its own stick and puck colliders.
The display world has no puck, so a drawn stick can never block or trap anything. The drawn stick is pulled hard to
the sim's stick pose (the IK stick, aimed at the sim blade) and may only be pushed off it by contacts within a cap; past
the cap it is put back. Measured: drawn blade against the sim blade every frame.

**Spike pass/fail, set before building** (`?phys` on all skaters, `?phys=i` one; 60 s bot match, Chromium, this Mac):

| Check | Pass |
|---|---|
| Physics cost per frame, 12 skaters (targets, step, write-back) | mean < 2 ms, p95 < 3 ms |
| Palm to its grip on the drawn stick, from the physics result, no IK snap after | every frame < 1 cm |
| Drift from the animated pose, outside hits and falls | bone angle p50 < 5 deg, p95 < 15 deg; pelvis and palms p95 < 3 cm |
| Stability | no NaN; joint gaps < 2 cm; no frame where a bone's error jumps > 20 deg; no part faster than 30 m/s |
| Drawn blade against the sim blade | p99 < 3 cm, worst < 6 cm |
| Close-ups at the game camera, fresh-context reviewer | no creases or spikes, both hands on own stick, elbows natural |

Any fail: report and stop, no rollout.

### Spike result (2026-11-20): FAIL, not rolled out

`src/physics/body.ts`, behind `?phys` (off by default). 12 rigs (10 skaters, 2 goalies), 19 bodies each plus a stick
body, ball joints, velocity drive toward the layered pose, one collision-group bit per rig (contact hooks never fire
in rapier3d-compat 0.21, checked in Node). `node tests/phys_spike.mjs 60`, this Mac, Chromium:

| Check | Result | |
|---|---|---|
| Cost per frame, 12 rigs | mean 1.23 ms, p95 1.4 ms | pass |
| Palm to grip, physics result | 1802 of 35458 skater-frames over 1 cm, worst 2.46 m | FAIL |
| Bone angle off the pose | p50 0.02 deg, p95 2.2 deg | pass |
| Pelvis and palms off the pose | p95 2.4 cm | pass |
| NaN | 0 | pass |
| Joint gaps | worst 2.46 m | FAIL |
| Error jumps > 20 deg / parts > 30 m/s | 2990 / 983 | FAIL |
| Drawn blade against the sim's | p99 5.0 cm (held at the 5 cm cap), worst 5.3 cm | p99 FAIL, worst pass |

Why it fails: tracking alone is exact (joints and contacts off: bone angle p95 0.3 deg), but the target the layers give
moves the hands and stick up to 0.3-0.6 m in one frame in crossovers, stops and slapshots. Interpolated per body
across the substeps, those targets don't fit the joints, the joints fight the drive, and the stick (held to the sim's
blade) tears away from the gloves. More solver iterations made it worse (grip fails 1658 -> 2538 frames over 15 s).

Sync with the sim (kept, works): the display world has no puck; the drawn stick has no contacts (the sim lets a stick
lie through other skaters' legs, so any push would contradict it); its blade is held within `BODY.bladeCap` (5 cm) of
the sim's stick every substep.

Bugs found on the way, fixed for everyone: a hit's squash baked into the stick's scale for good through the grip rig's
decompose (stick scale now reset with its rest position each frame).

Next options, for the user to pick: (a) fix the source pops first (hands and stick jumping 30-60 cm a frame in
crossovers and stops are visible without physics too), then retry; (b) hands and stick kinematic, physics on the body
and arms only, with the grip rig run after the write-back; (c) Rapier multibody joints (reduced coordinates, can't
drift apart) with motors instead of the velocity drive.

### Retry after fixing the source pops (2026-11-21): still FAIL, not rolled out

The user picked (a). Pops measured first without physics (`node tests/pop_probe.mjs [secs]`: palms, blade, shoulders,
pelvis and neck in the skater's own frame, frame to frame), each pass isolated by stage, then fixed where they start:

- Gait posture (render.ts `gaitLegs`, `GAIT.post`): hip height, torso lean and side lean were set outright from the
  mode and speed, so every change of mode (stride, glide, stop, pivot, cross) and every speed burst snapped the chest
  10-20 cm in one frame. Now eased (7/s). `?nopost` restores the old.
- Grip rig (`gripFit`, `popAbsorb`, `floorM`): the grip fit moved the blade a median 32 cm (up to 1.3 m) off the
  stick IK's and flipped between solutions. Now: fit, take any jump out with a pop absorber (inertialization: the stick
  follows exactly, but a change of speed past `POP.acc` / `POP.alpha` goes into an offset that decays like a critically
  damped spring, half-life 60 ms, capped in speed), keep the blade off the ice, fit again from the smoothed pose. The fit
  also slides the stick so the top grip stays in reach (it used to only turn about the bottom grip, which could leave
  the top grip out of reach). `?nopop` turns the absorber off.

Without physics (40 s bot match, 23.7k skater-frames; before -> after): hand or blade jump p99 63 -> 42 cm, p99.9 2.06
-> 1.30 m, frames over 15 cm 12.3% -> 8.6%; neck p99 20 -> 9 cm, shoulders 21 -> 11 cm. Blades below the ice 5.6% ->
3.0%; carried puck to drawn blade p90 1.89 m -> 1 cm (`tests/stick_probe.mjs`). Grip check 60 s: 0 frames over 1 cm
in 4 of 4 runs (the slide rule is off while a skater is down: in falls it left the top grip out of reach). Sim fingerprint unchanged.

Spike, same table, 60 s (verify/phys_spike_retry_60s.txt):

| Check | First spike | Retry |
|---|---|---|
| Cost per frame | 1.23 ms | 1.17 ms (pass) |
| Palm to grip over 1 cm | 1802 of 35458, worst 2.46 m | 667-1144 of ~35k (two runs), worst 1.6-2.0 m (FAIL) |
| Bone angle p95 / pelvis and palms p95 | 2.2 deg / 2.4 cm | 0.5 deg / 0.2 cm (pass) |
| Joint gaps | 2.46 m | 1.98-2.14 m (FAIL) |
| Error jumps / fast parts | 2990 / 983 | 1502-1752 / 458-553 (FAIL) |
| Target pose's own grip error | up to 8.6 cm | 0 (the layers now hand physics a consistent pose) |

Without the blade cap (`?bladecap=9`, a diagnostic): grip misses 331, worst 48 cm, so the cap's teleport of a jointed
body is part of what tears the gloves off, but not all of it. Remaining hand and blade jumps (8.6% of frames over 15 cm)
are mostly in steady stride and crossovers and were not traced further.

Blind review (fresh subagent, images and rules only): without physics verify/pop_r1 4/7 (strict 3), with physics
verify/phys_r2 4/7 (strict 3), first spike 3/7. Both sprints show no stick at the game camera; physics backhand has the
shaft into the torso.
