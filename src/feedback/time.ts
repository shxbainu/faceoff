// Hit stop and eased slow motion, with priorities so the biggest moment wins.
//
// These never change what the simulation computes. The game loop feeds `simScale()` x real time into the fixed
// 120 Hz step, so a hit stop just means "no steps this frame" and slow-mo means "fewer steps per second": the
// same steps with the same latched inputs, in the same order. In net mode (multiplayer, `?netfx`) the sim must
// keep wall-clock pace with the server, so simScale() is always 1 and only the drawn animation and particles
// (`animScale()`) freeze and slow.

import { FEEDBACK, SlowSpec } from './config';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class TimeDirector {
  net = false;
  private stopT = 0; private stopPri = -1;
  private slow: { scale: number; in: number; hold: number; out: number; t: number; pri: number } | null = null;
  /** for the debug readout */
  last = { stop: 0, slow: 1 };

  /** freeze for n frames (2..8), unless a bigger freeze is already running */
  hitStop(frames: number, priority: number) {
    const G = FEEDBACK.global;
    if (frames < 1) return;
    const n = Math.min(G.hitStopMax, Math.max(G.hitStopMin, Math.round(frames)));
    const t = n * G.frame;
    if (this.stopT > 0 && priority < this.stopPri) return;
    if (t > this.stopT) { this.stopT = t; this.stopPri = priority; }
  }

  slowmo(spec: SlowSpec, i: number, strength: number, priority: number) {
    const scale = Math.max(FEEDBACK.global.slowmoMin, 1 - (1 - lerp(spec.scale[0], spec.scale[1], i)) * strength);
    if (scale > 0.97) return;
    const cur = this.slow;
    if (cur && priority < cur.pri && cur.t < cur.in + cur.hold) return;   // a bigger slow-mo is still holding
    this.slow = { scale, in: spec.in, hold: lerp(spec.hold[0], spec.hold[1], i) * Math.min(1, strength), out: spec.out, t: 0, pri: priority };
  }

  /** player skipped: drop the freeze and ease out of slow-mo quickly */
  skip() {
    this.stopT = 0;
    const s = this.slow;
    if (s && s.t < s.in + s.hold + s.out) { s.t = s.in + s.hold; s.out = Math.min(s.out, 0.12); }
  }

  clear() { this.stopT = 0; this.slow = null; }

  get active() { return this.stopT > 0 || !!this.slow; }

  update(rdt: number) {
    if (this.stopT > 0) { this.stopT -= rdt; return; }   // slow-mo waits until the freeze is over
    const s = this.slow;
    if (s) { s.t += rdt; if (s.t >= s.in + s.hold + s.out) this.slow = null; }
  }

  private curve(): number {
    if (this.stopT > 0) return 0;
    const s = this.slow;
    if (!s) return 1;
    if (s.t < s.in) return lerp(1, s.scale, easeOut(s.t / Math.max(1e-3, s.in)));
    if (s.t < s.in + s.hold) return s.scale;
    return lerp(s.scale, 1, easeInOut(Math.min(1, (s.t - s.in - s.hold) / Math.max(1e-3, s.out))));
  }

  /** how much real time the simulation gets this frame */
  simScale(): number { const c = this.net ? 1 : this.curve(); this.last = { stop: Math.max(0, this.stopT), slow: c }; return c; }
  /** how much time animation and particles get this frame (same as the sim, except in net mode) */
  animScale(): number { return this.curve(); }
}
