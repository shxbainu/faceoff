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
