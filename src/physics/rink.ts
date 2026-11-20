// Rapier rink (PHYSICS_PLAN.md step 1): the boards and the nets as fixed walls, and the free puck moved through
// them each step with CCD, so a hard shot can't tunnel. On only with ?rapier until it plays the same as the
// hand-written puck. The world holds no game state: the puck's state lives on the Puck and is copied in and out
// each step, so snapshots and rollback stay the sim's own.
import type RAPIERType from '@dimforge/rapier2d-deterministic-compat';
import { L, W, CR, GL, GOAL_HALF, NET_DEPTH, PR, SR, BODY, STICK } from '../sim';

export const PHYS = { rapier: false };
const REST = { boards: 0.55, net: 0.4 };   // same as the hand-written collideBoards / collideNet for the puck

let R: typeof RAPIERType, world: RAPIERType.World, puck: RAPIERType.RigidBody;
// skaters get their own world: their walls differ from the puck's (bounciness 0.2, boards 0.2 further in because
// a skater's board radius SR is bigger than his body radius BODY, and the net is closed at the mouth)
let sw: RAPIERType.World, sq: RAPIERType.EventQueue;
// stick shapes (step 3): the blade's wall ball, the puck ball, and capsules made per cast
let bladeBall: RAPIERType.Ball, puckBall: RAPIERType.Ball, cap: RAPIERType.Capsule;
const gk: RAPIERType.RigidBody[] = [];   // the two goalies: kinematic, so the skaters slide off them inside the solve
const sk: { b: RAPIERType.RigidBody; c: RAPIERType.Collider }[] = [], skOf = new Map<number, number>(), wallHit: boolean[] = [];

/** solid boxes `t` thick on the right of a->b, `ext` past both ends */
function seg(w: RAPIERType.World, ax: number, ay: number, bx: number, by: number, t: number, rest: number, ext = 0.02) {
  const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy), nx = dy / l, ny = -dx / l;
  w.createCollider(R.ColliderDesc.cuboid(l / 2 + ext, t / 2).setTranslation((ax + bx) / 2 + nx * t / 2, (ay + by) / 2 + ny * t / 2)
    .setRotation(Math.atan2(dy, dx)).setRestitution(rest).setRestitutionCombineRule(R.CoefficientCombineRule.Max).setFriction(0), w.createRigidBody(R.RigidBodyDesc.fixed()));
}
/** boards: a rounded rectangle, 16 segments per corner, counter-clockwise so the outside is on each segment's right.
 *  `inset` moves it in (corner centres stay, the radius shrinks), like collideBoards with a bigger radius. Corner
 *  boxes run 1 unit past their ends, or a body pushed into one leaves through its end; a chord's line past the arc
 *  stays outside the rink */
