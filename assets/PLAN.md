# Faceoff asset plan

Goal: replace procedural low-poly models with high-quality GLB assets, one at a time, without changing gameplay, controls or the look direction. Each procedural model stays in code as the fallback if its GLB fails to load.

Status: crowd and players swapped and verified. Puck, nets, boards, ice and ice machine not started.

## 1. Audit: every procedural model in the game (2026-11-15)

All geometry is created in one file, [src/render.ts](../src/render.ts). `src/sim.ts`, `src/main.ts` and `src/audio.ts` create no meshes. There are no model files in the repo and no loader code.

World scale: 1 unit ≈ 1 m. X runs along the rink, Z across it, Y up. Rink half-length `L = 22`, half-width `W = 11`, corner radius `CR = 6` (constants in `src/sim.ts`).

### Models the request names

| Asset | In the game now? | Built by | Lines | What it is today | Notes for the swap |
|---|---|---|---|---|---|
| Players (6 skaters) | Yes | `buildActors()` | 254–290 | About 17 box meshes each plus an icosahedron helmet: skates, legs, hips, leaning torso, waist band, shoulder pads, arms, gloves, visor, stick shaft and blade. About 2.25 units tall, faces +X, collision radius `SR = 0.7`. | Team colours come from two shared materials per team (`body`, `trim`) recoloured in `setTeams()` (332–341). The GLB must keep a tintable jersey and trim. No skeleton or animation today: the whole body group is tilted for lean, checks, shot wind-up, knockdown and air spin in `frame()` (420–439). |
| Player stick | Yes, part of the player | `buildActors()` | 265–266, 285–286 | Box shaft 1.5 long and box blade, fixed to the body. | Swap together with the player, or as its own prop if the player model has none. |
| Player shadow | Yes | `buildActors()` | 267–268, 287 | Flat dark circle under each skater. | Stays procedural. |
| Goalie | **Yes** | goalie gear on the skater rig | CC-BY 4.0 (Sketchfab) | Real gear models fitted to the skater's bones by `assets/src/skater/import_goalie_gear.py`; shown on goalies only. Credits in the asset table below. | done 2026-11-18 |
| Puck | Yes | `buildActors()` | 315–319 | 12-sided cylinder, radius 0.32, height 0.16, plus a flat red disc under it. | Four "ghost" pucks for Split Shot reuse the same geometry (320–323). |
| Rink: ice surface | Yes | `buildRink()` | 88–140 | A flat plane with a 2048×1024 canvas-drawn texture: ice, skate scratches, creases, red and blue lines, faceoff circles, centre logo and wordmark. | Not a model. Candidate for a better ice material (Poly Haven texture) rather than a GLB. |
| Rink: arena floor | Yes | `buildRink()` | 141–143 | One dark plane, 140×100, under everything. | Stays procedural unless an arena shell is added. |
| Boards | Yes | `buildRink()` | 145–171 | Three instanced box strips following the rounded outline: white wall (1.1 high), blue cap rail, yellow kick plate. Gaps left for the goal mouths. No glass. | Shape is tied to the sim's rink outline, so a replacement must follow the same outline exactly. |
| Nets (2) | Yes | `buildRink()` | 173–195 | Red box posts and crossbar, translucent white box panels for the mesh, floor plane, goal lamp (icosahedron). Mouth is 4.2 wide (`GOAL_HALF = 2.1`), 1.5 deep, 1.35 high, recessed into the end boards. | The net group is stretched on X for the goal "bulge" (508–510) and the lamp flashes (511–512). Both must keep working. |
| Crowd | Yes | `buildCrowd()` | 225–251 | One instanced mesh of plain boxes (0.7×1.0×0.7) in 4 rows around the rink, random colour and height. No seats, stands or people shapes. | Bounces per instance on cheers (514–524). A replacement must stay instanced to hold 60fps. |
| Goalie pads, blocker, catching glove, goalie stick | https://sketchfab.com/3d-models/5ace50e9a12d4c029614820d3112dcb3 ("True L12.2 CP31 Version") | YeaBoiiiiiiiii | CC-BY 4.0 | 487,601 tris | about 7,100 tris (pads 2x2,500, blocker 1,500, glove 2,200, stick 900); lace curves and small lettering dropped, recoloured to team colours, stick plain dark; in `assets/models/skater.glb` as g_* pieces | **done** 2026-11-18 |
| Goalie mask | https://sketchfab.com/3d-models/12fe01ffe0d4443b96292815bb79958a ("Hockey Goalie Mask") | matyprokop09 | CC-BY 4.0 | 59,968 tris | 4,200 tris (shell 2,600, cage 1,600), team colour shell, dark cage | **done** 2026-11-18 |

