// Rapier rink (PHYSICS_PLAN.md step 1): the boards and the nets as fixed walls, and the free puck moved through
// them each step with CCD, so a hard shot can't tunnel. On only with ?rapier until it plays the same as the
// hand-written puck. The world holds no game state: the puck's state lives on the Puck and is copied in and out
// each step, so snapshots and rollback stay the sim's own.
import type RAPIERType from '@dimforge/rapier2d-deterministic-compat';
import { L, W, CR, GL, GOAL_HALF, NET_DEPTH, PR } from '../sim';

export const PHYS = { rapier: false };
const REST = { boards: 0.55, net: 0.4 };   // same as the hand-written collideBoards / collideNet for the puck

let R: typeof RAPIERType, world: RAPIERType.World, puck: RAPIERType.RigidBody;

/** loads Rapier (its own chunk, only when ?rapier is on) and builds the rink; call before the first Game step */
export async function initPhysics() {
  R = (await import('@dimforge/rapier2d-deterministic-compat')).default;
  await R.init();
  world = new R.World({ x: 0, y: 0 });
  const fixed = world.createRigidBody(R.RigidBodyDesc.fixed());
  // walls are solid boxes (not thin lines), so a puck that game code places slightly into one is pushed back
  // onto the ice the way the old clamp did, never out through it. seg: a box `t` thick on the right of a->b
  // ext: how far the box runs past both ends. Short corner boxes need it, or a puck pushed into one leaves through
  // its end instead of its inner face; a chord's line past the arc stays outside the rink
  const seg = (ax: number, ay: number, bx: number, by: number, t: number, rest: number, ext = 0.02) => {
    const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy), nx = dy / l, ny = -dx / l;
    world.createCollider(R.ColliderDesc.cuboid(l / 2 + ext, t / 2).setTranslation((ax + bx) / 2 + nx * t / 2, (ay + by) / 2 + ny * t / 2)
      .setRotation(Math.atan2(dy, dx)).setRestitution(rest).setRestitutionCombineRule(R.CoefficientCombineRule.Max).setFriction(0), fixed);
  };
  // boards: a rounded rectangle, 16 segments per corner, counter-clockwise so the outside is on each segment's right
  const v: number[] = [];
  for (const [cx, cy, a0] of [[L - CR, W - CR, 0], [-(L - CR), W - CR, Math.PI / 2], [-(L - CR), -(W - CR), Math.PI], [L - CR, -(W - CR), Math.PI * 1.5]])
    for (let k = 0; k <= 16; k++) { const a = a0 + (k / 16) * Math.PI / 2; v.push(cx + Math.cos(a) * CR, cy + Math.sin(a) * CR); }
  v.push(v[0], v[1]);
  for (let i = 0; i + 3 < v.length; i += 2) seg(v[i], v[i + 1], v[i + 2], v[i + 3], 2, REST.boards, 1);
  // nets: sides and back as thin boxes centred on the frame, open at the mouth (goals are scored by crossing the
  // goal line, in sim.ts)
  for (const sx of [-1, 1]) {
    const bx = sx * (GL + NET_DEPTH), t = 0.1;
    for (const [ax, ay, cx, cy] of [[sx * GL, GOAL_HALF, bx, GOAL_HALF], [bx, GOAL_HALF, bx, -GOAL_HALF], [bx, -GOAL_HALF, sx * GL, -GOAL_HALF]]) {
      const dx = cx - ax, dy = cy - ay, l = Math.hypot(dx, dy);
      seg(ax - (dy / l) * t / 2, ay + (dx / l) * t / 2, cx - (dy / l) * t / 2, cy + (dx / l) * t / 2, t, REST.net);   // shifted half a thickness so it centres on the frame line
    }
  }
  // one puck body, reused for every free puck in turn; ice friction is the damping (v *= 1/(1 + 0.4 dt) a step)
  puck = world.createRigidBody(R.RigidBodyDesc.dynamic().setCcdEnabled(true).setLinearDamping(0.4).lockRotations());
  world.createCollider(R.ColliderDesc.ball(PR).setRestitution(0).setRestitutionCombineRule(R.CoefficientCombineRule.Max).setFriction(0), puck);
  world.timestep = 1 / 120;
  world.step();   // the first step compiles (about 18 ms): pay it here, not at the faceoff
}

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
  const q = world.projectPoint(p, false, undefined, undefined, undefined, puck);
  if (!q?.isInside) return;
  const dx = q.point.x - p.x, dy = q.point.y - p.y, d = Math.hypot(dx, dy) || 1;
  p.x = q.point.x + (dx / d) * PR; p.y = q.point.y + (dy / d) * PR;
}
