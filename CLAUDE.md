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
