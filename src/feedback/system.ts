// The central feedback system. Gameplay events come in (handle), get resolved to a config entry (variant),
// scaled by quality, chaining, involvement, distance and the player's settings, and turn into effects:
// hit stop and slow-mo (time.ts), trauma shake, kicks, punch, fov, flashes, chromatic and vignette pulses,
// squash and stretch, pooled particles, layered sound and popups. Nothing here writes to the simulation.
//
// To add an event: emit it from gameplay (src/feedback/events.ts lists the names), add an entry under
// FEEDBACK.events in config.ts, and if it needs a variant (good or bad side, a tag) add a line to `variant`.

import type { Ev, Game } from '../sim';
import type { View } from '../render';
import { FEEDBACK, FxKey, FxSpec, Range } from './config';
import { TimeDirector } from './time';
import { FxHud } from './hud';
import { feel } from './settings';
import { cue, humSet, humStop, audioStats, setVoiceCap } from '../audio';

const lerp = (r: Range | undefined, i: number) => (r ? r[0] + (r[1] - r[0]) * i : 0);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const SPECS = FEEDBACK.events as Record<FxKey, FxSpec>;

/** events about the whole team: they play at full size whoever touched the puck */
const TEAM_LEVEL = new Set<FxKey>(['goal_scored', 'goal_conceded', 'save_made', 'post_hit', 'near_miss', 'turnover_won', 'turnover_lost', 'heat_fire', 'faceoff_won', 'streak_end']);

interface Req { key: FxKey; spec: FxSpec; i: number; e: Ev; me: boolean; inv: number }

export class FeedbackSystem {
  readonly time = new TimeDirector();
  readonly hud = new FxHud();
  // camera state
  private trauma = 0; private t = 0;
  private kx = 0; private kz = 0; private kvx = 0; private kvz = 0;
  private fov = 0; private fovV = 0; private fovHold = 0;
  private punch = 0;
  private flashA = 0; private lastFlash = -9;
  private chroma = 0; private chromaAng = 0;
  private vig = 0; private vigHold = 0;
  private phase = [Math.random() * 9, Math.random() * 9, Math.random() * 9];
  // flow rank and streak
  private flowPts = 0; private flowIdle = 0; private rankI = 0;
  streak = 0;
  // goal sequence
  private celebrate = 0; private goalsThisMatch = 0; private lastGoalAt = -99;
  // continuous emitters
  private trailAcc = 0; private lineAcc = 0; private skateAcc = 0;
  private windWas = -1; private sweetTicked = false;
  // bookkeeping
  private queue: Req[] = [];
  private cool: Partial<Record<FxKey, number>> = {};
  private lastPost = -9;
  /** debug and test readouts */
  readonly stats = { fired: {} as Record<string, number>, lastI: {} as Record<string, number>, frameMs: 0, maxQueue: 0 };

  constructor(private view: View, private game: () => Game) {
    this.time.net = new URLSearchParams(location.search).has('netfx');
    setVoiceCap(FEEDBACK.global.voices);
    view.pBudget = FEEDBACK.global.particles.budget;
  }

  /** a new match: flow and streak start over (rank is per match), goal repeat counter resets */
  reset() {
    this.flowPts = 0; this.rankI = 0; this.streak = 0; this.goalsThisMatch = 0; this.lastGoalAt = -99; this.celebrate = 0;
    this.trauma = 0; this.time.clear(); this.hud.streak(0, 'hide'); this.hud.hideGoal(); humStop();
  }

  // ------------------------------------------------------------ input from gameplay
  /** force: debug path, ignores cooldowns and de-duplication */
  handle(e: Ev, force = false) {
    const g = this.game();
    const key = this.variant(e, g);
    if (!key) {
      if (e.t === 'pop') this.scorePop(e);
      else if (e.t === 'streak_end') this.streakEnd(e);
      return;
    }
    const spec = SPECS[key];
    const ctl = g.ctrl?.id;
    const me = e.id === ctl || e.vid === ctl;
    if (spec.meOnly && !me) return;
    const now = this.t;
    if (!force && spec.cooldown && (this.cool[key] ?? -9) > now - spec.cooldown) return;
    this.cool[key] = now;
    if (!force && key === 'near_miss' && now - this.lastPost < 0.2) return;
    if (key === 'post_hit') this.lastPost = now;
    // involvement: your own play counts fully; other skaters' plays count for less; team moments are full
    // (team moments are never distance-scaled: a goal at the far end is still a goal)
    const team = TEAM_LEVEL.has(key);
    let inv = team || me ? 1 : FEEDBACK.global.others;
    if (e.team === 1 && !team && !me && key.startsWith('pass')) inv *= 0.5;   // their passing game: barely there
    if (!team) inv *= this.distance(e);
    this.queue.push({ key, spec, i: clamp01(e.i ?? 0.5), e, me, inv });
    if (key === 'pass_completed' && e.team === 0) this.streakUp(e.n ?? 0);
  }