function boards(w: RAPIERType.World, inset: number, rest: number) {
  const v: number[] = [], r = CR - inset;
  for (const [cx, cy, a0] of [[L - CR, W - CR, 0], [-(L - CR), W - CR, Math.PI / 2], [-(L - CR), -(W - CR), Math.PI], [L - CR, -(W - CR), Math.PI * 1.5]])
    for (let k = 0; k <= 16; k++) { const a = a0 + (k / 16) * Math.PI / 2; v.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  v.push(v[0], v[1]);
  for (let i = 0; i + 3 < v.length; i += 2) seg(w, v[i], v[i + 1], v[i + 2], v[i + 3], 2, rest, 1);
}

/** loads Rapier (its own chunk, only when ?rapier is on) and builds the rink; call before the first Game step */
export async function initPhysics() {
  R = (await import('@dimforge/rapier2d-deterministic-compat')).default;
  await R.init();
  // walls are solid boxes (not thin lines), so a puck that game code places slightly into one is pushed back
  // onto the ice the way the old clamp did, never out through it
  world = new R.World({ x: 0, y: 0 });
  boards(world, 0, REST.boards);
  // nets: sides and back as thin boxes centred on the frame, open at the mouth (goals are scored by crossing the
  // goal line, in sim.ts)
  // The goal rule (sim.ts) counts a centre within GOAL_HALF - PR/2 as in, so the frame is a thin wall whose inner
  // face is just inside where that puck's edge reaches (2.145) and whose outside is close to the old box (2.175 vs
  // 2.1): no shot the rule calls a goal rings off the inside of the post, and none slips into the net without one.
  // No overhang past the goal line (ext 0), so a puck skimming across the front of the post doesn't clip it
  const t = 0.03, gh = GOAL_HALF + PR * 0.5 - t / 2;
  for (const sx of [-1, 1]) {
    const bx = sx * (GL + NET_DEPTH);
    for (const [ax, ay, cx, cy] of [[sx * GL, gh, bx, gh], [bx, gh, bx, -gh], [bx, -gh, sx * GL, -gh]]) {
      const dx = cx - ax, dy = cy - ay, l = Math.hypot(dx, dy);
      seg(world, ax - (dy / l) * t / 2, ay + (dx / l) * t / 2, cx - (dy / l) * t / 2, cy + (dx / l) * t / 2, t, REST.net, 0);   // shifted half a thickness so it centres on the frame line
    }
  }
  // a closed box per net as a sensor: the puck goes through it (sensors don't push), blade casts don't (step 3),
  // so a blade can't reach into the net through the mouth. Same box as the old collideNet
  for (const sx of [-1, 1]) world.createCollider(R.ColliderDesc.cuboid(NET_DEPTH / 2, GOAL_HALF).setTranslation(sx * (GL + NET_DEPTH / 2), 0).setSensor(true), world.createRigidBody(R.RigidBodyDesc.fixed()));
  // one puck body, reused for every free puck in turn; ice friction is the damping (v *= 1/(1 + 0.4 dt) a step)
  puck = world.createRigidBody(R.RigidBodyDesc.dynamic().setCcdEnabled(true).setLinearDamping(0.4).lockRotations());
  world.createCollider(R.ColliderDesc.ball(PR).setRestitution(0).setRestitutionCombineRule(R.CoefficientCombineRule.Max).setFriction(0), puck);
  world.timestep = 1 / 120;
  world.step();   // the first step compiles (about 18 ms): pay it here, not at the faceoff

  bladeBall = new R.Ball(STICK.r + 0.05); puckBall = new R.Ball(PR); cap = new R.Capsule(STICK.blade / 2, STICK.r);

  sw = new R.World({ x: 0, y: 0 });
  sq = new R.EventQueue(true);
  boards(sw, SR - BODY, 0.2);
  for (const sx of [-1, 1]) sw.createCollider(R.ColliderDesc.cuboid(NET_DEPTH / 2, GOAL_HALF).setTranslation(sx * (GL + NET_DEPTH / 2), 0)
    .setRestitution(0.2).setRestitutionCombineRule(R.CoefficientCombineRule.Max).setFriction(0), sw.createRigidBody(R.RigidBodyDesc.fixed()));
  // goalies hold the crease: a skater's centre stays SR + 0.55 from the goalie's (the old after-step push, which
  // fought the net and squeezed skaters into each other)
  for (let i = 0; i < 2; i++) {
    const b = sw.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0));
    sw.createCollider(R.ColliderDesc.ball(SR + 0.55 - BODY).setFriction(0).setRestitution(0), b); gk.push(b);
  }
  // stiffer contacts than the default, so a skater pinned by another doesn't sink into the boards
  sw.integrationParameters.numSolverIterations = 8;
  sw.integrationParameters.contact_natural_frequency = 60;
  sw.timestep = 1 / 120;
  sw.step();
}

/** Moves every skater one step and solves body contacts and walls. `mass[i]` 0 leaves skater i out (in the air,
 *  off the ice, in the box); a heavier skater keeps more of his momentum in a contact. `rest[i]` is his bounciness
 *  (walls use at least 0.2). Returns, per skater, whether he hit a wall this step. Like the puck, the skaters' state
 *  stays in the sim: positions and velocities are copied in and out. */
export function skatersStep(S: { x: number; y: number; vx: number; vy: number }[], mass: number[], rest: number[], dt: number,
  goalies: { x: number; y: number }[] = []): boolean[] {
  while (sk.length < S.length) {   // created in index order, so every client builds the same world
    const b = sw.createRigidBody(R.RigidBodyDesc.dynamic().setCcdEnabled(true).lockRotations());   // CCD: a knocked-down skater sliding into the boards doesn't sink in
    const c = sw.createCollider(R.ColliderDesc.ball(BODY).setFriction(0).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS), b);
    skOf.set(c.handle, sk.length); sk.push({ b, c });
  }
  for (let i = 0; i < sk.length; i++) {
    const k = sk[i], s = S[i], on = i < S.length && mass[i] > 0;
    if (k.b.isEnabled() !== on) k.b.setEnabled(on);
    if (!on) continue;
    k.b.setTranslation({ x: s.x, y: s.y }, true); k.b.setLinvel({ x: s.vx, y: s.vy }, true);
    k.c.setMass(mass[i]); k.c.setRestitution(rest[i]);
  }
  for (let i = 0; i < gk.length; i++) {
    const g = goalies[i], b = gk[i];
    if (!g) { b.setTranslation({ x: 0, y: 1e4 }, false); continue; }
    // placed, not moved: the world keeps no state between steps (same result whatever ran before), and the
    // skaters are pushed out of the crease by position, like the old rule
    b.setTranslation({ x: g.x, y: g.y }, false); b.setNextKinematicTranslation({ x: g.x, y: g.y });
  }
  sw.timestep = dt;
  sw.step(sq);
  wallHit.length = S.length; wallHit.fill(false);
  sq.drainCollisionEvents((h1, h2, started) => {
    const i = skOf.get(h1), j = skOf.get(h2);
    if (started && (i === undefined) !== (j === undefined) && !isGoalie(i === undefined ? h1 : h2)) wallHit[(i ?? j)!] = true;
  });
  for (let i = 0; i < S.length; i++) {
    if (!(mass[i] > 0)) continue;
    const t = sk[i].b.translation(), v = sk[i].b.linvel(), s = S[i];
    s.x = t.x; s.y = t.y; s.vx = v.x; s.vy = v.y;
  }
  return wallHit;
}

