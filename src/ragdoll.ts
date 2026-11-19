// Ragdoll for big checks (display only: the sim's knockdown, slide and stun stay the truth for play).
// A verlet particle body: four torso points held rigid, head, knees, feet, elbows, hands. It starts from the
// skater's current bone positions (so there is no pop), gets a kick shaped by the kind of hit, rides along with the
// sim's slide (the sim moves the skater, the ragdoll adds the tumble), and lands on the ice and against the boards.
// render.ts turns the particles into bone rotations and blends them over the clip by a weight.
import { collideBoards } from './sim';

/** Ragdoll tuning. min: hit value (closing speed, sim CHECK units) from which a knockdown ragdolls instead of
 *  playing the fall clip; stagger: below CHECK.knock a check is a stagger (render). kick: base kick (u/s) per unit of
 *  hit value, and its range; inT/outT: blend in and out (s); getup: sim stun left when the get-up starts; gravity;
 *  iters: constraint passes per step; ground friction per step; r: particle radius off the ice; max: most ragdolls
 *  simulated at once (older ones fall back to the clip). */
export const RAGDOLL = { min: 9, stagger: 2.5, kick: 0.45, kickMin: 3, kickMax: 9, inT: 0.05, outT: 0.35, getup: 0.75,
  gravity: 24, iters: 8, friction: 0.82, r: 0.09, max: 6, step: 1 / 120 };

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
    // the kick, relative to the sim's own slide (which carries the whole body): it is what turns him over
    const k = Math.max(RAGDOLL.kickMin, Math.min(RAGDOLL.kickMax, imp * RAGDOLL.kick)), dt = RAGDOLL.step;
    const kickOf = (i: number): [number, number, number] => {
      const upper = i === HD || i === SL || i === SR || i === EL || i === ER || i === AL || i === AR;
      const legs = i === KL || i === KR || i === FL || i === FR;
      switch (kind) {
        case 'hip':    // swept at the hips: legs flip up and over, head goes down along the hit
          return legs ? [nx * k * 0.4, k * 0.9, nz * k * 0.4] : upper ? [nx * k * 1.1, -k * 0.2, nz * k * 1.1] : [nx * k * 0.6, k * 0.35, nz * k * 0.6];
        case 'board':  // driven into the wall: chest first, then he crumples down it
          return upper ? [nx * k * 1.2, k * 0.15, nz * k * 1.2] : legs ? [nx * k * 0.5, 0, nz * k * 0.5] : [nx * k * 0.9, 0, nz * k * 0.9];
        default:       // open ice: knocked back off his feet, skates go out from under him
          return upper ? [nx * k, k * 0.25, nz * k] : legs ? [-nx * k * 0.25, k * 0.3, -nz * k * 0.25] : [nx * k * 0.55, k * 0.15, nz * k * 0.55];
      }
    };
    for (let i = 0; i < n; i++) {
      const [kx, ky, kz] = kickOf(i);
      this.q[i * 3] = this.p[i * 3] - kx * dt; this.q[i * 3 + 1] = this.p[i * 3 + 1] - ky * dt; this.q[i * 3 + 2] = this.p[i * 3 + 2] - kz * dt;
    }
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
    }
  }
  /** test hook: is every particle finite, above the ice and every link near its rest length (no exploding limbs) */
  health() {
    let worst = 0, low = 9;
    LINKS.forEach(([a, b, slack], li) => { if (slack === 0) worst = Math.max(worst, Math.abs(this.dist(a, b) / this.rest[li] - 1)); });
    for (let i = 1; i < this.p.length; i += 3) low = Math.min(low, this.p[i]);
    const P = this.p, my = (a: number, b: number) => (P[a * 3 + 1] + P[b * 3 + 1]) / 2;
    const up = (my(SL, SR) - my(HL, HR)) / (Math.hypot(...[0, 2].map(c => (P[SL * 3 + c] + P[SR * 3 + c] - P[HL * 3 + c] - P[HR * 3 + c]) / 2)) + Math.abs(my(SL, SR) - my(HL, HR)) || 1);
    return { finite: this.p.every(Number.isFinite), stretch: worst, low, up: +up.toFixed(2) };   // up: 1 torso upright, 0 lying flat
  }
  at(i: number, out: { x: number; y: number; z: number }) { out.x = this.p[i * 3]; out.y = this.p[i * 3 + 1]; out.z = this.p[i * 3 + 2]; return out; }
}
export const RAG = { HL, HR, SL, SR, HD, KL, KR, FL, FR, EL, ER, AL, AR };