  /** which config entry a gameplay event plays (null: not a feedback event) */
  private variant(e: Ev, g: Game): FxKey | null {
    switch (e.t) {
      case 'check_landed':
        if (e.tag === 'shove') return 'check_shove';
        if (e.tag === 'poke') return e.team === 0 ? 'check_poke' : null;
        if (e.team !== 0) return 'got_hit';
        return e.board ? 'check_board' : 'check_landed';
      case 'turnover': return e.team === 0 ? 'turnover_won' : 'turnover_lost';
      case 'goal_scored': return e.team === 0 ? 'goal_scored' : 'goal_conceded';
      case 'faceoff_won': return e.team === 0 ? 'faceoff_won' : null;
      case 'fire': return 'heat_fire';
      case 'slam': return 'slam';
      case 'streak_end': return null;
      default: return (e.t in SPECS ? (e.t as FxKey) : null);
    }
    void g;
  }

  private distance(e: Ev): number {
    if (e.x === undefined) return 1;
    const [cx, cz] = this.view.camCenter(), D = FEEDBACK.global.distance;
    const d = Math.hypot(e.x - cx, (e.y ?? 0) - cz);
    return d <= D.near ? 1 : Math.max(D.floor, 1 - (d - D.near) / (D.far - D.near));
  }

  // ------------------------------------------------------------ resolve a frame's events, biggest first
  private flush() {
    if (!this.queue.length) return;
    this.stats.maxQueue = Math.max(this.stats.maxQueue, this.queue.length);
    const q = this.queue.sort((a, b) => b.spec.priority - a.spec.priority);
    this.queue = [];
    const top = q[0].spec.priority;
    for (let k = 0; k < q.length; k++) this.apply(q[k], k === 0 || q[k].spec.priority >= top ? 1 : 0.35, q[k].spec.priority >= top);
  }

