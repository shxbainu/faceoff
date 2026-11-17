# Faceoff — design handoff

Status as of 2026-11-14: **v1 built and playable** (single-player vs bots, no multiplayer). Run with `npm run dev`; verify with `npm run build` then `npm run playbot`.

### v1 as built (see `src/`)

- `sim.ts` is a seeded, fixed-step (120 Hz), input-driven simulation with no rendering in it, so it can move to a game server later. `render.ts` (Three.js WebGPU, WebGL2 fallback), `main.ts` (flow, HUD, loop), `audio.ts` (synthesised sound).
- Physics is hand-written 2D circles in a rounded rink. Rapier is not used yet.
- The player controls one fixed skater (the centre); two bot teammates. Nets are recessed into the end boards. No goalies: the deepest defender on each side has the automatic save reach.
- Faceoffs are a timing draw: tap J the instant the puck lands.
- Match is first to 3 or the leader after 90 seconds; tied at 0:00 goes to sudden death with saves weakening over time.
- Built gimmick teams: Permafrost (frost lanes), Wrecking Crew (only big hits drop them), Night Shift (lights out), boss Resurfacer Union (ice machine drives through play). The boss is deliberately not a referee team, to stay clear of the reference game.
- Built powers: Curve Pass, Shockwave Check, Split Shot, Afterburner, Magnet Stick, Heavy Slapper, Hot Hands, Iron Wall. Split + Curve combine.
- Test hooks: `?round=N`, `?powers=split:1,curve:2`, `?seed=N`, `?webgl` (force WebGL2). `window.__faceoff.snap()` and `.perf()` feed the playbot.
- Heat tiers are real buffs for the home team: each tier (x2, x3, x4, on fire) adds +6% shot speed, +15% knockdown time, −13% check cooldown and a little skating speed. Heat decays after 2.5 idle seconds and drops when you get flattened or concede.
- Checks: longer hit-stop, heavier knockback, a cartoon impact star, camera punch toward the hit, board slams.
- Bots attack: carriers drive the net and shoot early, forwards weave through the slot and get fed for one-timers, the defender steps up to the point only when the puck is deep.
- Finding yourself: thick blue ring with ink edge, beam, overhead arrow, a "You" tag that pins to the screen edge, and a red arrow on the ice pointing at the puck.
- Camera: vertical "2K" view from behind your own end looking up-ice. You attack the net at the top of the screen. It follows you and the puck along the rink and pulls back only when you are far apart.
- Controls follow the screen: W skates up-ice, S back, A and D left and right. A or D while shooting picks the corner.
- Not built yet: multiplayer, overworld map, roster stats, elite-team variations beyond higher bot skill.

### Prototype pass, 2026-11-15 (after user playtest feedback)

Feedback: 3v3 felt thin; Heat was "just numbers"; anyone could be flattened from a standstill, so play turned into trading checks and nobody could hold the puck; skaters have no identity.

Built now:
- **5v5 prototype.** Default is 5 a side (centre, two wings, two defenders). `?team=3` brings back 3v3. Rink size is unchanged.
- **Checks need momentum.** A check is worth its closing speed. Under 7 it is a shove (target stays up and almost always keeps the puck, the checker is left off balance). 7 to 11.5 is a hit. Over 11.5 is a big hit. Lunges only add to speed you already carry toward the target.
- **Checks cost stamina** (about a third of the tank), and a whiff adds recovery time.
- **Standing checks tie people up.** A check without momentum does not knock anyone down or free the puck; it slows the target for about half a second.
- **Pokes are aim and timing, not a dice roll.** The poke lands only if your stick reaches the puck itself (about 1.5 units) and the carrier's body is not in the way. The puck rides in front of the carrier, so turning away shields it. A just-received puck has a short grace. No random success chance.
- **No button modifiers.** A "hold L to protect" stance was tried and removed on user feedback: defence and puck protection come from position, facing and timing.
- **Heat is a small momentum bonus.** Tiers now give about +2% shot speed and +8% stamina refill each, and "on fire" only sends skaters over the boards on big hits. The main sources of power are the abilities and passives picked between rounds.
- **Bots:** only commit to a check with real closing speed or when their stick can reach the puck, mark separate attackers in 5v5. Round 1 opponents start a little sharper.

