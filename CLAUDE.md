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