  private apply(r: Req, share: number, lead: boolean) {
    const { key, spec, e, me } = r;
    const G = FEEDBACK.global, bad = spec.valence === 'bad', good = spec.valence === 'good';
    // chaining: good events escalate with the flow rank and the pass streak
    const esc = good ? Math.min(G.escalate.max, this.rankI * G.escalate.perRank + (e.team === 0 ? this.streak * G.escalate.perStreak : 0)) : 0;
    const i = clamp01(r.i + esc);
    const K = feel.intensity * (bad ? G.negative : 1);
    const A = K * r.inv * share;
    this.stats.fired[key] = (this.stats.fired[key] ?? 0) + 1; this.stats.lastI[key] = +i.toFixed(2);
    const x = e.x ?? 0, y = e.y ?? 0, dx = e.dx ?? 0, dy = e.dy ?? 0;
    const view = this.view;

    // time: only the lead event of a frame, and only for your own plays or team moments
    if (feel.slowmo && lead && r.inv > 0.7 && K > 0) {
      const extra = (e.timed ? 1 : 0) + (key === 'shot_released' && e.big ? 1 : 0);
      if (spec.hitStop) this.time.hitStop((lerp(spec.hitStop, i) + extra) * Math.min(1, K * 1.1), spec.priority);
      const slow = spec.slowmo;
      if (slow && i >= (slow.minI ?? 0)) {
        const rep = key === 'goal_scored' && this.repeatGoal(i) ? FEEDBACK.goal.repeatScale : 1;
        this.time.slowmo({ ...slow, hold: [slow.hold[0] * rep, slow.hold[1] * rep] }, i, Math.min(1, K) * (e.tag === 'over' ? 1.2 : 1), spec.priority);
      }
    }
    // camera
    if (feel.shake) {
      this.trauma = Math.min(G.trauma.max, this.trauma + lerp(spec.trauma, i) * A);
      let kdx = dx, kdy = dy;
      if (key === 'goal_scored' || key === 'goal_conceded') { const [nx] = view.netPos(e.team ?? 0); kdx = Math.sign(nx); kdy = 0; }   // punch toward the net
      const kick = lerp(spec.kick, i) * A;
      this.kvx += kdx * kick * G.kick.omega * 0.5; this.kvz += kdy * kick * G.kick.omega * 0.5;
      this.punch = Math.min(G.punch.max, Math.max(this.punch, lerp(spec.punch, i) * A));
      const fv = lerp(spec.fov, i) * A;
      if (Math.abs(fv) > Math.abs(this.fov)) { this.fov = Math.max(-G.fov.max, Math.min(G.fov.max, fv)); this.fovV = 0; this.fovHold = 0.05; }
    }
    if (feel.flashes && spec.flash && lead) {
      const a = Math.min(G.flash.maxAlpha, lerp(spec.flash, i) * K);
      if (a > 0.02 && this.t - this.lastFlash >= G.flash.minGap) { this.flashA = Math.max(this.flashA, a); this.lastFlash = this.t; }
    }
    if (feel.chroma) {
      const c = lerp(spec.chroma, i) * A;
      if (c > this.chroma) { this.chroma = Math.min(1, c); this.chromaAng = Math.atan2(dy, dx || 1e-3); }
      this.vig = Math.min(1, Math.max(this.vig, lerp(spec.vignette, i) * A));
    }
    // body
    const sq = lerp(spec.squash, i) * Math.min(1.2, feel.intensity) * (r.inv > 0.7 ? 1 : 0.7);
    if (sq && (e.vid ?? e.id) !== undefined) view.squash((e.vid ?? e.id)!, sq, dx, dy, sq > 0 ? 0.2 : 0.16);
    if (key === 'shot_released' || key === 'one_timer') view.puckSnap(0.4 + 0.6 * i);
    // particles (counts follow intensity, but never vanish below 40% so the world still reacts)
    const pk = (0.4 + 0.6 * Math.min(1.25, feel.intensity)) * (0.5 + 0.5 * r.inv) * (0.6 + 0.4 * share);
    for (const p of spec.particles ?? []) {
      const n = Math.min(G.particles.perEventCap, Math.round(lerp(p.count, i) * pk));
      const sp = lerp(p.speed, i);
      if (p.kind === 'ring') { if (A > 0.05) view.ringPulse(x, y, Array.isArray(p.color) ? p.color[0] : p.color, 0.3, sp * Math.max(0.6, Math.min(1.2, A)), 0.3); continue; }
      const kind = p.kind === 'sparks' ? 1 : p.kind === 'confetti' ? 2 : 0;
      let ex = x, ey = y;
      if (p.kind === 'confetti') { const [nx] = view.netPos(e.team ?? 0); ex = nx - Math.sign(nx) * 3; ey = 0; }
      view.emit(kind, ex, ey, n, p.color, sp, {
        up: p.up, size: p.size ?? (p.kind === 'dust' ? 0.08 : p.kind === 'sparks' ? 0.12 : 0.15), h: p.h,
        life: p.kind === 'confetti' ? 2.6 : p.kind === 'sparks' ? 0.4 : 0.6,
        dx: p.directional ? dx : p.kind === 'confetti' ? -Math.sign(ex) : undefined, dy: p.directional ? dy : p.kind === 'confetti' ? 0 : undefined,
        spread: p.kind === 'confetti' ? 2.6 : undefined,
      });
    }
    // sound: layered, pitch jittered, the streak climbs a scale
    const vk = (0.6 + 0.4 * r.inv) * (lead ? 1 : 0.75);
    for (const s of spec.sounds ?? []) {
      let semis = (s.jitter ?? 0) * (Math.random() * 2 - 1);
      if (s.perStreak && e.team === 0) { const sc = FEEDBACK.streak.scale; semis += sc[Math.min(sc.length - 1, Math.max(0, (e.n ?? 0) - 1))] * s.perStreak; }
      cue(s.cue, lerp(s.vol, i) * vk, lerp(s.pitch ?? [1, 1], i) * Math.pow(2, semis / 12), s.delay ?? 0, spec.priority >= 6 ? 2 : spec.priority >= 3 ? 1 : 0);
    }
    // popups for moments with no style-points popup of their own
    if (spec.popup && i >= (spec.popup.minI ?? 0) && (me || TEAM_LEVEL.has(key) || r.inv > 0.5)) {
      const [sx, sy] = view.project(x, 2.4, y);
      this.hud.popup(spec.popup.text.replace('{n}', String(e.n ?? 0)), sx, sy, spec.popup.size, 0.8 + 0.5 * i, spec.priority, G.popups.max);
    }
    if (key === 'save_made' && e.big && e.team === 1) { const [sx, sy] = view.project(x, 2.4, y); this.hud.popup('Robbed', sx, sy, 'md', 1, spec.priority); }
    if (key === 'check_landed' && e.timed && me) { const [sx, sy] = view.project(x, 3.2, y); this.hud.popup('Timed hit', sx, sy, 'sm', 1, spec.priority); }
    // flow rank
    if (spec.flow) this.addFlow(spec.flow * (spec.flow > 0 ? (0.5 + 0.5 * i) * (0.4 + 0.6 * r.inv) : 1));
    // goals: the card and the skip window
    if (key === 'goal_scored') this.goalCard(e, i);
    if (key === 'goal_conceded') { this.celebrate = 0; this.hud.hideGoal(); }
  }