### Other procedural geometry (not in the request, listed for completeness)

| Asset | Built by | Lines | What it is |
|---|---|---|---|
| Ice machine (Resurfacer Union boss) | `buildRink()` | 202–206 | Three boxes: blue body, orange cab, grey blade. |
| Frost / machine warning lane | `buildRink()` | 198–201 | Flat coloured plane. |
| Shockwave ring, impact ring | `buildRink()` | 207–214 | Flat ring meshes. |
| Scuff decals (36) | `buildRink()` | 216–222 | Flat circles on the ice. |
| "You" markers: disc, ink ring, beam, overhead arrow, to-puck arrow, pass ring | `buildActors()` | 291–309 | Rings, a cylinder, a cone and flat triangles. |
| Power gems over the head (8) | `buildActors()` | 310–313 | Octahedra. |
| Particles (400) | `buildActors()` | 324–329 | Instanced cubes for spray, bursts and confetti. |

These are effects and HUD markers. Recommendation: leave them procedural. The ice machine is the only real prop here and could be swapped last.

## 2. Proposed order

1. Players (with stick)
2. Puck
3. Nets
4. Boards (add glass if a source has it)
5. Crowd and stands
6. Ice surface material
7. Ice machine (optional)

Each step: find source, record URL and licence below, download to `assets/`, check tri count and file size in Blender, decimate if heavy, match scale and orientation to the procedural model, export GLB, swap in code with procedural fallback, `npm run build`, Playwright run and screenshot, report FPS. Only then move on.

## 3. Sources and licences

Sources: any online source with a CC0 or CC-BY licence (user widened this on 2026-11-15; online assets preferred, text-to-3D only as fallback). Original downloads are kept in `assets/src/`, game-ready files in `assets/models/`.

Test switches: `?noassets` (procedural only), `?breakassets` (force every GLB to fail, to prove the fallback).

| Asset | Source URL | Author | Licence | Original tris / size | Final tris / size | Status |
|---|---|---|---|---|---|---|
| Players | Tencent HY 3D Global (hy3d.tencent.ai), 3DGeneration-V3.1 text-to-3D, generated on the user's account (no usable online model, see section 4) | generated | Tencent HY 3D terms of service (not yet read for commercial use) | 500,000 tris / 43.7 MB, 4096 textures (`assets/src/player/hunyuan-v31-player.glb`) | 9,999 tris / 526 KB, 1024 texture rebaked (`assets/models/player.glb`) | **done** 2026-11-15: build passes, 60.0 fps WebGPU, teams tinted at runtime, chin darkened so no face shows, procedural fallback kept. Replaces the earlier soft Tripo H2.5 version (`assets/src/player/tripo-h25-player.glb`, now unused) |
| Puck | | | | | | not started |
| Nets | Built in Blender for this project (frame tubes and an alpha-masked net texture), after the Hunyuan net (`assets/src/net/hunyuan-v31-net.glb`) came out with broken strands and the Sketchfab options proved unusable (one is a single triangle, the other an untextured soccer-style goal) | own work | n/a | Hunyuan source 50,000 tris / 32.7 MB | 1,568 tris / 57 KB (`assets/models/net.glb`) | **done** 2026-11-15: build passes, 59.9 fps, floor plate and goal lamp stay procedural, box net kept as fallback |
| Boards | | | | | | not started |
| Crowd | https://poly.pizza/m/2-i2ZDps78- ("crowd") | apelab | CC-BY 3.0 | 4,206 tris / 524 KB (9 people on a plate) | 3,462 tris / 431 KB (6 separate people, vertex colours, `assets/models/crowd.glb`) | **done** 2026-11-15: build passes, 59.9 fps WebGPU (baseline 60.0), fallback verified with `?breakassets` |
| Ice material | | | | | | not started |
| Ice machine | | | | | | not started |

## 4. Missing online

### Players (hockey skater)

Searched 2026-11-15: Kenney, Quaternius, KayKit, Poly Haven, Poly Pizza, OpenGameArt, itch.io, Sketchfab (downloadable, CC0 or CC-BY).

