// Step 0 of PHYSICS_PLAN.md: a Rapier world shaped like a Faceoff match, to measure init time, step cost and
// whether the deterministic build gives the same result in Node and every browser. Not used by the game.
// shortcut: throwaway spike, delete once step 1 builds the real world.
import RAPIER from '@dimforge/rapier2d-deterministic-compat';
import { L, W, CR, GL, GOAL_HALF, NET_DEPTH, SR, PR } from '../sim';

const G_BODY = 0x0001, G_PUCK = 0x0002, G_WALL = 0x0004, G_BLADE = 0x0008;
const groups = (self: number, hits: number) => (self << 16) | hits;

export async function run(steps = 7200) {
  const t0 = performance.now();
  await RAPIER.init();
  const initMs = performance.now() - t0;
  const world = new RAPIER.World({ x: 0, y: 0 });
  world.timestep = 1 / 120;

  // boards: a closed rounded rectangle
  const v: number[] = [];
  for (const [cx, cy, a0] of [[L - CR, W - CR, 0], [-(L - CR), W - CR, Math.PI / 2], [-(L - CR), -(W - CR), Math.PI], [L - CR, -(W - CR), Math.PI * 1.5]])
    for (let k = 0; k <= 12; k++) { const a = a0 + (k / 12) * Math.PI / 2; v.push(cx + Math.cos(a) * CR, cy + Math.sin(a) * CR); }
  v.push(v[0], v[1]);
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.polyline(new Float32Array(v)).setRestitution(0.5).setFriction(0).setCollisionGroups(groups(G_WALL, G_BODY | G_PUCK)), fixed);
  // nets: solid boxes behind each goal line, a sensor across each mouth
  for (const sx of [-1, 1]) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(NET_DEPTH / 2, GOAL_HALF).setTranslation(sx * (GL + NET_DEPTH / 2 + 0.05), 0).setRestitution(0.3).setFriction(0).setCollisionGroups(groups(G_WALL, G_BODY | G_PUCK)), fixed);
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.05, GOAL_HALF).setTranslation(sx * GL, 0).setSensor(true).setCollisionGroups(groups(G_WALL, G_PUCK)), fixed);
  }

  // 12 skaters (dynamic balls, velocity set by a fake skating model) with kinematic blades and shafts
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const sk = Array.from({ length: 12 }, (_, i) => {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation((i % 6) * 6 - 15, (i < 6 ? -1 : 1) * 6).lockRotations());
    world.createCollider(RAPIER.ColliderDesc.ball(SR * 0.6).setFriction(0).setRestitution(0.15).setCollisionGroups(groups(G_BODY, G_BODY | G_PUCK | G_WALL)), b);
    const blade = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setCcdEnabled(true));
    world.createCollider(RAPIER.ColliderDesc.capsule(0.25, 0.1).setRestitution(0.35).setCollisionGroups(groups(G_BLADE, G_PUCK)), blade);
    const shaft = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    world.createCollider(RAPIER.ColliderDesc.capsule(0.6, 0.05).setCollisionGroups(groups(G_BLADE, G_PUCK)), shaft);
    return { b, blade, shaft, tx: 0, ty: 0 };
  });
  const puck = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCcdEnabled(true).setLinearDamping(0.15).lockRotations());
  world.createCollider(RAPIER.ColliderDesc.ball(PR).setRestitution(0.55).setFriction(0).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS).setCollisionGroups(groups(G_PUCK, G_BODY | G_WALL | G_BLADE)), puck);

  const events = new RAPIER.EventQueue(true);
  let contacts = 0, goals = 0, maxStep = 0, firstMs = 0;
  const tStep = performance.now();
  for (let n = 0; n < steps; n++) {
    for (const s of sk) {
      if (n % 60 === 0) { s.tx = (rnd() * 2 - 1) * (L - 6); s.ty = (rnd() * 2 - 1) * (W - 4); }
      const p = s.b.translation(), dx = s.tx - p.x, dy = s.ty - p.y, d = Math.hypot(dx, dy) || 1, sp = Math.min(10.5, d * 2);
      s.b.setLinvel({ x: dx / d * sp, y: dy / d * sp }, true);
      const a = Math.atan2(dy, dx);
      s.blade.setNextKinematicTranslation({ x: p.x + Math.cos(a) * 1.7, y: p.y + Math.sin(a) * 1.7 });
      s.blade.setNextKinematicRotation(a + Math.PI / 2);
      s.shaft.setNextKinematicTranslation({ x: p.x + Math.cos(a) * 0.9, y: p.y + Math.sin(a) * 0.9 });
      s.shaft.setNextKinematicRotation(a + Math.PI / 2);
    }
    if (n % 240 === 0) puck.setLinvel({ x: (rnd() * 2 - 1) * 45, y: (rnd() * 2 - 1) * 30 }, true);   // a hard shot every 2 s
    const s0 = performance.now();
    world.step(events);
    if (n === 0) firstMs = performance.now() - s0;
    if (n >= 10) maxStep = Math.max(maxStep, performance.now() - s0);   // after warm-up (the first steps compile)
    events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      contacts++;
      if (world.getCollider(h1).isSensor() || world.getCollider(h2).isSensor()) goals++;
    });
  }
  const stepMs = (performance.now() - tStep) / steps;

  // fingerprint: every body's position and velocity bits, FNV-1a 64
  const f = new Float64Array(4 * 13), u8 = new Uint8Array(f.buffer);
  [...sk.map(s => s.b), puck].forEach((b, i) => { const p = b.translation(), q = b.linvel(); f.set([p.x, p.y, q.x, q.y], i * 4); });
  let h = 0xcbf29ce484222325n;
  for (const x of u8) h = ((h ^ BigInt(x)) * 0x100000001b3n) & 0xffffffffffffffffn;
  const p = puck.translation();
  const escaped = Math.abs(p.x) > L + 0.5 || Math.abs(p.y) > W + 0.5;   // puck tunnelled out of the rink
  return { fingerprint: h.toString(16).padStart(16, '0'), initMs: +initMs.toFixed(1), stepMs: +stepMs.toFixed(4), maxStepMs: +maxStep.toFixed(3), firstStepMs: +firstMs.toFixed(1), contacts, goals, escaped, version: RAPIER.version() };
}