const isGoalie = (h: number) => gk.some(b => b.collider(0).handle === h);

/** moves a free puck one step (plus an extra push for curving shots) and reports what it bounced off */
export function puckStep(p: { x: number; y: number; vx: number; vy: number }, dt: number, ox = 0, oy = 0): { board: boolean; net: boolean } {
  world.timestep = dt;
  const o = { x: p.x + ox, y: p.y + oy };
  puckOut(o);
  puck.setTranslation(o, true);
  puck.setLinvel({ x: p.vx, y: p.vy }, true);
  world.step();
  const t = puck.translation(), v = puck.linvel(), damp = 1 / (1 + 0.4 * dt);
  // a bounce: the velocity changed by more than the damping, like the old normal speed over 1
  const bounce = Math.hypot(v.x - p.vx * damp, v.y - p.vy * damp) > 1.5;
  const atNet = Math.abs(t.x) > GL - 0.5 && Math.abs(t.x) < GL + NET_DEPTH + 0.5 && Math.abs(t.y) < GOAL_HALF + 0.6;
  p.x = t.x; p.y = t.y; p.vx = v.x; p.vy = v.y;
  return { board: bounce && !atNet, net: bounce && atNet };
}

/** game code (a blade deflection, a carry) can leave the puck inside a wall, and the solver would only ease it out
 *  over several steps: put it on the wall's surface instead (the next step bounces it) */
export function puckOut(p: { x: number; y: number }) {
  const q = world.projectPoint(p, false, R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, puck);   // not the net sensors
  if (!q?.isInside) return;
  const dx = q.point.x - p.x, dy = q.point.y - p.y, d = Math.hypot(dx, dy) || 1;
  p.x = q.point.x + (dx / d) * PR; p.y = q.point.y + (dy / d) * PR;
}

/** Step 3: where a blade aimed from the hands (hx, hy) at (x, y) ends up: its ball is cast along that line and stops
 *  where it first touches a board or a net, so it can't reach through one (the old push-out could pop it out the far
 *  side of a net); the nets count as closed boxes (their sensors). Hands already against a wall: pushed out to the
 *  surface, as before. */
export function bladeWalls(hx: number, hy: number, x: number, y: number): [number, number] {
  const vx = x - hx, vy = y - hy;
  const h = world.castShape({ x: hx, y: hy }, 0, { x: vx, y: vy }, bladeBall, 0, 1, true, undefined, undefined, undefined, puck);
  if (!h) return [x, y];
  if (h.time_of_impact > 0) return [hx + vx * h.time_of_impact, hy + vy * h.time_of_impact];
  const o = { x, y }, q = world.projectPoint(o, false, undefined, undefined, undefined, puck);
  if (!q?.isInside) return [x, y];
  const dx = q.point.x - x, dy = q.point.y - y, d = Math.hypot(dx, dy) || 1;
  return [q.point.x + (dx / d) * bladeBall.radius, q.point.y + (dy / d) * bladeBall.radius];
}

/** Step 3: the first time t in [0, 1] of a step when a ball (radius `br`, or the puck's when 0) moving from (ax, ay)
 *  by (amx, amy) comes within `gap` of a capsule (half length `hl`, radius `cr`, axis angle `ca`) moving from
 *  (bx, by) by (bmx, bmy), or -1. Exact for straight-line motion, so neither tunnels; the capsule doesn't turn in
 *  the step (like the old sampled sweep). Starting inside counts as t = 0. */
export function sweepHit(ax: number, ay: number, amx: number, amy: number, br: number,
  bx: number, by: number, bmx: number, bmy: number, ca: number, hl = STICK.blade / 2, cr = STICK.r, gap = 0): number {
  const ball = br > 0 ? new R.Ball(br) : puckBall, c = hl === cap.halfHeight && cr === cap.radius ? cap : new R.Capsule(hl, cr);
  const h = ball.castShape({ x: ax, y: ay }, 0, { x: amx, y: amy }, c, { x: bx, y: by }, ca - Math.PI / 2, { x: bmx, y: bmy }, gap, 1, true);
  return h ? h.time_of_impact : -1;
}