  private repeatGoal(i: number) { return this.goalsThisMatch > 0 && this.t - this.lastGoalAt < FEEDBACK.goal.repeatWindow && i < 0.85; }

  private goalCard(e: Ev, i: number) {
    const rep = this.repeatGoal(i);
    const tags = (e.text ?? '').split(' ').filter(Boolean);
    const sub = [tags.includes('ot') ? 'Sudden death' : '', tags.includes('winner') ? 'Game winner' : '', tags.includes('one_timer') ? 'One-timer' : '',
      (e.n ?? 0) >= 2 ? `Off a ${e.n}-pass streak` : ''].filter(Boolean).join(' · ');
    const g = this.game();
    this.hud.goalCard('Goal', sub || `${g.score[0]} – ${g.score[1]}`, true);
    this.celebrate = FEEDBACK.goal.celebrateTime * (rep ? FEEDBACK.goal.repeatScale : 1);
    this.goalsThisMatch++; this.lastGoalAt = this.t;
  }

  /** a skip key was pressed: cut a running goal celebration short */
  skip(): boolean {
    if (this.celebrate <= 0 || FEEDBACK.goal.celebrateTime - this.celebrate < FEEDBACK.goal.skipAfter) return false;
    this.celebrate = 0; this.time.skip(); this.hud.hideGoal();
    this.trauma *= 0.4; this.punch *= 0.4;
    return true;
  }
  get celebrating() { return this.celebrate > 0; }

  // ------------------------------------------------------------ streak and flow
  private streakUp(n: number) {
    this.streak = n;
    if (n >= FEEDBACK.streak.minShow) this.hud.streak(n, 'up');
  }
  private streakEnd(e: Ev) {
    const n = e.n ?? 0;
    this.streak = 0;
    if (e.tag === 'cashed') this.hud.streak(n, 'cashed');
    else {
      this.hud.streak(n, 'broken');
      const s = SPECS.streak_end;
      for (const c of s.sounds ?? []) cue(c.cue, lerp(c.vol, 0.5), lerp(c.pitch ?? [1, 1], 0.5), 0, 0);
    }
    this.stats.fired.streak_end = (this.stats.fired.streak_end ?? 0) + 1;
  }
  private addFlow(pts: number) {
    const F = FEEDBACK.flow;
    this.flowPts = Math.max(0, Math.min(F.max, this.flowPts + pts));
    if (pts > 0) this.flowIdle = 0;
  }
  private rank() {
    const R = FEEDBACK.flow.ranks;
    let k = 0; for (let j = 0; j < R.length; j++) if (this.flowPts >= R[j].at) k = j;
    return k;
  }
  get flowState() { return { pts: Math.round(this.flowPts), rank: FEEDBACK.flow.ranks[this.rankI].name }; }

  private scorePop(e: Ev) {
    const [sx, sy] = this.view.project(e.x ?? 0, 2.4, e.y ?? 0);
    const m = /\+(\d+)/.exec(e.text ?? ''), pts = m ? +m[1] : 0;
    this.hud.popup(e.text ?? '', sx, sy, pts >= 600 ? 'lg' : e.big || pts >= 300 ? 'md' : 'sm', 0.9 + Math.min(0.6, pts / 1500), e.big ? 5 : 2);
  }
  /** a popup from outside (heat tiers) */
  popAt(text: string, x: number, y: number, big: boolean) { const [sx, sy] = this.view.project(x, 2.4, y); this.hud.popup(text, sx, sy, big ? 'md' : 'sm', 1, big ? 4 : 1); }

