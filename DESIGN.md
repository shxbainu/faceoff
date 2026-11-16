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

- **WASD**: skate, with glide and momentum. **Shift**: short burst, uses stamina.
- **J**: pass. Auto-targets the best open teammate in the direction you face and leads the pass. A teammate pressing their pass key is "calling for it" and gets priority, shown with a ring.
- **K**: hold to wind up, release to shoot. Always goes at the net; the held direction key picks the corner; a wide sweet spot on the wind-up gives a harder shot.
- **One-timer**: hold K before a pass arrives to shoot the instant it lands. This is the main skill shot.
- **L**: context defend. Poke-check near the carrier, block in a shooting lane, body-check at speed. Checks must drive through the target, not stop on contact.
- **1 / 2 / 3**: pick a power card between rounds.

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