Held for v2:
- **Skater identity:** per-skater stats (speed, shot, hands, checking) and one trait each, a roster screen, visible archetypes (sniper, grinder, playmaker).
- **More abilities and passives** as the main source of power (per user: Heat stays a minor momentum bonus).
- **5v5 done properly:** rink scales with team size, line changes, positional play calls.
- **Run structure closer to the reference experience:** a map of games between rounds, pick-1-of-3 for coaches and abilities, relics, post-game stat sheet. Original teams, names and art throughout.
- **Difficulty:** elite-team variations, bot systems (forecheck, trap), a difficulty curve tuned from real playtests.

### Playtest feedback, 2026-11-15 (second round, not built yet)

From the user's own play of the 5v5 prototype:
- The game is close to unplayable: too fast to think, and it feels slidy with too little animation.
- The rink is too small and the skaters too big for it. Hitboxes feel crammed. Wants a longer, wider rink and slower, less aggressive puck movement, closer to how Tape to Tape plays.
- Controlling only one fixed skater feels removed from play. Wants to control more than one (switching).
- Bots just run at the puck. No passing set-ups, no formations.
- The stick must be its own model, not fused into the player mesh.

Proposed order (assistant's recommendation, to be confirmed):
1. **Before more models:** rink size, skater scale and hitbox, and overall speed. These decide how big every other model has to be, so nets and boards should not be fitted until they are settled.
2. **With the player model:** separate stick, so it can swing on shots and checks.
3. **After models:** player switching, bot formations and passing, then skating animation.

## The decision

After many rounds of concepts, the user chose **Faceoff**: arcade ice hockey played as a roguelite run, with a Heat (style) meter and stacking power-ups. Every other concept was dropped, including the arena shooter "Overdrive".

## Design rules (every screen)

Design rules for this whole project. Follow them on every screen:

- No purple to blue gradients, no gradient text, no colored glows, no blurred blobs.
- No emoji as icons or decoration. No sparkles for anything AI.
- No "New", "Pro" or "Beta" badges unless I ask for one.
- Use one neutral color ramp and one accent color, used once or twice per screen.
- All spacing on a 4px grid. Sentence case labels. Two font weights at most.
- If you are about to add something only to make it look impressive, leave it out.

### Look (revised 2026-11-15)

The cartoon pass (cream paper boxes, comic starburst, blob skaters, tilted panels) was rejected as too toon. Current direction: grounded and readable, still fun and low-poly. Tape to Tape is a loose reference only, never copied.

- Skaters read as players: legs, hips, leaning torso, shoulder pads, arms, gloves, small helmet with visor, stick.
- Hits feel solid: hit-stop, camera punch, directional ice spray and a tight white ring on the ice. No starbursts or comic shapes.
- HUD is a plain game HUD: opaque dark panels, 2px borders, no tilt, no shadows. Neutral ramp `#14171d`, `#232830`, `#3a424e`, `#9aa3b0`, `#eef1f4`; accent red `#e5482d`. One font, Archivo, at weights 500 and 800, bundled through `@fontsource`.
- Still banned: gradients, glow, gradient text, emoji icons, huge white bold italic text, broadcast-style condensed caps.
- Tokens live at the top of the `<style>` block in `index.html`.

## Hard rules from the user

- Easy on a laptop trackpad: keyboard only, no precise aiming or tracking.
- Addictive, constant dopamine: hit feedback, score popups, style meter, big physical moments.
- Depth and a high skill ceiling.
- End goal is multiplayer, including larger lobbies, co-op and drop-in, not only 1v1.
- Creative, not a generic clone. Original teams, characters, names and art.
- Stack and art rules are in CLAUDE.md (low-poly, moving from procedural to GLB assets per assets/PLAN.md, no realistic faces, 60fps, restart in 1 second).

## Core game

- Arcade hockey, short and loud. A round is **first to 3 goals**, about 90 seconds. Puck is back in play within 2 seconds of a goal.
- Four verbs: skate, pass, shoot, check.
- No fixed goalie for human players: the deepest defender gets a wide automatic save reach. (Bot goalies are fine for bot teams.)

### Controls (keyboard only)

Changed 2026-11-16 at the user's request to follow the reference game's key layout, kept simple:

- **W A S D** or arrows: skate.
- **Space** (hold): sprint. Drains the sprint bar under your skater (about 2.4 s from full, refills in about 3 s after a short rest). Empty it and you are winded: no sprint until it is back past the tick at 35%. Checks also draw from it. Bots use the same bar.
- **J**: pass (auto-targets the best open teammate in the direction you face). Without the puck it calls for a pass. Tap on the faceoff drop.
- **K**: saucer pass, lifted over sticks so it cannot be picked off; a little slower.
- **L**: wrist shot, instant release, accurate, not as hard.
- **I**: slapshot, hold to wind up and release; the sweet spot in the wind-up hits hardest. Hold it before a pass lands for a one-timer.
- **Shift**: body check (needs speed; from a standstill it only ties the player up).
- **U**: poke check (only works if your stick reaches the puck).
- **Q**: switch to the skater nearest the puck (control also follows passes and possession automatically).
- **O**: special ability (reserved; no active abilities yet).
- **1 / 2 / 3**: pick a power card between rounds. **R**: restart the run.
- Hold A or D while shooting to pick the corner.

### Heat meter (the dopamine layer)

- Filled by one-timers, big hits, passes lifted over a stick, dekes and saves.
- Every one of those gets a named score popup over the play (for example "One-timer +300", "Big hit +200") and a rising tone.
- At full Heat the team is on fire for about 10 seconds: puck ignites, shots are harder, checks send skaters over the boards.
- Other feedback: brief slow-motion as a one-timer leaves the stick, freeze-frame on big hits, net bulge, goal horn.

### Roguelite run and stacking power-ups

- A run is **8 rounds** in roughly 12 minutes, with elite teams and a boss at the end.
- After each round won, pick **1 of 3 power cards**.
- Picking a power you already own **levels it up**; new powers add to the stack. Powers combine (Split shot + Curve pass = two curving pucks).
- Example powers: Curve pass (passes bend around defenders), Shockwave check (hits flatten nearby skaters), Split shot (shots split into two pucks).
- Lose a round and the run ends; a new run starts immediately with an empty stack.
- Every opponent team bends the rules with a stated gimmick, shown on an intro card. Ideas: freezes lanes of ice, plays with two pucks, cracks the rink into drifting floes, a referee team that cheats.
- Open choice (my default, not confirmed by the user): in versus play the losing side also gets a pick each round so leads don't snowball.

### Camera and look

- "2K-style" vertical camera, as in the reference video: behind your own end, looking up-ice, with the rink running top to bottom and the net you attack at the top. The user rejected the side-on (horizontal) broadcast view. Skaters are large; boards and crowd sit at the screen edges.
- Skaters are chunky low-poly figures with helmets and visors, no faces. Teams have strongly contrasting colours.
- Physical comedy: skaters knocked flat, dropped sticks left on the ice, marks left on the ice.

### HUD layout

- **Bottom-centre**: one compact scoreboard bar: team colour chip, three-letter code, score, clock. A small banner above it shows the round and win condition ("Round 4 · first to 3").
- **Top-left**: Heat meter with multiplier.
- **Top-right**: power stack, one icon per power with its level count.
- **On your skater**: blue arrow above, blue disc underneath, active power icons floating over the head. Must be unmissable.
- **Between rounds**: full-screen pick screen with three cards (name, one-line effect, "Level 2 to 3" or "New power", key to press), a "Your stack" row, and what comes next.
- Keep everything else off the screen during play.

### Multiplayer plan

- **Co-op runs**: 1–4 players on one team against bot teams, drop-in between rounds.
- **Versus**: 2v2 up to 6v6, rink scales with player count, each side drafts powers.
- **Lobby night**: 8–12 players in a quick bracket of 90-second games.
- Bots fill every empty skater and are swapped out when a player joins; matches never wait.
- Needs a small game server added to the stack (not chosen yet).

### Suggested build order

1. Rink, camera, one skater with good skating feel.
2. Puck physics, pass, shoot, one-timer.
3. Bot teammates and opponents, checking, goals, scoreboard.
4. Heat meter, popups and feedback effects.
5. Run structure and power cards.
6. Opponent gimmicks, elite and boss teams.
7. Networking: co-op first, then versus.

## Ideas discussed for hockey but not confirmed

- **Meltdown**: skating scars the ice, scarred ice is slow, the rink cracks into holes late in a period. The first concept sketch showed ice scars; the user never confirmed keeping it. Could be an opponent gimmick or rink variant.
- **Pass charge**: each completed pass charges the puck up to 5 and a goal is worth the charge. Not confirmed; partly absorbed into Heat.
- **Raid mode**: everyone on one team against a giant boss goalie with a health bar.

### Phase 1 built, 2026-11-16: scale, pace, goalies

Plan agreed with the user: Phase 1 scale, camera, pace (+ goalies and shot placement) → user playtest → Phase 2 control switching and bot formations → Phase 3 models fitted to the new scale (separate stick, puck, 2.5D look) → Phase 4 skater stats and abilities → Phase 5 run structure (v2).

- **Rink 80 × 38** (was 44 × 22), corner radius 8.5. Skaters keep their size, so a skater is now about 3.7% of the rink width (reference about 3%). Markings placed as fractions of the rink.
- **Camera** higher and steeper (distance 37, elevation 1.15 rad), north to south, showing about a third of the rink length.
- **Pace:** top speed 8.6 (was 9.6), acceleration 34 (was 44), passes 18 (was 21), shots about 10% slower.
- **Goalies:** one per team, always in the crease, sliding along the goal line. They cut the angle toward the puck and react to a shot after a short delay (0.1 to 0.2 s, better for stronger teams). A shot at the body is almost always saved; toward the posts the save chance falls off and a better shot beats it. Slow loose pucks at the goalie's feet are cleared to the corner. The deepest-defender automatic save is gone. Iron Wall now widens the goalie's coverage.
- **Shot placement:** hold left or right while shooting to pick the corner. With no direction held the shot goes to the side the goalie is leaving open, a little less accurately.
- **Bots:** positions scale with the rink; only the nearest skater chases a loose puck, the rest keep their shape.
- Playbot, three matches: about 6 in 10 shots saved, 59.9 fps, no errors.

Open decision (2026-11-16): the user pointed out the reference is 2.5D, hand-drawn 2D sprites in a 3D rink with a north-to-south camera. Proposed for Phase 3: render our own skater model to sprite sheets in Blender (directions × poses) and draw them as camera-facing sprites in the 3D rink. That gives the 2.5D look from our own art.

### Playtest of Phase 1, 2026-11-16 (user)

- Biggest problem: the camera is straight overhead, a bird's-eye view, not 2.5D.
- Rink no longer feels crowded, but bots still rush the puck with no strategy; three of them close on you every time; the players move as one pack straight up and down the middle.
- You only ever see about half the rink, because the camera follows your one skater.
- Skater models look bad and have no animation. Move to 2.5D soon with better assets.

Measured from a full-resolution reference frame (video 80 s): the centre circle is about 527 px wide and 305 px tall, so the camera pitch is roughly 35 to 40 degrees above the ice, not the 66 degrees Faceoff uses. Skaters are seen at three-quarter view, which is what makes the sprites read.

Plan (proposed 2026-11-16):
1. **Camera:** pitch about 38 degrees, north to south, following the puck instead of your skater.
2. **Control switching:** you control the puck carrier on offence and the skater nearest the puck on defence, plus a switch key.
3. **Team AI with a shape**, from sports-game AI practice: each role has a home spot that shifts with the puck (a weighted mix of the formation spot and the puck position). Only one skater pressures the carrier (F1); F2 supports, F3 stays high; the two defenders keep a gap and never both pinch. Rotation rule from the 1-2-2 forecheck: when F1 forces play to a wall, the nearest middle forward takes that wall and the far one holds the middle. Bots on your team cover rather than press when you are nearest the puck.
4. **2.5D skaters:** rig and animate a skater (stride, glide, wind-up, shot, check, fall, goalie stance), render it in Blender from 8 directions at the game's camera pitch into sprite sheets with a separate team-colour mask, and draw camera-facing sprites in the 3D rink.

### Built 2026-11-16: 2.5D camera, switching, team shape

- **Camera** pitch 0.66 rad (about 38 degrees, measured from the reference) instead of 66 degrees; it follows the puck (80%) rather than your skater.
- **Control switching:** passing hands control to the receiver as the pass leaves; a teammate picking up the puck gives you that skater; when the other team takes it you get the home skater nearest the carrier. **Space** switches to the skater nearest the puck.
- **Team AI:** one presser per team (forwards first, defenders only in their own zone; on your team the presser is you when you are close). Everyone else takes a formation spot that shifts with the puck: wingers stretch their lanes and work the half-walls, the centre trails then takes the net front, defenders trail and hold the blue line; on defence a 1-2-2 back-check in the neutral zone and a box in front of the net in their own zone, marking the nearest attacker goal-side.
- **Carriers** keep the puck about 1.2 s (median) instead of 0.4 s; they pass under pressure only after a while, otherwise only to a teammate further up the ice; they shoot from up to 17 units with a lane.
- Test hook: `?autoplay` lets bots play your skater too. Headless check over three bot-vs-bot matches: puck owned 63% of the time, about 6 shots per match.

### New skater (2026-11-16)

The user rejected the first player model (too tall and squashed, stick fused and rigid). Free ready-made options were checked first: no free 3D skater beyond a crude Sketchfab one; free 2D hockey sprites are straight top-down with 2 to 4 frames (unusable at a 38-degree camera); Quaternius base characters (CC0) have realistic faces and no gear. So a chunky cartoon skater was generated on Hunyuan in a T-pose with no stick (`assets/src/skater/`), for Mixamo auto-rigging. Plan: rig, animate (stride, glide, wind-up, shot, check, fall, goalie crouch; hit and fall clips from Mixamo or the CC0 Quaternius Universal Animation Library), stick as a separate prop in the hand, then render 8-direction sprites at the game's camera pitch with a team-colour mask.

### What gives shots their punch in the reference (studied 2026-11-16)

One goal sequence studied frame by frame at 14 fps (video 17.6 s to 20.2 s). Seen: a short white streak behind the puck while it travels; on the goal a red light wash floods the end boards behind the net; a "GOAL" stamp in the scoreboard bar and a banner with the scorer's name. Not seen in this sequence: screen shake or slow motion. One shot is a small sample; more shots need checking before drawing firm conclusions.

## Reference video, re-checked 2026-11-15

The video is on disk: `~/Downloads/YTDown.com_YouTube_Media_wTGC_-PaM5E_Tape-to-Tape-1-0-FULL-RELEASE-Worth-Your-Time-and-Money-Overview_002_720p.mp4` (9:14, 720p). 28 frames were pulled at 20-second steps. Measured from those frames:

- **Scale is the big difference.** The camera is high and steep, nearly top-down, and shows roughly a third of the rink length at once. A skater is about 30 to 40 px tall on a 720 px frame, and the rink width fills the screen, so a skater is only about 3% of the rink width. In Faceoff a skater is about 10% of it. That is why our rink feels crowded and the hitboxes feel crammed.
- Rink runs top to bottom on screen with lots of open ice around each player.
- 5 skaters and a goalie per side, plus referees skating on the ice.
- Your skater: small icon above the head, a blue disc under the feet, position and name label below ("RW KOVALSKI").
- Knocked-down skaters lie flat; dropped sticks stay on the ice.
- Between games: roster with SPD, ACC, PWR, CHK and an overall rating; each skater has active and passive abilities; pick 1 of 3 coach cards; an equipment shop; "select a superstar" draft; a versus card before boss games.
- Characters are cartoon, cel-shaded; HUD is a small scoreboard bar at bottom centre.

## Reference: the user's Tape to Tape video

The user attached a gameplay overview video as the inspiration. Analysed from 45 still frames, no audio. Take the experience, not the content.

- Camera is a vertical up-ice view following the puck. Not side-on.
- HUD is one scoreboard bar bottom-centre, a small win-condition banner above it, and a player portrait with ability icons top-left.
- The controlled skater has a blue arrow, a blue disc underneath, a name label and ability icons overhead.
- Big-headed cartoon skaters; every opposing team has a distinct colour.
- Periods are about two minutes.
- Between matches: an overworld map of nodes, and "pick 1 of 3" everywhere (coach clipboards, ability cards, starting superstar).
- Roster screen with four stats (speed, accuracy, power, checking), active and passive abilities, relics.
- Elite and boss games get an intro card describing the team's gimmick; the boss is a team of referees.
- Post-game stat sheet: shots, hits, time on attack, passes, blocked shots.
- Known weak points from reviews: clunky body checks, weak AI teammates, easy to lose your skater, no native online play. Beat these.

## What the user rejected, and why

Useful for judging future suggestions.

- One-mechanic games, 2D games dressed as 3D, one-button or one-aim games: too shallow.
- "Travel from A to B" loops in any skin.
- Skating and trick games: too many exist, and tricks as the only reward is too narrow.
- Pure 1v1 shooters and duels as the only multiplayer.
- Existing games with one rule changed (the user named these as clones of Fall Guys, Chained Together, slither.io, and a mobile horde roguelike).
- Ideas that sound clever but aren't viscerally rewarding (pinball arena, chain-reaction arena, time-loop hockey).
- Do not compare ideas to Cork7.
- The user liked: Under the Red Sky style parkour, Ultrakill / Karlson / Redliner style feedback (style meter, hit markers, big score popups), and arcade hockey.

## Environment notes

- Node.js v26 and npm 11 were installed with Homebrew on 2026-11-14 because npx was missing.
- Playwright MCP was added with `claude mcp add playwright npx @playwright/mcp@latest` and showed Connected. It was added at local scope for the original session folder, so it must be added again in the project folder (or with `--scope user`).
- Playwright's browser builds were not downloaded yet.

### Reference video, frame by frame (2026-11-16)

Stepped through the reference at its native 59.94 fps (ffmpeg), following one skater around 84.5 s
(`assets/src/reference/t2t_turn_60fps.png`, `t2t_stride_60fps.png`).
- **Turning is continuous.** Over about 8 frames the skater goes from side-on to straight away from
  the camera, a little further each frame; the name and number on his back slide gradually around the
  jersey. That is not 8 fixed drawings swapped at 45 degree steps. It behaves like a 3D model drawn
  with ink outlines and flat cel shading (or a sprite set with dozens of angles).
- **The stride is smooth.** The legs change pose every 2 to 3 video frames, so roughly 20 to 30
  drawings per second, with a soft round shadow under the skates.
- **Look:** dark ink outline, two flat tones per colour, big-headed cartoon proportions, names and
  numbers on every jersey.
- **What this means for us:** separately generated 2D images can't give continuous turning or a
  20-30 fps stride with one consistent character. Our animated 3D skater drawn in the game with an
  ink outline and cel shading can, and that is not converting 3D into sprites: it stays 3D.

### 3D skater in the game (2026-11-16)

- `assets/models/skater.glb` replaces the old player model: one skinned skater cloned per skater and
  goalie, team-tinted (white cloth takes the team colour, red gear the trim; helmets take the trim).
- Drawn look: flat cel shading (three tones) and an ink outline that follows the skinned mesh
  (back-face hull pushed out along the normal), the style the reference uses.
- Clips follow the sim: stride (speed scales the playback), glide, idle, slapshot wind-up held while
  the shot button is down then released, wrist shot, body check; goalies hold the glide stance.
- 2560x1440 playbot run: 59 fps on WebGPU, skater GLB loads in about 0.3 s, no errors. Old box
  skater stays as the fallback.
- Still open: skaters are about 55 px tall on a 720p screen (reference about 90 px), so the camera
  could come closer; no fall/hit clips yet (falls still tip the whole body).

### Playtest feedback and plan, 2026-11-16 (evening)

Feedback (user): too few offensive options (you can only turn and move side to side); wants skill moves and
moves without overcomplicating, skater attributes, active abilities as in the reference; more speed feeling
and "oomph" on big hits and shots (impact frames, more dopamine on every action); no space behind the net,
which real hockey has; more animation and less rigid movement.

Mapped onto the phase plan (1 rink/camera/goalies done, 2 switching/formations done, 3 models mostly done,
4 stats and abilities, 5 run structure):
1. **Finish Phase 3 now.** Nets on a goal line 4.4 units out from the end boards (NHL 11 ft of 200) with room
   to skate behind; movement feel: body lean into turns, crossover steps, hockey stop with ice spray, backward
   skating, smoother acceleration and turning.
2. **Game-feel pass** (the feedback layer from the build order, step 4) before Phase 4, so abilities land on
   actions that already feel good: impact frames, hit-stop scaled by hit size, camera punch and kick, shot
   trails, speed lines at full stride, bigger hit and goal moments, layered sound.
3. **Phase 4:** attributes (speed, shot, hands, checking) and visible archetypes; two skill moves on existing
   keys without modifier buttons (quick deke, spin); one active ability per skater on O; passives from rounds.
4. **Phase 5:** run structure.