  // ------------------------------------------------------------ every frame
  /** rdt: real frame time. live: a match is on (continuous effects only then) */
  update(rdt: number, live: boolean) {
    const t0 = performance.now();
    this.t += rdt;
    this.time.update(rdt);   // before this frame's events, so a new hit stop gets its full length
    this.flush();
    const G = FEEDBACK.global, g = this.game(), view = this.view;
    const animDt = rdt * this.time.animScale();
    // continuous: wind-up tension, puck trail and speed lines, top-speed lines
    let windVig = 0, windFov = 0;
    const h = g.ctrl, p = g.pucks[0];
    if (live && h && g.phase === 'play' && h.wind >= 0 && (p.owner === h || (p.kind === 'pass' && p.target === h))) {
      const C = FEEDBACK.continuous.windup, w = Math.min(1, h.wind / 0.82), over = h.wind > 0.82;
      const sweet = h.wind >= 0.32 && h.wind <= 0.82;
      windVig = C.vignette * w * feel.intensity * (feel.chroma ? 1 : 0);
      windFov = C.fov * w * feel.intensity * (feel.shake ? 1 : 0);
      humSet(C.hum * w * (over ? 0.6 : 1), 1 + w * 0.8 - (over ? 0.25 : 0));
      if (sweet && !this.sweetTicked) { this.sweetTicked = true; cue('draw_click', 0.5, 1.6); view.ringPulse(h.x, h.y, 0xffffff, 0.4, 1.6, 0.22); }
      if (!sweet) this.sweetTicked = h.wind > 0.82;
      this.windWas = h.wind;
    } else if (this.windWas >= 0) { this.windWas = -1; this.sweetTicked = false; humStop(); }
    if (live && animDt > 0) {
      const C = FEEDBACK.continuous;
      const sp = Math.hypot(p.vx, p.vy), free = !p.owner && !p.held;
      if (free && (p.kind === 'pass' || p.kind === 'shot') && sp > 6) {   // puck trail
        this.trailAcc += animDt * C.trail.perSecond * Math.min(1.5, sp / 25) * Math.min(1, 0.5 + feel.intensity * 0.5);
        const col = g.fireT > 0 && p.lastTeam === 0 ? C.trail.fire : p.kind === 'shot' ? C.trail.shot : C.trail.pass;
        while (this.trailAcc >= 1) { this.trailAcc--; view.emit(4, p.x - p.vx * Math.random() * 0.016, p.y - p.vy * Math.random() * 0.016, 1, col, 0, { h: 0.08, size: p.kind === 'shot' ? 0.16 : 0.12, life: C.trail.life }); }
      }
      if (free && p.kind === 'shot' && sp > C.speedLines.minSpeed && feel.intensity > 0) {   // speed lines along a hard shot
        this.lineAcc += animDt * C.speedLines.perSecond * (sp / 40) * feel.intensity;
        const ux = p.vx / sp, uy = p.vy / sp;
        while (this.lineAcc >= 1) {
          this.lineAcc--;
          const side = (Math.random() - 0.5) * 2.4;
          view.emit(3, p.x - uy * side, p.y + ux * side, 1, C.speedLines.color, 0, { h: 0.15 + Math.random() * 0.9, size: 0.06 * C.speedLines.len, life: 0.18, vx: p.vx * 0.55, vy: p.vy * 0.55 });
        }
      }
      const hs = h ? Math.hypot(h.vx, h.vy) : 0;
      if (h && h.sprint && hs > 10.2 * C.skateLines.minFrac && feel.intensity > 0) {   // near top speed: air streaming past you
        this.skateAcc += animDt * C.skateLines.perSecond * feel.intensity;
        while (this.skateAcc >= 1) {
          this.skateAcc--;
          const ux = h.vx / hs, uy = h.vy / hs, side = (Math.random() - 0.5) * 3, fwd = 1.5 + Math.random() * 2;
          view.emit(3, h.x + ux * fwd - uy * side, h.y + uy * fwd + ux * side, 1, 0xe8f4ff, 0, { h: 0.4 + Math.random() * 1.6, size: 0.05, life: 0.2, vx: -h.vx * 0.9, vy: -h.vy * 0.9 });
        }
      }
    }
    // camera: trauma shake (smooth noise), kick spring, fov spring, punch
    this.trauma = Math.max(0, this.trauma - G.trauma.decay * rdt);
    const sh = Math.pow(this.trauma, G.trauma.exponent), f = G.trauma.freq, tt = this.t;
    const nz = (k: number) => (Math.sin(tt * f + this.phase[k]) + Math.sin(tt * f * 1.73 + this.phase[k] * 2) * 0.6 + Math.sin(tt * f * 2.91 + this.phase[k] * 3) * 0.3) / 1.9;
    const w = G.kick.omega;
    this.kvx += (-w * w * this.kx - 2 * w * this.kvx) * rdt; this.kx += this.kvx * rdt;
    this.kvz += (-w * w * this.kz - 2 * w * this.kvz) * rdt; this.kz += this.kvz * rdt;
    const km = G.kick.max; this.kx = Math.max(-km, Math.min(km, this.kx)); this.kz = Math.max(-km, Math.min(km, this.kz));
    if (this.fovHold > 0) this.fovHold -= rdt;
    else { const fw = G.fov.omega; this.fovV += (-fw * fw * this.fov - 2 * fw * this.fovV) * rdt; this.fov += this.fovV * rdt; }
    this.punch = Math.max(0, this.punch - G.punch.decay * this.punch * rdt * 2 - 0.02 * rdt);
    const shakeOn = feel.shake ? 1 : 0;
    view.fxCam.ox = (sh * G.trauma.offset * nz(0) + this.kx) * shakeOn;
    view.fxCam.oz = (sh * G.trauma.offset * nz(1) + this.kz) * shakeOn;
    view.fxCam.roll = sh * G.trauma.roll * nz(2) * shakeOn;
    view.fxCam.fov = (this.fov + windFov) * shakeOn;
    view.fxCam.punch = this.punch * shakeOn;
    // screen layers
    this.flashA = Math.max(0, this.flashA - rdt * (G.flash.maxAlpha / G.flash.fade));
    this.chroma = Math.max(0, this.chroma - rdt * G.chroma.decay * Math.max(0.3, this.chroma));
    this.vig = Math.max(0, this.vig - rdt * G.vignette.decay * Math.max(0.3, this.vig));
    view.setChroma(feel.chroma ? this.chroma * G.chroma.max : 0, this.chromaAng);
    this.hud.layers(feel.flashes ? this.flashA : 0, Math.min(G.vignette.max, Math.max(this.vig, windVig)));
    // flow rank decays when idle
    const F = FEEDBACK.flow;
    this.flowIdle += rdt;
    if (this.flowIdle > F.idleDelay) this.flowPts = Math.max(0, this.flowPts - (F.decay + F.decayPerRank * this.rankI) * rdt);
    const rk = this.rank(), up = rk > this.rankI;
    if (up) cue('rank_up', 0.55, 1 + rk * 0.06, 0, 2);
    this.rankI = rk;
    const R = F.ranks, lo = R[rk].at, hi = rk + 1 < R.length ? R[rk + 1].at : F.max;
    this.hud.flow(R[rk].name, Math.max(0, Math.min(1, (this.flowPts - lo) / (hi - lo || 1))), rk >= 4, up, live);
    this.hud.tick(rdt);
    if (this.celebrate > 0) { this.celebrate -= rdt; if (this.celebrate <= 0) this.hud.hideGoal(); }
    this.stats.frameMs = performance.now() - t0;
  }

  /** test readout */
  snapshot() {
    return {
      fired: { ...this.stats.fired }, lastI: { ...this.stats.lastI }, flow: this.flowState, streak: this.streak,
      trauma: +this.trauma.toFixed(3), time: { ...this.time.last }, net: this.time.net, celebrating: this.celebrating,
      particles: this.view.particleCount, voices: audioStats.voices, droppedVoices: audioStats.dropped, fxMs: +this.stats.frameMs.toFixed(3),
      cam: { ...this.view.fxCam }, flash: +this.flashA.toFixed(3), chroma: +this.chroma.toFixed(3), vignette: +this.vig.toFixed(3), settings: { ...feel },
    };
  }
}
