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