- No hockey skater in any of the packs.
- Sketchfab has one usable candidate: "Hockey dancer" by 7301965, CC-BY 4.0, 2,650 faces, https://sketchfab.com/3d-models/hockey-dancer-700c26325c5544fbabd8a9ca2bbe134d. It is cruder than the target look and needs a Sketchfab sign-in to download. Other hits were a goalie, real-team or existing-character models (not usable), or non-commercial licences.
- Fallback used: a concept image (`assets/src/player/concept.png`, Qwen-Image on Hugging Face) turned into a mesh.
  - Hugging Face TripoSG / TRELLIS.2: free GPU quota ran out before a mesh was produced. Resets about 24 hours after 14:05 on 2026-11-15.
  - Tripo Studio (user's account): the H3.1 model generated well (55 credits) but cannot be exported on the free plan. The H2.5 Legacy model (40 credits) exports free (10 exports) and is what the game uses now. 105 credits left.
  - Meshy (user's account): Meshy 7.1 generated (30 credits) but download needs a subscription. The user reports Meshy 4 or 5 models download free; not tried yet.
- Ways forward (user's choice): Tripo paid plan, a Meshy account (free plan allows GLB download), retry Hugging Face after the quota resets, or the Sketchfab model.

Planned treatment once a mesh is in hand: decimate to roughly 3-5k tris, 1024 texture, colour-key the white jersey and red gear so teams can be tinted, darken the chin so no face shows, scale to 2.25 units, face +X.

### Likely also missing (not searched in depth yet)

Ice hockey puck, hockey goal and rink boards only turned up on Sketchfab (sign-in needed): "Hockey Goal" by voittohovi (CC-BY, 7,152 faces), "Hockey Rink" by rockleyr (CC-BY, 6,360 faces). Poly Pizza has usable hockey sticks ("Ice Hockey Stick" by jeremy, CC-BY, 100 tris, already in scratch).

## 5. Open questions

- Licence filter confirmed by the user on 2026-11-15: CC0 and CC-BY are both allowed. CC-BY models need a credit line (kept in this file and to be shown in the game's credits).
- CLAUDE.md and DESIGN.md still say "procedural only, no external models". They need a one-line update when the first GLB lands.
- Goalie: in the game since Phase 1; gear added 2026-11-18 (see the asset table).
- Players have no skeleton today. Plan is a static posed model tilted by the existing code, so gameplay and feel do not change. Skating animation would be a separate, later decision.
- Text-to-3D: no Meshy or Tripo connection is set up in this session. Only needed if a model is missing.

## 6. Free image-to-3D options (researched 2026-11-15)

This Mac: Apple M4 (10 cores), 24 GB memory, 343 GB free disk, Blender 5.3.

"Verified" means tried in this project. Everything else is from the linked pages and still needs a first run.

### Online

| Tool | Free textured GLB download? | Notes |
|---|---|---|
| Tripo Studio, H2.5 Legacy | **Yes, verified** | 40 credits per model, free export counter showed 10 (9 left). Soft quality. Newer Tripo models (H3.1) generate but do not export on the free plan. Third-party pages say free models are public and may be non-commercial. |
| Meshy | **No, verified** | Textured download shows "Subscribe to download". Help centre: free plan downloads only untextured Meshy 6 Lite models, 10 a month. Only 7.1, 6 and 6 Lite are offered now. |
| Krea (krea.ai/3d) | Unverified | Free: 100 units a day; Hunyuan3D-2.1 costs 25, legacy TRELLIS 10, Rodin V2.5 Fast 75. Job sat in queue 20+ minutes and never started. Free plan is not licensed for commercial use. |
| Hugging Face Spaces (Hunyuan3D-2, Hunyuan3D-2.1, 2mini-Turbo, TRELLIS.2, TripoSG) | Yes, but quota-limited | All run on shared ZeroGPU. The free daily GPU quota covers roughly one model. Used up on 2026-11-15, resets about 24 hours later. |
| Tencent HY 3D Global (hy3d.tencent.ai) | **Yes, verified** | 5 free generations a day ("Limited-time Benefits"), V3.1 model, textured GLB download with no paywall. Text-to-3D works. Image upload failed its server check ("Detection failed") from the built-in browser. Best free option found. |
| Pocket 3D AI (3dai.skyebrowse.com) | Failed, verified | No account, but errored on generate (shared GPU pool). |
| 3D AI Maker | No | Redirects to another site on generate. Dropped. |

### Local on this Mac

| Option | Fits 24 GB M4? | Needs | Notes |
|---|---|---|---|
| TRELLIS.2 via shivampkumar/trellis-mac (PyTorch MPS) | Recommended 24 GB+, about 18 GB peak | `hf auth login` plus access requests for two gated models (DINOv3, RMBG-2.0); about 15 GB download; Python 3.11 | Textured GLB. About 5 minutes per model on an M4 Pro 24 GB (author's figure). No credits, no queue. RMBG-2.0 is non-commercial. |
| TRELLIS.2 via lyonsno/trellis2mlx (MLX) | Yes at 512 (ran on a 16 GB M2 Pro) | Same Hugging Face login, DINOv3 gate | Textured GLB. Newer, small project (13 stars). |
| Hunyuan3D-2 / 2.1 Mac forks | Shape yes; texture doubtful | No login for Hunyuan3D-2 weights; 15-20 GB download | Texture step is reported to fail or swap heavily on 24 GB Macs. |
| TripoSR | Yes | No login | Fast, but low detail and vertex colours only. Unlikely to beat the current player. |

## 7. Asset-site search, redone by opening each catalogue (2026-11-15)

Rule from the user: nothing is ruled out from memory. Each line below says what was actually opened.

| Site | How it was checked | Hockey-relevant 3D found |
|---|---|---|
| Sketchfab | Public search API, about 20 terms, downloadable, CC0/CC-BY only | Hockey Net by imveryokay (5,676 faces, CC-BY) `04f1b2bbebe4419b8c894c113cf864d9`; Hockey Goal by voittohovi (7,152, CC-BY) `42e1d6e7eff54fdf92439638630106d6`; Hockey Rink by rockleyr (6,360, CC-BY) `eeaaf38b50e748feb226a7bdbdcb9138`; Stylized Puck by RiZoRuS77 (640, CC-BY) `d7dde2d89db74e8eb58b8af0f52c1f80`; Hockey Puck by j.thorne (4,126, CC-BY) `716ae43cc57a453a9e830cef1e55b47c`; Hockey Stick by duz_vr (124, CC-BY); Hockey dancer skater by 7301965 (2,650, CC-BY); stadium seats by anDDDres (3,880, CC-BY). No ice machine. **Download needs a Sketchfab sign-in.** |
| itch.io | 11 search terms, 130 unique asset listings, every hockey/puck/rink listing opened | Hockey Stick V2 and V1 by Zen (free, 3D, no licence stated, .7z and .unitypackage); Halloween Hockey Masks (free, 3D, CC-BY 4.0); The Hockey Player PSX pack by VEXON ($14.99, 3D skater); PSX Hockey Mask Character ($2.50, horror). The rest are 2D sprites, audio or air hockey. |
| Poly Pizza | Site search, about 15 terms | Ice Hockey Stick by jeremy (CC-BY, 100 tris), Hockey Stick by Poly by Google (CC-BY), Hockey Stick by CreativeTrio (public domain), Ice skate by jeremy, stadium seats by Zsky, sports stands by Cole Brenner, crowd by apelab (in the game). No skater, goal or puck. |
| Kenney | Site search and all 14 pages of the 3D category (50 packs) | No hockey pack. Possibly useful: mini-arena, mini-characters, blocky-characters (all CC0, animated). sports-pack is 2D. |
| Quaternius | Full pack list (84 packs) | No hockey or sports pack. Generic animated characters only. |
| KayKit | Full itch.io catalogue (33 packs) | No hockey or sports pack. |
| Poly Haven | Full model list via API (522 models) and textures | No hockey models. No ice texture matched. |
| OpenGameArt | Search for "hockey", each result opened | Only 2D: top-down hockey players with skate frames (CC0), ICE Hockey Pack (CC0), jerseys (CC-BY 3.0). |
| CGTrader, Fab, TurboSquid | **Not searched.** | Free models there need an account to download. |

### 7b. Downloaded from Sketchfab (2026-11-15, user's account), in `assets/src/sketchfab/`

All CC-BY 4.0 (credit the author). Not yet checked in Blender (Blender was closed).

| File | Model | Author | Size |
|---|---|---|---|
| net_imveryokay.glb | Hockey Net | imveryokay | 211 KB |
| goal_voittohovi.glb | Hockey Goal | voittohovi | 3 KB (suspiciously small, may be empty) |
| rink_rockleyr.glb | Hockey Rink | rockleyr | 1.9 MB |
| puck_stylized.glb | Stylized Puck | RiZoRuS77 | 384 KB |
| stick_duz.glb | Hockey Stick | duz_vr | 1.7 MB |

### 7c. Sign-in sites checked in the browser (2026-11-15)

| Site | Free hockey models found | Licence | Needs |
|---|---|---|---|
| CGTrader | Stylized Goal Net (Kaagan), Hockey stick and puck, HOCKEY low-poly, hockey stick 1, Hockey Stick Actual | "Royalty Free License (no AI), free for personal and commercial use" | CGTrader sign-in |
| TurboSquid | Low Poly Ice Hockey Stick (Blender), Hockey Goal & Net (two), several Hockey Pucks, Lowpoly Mini Ice Hockey Rink, Hockey Goal | Not read yet | TurboSquid sign-in |
| Fab | Hockey puck, Wooden Hockey Stick | Not read yet | Epic Games sign-in |

Hunyuan net (generated on the user's account) finished and is in its Assets list; not downloaded yet.

### 7d. Checked in Blender (2026-11-15)

- Sketchfab Hockey Goal (voittohovi): 6 triangles, unusable.
- Sketchfab Hockey Net (imveryokay): untextured white frame shaped like a soccer goal. Not used.
- Sketchfab Hockey Rink (rockleyr): a small diorama with stands (294 objects). Not usable as the game rink.
- Sketchfab Stylized Puck (RiZoRuS77): 640 tris, 512 texture, dark puck with a metal rim. **Picked for the puck.**
- Sketchfab Hockey Stick (duz_vr): 124 tris, 1024 texture, taped wooden stick. **Picked for the separate stick.**
- Hunyuan net: right shape, but the netting strands are broken in places. Frame shape reused as reference only.

Blender MCP add-on (mcp-for-blender, localhost:9876): asset search on for Poly Haven, Sketchfab, Poly Pizza; generators (Tripo, Hunyuan3D, Hyper3D, Meshy) off until API keys are added in the add-on.

### 7e. Skater rebuild (2026-11-16)

| File | What | Licence |
|---|---|---|
| `assets/src/skater/hunyuan-v31-skater-tpose.glb` | Chunky cartoon skater, T-pose, no stick, 49,886 tris, 4096 textures. Generated on the user's Tencent HY 3D account | Tencent HY 3D terms (commercial use not yet checked) |
| `assets/src/skater/skater_for_mixamo.fbx` | Same, 16,000 tris, 1024 textures, scaled to human size for Mixamo | as above |
| `assets/src/quaternius/ubc/` | Universal Base Characters (Standard) by Quaternius: 2 rigged base bodies | CC0 |
| `assets/src/quaternius/ual/` | Universal Animation Library (Standard) by Quaternius: 43 animations incl. crouch idle, hit reactions, falls, push | CC0 |

Mixamo was searched for skating: only a skateboard push exists, so the stride, shot and check will be keyed in Blender.

### 7f. Skater detail pass (reserved, requested 2026-11-16)

The user asked for more complexity on the skater model. Parked until the animations are done, so the
detail is added once on a model whose deformation is already proven. Candidates: visible seams and
piping on the jersey, a number and crest (our own design), shoulder and elbow pad shapes under the
cloth, segmented glove fingers and a cuff roll, helmet vents and ear guards, skate boot panels and
laces, stick tape spiral and blade curve, a tie-down strap at the jersey hem. Also still open: the
jersey rounds out over the back in side view, and the semi-realistic face behind the visor.

### 7g. 2D player assets for a 2.5D build (searched 2026-11-16)

The user wants a separate 2.5D build drawn with real 2D art (not sprites rendered from our 3D
model), and a smooth look, not pixel art. Every source checked:

| Source | Hockey players found | Usable? |
|---|---|---|
| itch.io (tag hockey, 2D, searches for hockey sprite / sprite sheet) | Mini Hockey by CanadianBoy (free, overhead); Pixel Hockey 32x32 by Masalimov Ilnur ($5, chibi 3/4 view); Ice Hockey NES by chasersgaming (GBP 2, public domain, 3/4 side view, skate/shoot/fight/keeper/celebrate) | All pixel art |
| OpenGameArt (2D art search) | ICE Hockey Pack (CC0: puck and icon art, no players); hockey players by wutang33 (CC0, tiny overhead); Ice Hockey jersey (CC-BY 3.0, jersey only) | No |
| GameDev Market | Only the NES pack above | Pixel art |
| Unity Asset Store | Hockey Player Animated ($19) is 3D; 2D Spine packs exist but none are hockey | No |
| CraftPix, GameArt2D, Kenney | No hockey characters | No |
| Vecteezy, Freepik/Magnific | Many smooth vector hockey players, static poses only | Art source only |
| Creative Market | "Ice Hockey Player Vector. Animated" listing no longer exists | No |

No free, smooth, animated 2D hockey player exists. Realistic routes: a paid vector character
kit with hockey gear that can be cut into parts and animated as 2D cut-out (bones), a commission,
or static vector art from Vecteezy/Freepik as a base.

### 7h. Generated 2D skater tests (2026-11-16)

Generated with GPT-image 2.5 (Figma AI, user's credits, Figma file "Faceoff 2D skater tests"),
saved in `assets/src/sprites2d/gen/`.

| Test | Result |
|---|---|
| test1_single.png: one skater, ready stance | Smooth inked cartoon look, clean uniform, reads well. Camera lower than the game's 38 degrees. |
| test2_turnaround.png: 8 directions in one image | Same character in all 8, consistent size and gear. Stick switches hands between views; camera near eye level. Fix: draw 5 directions and mirror 3. |
| test3_stride.png: 6-frame stride from behind | Same character, steeper camera (closer to the game). Only the left leg pushes; the stick changed from wood to black. Frames need picking and aligning. |

Verdict: generation can give the smooth 2D look. Consistency within one image is good; across
separate images it drifts (stick colour, angle). Image-to-image with the first sprite as a
reference would hold the character; Weave (in Figma) offers that but the user's Figma account is
not linked to Weave yet.

### 8. Free local generation for game assets (researched 2026-11-16)

This Mac: Apple M4, 24 GB unified memory, ComfyUI Desktop 0.45 (MPS). Licences read from the
Hugging Face / GitHub pages, not blogs. Apple's GPU backend generally can't run fp8 files, so
use GGUF quantised models.

| Job | Model / tool | Licence | Mac | Notes |
|---|---|---|---|---|
| Same character, new angle or pose | Qwen-Image-Edit 2511 (GGUF Q4_K_M, 12.8 GB) | Apache 2.0 | yes (GGUF) | Main 2D tool; downloading. Lightning 4-step LoRA for speed. |
| Split a drawing into transparent layers (cut-out parts) | Qwen-Image-Layered | Apache 2.0 | likely (GGUF exists) | 3 or 8 RGBA layers; unproven for limbs; hidden areas need repainting. |
| Animate a drawing (frames for sprite sheets) | Wan 2.2 TI2V 5B | Apache 2.0 | yes, slow | Image-to-video, 24 fps; one report: 49 frames at 1280x704 in about 7 min on a Mac. |
| Other video models | LTX-2 | own community licence | - | Check terms before use. |
| Image to 3D | TRELLIS.2 | MIT | via trellis-silicon port (MIT, new, 10 stars), needs 24 GB+ | Official code is Linux + NVIDIA only. |
| Image to 3D, bundled with auto-rig and animations | AssetFurnace (image-to-3dlab) | Apache 2.0 (tool) | yes, 32 GB recommended | Wraps TRELLIS.2, Hunyuan3D, SF3D; each model keeps its own licence. |
| Image to 3D | TripoSR | MIT | yes | Older, lower quality. |
| Image to 3D | Hunyuan3D 2.1 / 2mini | Tencent Hunyuan Community | - | Excludes some regions and has usage limits: avoid for a commercial game. |
| Image to 3D | Stable Fast 3D | Stability Community | yes | Free under a revenue threshold. |
| 2D bone animation editors | DragonBones (free, open source); Rigby2D (claims unverified) | - | - | For a cut-out rig like the reference's. |

Planned 2D route (reference-style cut-out): design one cartoon skater, redraw 5 directions with
Qwen-Image-Edit (mirror 3), split each into body parts (Qwen-Image-Layered, or Qwen-Image-Edit
asked for each part alone), rig with bones in the game, key the motion in 2D. Frame-based backup:
Wan 2.2 image-to-video per direction, cut out with background removal.
