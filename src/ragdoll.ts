// Ragdoll for big checks (display only: the sim's knockdown, slide and stun stay the truth for play).
// A verlet particle body: four torso points held rigid, head, knees, feet, elbows, hands. It starts from the
// skater's current bone positions (so there is no pop), gets a kick shaped by the kind of hit, rides along with the
// sim's slide (the sim moves the skater, the ragdoll adds the tumble), and lands on the ice and against the boards.
// render.ts turns the particles into bone rotations and blends them over the clip by a weight.
import { collideBoards } from './sim';

/** Ragdoll tuning. min: hit value (closing speed, sim CHECK units) from which a knockdown ragdolls instead of
 *  playing the fall clip; stagger: below CHECK.knock a check is a stagger (render). A big hit LAUNCHES him: launch is
 *  the extra push away from the hitter (u/s per unit of hit value, on top of the sim's slide), up the upward launch
 *  speed at the weakest and the biggest ragdoll hit, spin the tumble (rad/s at the biggest hit, about the axis across
 *  the hit, plus a little twist); hitTop: hit value treated as the biggest. stiff: how hard each limb springs back
 *  toward its pose in the torso's frame (per s; 0 = limp, high = a statue), so limbs flail but never fold into a
 *  pile. inT/outT: blend in and out (s); getup: sim stun left when the get-up starts (the get-up time); gravity;
 *  iters; friction: ground friction per step (closer to 1 = longer slide and tumble on landing); r: particle radius;
 *  max: most ragdolls at once (the rest use the fall clip). */
export const RAGDOLL = { min: 9, stagger: 2.5, launch: 0.25, up: [4.5, 8.5], spin: 9, twist: 2.5, hitTop: 18, stiff: 9,
  inT: 0.04, outT: 0.4, getup: 0.75, gravity: 24, iters: 12, friction: 0.92, r: 0.09, max: 6, step: 1 / 120 };

/** particle order and the bone each one starts from */
export const RAG_BONES = ['thigh_l', 'thigh_r', 'upperarm_l', 'upperarm_r', 'Head', 'calf_l', 'calf_r', 'foot_l', 'foot_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r'] as const;
const HL = 0, HR = 1, SL = 2, SR = 3, HD = 4, KL = 5, KR = 6, FL = 7, FR = 8, EL = 9, ER = 10, AL = 11, AR = 12;
// distance links: [a, b, slack] (slack > 0 lets the link shorten to (1 - slack) of its rest length: soft joints)
const LINKS: [number, number, number][] = [
  [HL, HR, 0], [SL, SR, 0], [HL, SL, 0], [HR, SR, 0], [HL, SR, 0], [HR, SL, 0],   // rigid torso box
  [HD, SL, 0], [HD, SR, 0], [HD, HL, 0.15], [HD, HR, 0.15],                         // neck
  [HL, KL, 0], [KL, FL, 0], [HR, KR, 0], [KR, FR, 0], [HL, FL, 0.55], [HR, FR, 0.55], // legs (knee can fold, not past the foot)
  [SL, EL, 0], [EL, AL, 0], [SR, ER, 0], [ER, AR, 0], [SL, AL, 0.7], [SR, AR, 0.7], // arms
  [KL, KR, 0.8], [FL, FR, 0.9],                                                     // legs don't pass through each other
];
export type HitKind = 'open' | 'hip' | 'board';

export class Ragdoll {
  p: Float32Array; q: Float32Array;   // positions and previous positions (x, y, z per particle)
  rest: number[];
  w = 0; age = 0; out = false; acc = 0;
  constructor(pos: { x: number; y: number; z: number }[], nx: number, nz: number, imp: number, kind: HitKind) {
    const n = pos.length;
    this.p = new Float32Array(n * 3); this.q = new Float32Array(n * 3);
    pos.forEach((v, i) => { this.p[i * 3] = v.x; this.p[i * 3 + 1] = Math.max(RAGDOLL.r, v.y); this.p[i * 3 + 2] = v.z; });
    this.rest = LINKS.map(([a, b]) => this.dist(a, b));
    // the pose each limb springs back toward, in the torso's own frame
    const F = this.frame(); this.pose = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const x = this.p[i * 3] - F[0], y = this.p[i * 3 + 1] - F[1], z = this.p[i * 3 + 2] - F[2];
      for (let c = 0; c < 3; c++) this.pose[i * 3 + c] = x * F[3 + c * 3] + y * F[4 + c * 3] + z * F[5 + c * 3]; }
    this.hip0 = F[1];
    // the launch, relative to the sim's own slide (which carries the whole body): up and away from the hitter, and a
    // tumble about the axis across the hit (head goes back, skates come up), more legs-over for a hip check, less
    // lift and more into the wall for a board hit
    const t = Math.max(0, Math.min(1, (imp - RAGDOLL.min) / (RAGDOLL.hitTop - RAGDOLL.min)));
    const up = (RAGDOLL.up[0] + (RAGDOLL.up[1] - RAGDOLL.up[0]) * t) * (kind === 'board' ? 0.55 : kind === 'hip' ? 1.1 : 1);
    const away = imp * RAGDOLL.launch * (kind === 'board' ? 1.4 : 1);
    const spin = RAGDOLL.spin * (0.5 + 0.5 * t) * (kind === 'hip' ? 1.5 : kind === 'board' ? 0.6 : 1);
    // axis across the hit (up x n): turning about it carries the top of the body along n, the feet against it
    const ax = nz, az = -nx, tw = RAGDOLL.twist * (nx >= 0 ? 1 : -1) * (0.5 + t);
    let cx = 0, cy = 0, cz = 0; for (let i = 0; i < n; i++) { cx += this.p[i * 3]; cy += this.p[i * 3 + 1]; cz += this.p[i * 3 + 2]; } cx /= n; cy /= n; cz /= n;
    const dt = RAGDOLL.step;
    for (let i = 0; i < n; i++) {
      const rx = this.p[i * 3] - cx, ry = this.p[i * 3 + 1] - cy, rz = this.p[i * 3 + 2] - cz;
      // w x r with w = spin * (ax, 0, az) + tw * up
      const vx = nx * away + spin * (0 * rz - az * ry) + tw * rz, vy = up + spin * (az * rx - ax * rz), vz = nz * away + spin * (ax * ry - 0 * rx) - tw * rx;
      this.q[i * 3] = this.p[i * 3] - vx * dt; this.q[i * 3 + 1] = this.p[i * 3 + 1] - vy * dt; this.q[i * 3 + 2] = this.p[i * 3 + 2] - vz * dt;
    }
  }
  pose: Float32Array;
  /** test: how far the hips rose above where they started (the launch) */
  hip0 = 0; rise = 0;
  /** torso frame from the four torso points: origin (mid hips), then side, up, forward axes (9 numbers, rows) */
  private fr = new Float32Array(12);
  private frame() {
    const P = this.p, f = this.fr, m = (a: number, b: number, c: number) => (P[a * 3 + c] + P[b * 3 + c]) / 2;
    const ox = m(HL, HR, 0), oy = m(HL, HR, 1), oz = m(HL, HR, 2);
    let ux = m(SL, SR, 0) - ox, uy = m(SL, SR, 1) - oy, uz = m(SL, SR, 2) - oz; let l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
    let sx = P[HR * 3] - P[HL * 3], sy = P[HR * 3 + 1] - P[HL * 3 + 1], sz = P[HR * 3 + 2] - P[HL * 3 + 2]; const d = sx * ux + sy * uy + sz * uz;
    sx -= d * ux; sy -= d * uy; sz -= d * uz; l = Math.hypot(sx, sy, sz) || 1; sx /= l; sy /= l; sz /= l;
    const fx = sy * uz - sz * uy, fy = sz * ux - sx * uz, fz = sx * uy - sy * ux;
    f.set([ox, oy, oz, sx, sy, sz, ux, uy, uz, fx, fy, fz]);
    return f;
  }
  private dist(a: number, b: number) { const P = this.p; return Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]); }
  /** advance by dt (fixed sub-steps), carried by the sim's slide (dx, dz this frame) */
  update(dt: number, dx: number, dz: number) {
    const P = this.p, Q = this.q, n = P.length / 3;
    for (let i = 0; i < n; i++) { P[i * 3] += dx; Q[i * 3] += dx; P[i * 3 + 2] += dz; Q[i * 3 + 2] += dz; }
    this.acc = Math.min(this.acc + dt, 0.05);   // a long frame can't explode it: at most 6 sub-steps
    const h = RAGDOLL.step, g = RAGDOLL.gravity * h * h, R = RAGDOLL.r, o = { x: 0, y: 0, vx: 0, vy: 0 };
    while (this.acc >= h) {
      this.acc -= h; this.age += h;
      for (let i = 0; i < n; i++) {   // verlet: keep velocity, add gravity
        const j = i * 3;
        for (let c = 0; c < 3; c++) { const v = P[j + c] - Q[j + c]; Q[j + c] = P[j + c]; P[j + c] += v * 0.995 - (c === 1 ? g : 0); }
      }
      // partly active: limbs and head spring toward their pose in the current torso frame (stiff joints, not limp)
      { const F = this.frame(), k = Math.min(1, RAGDOLL.stiff * h), Z = this.pose;
        for (let i = 0; i < n; i++) {
          if (i === HL || i === HR || i === SL || i === SR) continue;
          for (let c = 0; c < 3; c++) {
            const tgt = F[c] + Z[i * 3] * F[3 + c] + Z[i * 3 + 1] * F[6 + c] + Z[i * 3 + 2] * F[9 + c];
            const dd = (tgt - P[i * 3 + c]) * k;
            P[i * 3 + c] += dd; this.q[i * 3 + c] += dd * 0.8;   // mostly a pose correction, only a little of it becomes speed (no energy pumping)
          }
        } }
      const collide = () => {
        for (let i = 0; i < n; i++) {   // ice (with friction) and boards
          const j = i * 3;
          if (P[j + 1] < R) {
            P[j + 1] = R;
            Q[j] = P[j] - (P[j] - Q[j]) * RAGDOLL.friction; Q[j + 2] = P[j + 2] - (P[j + 2] - Q[j + 2]) * RAGDOLL.friction;
            if (Q[j + 1] < P[j + 1]) Q[j + 1] = P[j + 1];
          }
          o.x = P[j]; o.y = P[j + 2]; o.vx = o.vy = 0;
          collideBoards(o, R + 0.05, 0, false);
          if (o.x !== P[j] || o.y !== P[j + 2]) { P[j] = o.x; P[j + 2] = o.y; Q[j] = P[j]; Q[j + 2] = P[j + 2]; }
        }
      };
      // collisions first and links last in each pass (so a body pinned on the boards keeps its shape), then a
      // final collision pass so nothing is left in the ice or the boards
      for (let it = 0; it < RAGDOLL.iters; it++) {
        collide();
        LINKS.forEach(([a, b, slack], li) => {
          const ja = a * 3, jb = b * 3, ex = P[jb] - P[ja], ey = P[jb + 1] - P[ja + 1], ez = P[jb + 2] - P[ja + 2];
          const d = Math.hypot(ex, ey, ez) || 1e-6, r = this.rest[li];
          const lo = r * (1 - slack);
          if (d >= lo && d <= r) return;
          const k = ((d < lo ? lo : r) - d) / d * 0.5;
          P[ja] -= ex * k; P[ja + 1] -= ey * k; P[ja + 2] -= ez * k; P[jb] += ex * k; P[jb + 1] += ey * k; P[jb + 2] += ez * k;
        });
      }
      collide();
      this.rise = Math.max(this.rise, (P[HL * 3 + 1] + P[HR * 3 + 1]) / 2 - this.hip0);
    }
  }
  /** test hook: is every particle finite, above the ice and every link near its rest length (no exploding limbs) */
  health() {
    let worst = 0, low = 9;
    LINKS.forEach(([a, b, slack], li) => { if (slack === 0) worst = Math.max(worst, Math.abs(this.dist(a, b) / this.rest[li] - 1)); });
    for (let i = 1; i < this.p.length; i += 3) low = Math.min(low, this.p[i]);
    const P = this.p, my = (a: number, b: number) => (P[a * 3 + 1] + P[b * 3 + 1]) / 2;
    const up = (my(SL, SR) - my(HL, HR)) / (Math.hypot(...[0, 2].map(c => (P[SL * 3 + c] + P[SR * 3 + c] - P[HL * 3 + c] - P[HR * 3 + c]) / 2)) + Math.abs(my(SL, SR) - my(HL, HR)) || 1);
    return { finite: this.p.every(Number.isFinite), stretch: worst, low, up: +up.toFixed(2), rise: +this.rise.toFixed(2) };   // up: 1 torso upright, 0 lying flat
  }
  at(i: number, out: { x: number; y: number; z: number }) { out.x = this.p[i * 3]; out.y = this.p[i * 3 + 1]; out.z = this.p[i * 3 + 2]; return out; }
}
export const RAG = { HL, HR, SL, SR, HD, KL, KR, FL, FR, EL, ER, AL, AR };
