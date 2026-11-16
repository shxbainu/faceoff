// Faceoff simulation. No rendering in here: fixed-step, seeded, input-driven,
// so the same code can later run on a game server for multiplayer.

export const L = 40; // half length (x). Was 22: skaters were ~10% of the rink width, the reference is ~3%
export const W = 19; // half width (y, screen-down is +y)
export const CR = 8.5; // corner radius
/** rink scale relative to the original 44x22 rink, for positions that should grow with the ice */
const KX = L / 22, KY = W / 11;
export const GOAL_HALF = 2.1;
export const NET_DEPTH = 1.5;
export const SR = 0.7; // skater radius
export const PR = 0.22; // puck radius
export const WIN_GOALS = 3;
export const MATCH_SECONDS = 90;
/** skaters per side. 5 is the current prototype; ?team=3 brings back 3v3. Slots: 0 centre, 1 wing, 2 anchor defender, 3 wing, 4 second defender. */
export let TEAM = 5;
export function setTeamSize(n: number) { TEAM = n === 3 ? 3 : 5; }

export type PowerId = 'curve' | 'shock' | 'split' | 'burner' | 'magnet' | 'slapper' | 'hot' | 'wall';
export type Gimmick = 'frost' | 'wreck' | 'dark' | 'zamboni';

export interface PowerDef { id: PowerId; name: string; icon: string; color: string; desc: string }
export const POWERS: PowerDef[] = [
  { id: 'curve', name: 'Curve Pass', icon: '↪', color: '#39d5ff', desc: 'Passes bend around defenders and are harder to pick off.' },
  { id: 'shock', name: 'Shockwave Check', icon: '✺', color: '#ff7a3d', desc: 'Your hits flatten every opponent standing nearby.' },
  { id: 'split', name: 'Split Shot', icon: '⋔', color: '#c77dff', desc: 'Every shot splits off an extra live puck per level.' },
  { id: 'burner', name: 'Afterburner', icon: '➤', color: '#7dff8a', desc: 'Faster skating and a deeper burst tank for the whole team.' },
  { id: 'magnet', name: 'Magnet Stick', icon: '∩', color: '#ff5d8f', desc: 'Wider puck pickup and pokes slide off your stick.' },
  { id: 'slapper', name: 'Heavy Slapper', icon: '✦', color: '#ffd23d', desc: 'All your shots leave the stick harder.' },
  { id: 'hot', name: 'Hot Hands', icon: '♨', color: '#ff9a3d', desc: 'Heat builds faster from every stylish play.' },
  { id: 'wall', name: 'Iron Wall', icon: '▣', color: '#9fb4ff', desc: 'Your goalie covers more of the net.' },
];

export interface TeamDef {
  name: string; code: string; color: number; trim: number;
  gimmick: Gimmick | null; blurb: string;
}
export const HOME: TeamDef = { name: 'Kilowatts', code: 'KWT', color: 0xffb400, trim: 0x23263a, gimmick: null, blurb: '' };
export const OPPONENTS: TeamDef[] = [
  { name: 'Permafrost', code: 'PFR', color: 0x6a35b8, trim: 0x8ff0ff, gimmick: 'frost', blurb: 'They flash-freeze whole lanes of ice. Deep frost grabs your skates, not theirs.' },
  { name: 'Wrecking Crew', code: 'WRK', color: 0xc62f2f, trim: 0x1a1a1a, gimmick: 'wreck', blurb: 'Built like fridges. Only BIG hits knock them down, and theirs keep you down longer.' },
  { name: 'Night Shift', code: 'NSH', color: 0x1d7a55, trim: 0xb6ff3d, gimmick: 'dark', blurb: 'They keep cutting the arena lights. Follow the glow.' },
  { name: 'Resurfacer Union', code: 'RSU', color: 0x2a4fd0, trim: 0xff8a1e, gimmick: 'zamboni', blurb: 'BOSS. They own the rink, and their ice machine drives straight through play.' },
];
export const ROUND_ORDER = [0, 1, 2, 0, 1, 2, 1, 3];
export const RUN_ROUNDS = 8;

export interface Ctl {
  mx: number; my: number; pass: boolean; shoot: boolean; check: boolean; burst: boolean;
  passTo?: Skater | null;
}

export interface Skater {
  id: number; team: number; slot: number; human: boolean;
  x: number; y: number; vx: number; vy: number; face: number;
  stun: number; air: boolean; z: number; vz: number; out: number; boxed: number;
  wind: number; checkT: number; checkCd: number; blockT: number; pickupCd: number;
  stamina: number; calling: number; frost: boolean;
  slow: number; settle: number; // slowed by a standing check; just-received grace against pokes
  pPass: boolean; pShoot: boolean; pCheck: boolean;
  hits: Set<number>; lungeAt: Skater | null;
  ai: { hold: number; patience: number; windGoal: number; react: number; oneT: boolean };
}

/** goalies stay in their crease and slide along the goal line */
export interface Goalie { team: number; x: number; y: number; vy: number; react: number }

export interface Puck {
  x: number; y: number; vx: number; vy: number;
  owner: Skater | null; lastTeam: number; shooter: Skater | null;
  kind: 'loose' | 'pass' | 'shot'; target: Skater | null; from: Skater | null;
  ax: number; ay: number; q: number; oneTimer: boolean; fire: boolean;
  ghost: boolean; alive: boolean; checked: Set<number>; age: number;
  cpx: number; cpy: number; cc: number; cT: number;
}

export interface Ev { t: string; x?: number; y?: number; text?: string; n?: number; big?: boolean; team?: number; dx?: number; dy?: number }

export interface Stats { shots: number[]; hits: number[]; passes: number[]; saves: number[]; oneTimers: number; attack: number[] }

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

export function insideRink(x: number, y: number, r = 0): boolean {
  const ax = Math.abs(x), ay = Math.abs(y);
  if (ax > L - r || ay > W - r) return false;
  const ix = L - CR, iy = W - CR;
  if (ax > ix && ay > iy) return Math.hypot(ax - ix, ay - iy) <= CR - r;
  return true;
}

export class Game {
  skaters: Skater[] = [];
  pucks: Puck[] = [];
  score = [0, 0];
  clock = MATCH_SECONDS;
  ot = false; otT = 0;
  phase: 'faceoff' | 'play' | 'goal' | 'over' = 'faceoff';
  phaseT = 0;
  foDrop = 0; foLive = false; foLock = 0; foBot = 0;
  heat = 0; heatIdle = 0; fireT = 0; style = 0; combo = 0; comboT = 0; chain = 0;
  events: Ev[] = [];
  winner = -1; time = 0; pendingOver = false;
  stats: Stats = { shots: [0, 0], hits: [0, 0], passes: [0, 0], saves: [0, 0], oneTimers: 0, attack: [0, 0] };
  goalies: Goalie[] = [0, 1].map(team => ({ team, x: (team === 0 ? -1 : 1) * (L - 0.9), y: 0, vy: 0, react: 0 }));
  // gimmick state
  gimT = 6;
  lane = { x: 0, half: 2.6, warn: 0, t: 0 };
  dark = 0;
  zam = { active: false, warn: 0, x: 0, y: 0, hx: 2.3, hy: 1.7 };
  private seed: number;
  readonly skillLevel: number;

  constructor(public round: number, public opp: TeamDef, public powers: Record<PowerId, number>, seed: number) {
    this.seed = seed >>> 0 || 1;
    this.skillLevel = clamp(0.15 + (0.85 * (round - 1)) / 7, 0, 1);
    let id = 0;
    for (let team = 0; team < 2; team++) for (let slot = 0; slot < TEAM; slot++) {
      this.skaters.push({
        id: id++, team, slot, human: team === 0 && slot === 0,
        x: 0, y: 0, vx: 0, vy: 0, face: team === 0 ? 0 : Math.PI,
        stun: 0, air: false, z: 0, vz: 0, out: 0, boxed: 0,
        wind: -1, checkT: 0, checkCd: 0, blockT: 0, pickupCd: 0,
        stamina: 1, calling: 0, frost: false, slow: 0, settle: 0,
        pPass: false, pShoot: false, pCheck: false,
        hits: new Set(), lungeAt: null,
        ai: { hold: 0, patience: 2, windGoal: 0.5, react: 0.3, oneT: false },
      });
    }
    this.pucks.push(this.newPuck());
    if (opp.gimmick === 'zamboni') this.score[1] = 0;
    this.setupFaceoff();
  }

  rnd(): number {
    let t = (this.seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private newPuck(): Puck {
    return {
      x: 0, y: 0, vx: 0, vy: 0, owner: null, lastTeam: -1, shooter: null, kind: 'loose', target: null, from: null,
      ax: 0, ay: 0, q: 0, oneTimer: false, fire: false, ghost: false, alive: true, checked: new Set(), age: 0,
      cpx: 0, cpy: 0, cc: 0, cT: 0,
    };
  }

  pw(team: number, id: PowerId): number { return team === 0 ? this.powers[id] || 0 : 0; }
  active(s: Skater): boolean { return s.stun <= 0 && !s.air && s.out <= 0 && s.boxed <= 0; }
  mult(): number { return 1 + Math.min(3, Math.floor(this.heat / 250)); }
  /** Heat tier 0..4 for a team. Only the home team has Heat. Every tier is a real buff. */
  tier(team: number): number { return team !== 0 ? 0 : this.fireT > 0 ? 4 : this.mult() - 1; }
  private lastTier = 0;
  private coolHeat(n: number) { if (this.fireT <= 0) this.heat = Math.max(0, this.heat - n); }

  private ev(e: Ev) { this.events.push(e); }

  addHeat(pts: number, label: string, x: number, y: number) {
    const mult = this.fireT > 0 ? 5 : this.mult();
    const gain = pts * mult;
    this.style += gain;
    this.combo = this.comboT > 0 ? this.combo + 1 : 0;
    this.comboT = 4;
    this.ev({ t: 'pop', text: `${label} +${gain}`, x, y, n: this.combo, big: pts >= 200 });
    if (this.fireT <= 0) {
      this.heat += Math.min(pts, 300) * 0.45 * (1 + 0.25 * this.pw(0, 'hot'));
      this.heatIdle = 0;
      if (this.heat >= 1000) {
        this.heat = 1000; this.fireT = 10;
        this.ev({ t: 'fire', x, y });
      }
    }
  }

  setupFaceoff() {
    this.phase = 'faceoff';
    this.foDrop = 0.75 + this.rnd() * 0.45;
    this.foLive = false; this.foLock = 0;
    const side = this.rnd() < 0.5 ? 1 : -1;
    for (const s of this.skaters) {
      const d = s.team === 0 ? -1 : 1;
      if (s.slot === 0) { s.x = d * 1.15; s.y = 0; }
      else if (s.slot === 1) { s.x = d * 4.5 * KX; s.y = d * side * 5 * KY; }
      else if (s.slot === 2) { s.x = d * 13 * KX; s.y = d * side * 3 * KY; }
      else if (s.slot === 3) { s.x = d * 4.5 * KX; s.y = -d * side * 5 * KY; }
      else { s.x = d * 13 * KX; s.y = -d * side * 3 * KY; }
      s.vx = s.vy = 0; s.face = d < 0 ? 0 : Math.PI;
      s.stun = 0; s.air = false; s.z = 0; s.out = 0; s.wind = -1; s.checkT = 0; s.checkCd = 0.3; s.pickupCd = 0;
      s.calling = 0; s.ai.hold = 0; s.slow = 0; s.settle = 0; s.stamina = Math.max(s.stamina, 0.6);
      if (s.boxed > 0) s.boxed = 0;
    }
    for (const g of this.goalies) { g.y = 0; g.vy = 0; }
    this.pucks.length = 1;
    const p = this.pucks[0];
    Object.assign(p, this.newPuck());
    this.chain = 0;
    this.zam.active = false; this.zam.warn = 0;
    this.ev({ t: 'faceoff' });
  }

  // ---------------------------------------------------------------- step
  step(dt: number, human: Ctl) {
    this.time += dt;
    if (this.phase === 'over') return;
    const hs = this.skaters[0];
    this.lastHumanMy = human.my;

    if (this.phase === 'faceoff') {
      const press = (human.pass && !hs.pPass) || (human.shoot && !hs.pShoot) || (human.check && !hs.pCheck);
      hs.pPass = human.pass; hs.pShoot = human.shoot; hs.pCheck = human.check;
      this.foLock -= dt;
      if (!this.foLive) {
        this.foDrop -= dt;
        if (press) { this.foLock = 0.45; this.ev({ t: 'early' }); }
        if (this.foDrop <= 0) {
          this.foLive = true;
          this.foBot = 0.36 - 0.14 * this.skillLevel + this.rnd() * 0.16;
          this.ev({ t: 'drop' });
        }
      } else {
        this.foBot -= dt;
        let win = -1;
        if (press && this.foLock <= 0) win = 0;
        else if (this.foBot <= 0) win = 1;
        if (win >= 0) {
          const c = this.skaters[win * TEAM];
          this.phase = 'play';
          this.gain(this.pucks[0], c);
          if (win === 0) this.addHeat(100, 'Clean draw', c.x, c.y);
          this.ev({ t: 'draw', team: win });
        }
      }
      return;
    }

    if (this.phase === 'goal') {
      this.phaseT -= dt;
      for (const s of this.skaters) this.updateSkater(s, s.human ? { ...human, pass: false, shoot: false, check: false } : NOCTL, dt);
      this.tickHeat(dt);
      if (this.phaseT <= 0) {
        if (this.pendingOver) { this.phase = 'over'; this.ev({ t: 'over', team: this.winner }); }
        else this.setupFaceoff();
      }
      return;
    }

    // play
    if (!this.ot) {
      this.clock -= dt;
      if (this.clock <= 0) {
        this.clock = 0;
        if (this.score[0] !== this.score[1]) {
          this.winner = this.score[0] > this.score[1] ? 0 : 1;
          this.phase = 'over';
          this.ev({ t: 'buzzer' }); this.ev({ t: 'over', team: this.winner });
          return;
        }
        this.ot = true; this.ev({ t: 'ot' });
      }
    } else this.otT += dt;

    this.updateGimmick(dt);
    this.updateGoalies(dt);
    for (const s of this.skaters) {
      const c = s.human ? human : this.ai(s, dt);
      this.updateSkater(s, c, dt);
    }
    this.collide();
    for (const p of this.pucks) if (p.alive) this.updatePuck(p, dt);
    for (let i = this.pucks.length - 1; i >= 1; i--) if (!this.pucks[i].alive) this.pucks.splice(i, 1);
    const o = this.pucks[0].owner;
    if (o) this.stats.attack[o.team] += dt;
    this.tickHeat(dt);
  }

  private tickHeat(dt: number) {
    this.comboT -= dt;
    if (this.fireT > 0) {
      this.fireT -= dt;
      this.heat = 1000 * Math.max(0, this.fireT / 10);
      if (this.fireT <= 0) { this.heat = 0; this.ev({ t: 'fireEnd' }); }
    } else {
      this.heatIdle += dt;
      if (this.heatIdle > 2.5) this.heat = Math.max(0, this.heat - 45 * dt);
    }
    const tr = this.tier(0);
    if (tr !== this.lastTier) { this.ev({ t: 'tier', n: tr, big: tr > this.lastTier, x: this.skaters[0].x, y: this.skaters[0].y }); this.lastTier = tr; }
  }

  private updateGimmick(dt: number) {
    const g = this.opp.gimmick;
    if (!g || g === 'wreck') return;
    this.gimT -= dt;
    if (g === 'frost') {
      const ln = this.lane;
      if (ln.warn > 0) { ln.warn -= dt; if (ln.warn <= 0) { ln.t = 5; this.ev({ t: 'frost', x: ln.x }); } }
      else if (ln.t > 0) ln.t -= dt;
      else if (this.gimT <= 0) {
        this.gimT = 9.5;
        ln.x = clamp(this.skaters[0].x + (this.rnd() - 0.3) * 8, -L + 5, L - 5);
        ln.warn = 1.4;
        this.ev({ t: 'warn', x: ln.x });
      }
    } else if (g === 'dark') {
      if (this.dark > 0) { this.dark -= dt; if (this.dark <= 0) this.ev({ t: 'lights', n: 1 }); }
      else if (this.gimT <= 0) { this.gimT = 11; this.dark = 4; this.ev({ t: 'lights', n: 0 }); }
    } else if (g === 'zamboni') {
      const z = this.zam;
      if (z.warn > 0) { z.warn -= dt; if (z.warn <= 0) { z.active = true; z.y = -W - 3; this.ev({ t: 'zamGo' }); } }
      else if (z.active) {
        z.y += 9.5 * dt;
        if (z.y > W + 3) z.active = false;
        for (const s of this.skaters) {
          if (s.air || s.out > 0 || s.boxed > 0 || s.stun > 0.6) continue;
          if (Math.abs(s.x - z.x) < z.hx + SR * 0.6 && Math.abs(s.y - z.y) < z.hy + SR * 0.6) {
            s.stun = 1.3; s.wind = -1; s.checkT = 0;
            s.vx = (s.x >= z.x ? 1 : -1) * 9; s.vy = 7;
            this.dropPuck(s, s.vx * 0.6, 5);
            this.ev({ t: 'hit', x: s.x, y: s.y, big: true });
            if (s.human) this.ev({ t: 'shake', n: 0.5 });
          }
        }
      } else if (this.gimT <= 0) {
        this.gimT = 12;
        z.x = clamp(this.pucks[0].x + (this.rnd() - 0.5) * 4, -L + 6, L - 6);
        z.warn = 1.6;
        this.ev({ t: 'warn', x: z.x });
      }
    }
  }

  private updateGoalies(dt: number) {
    const p = this.pucks[0];
    for (const g of this.goalies) {
      const gx = g.team === 0 ? -L : L, dir = g.team === 0 ? 1 : -1;
      g.x = gx + dir * 0.9;
      const sk = g.team === 1 ? 0.35 + 0.5 * this.skillLevel : 0.6;
      let ty = g.y, vmax = 4.5;
      const shot = this.pucks.find(q => q.alive && q.kind === 'shot' && q.lastTeam !== g.team && q.vx * dir < 0);
      if (shot) {
        // reads the shot after a short delay, then slides to where it will cross
        g.react -= dt;
        const t = (g.x - shot.x) / (shot.vx || 1e-3);
        if (g.react <= 0 && t > 0) ty = shot.y + shot.vy * t;
        vmax = 5 + 3 * sk;
      } else {
        g.react = 0.2 - 0.1 * sk;
        // cut the angle: drift toward the puck's side, more when it is close
        const ax = Math.abs(p.x - gx);
        ty = p.y * clamp(1.2 / (ax / 3 + 1), 0.15, 0.7);
      }
      ty = clamp(ty, -(GOAL_HALF - 0.45), GOAL_HALF - 0.45);
      g.vy = clamp((ty - g.y) * 10, -vmax, vmax);
      g.y += g.vy * dt;
    }
  }

  deepest(team: number): Skater | null {
    const gx = team === 0 ? -L : L;
    let best: Skater | null = null, bd = 12;
    for (const s of this.skaters) {
      if (s.team !== team || !this.active(s)) continue;
      const d = Math.hypot(s.x - gx, s.y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  // ---------------------------------------------------------------- skaters
  private maxSpeed(s: Skater): number {
    let m = 8.6;
    if (s.team === 1) m *= 0.9 + 0.14 * this.skillLevel;
    else m *= 1 + 0.06 * this.pw(0, 'burner') + 0.01 * this.tier(0);
    if (s.frost) m *= 0.5;
    return m;
  }

  private updateSkater(s: Skater, c: Ctl, dt: number) {
    s.checkCd -= dt; s.blockT -= dt; s.pickupCd -= dt; s.calling -= dt;
    if (s.out > 0) {
      s.out -= dt;
      if (s.out <= 0) {
        const d = s.team === 0 ? -1 : 1;
        s.x = d * 4; s.y = -W + 1.4; s.vx = 0; s.vy = 4; s.z = 0; s.air = false; s.stun = 0;
        this.ev({ t: 'return', x: s.x, y: s.y });
      }
      return;
    }
    if (s.air) {
      s.z += s.vz * dt; s.vz -= 30 * dt; s.x += s.vx * dt; s.y += s.vy * dt;
      if (s.z <= 0) {
        s.z = 0; s.air = false;
        if (!insideRink(s.x, s.y, SR)) { s.out = 2.2; s.vx = s.vy = 0; this.ev({ t: 'crowd', x: s.x, y: s.y }); }
        else s.stun = 1.0;
      }
      return;
    }
    if (s.boxed > 0) { s.boxed -= dt; s.vx = s.vy = 0; return; }
    if (s.stun > 0) {
      s.stun -= dt;
      const f = Math.exp(-1.7 * dt); s.vx *= f; s.vy *= f;
      const pre = Math.hypot(s.vx, s.vy);
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (collideBoards(s, SR, 0.4, false) && pre > 6) { this.ev({ t: 'slam', x: s.x, y: s.y, n: pre }); this.ev({ t: 'shake', n: 0.4 }); }
      s.pPass = c.pass; s.pShoot = c.shoot; s.pCheck = c.check;
      return;
    }
    const p = this.pucks[0];
    const has = p.owner === s;
    s.frost = s.team === 0 && this.lane.t > 0 && this.lane.warn <= 0 && Math.abs(s.x - this.lane.x) < this.lane.half;

    let mx = c.mx, my = c.my;
    const ml = Math.hypot(mx, my);
    if (ml > 1e-3) { mx /= ml; my /= ml; }
    let max = this.maxSpeed(s), acc = 34;
    if (has) max *= 0.93;
    if (s.wind >= 0 && has) max *= 0.6;
    const tank = 1.8 + 0.5 * this.pw(s.team, 'burner');
    s.settle -= dt; s.slow -= dt;
    if (s.slow > 0) { max *= 0.55; acc *= 0.6; } // a standing check landed: legs are tied up for a moment
    if (c.burst && ml > 0 && s.stamina > 0.03) { max *= 1.35; acc *= 1.5; s.stamina = Math.max(0, s.stamina - dt / tank); }
    else s.stamina = Math.min(1, s.stamina + (dt / 4) * (1 + 0.08 * this.tier(s.team)));
    if (s.frost) acc *= 0.5;

    if (s.checkT > 0) {
      s.checkT -= dt;
      if (s.checkT <= 0) {
        if (s.hits.size === 0) { s.checkCd += 0.45; s.vx *= 0.55; s.vy *= 0.55; } // whiff: off balance
        // missed check on our carrier = a deke
        const o = p.owner;
        if (s.hits.size === 0 && o && o.team === 0 && s.team === 1 && s.lungeAt === o && Math.hypot(o.x - s.x, o.y - s.y) < 3)
          this.addHeat(150, 'Deke', o.x, o.y);
      }
    } else {
      if (ml > 0) {
        s.vx += mx * acc * dt; s.vy += my * acc * dt;
        const along = s.vx * mx + s.vy * my;
        let px = s.vx - along * mx, py = s.vy - along * my;
        const f = Math.exp(-5 * dt); px *= f; py *= f;
        s.vx = along * mx + px; s.vy = along * my + py;
      } else { const f = Math.exp(-1.5 * dt); s.vx *= f; s.vy *= f; }
      const sp = Math.hypot(s.vx, s.vy);
      if (sp > max) { const k = (max + (sp - max) * Math.exp(-6 * dt)) / sp; s.vx *= k; s.vy *= k; }
    }
    // facing
    const sp = Math.hypot(s.vx, s.vy);
    let ta = s.face;
    if (s.wind >= 0 && has) ta = Math.atan2(-s.y, (s.team === 0 ? L : -L) - s.x);
    else if (ml > 0) ta = Math.atan2(my, mx);
    else if (sp > 1.5) ta = Math.atan2(s.vy, s.vx);
    let da = ta - s.face; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    s.face += clamp(da, -14 * dt, 14 * dt);

    // buttons
    const passEdge = c.pass && (!s.pPass || !s.human);
    const checkEdge = c.check && (!s.pCheck || !s.human);
    if (has && (c.passTo || passEdge)) this.doPass(s, c.passTo || null, mx, my, ml > 0);
    else if (passEdge && s.human && p.owner && p.owner.team === s.team) { s.calling = 0.9; this.ev({ t: 'call' }); }
    if (c.shoot) {
      s.wind = s.wind < 0 ? 0 : s.wind + dt;
      if (p.owner === s && s.wind > 1.5) { this.doShot(s, s.wind, false, my); s.wind = -1; }
    } else if (s.pShoot || s.wind >= 0) {
      if (p.owner === s && s.wind >= 0) this.doShot(s, s.wind, false, my);
      s.wind = -1;
    }
    if (checkEdge && s.checkCd <= 0 && p.owner !== s) this.startCheck(s);
    s.pPass = c.pass; s.pShoot = c.shoot; s.pCheck = c.check;

    s.x += s.vx * dt; s.y += s.vy * dt;
    collideBoards(s, SR, 0.2, false);
  }

  private startCheck(s: Skater) {
    const p = this.pucks[0], car = p.owner;
    const sp = Math.hypot(s.vx, s.vy);
    const dC = car ? Math.hypot(car.x - s.x, car.y - s.y) : 99;
    if (car && car.team !== s.team && dC < 1.9 && (sp < 4.5 || Math.hypot(s.vx - car.vx, s.vy - car.vy) < 4.5)) {
      s.checkCd = 0.9;
      // a poke is aim and timing, not a dice roll: the stick has to reach the puck itself.
      // The puck rides in front of the carrier, so turning away puts their body in the way.
      const reach = 1.5 * (1 - 0.12 * this.pw(car.team, 'magnet'));
      const dP = Math.hypot(p.x - s.x, p.y - s.y);
      if (car.settle > 0 || dP > reach || dP > dC + 0.15) this.ev({ t: 'bump', x: p.x, y: p.y });
      else {
        s.checkCd = 0.5;
        const a = s.face + (this.rnd() - 0.5) * 1.6;
        this.dropPuck(car, Math.cos(a) * 7, Math.sin(a) * 7);
        car.pickupCd = 0.55;
        if (s.team === 0) this.addHeat(50, 'Poke check', car.x, car.y);
        this.ev({ t: 'poke', x: car.x, y: car.y });
      }
      return;
    }
    // lunge, auto-aimed at the nearest opponent in front
    let dx = Math.cos(s.face), dy = Math.sin(s.face), best: Skater | null = null, bd = 5.5;
    for (const o of this.skaters) {
      if (o.team === s.team || !this.active(o)) continue;
      const ox = o.x - s.x, oy = o.y - s.y, d = Math.hypot(ox, oy);
      if (d < 0.01) continue;
      const dot = (ox * dx + oy * dy) / d;
      const eff = d - (o === car ? 1.5 : 0);
      if (dot > 0.25 && eff < bd) { bd = eff; best = o; }
    }
    if (best) {
      const tx = best.x + best.vx * 0.15 - s.x, ty = best.y + best.vy * 0.15 - s.y, d = Math.hypot(tx, ty) || 1;
      dx = tx / d; dy = ty / d;
    }
    // a check is only as hard as the speed you bring into it, and it costs stamina
    const tr = this.tier(s.team);
    const cost = 0.32, gas = Math.min(1, s.stamina / cost);
    s.stamina = Math.max(0, s.stamina - cost);
    const along = Math.max(0, s.vx * dx + s.vy * dy);
    const v = Math.min(15.5 + 0.3 * tr, along + (4.4 + 0.2 * tr) * (0.4 + 0.6 * gas));
    s.vx = dx * v; s.vy = dy * v; s.face = Math.atan2(dy, dx);
    s.checkT = 0.3; s.checkCd = 0.95; s.blockT = 0.7; s.hits.clear(); s.lungeAt = best; s.wind = -1;
    this.ev({ t: 'lunge', x: s.x, y: s.y });
  }

  private dropPuck(s: Skater, vx: number, vy: number) {
    const p = this.pucks[0];
    if (p.owner !== s) return;
    p.owner = null; p.kind = 'loose'; p.target = null; p.vx = vx; p.vy = vy; p.age = 0; p.checked.clear(); p.cc = 0;
    s.pickupCd = Math.max(s.pickupCd, 0.4);
    this.chain = 0;
  }

  private gain(p: Puck, s: Skater) {
    const prevTeam = p.lastTeam;
    p.owner = s; p.kind = 'loose'; p.target = null; p.from = null; p.cc = 0; p.oneTimer = false; p.fire = false;
    p.lastTeam = s.team; p.checked.clear();
    if (prevTeam !== s.team) this.chain = 0;
    s.ai.hold = 0; s.ai.patience = 1.4 + this.rnd() * 1.4; s.settle = 0.45;
    if (s.wind >= 0) s.wind = 0;
  }

  private laneGap(ax: number, ay: number, bx: number, by: number, team: number): number {
    let m = 9;
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    for (const o of this.skaters) {
      if (o.team === team || !this.active(o)) continue;
      const t = clamp(((o.x - ax) * dx + (o.y - ay) * dy) / l2, 0, 1);
      const d = Math.hypot(o.x - (ax + dx * t), o.y - (ay + dy * t));
      if (d < m) m = d;
    }
    return m;
  }

  private nearestOpp(s: Skater): [Skater | null, number] {
    let b: Skater | null = null, bd = 99;
    for (const o of this.skaters) {
      if (o.team === s.team || !this.active(o)) continue;
      const d = Math.hypot(o.x - s.x, o.y - s.y);
      if (d < bd) { bd = d; b = o; }
    }
    return [b, bd];
  }

  private doPass(s: Skater, to: Skater | null, mx: number, my: number, hasDir: boolean) {
    const p = this.pucks[0];
    const ax = hasDir ? mx : Math.cos(s.face), ay = hasDir ? my : Math.sin(s.face);
    if (!to) {
      let bs = -1e9;
      for (const m of this.skaters) {
        if (m.team !== s.team || m === s || !this.active(m)) continue;
        const dx = m.x - s.x, dy = m.y - s.y, d = Math.hypot(dx, dy) || 1;
        const sc = ((dx * ax + dy * ay) / d) * 2 + (m.calling > 0 ? 3 : 0) + Math.min(this.laneGap(s.x, s.y, m.x, m.y, s.team), 2) * 0.5 - d * 0.03;
        if (sc > bs) { bs = sc; to = m; }
      }
    }
    const speed = 18 + 2 * this.pw(s.team, 'curve');
    p.owner = null; p.age = 0; p.checked.clear(); p.from = s; p.lastTeam = s.team; p.shooter = null; p.cc = 0;
    p.x = s.x + Math.cos(s.face) * 0.6; p.y = s.y + Math.sin(s.face) * 0.6;
    s.pickupCd = 0.4; s.wind = -1;
    if (!to) { // nobody to pass to: dump it forward
      p.kind = 'loose'; p.target = null; p.vx = ax * 15; p.vy = ay * 15;
      this.ev({ t: 'pass', x: s.x, y: s.y });
      return;
    }
    let tx = to.x, ty = to.y;
    for (let i = 0; i < 2; i++) {
      const t = Math.min(0.9, Math.hypot(tx - p.x, ty - p.y) / speed);
      tx = to.x + to.vx * t * 0.85; ty = to.y + to.vy * t * 0.85;
    }
    tx = clamp(tx, -L + 1, L - 1); ty = clamp(ty, -W + 1, W - 1);
    const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy) || 1;
    p.kind = 'pass'; p.target = to; p.ax = tx; p.ay = ty;
    p.vx = (dx / d) * speed; p.vy = (dy / d) * speed;
    const cl = this.pw(s.team, 'curve');
    if (cl > 0 && d > 4) {
      // bend away from the defender closest to the lane
      let side = 1, m = 9;
      for (const o of this.skaters) {
        if (o.team === s.team || !this.active(o)) continue;
        const t = clamp(((o.x - p.x) * dx + (o.y - p.y) * dy) / (d * d), 0, 1);
        const ex = o.x - (p.x + dx * t), ey = o.y - (p.y + dy * t), e = Math.hypot(ex, ey);
        if (e < m) { m = e; side = ex * -dy + ey * dx > 0 ? -1 : 1; }
      }
      p.cpx = (-dy / d) * side; p.cpy = (dx / d) * side; p.cc = 5 + cl; p.cT = d / speed;
    }
    to.ai.oneT = this.rnd() < (s.team === 0 ? 0.75 : 0.4 + 0.4 * this.skillLevel);
    this.ev({ t: 'pass', x: s.x, y: s.y });
  }

  private doShot(s: Skater, wind: number, oneTimer: boolean, my: number) {
    const p = this.pucks[0];
    const dir = s.team === 0 ? 1 : -1, gx = dir * L;
    const sweet = oneTimer || (wind >= 0.32 && wind <= 0.82);
    let pw = clamp(wind / 0.32, 0.3, 1);
    if (wind > 0.82) pw = Math.max(0.55, 1 - (wind - 0.82) * 0.8);
    if (oneTimer) pw = 1;
    const fire = s.team === 0 && this.fireT > 0;
    let speed = 18 + 7 * pw + (sweet ? 4 : 0) + (oneTimer ? 7 : 0);
    speed *= 1 + 0.1 * this.pw(s.team, 'slapper') + 0.02 * this.tier(s.team);
    if (fire) speed *= 1.08;
    let q = 0.015 * this.tier(s.team) - (s.team === 1 ? 0.12 * (1 - this.skillLevel) : 0) + 0.25 + 0.25 * pw + (sweet ? 0.2 : 0) + (oneTimer ? 0.25 : 0) + (fire ? 0.08 : 0) + 0.05 * this.pw(s.team, 'slapper');
    q -= clamp((Math.hypot(gx - s.x, s.y) - 7) * 0.03, 0, 0.25);
    // corner
    let ty: number;
    // placement: hold left or right to pick the corner. With no direction held the shot goes
    // to the side the goalie is leaving open, but less accurately
    const gk = this.goalies[1 - s.team];
    const picked = s.human && Math.abs(my) > 0.3;
    if (picked) ty = Math.sign(my) * GOAL_HALF * 0.78;
    else ty = (gk.y > 0.15 ? -1 : gk.y < -0.15 ? 1 : this.rnd() < 0.5 ? -1 : 1) * GOAL_HALF * 0.7;
    const sx = s.x + Math.cos(s.face) * 0.7, sy = s.y + Math.sin(s.face) * 0.7;
    const dist = Math.hypot(gx - sx, ty - sy);
    const sig = (s.human ? (picked ? 0.035 : 0.05) : s.team === 0 ? 0.06 : 0.1 - 0.04 * this.skillLevel) * (1 + dist / 22) * (sweet ? 1 : 1.5);
    const fireOne = (tY: number, spd: number, ghost: boolean) => {
      const a = Math.atan2(tY - sy, gx - sx) + (this.rnd() + this.rnd() - 1) * sig;
      const b = ghost ? this.newPuck() : p;
      b.owner = null; b.kind = 'shot'; b.target = null; b.from = s; b.shooter = s; b.lastTeam = s.team; b.age = 0; b.checked.clear();
      b.x = clamp(sx, -L + 0.4, L - 0.4); b.y = sy; b.vx = Math.cos(a) * spd; b.vy = Math.sin(a) * spd;
      b.q = ghost ? q * 0.65 : q; b.oneTimer = oneTimer; b.fire = fire; b.ghost = ghost; b.cc = 0;
      const cl = this.pw(s.team, 'curve');
      if (cl > 0 && this.pw(s.team, 'split') > 0) { // combo: split pucks curve
        const sd = ghost ? -1 : 1;
        b.cpx = -Math.sin(a) * sd; b.cpy = Math.cos(a) * sd; b.cc = 3 + cl; b.cT = dist / spd; b.q += 0.08;
      }
      if (ghost) this.pucks.push(b);
    };
    fireOne(ty, speed, false);
    const n = this.pw(s.team, 'split');
    for (let i = 0; i < n; i++) fireOne(i % 2 === 0 ? -ty : 0, speed * (0.9 - 0.05 * i), true);
    s.pickupCd = 0.35; s.wind = -1;
    this.stats.shots[s.team]++;
    this.chain = 0;
    this.ev({ t: 'shot', x: sx, y: sy, big: sweet, n: speed });
    if (oneTimer) {
      this.ev({ t: 'slowmo', n: 0.4 });
      if (s.team === 0) { this.stats.oneTimers++; this.addHeat(300, 'One-timer', s.x, s.y); }
    } else if (sweet && s.human) this.addHeat(50, 'Sweet spot', s.x, s.y);
  }

  private hit(a: Skater, b: Skater) {
    a.hits.add(b.id);
    const sp = Math.hypot(a.vx, a.vy) || 1, nx = a.vx / sp, ny = a.vy / sp;
    const fire = a.team === 0 && this.fireT > 0;
    const imp = sp - (b.vx * nx + b.vy * ny); // closing speed: what the hit is actually worth
    const big = imp > 11.5;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if (imp < 7) {
      // standing check: no knockdown and the puck stays, but it ties the target up and slows them down
      b.vx *= 0.4; b.vy *= 0.4; b.slow = Math.max(b.slow, 0.3 + imp * 0.07);
      a.vx *= 0.35; a.vy *= 0.35; a.checkT = 0; a.checkCd = Math.max(a.checkCd, 1.0);
      this.ev({ t: 'bump', x: mx, y: my, big: imp > 3.5 });
      if (a.team === 0 && imp > 3.5) this.addHeat(25, 'Tied up', b.x, b.y);
      return;
    }
    const wreck = this.opp.gimmick === 'wreck';
    if (wreck && b.team === 1 && !big) b.stun = 0.35;
    else b.stun = (big ? 1.6 : 1.0) * (wreck && a.team === 1 ? 1.7 : 1) * (1 + 0.04 * this.tier(a.team));
    if (b.team === 0) this.coolHeat(b.human ? 120 : 60); // getting flattened costs Heat
    const kb = Math.max(sp * (big ? 1.3 : 1.05), big ? 13 : 9); // knockback: they fly, the checker drives through
    b.vx = nx * kb; b.vy = ny * kb; b.wind = -1; b.checkT = 0;
    this.dropPuck(b, nx * 5 + (this.rnd() - 0.5) * 6, ny * 5 + (this.rnd() - 0.5) * 6);
    b.pickupCd = 1;
    a.vx *= 0.8; a.vy *= 0.8;
    this.stats.hits[a.team]++;
    let over = false;
    if (fire && big) {
      over = true;
      const side = b.y >= 0 ? 1 : -1;
      b.air = true; b.z = 0.1; b.vz = 11.25; b.stun = 0;
      b.vy = side * Math.max(9, (W + 2 - Math.abs(b.y)) / 0.72); b.vx = nx * 4;
    }
    this.ev({ t: 'hit', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, big, dx: nx, dy: ny, team: a.team });
    this.ev({ t: 'freeze', n: big ? 0.15 : 0.07 });
    this.ev({ t: 'shake', n: big ? 1.1 : b.human || a.human ? 0.5 : 0.3 });
    if (big) this.ev({ t: 'slowmo', n: 0.22 });
    if (a.team === 0) {
      if (over) this.addHeat(400, 'Over the boards', b.x, b.y);
      else if (big) this.addHeat(200, 'Big hit', b.x, b.y);
      else this.addHeat(100, 'Hit', b.x, b.y);
      const sl = this.pw(0, 'shock');
      if (sl > 0) {
        const R = 2.4 + 0.9 * sl;
        this.ev({ t: 'shock', x: b.x, y: b.y, n: R });
        for (const o of this.skaters) {
          if (o.team === 0 || o === b || !this.active(o)) continue;
          const dx = o.x - b.x, dy = o.y - b.y, d = Math.hypot(dx, dy) || 1;
          if (d > R) continue;
          o.stun = 0.9; o.vx = (dx / d) * 7; o.vy = (dy / d) * 7; o.wind = -1;
          this.dropPuck(o, o.vx, o.vy);
          this.addHeat(100, 'Shockwave', o.x, o.y);
        }
      }
    }
  }

  private collide() {
    const S = this.skaters;
    for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
      const a = S[i], b = S[j];
      if (a.air || b.air || a.out > 0 || b.out > 0 || a.boxed > 0 || b.boxed > 0) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d >= SR * 2 || d < 1e-4) continue;
      if (a.team !== b.team) {
        if (a.checkT > 0 && !a.hits.has(b.id) && b.stun <= 0) { this.hit(a, b); continue; }
        if (b.checkT > 0 && !b.hits.has(a.id) && a.stun <= 0) { this.hit(b, a); continue; }
      }
      const nx = dx / d, ny = dy / d, ov = (SR * 2 - d) / 2;
      a.x -= nx * ov; a.y -= ny * ov; b.x += nx * ov; b.y += ny * ov;
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) { const k = rv * 0.5; a.vx += nx * k; a.vy += ny * k; b.vx -= nx * k; b.vy -= ny * k; }
    }
    // the goalie holds the crease: skaters slide off
    for (const g of this.goalies) for (const s of S) {
      if (s.air || s.out > 0) continue;
      const dx = s.x - g.x, dy = s.y - g.y, d = Math.hypot(dx, dy), m = SR + 0.55;
      if (d >= m || d < 1e-4) continue;
      s.x = g.x + (dx / d) * m; s.y = g.y + (dy / d) * m;
      const vn = (s.vx * dx + s.vy * dy) / d;
      if (vn < 0) { s.vx -= (vn * dx) / d; s.vy -= (vn * dy) / d; }
    }
  }

  // ---------------------------------------------------------------- puck
  private deflect(p: Puck, s: Skater, keep: number) {
    if (p.ghost) { p.alive = false; this.ev({ t: 'poof', x: p.x, y: p.y }); return; }
    const sp = Math.hypot(p.vx, p.vy);
    const gx = s.team === 0 ? -L : L;
    let ox = p.x - gx, oy = p.y + (this.rnd() - 0.5) * 8;
    const d = Math.hypot(ox, oy) || 1; ox /= d; oy /= d;
    p.vx = ox * sp * keep; p.vy = oy * sp * keep;
    p.kind = 'loose'; p.target = null; p.lastTeam = s.team; p.age = 0; p.cc = 0; p.fire = false;
    s.pickupCd = 0.3;
    this.chain = 0;
  }

  private updatePuck(p: Puck, dt: number) {
    if (p.owner) {
      const s = p.owner;
      p.x = clamp(s.x + Math.cos(s.face) * 0.85, -L + 0.3, L - 0.3);
      p.y = clamp(s.y + Math.sin(s.face) * 0.85, -W + 0.3, W - 0.3);
      p.vx = s.vx; p.vy = s.vy;
      return;
    }
    p.age += dt;
    const f = Math.exp(-0.4 * dt); p.vx *= f; p.vy *= f;
    const x0 = p.x, y0 = p.y;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.cc > 0 && p.age < p.cT) {
      const k = p.cc * (1 - (2 * p.age) / p.cT) * dt;
      p.x += p.cpx * k; p.y += p.cpy * k;
    }
    if (this.goalieTouch(p, x0, y0)) return;
    // goal?
    if (Math.abs(p.x) > L + 0.25 && Math.abs(p.y) < GOAL_HALF) { this.goal(p); return; }
    const bounced = collideBoards(p, PR, 0.55, true);
    if (bounced) {
      if (p.ghost) { p.alive = false; return; }
      this.ev({ t: 'board', x: p.x, y: p.y, n: Math.hypot(p.vx, p.vy) });
      if (p.kind === 'shot') {
        if (Math.abs(p.x) > L - 1 && Math.abs(p.y) < GOAL_HALF + 0.6) this.ev({ t: 'post', x: p.x, y: p.y });
        p.kind = 'loose'; p.fire = false;
      }
      p.cc = 0;
    }
    const sp = Math.hypot(p.vx, p.vy);
    if (p.ghost && (p.age > 1.6 || sp < 6)) { p.alive = false; return; }
    if (p.kind === 'pass' && (p.age > 2 || sp < 4)) { p.kind = 'loose'; p.target = null; this.chain = 0; }
    if (p.kind === 'shot' && sp < 7) { p.kind = 'loose'; p.fire = false; }

    for (const s of this.skaters) {
      if (!this.active(s) || s.pickupCd > 0) continue;
      const d = Math.hypot(p.x - s.x, p.y - s.y);
      const reach = 1.05 * (1 + 0.25 * this.pw(s.team, 'magnet'));
      if (p.kind === 'pass') {
        if (s.team === p.lastTeam) {
          if (s === p.from) continue;
          if (d < (s === p.target ? reach + 0.25 : reach * 0.8)) { this.receive(p, s); return; }
        } else if (d < 1.15 && !p.checked.has(s.id)) {
          p.checked.add(s.id);
          let ch = s.blockT > 0 ? 0.9 : 0.5;
          ch *= Math.pow(0.5, this.pw(p.lastTeam, 'curve'));
          if (this.rnd() < ch) {
            this.gain(p, s);
            if (s.team === 0) this.addHeat(100, 'Pickoff', s.x, s.y);
            this.ev({ t: 'steal', x: s.x, y: s.y });
            return;
          } else if (p.lastTeam === 0) this.addHeat(100, 'Saucer pass', s.x, s.y);
        }
      } else if (p.kind === 'shot') {
        if (s.team === p.lastTeam || p.checked.has(s.id)) continue;
        if (d < 0.95) {
          p.checked.add(s.id);
          if (this.rnd() < (s.blockT > 0 ? 1 : 0.2)) {
            this.ev({ t: 'save', x: p.x, y: p.y });
            if (s.team === 0) this.addHeat(150, 'Blocked shot', s.x, s.y);
            this.deflect(p, s, 0.3);
            return;
          }
        }
      } else if (d < reach && s.checkT <= 0 && sp < 30) {
        this.gain(p, s);
        this.ev({ t: 'pickup', x: s.x, y: s.y });
        return;
      }
    }
  }

  /** returns true if a goalie saved or cleared the puck this step */
  private goalieTouch(p: Puck, x0: number, y0: number): boolean {
    const sp = Math.hypot(p.vx, p.vy);
    for (const g of this.goalies) {
      const dir = g.team === 0 ? 1 : -1;
      if (p.kind === 'shot' && p.lastTeam !== g.team && !p.checked.has(100 + g.team) && (x0 - g.x) * (p.x - g.x) <= 0) {
        p.checked.add(100 + g.team);
        const t = (g.x - x0) / (p.x - x0 || 1e-6), yc = y0 + (p.y - y0) * t;
        // the body is a near-certain save; out toward the posts it takes a stretch, and a good shot beats it
        const wl = 1 + 0.15 * this.pw(g.team, 'wall');
        const off = Math.abs(yc - g.y), body = 0.7 * wl, reach = 2.0 * wl;
        if (off > reach) continue;
        const atBody = 0.95 - 0.3 * p.q, atEdge = Math.max(0.03, 0.25 - 0.2 * p.q);
        let ps = off < body ? atBody : atEdge + (atBody - atEdge) * Math.pow(1 - (off - body) / (reach - body), 1.5);
        if (g.team === 1) ps *= 0.9 + 0.2 * this.skillLevel;
        if (this.ot) ps *= Math.max(0.3, 1 - this.otT / 40);
        if (this.rnd() >= clamp(ps, 0.02, 0.97)) continue;
        if (p.ghost) { p.alive = false; this.ev({ t: 'poof', x: p.x, y: p.y }); return true; }
        this.stats.saves[g.team]++;
        this.ev({ t: 'save', x: p.x, y: p.y });
        if (g.team === 0) this.addHeat(150, 'Save', g.x, g.y);
        p.x = g.x + dir * 0.4; p.y = yc;
        p.vx = dir * sp * 0.3; p.vy = (this.rnd() - 0.5) * sp * 0.6;
        p.kind = 'loose'; p.target = null; p.lastTeam = g.team; p.age = 0; p.cc = 0; p.fire = false;
        this.chain = 0;
        return true;
      }
      // a slow loose puck at the goalie's feet gets cleared to the corner
      if (p.kind === 'loose' && !p.ghost && sp < 9 && Math.hypot(p.x - g.x, p.y - g.y) < 0.85) {
        p.vx = dir * 7; p.vy = (p.y >= 0 ? 1 : -1) * 7; p.lastTeam = g.team; p.age = 0;
        this.ev({ t: 'save', x: p.x, y: p.y });
        return true;
      }
    }
    return false;
  }

  private receive(p: Puck, s: Skater) {
    const from = p.from;
    this.stats.passes[s.team]++;
    if (s.team === 0) {
      this.chain++;
      if (this.chain >= 2) this.addHeat(50 * Math.min(this.chain, 4), `Tape to tape ×${this.chain}`, s.x, s.y);
    }
    const chain = this.chain;
    const oneT = s.wind >= 0;
    this.gain(p, s);
    this.chain = chain;
    this.ev({ t: 'recv', x: s.x, y: s.y });
    if (oneT && from !== s) {
      s.face = Math.atan2(-s.y, (s.team === 0 ? L : -L) - s.x);
      this.doShot(s, 0.5, true, s.human ? this.lastHumanMy : 0);
    }
  }
  lastHumanMy = 0;

  private goal(p: Puck) {
    const team = p.x > 0 ? 0 : 1;
    this.score[team]++;
    const main = this.pucks[0];
    main.owner = null; main.vx = main.vy = 0; main.kind = 'loose'; main.target = null;
    main.x = p.x > 0 ? L + 0.9 : -L - 0.9; main.y = clamp(p.y, -1.6, 1.6);
    for (let i = 1; i < this.pucks.length; i++) this.pucks[i].alive = false;
    this.pucks.length = 1;
    this.ev({ t: 'goal', team, x: main.x, y: main.y, big: p.oneTimer });
    if (team === 1) this.coolHeat(250);
    if (team === 0) this.addHeat(p.oneTimer ? 800 : 500, p.oneTimer ? 'One-timer goal' : 'Goal', L - 3, 0);
    this.phase = 'goal'; this.phaseT = 1.4;
    for (const s of this.skaters) { s.wind = -1; }
    if (this.score[team] >= WIN_GOALS || this.ot) { this.winner = team; this.pendingOver = true; this.phaseT = 1.8; }
  }

  // ---------------------------------------------------------------- bots
  private ai(s: Skater, dt: number): Ctl {
    const c: Ctl = { mx: 0, my: 0, pass: false, shoot: false, check: false, burst: false };
    const p = this.pucks[0], car = p.owner;
    const dir = s.team === 0 ? 1 : -1, ogx = -dir * L, tgx = dir * L;
    const sk = s.team === 1 ? this.skillLevel : 0.7;
    const anchor = s.slot === 2;
    let tx = s.x, ty = s.y;

    const guard = () => {
      const gx = p.x - ogx, gy = p.y, d = Math.hypot(gx, gy) || 1;
      const r = clamp(d * 0.5, 3.4, 6); // stay out of the goalie's crease
      tx = clamp(ogx + (gx / d) * r, -L + 0.9, L - 0.9); ty = (gy / d) * r;
    };
    const support = (holder: Skater) => {
      const hu = holder.x * dir;
      if (anchor) {
        // trail the play, then step up to the point once the puck is in their end
        const u = hu > 10 * KX ? 4 * KX : clamp(hu - 9 * KX, -L + 3.5 * KX, 0);
        tx = u * dir; ty = hu > 10 * KX ? clamp(-holder.y * 0.5, -4 * KY, 4 * KY) : p.y * 0.3;
        return;
      }
      // weave through the slot instead of parking: keeps a one-timer lane open
      const ph = this.time * 1.5 + s.id * 2.1;
      let u = Math.min(L - 5 * KX, Math.max(hu + 6 * KX, 5 * KX)) + Math.cos(ph) * 1.2;
      if (hu > L - 9 * KX) u = L - 5.5 * KX + Math.cos(ph) * 1.5;
      const far = holder.y > 0 ? -1 : 1;
      if (s.slot === 4) {
        // second defender: trails on the weak side, steps up to the point in their end
        tx = (hu > 8 * KX ? 5.5 * KX : clamp(hu - 5 * KX, -L + 5 * KX, KX)) * dir; ty = far * (hu > 8 * KX ? 5 : 3) * KY;
        return;
      }
      // each forward takes a different lane: weak side, strong side, then the middle
      let idx = 0;
      for (const k of [0, 1, 3]) { if (k === s.slot) break; if (k !== holder.slot && k < TEAM) idx++; }
      const side = idx === 0 ? far : idx === 1 ? -far : far * 0.2;
      tx = Math.min(L - 3 * KX, u) * dir; ty = side * (2.6 + 1.6 * Math.sin(ph)) * KY;
      // slide off a defender sitting in the lane
      if (this.laneGap(holder.x, holder.y, tx, ty, s.team) < 1.2) ty = -ty * 0.6;
      c.burst = (tx - s.x) * dir > 6 * KX;
    };
    const defend = (carr: Skater) => {
      const dS = Math.hypot(carr.x - s.x, carr.y - s.y);
      if (anchor) {
        guard();
        if (dS < 2.1 && s.checkCd <= 0 && this.rnd() < dt * 5) c.check = true;
        return;
      }
      // nearest free skater pressures the carrier; the rest each pick up a different attacker
      let chaser = s, cd = dS;
      for (let k = 0; k < TEAM; k++) {
        const m = this.skaters[s.team * TEAM + k];
        if (m === s || k === 2 || !this.active(m)) continue;
        const dM = Math.hypot(carr.x - m.x, carr.y - m.y) * (m.human ? 1.4 : 1);
        if (dM < cd) { cd = dM; chaser = m; }
      }
      if (chaser === s) {
        tx = carr.x + carr.vx * 0.2; ty = carr.y + carr.vy * 0.2;
        c.burst = dS > 5;
        // only commit when close enough to poke, or with real closing speed for a hit
        const closing = ((carr.x - s.x) * (s.vx - carr.vx) + (carr.y - s.y) * (s.vy - carr.vy)) / (dS || 1);
        const dPk = Math.hypot(p.x - s.x, p.y - s.y);
        if (((dS < 1.9 && dPk < 1.45 && dPk < dS + 0.1) || (dS < 3.4 && closing > 6)) && s.checkCd <= 0 && p.owner === carr) {
          s.ai.react -= dt;
          if (s.ai.react <= 0) { c.check = true; s.ai.react = (0.6 - 0.38 * sk) * (0.7 + this.rnd() * 0.6); }
        }
      } else {
        let rank = 0;
        for (let k = 0; k < s.slot; k++) {
          const m = this.skaters[s.team * TEAM + k];
          if (k !== 2 && m !== chaser && this.active(m)) rank++;
        }
        const opps = this.skaters.filter(o => o.team !== s.team && o !== carr && this.active(o))
          .sort((a, b) => Math.hypot(a.x - ogx, a.y) - Math.hypot(b.x - ogx, b.y));
        const m = opps.length ? opps[Math.min(rank, opps.length - 1)] : null;
        if (m) { tx = m.x + (ogx - m.x) * 0.22 + (carr.x - m.x) * 0.15; ty = m.y - m.y * 0.22 + (carr.y - m.y) * 0.15; }
        else guard();
      }
    };

    if (car === s) {
      s.ai.hold += dt;
      const dg = Math.hypot(tgx - s.x, s.y), ahead = (tgx - s.x) * dir;
      const [no, nd] = this.nearestOpp(s);
      tx = tgx - dir * 5; ty = clamp(s.y * 0.45, -3, 3);
      if (s.wind >= 0) c.shoot = s.wind < s.ai.windGoal;
      else {
        const h = s.team === 0 ? this.skaters[0] : null;
        if (h && this.active(h)) {
          const hOpen = this.nearestOpp(h)[1] > 1.7;
          const hAhead = (h.x - s.x) * dir > -3;
          const ln = this.laneGap(s.x, s.y, h.x, h.y, 0);
          if ((h.calling > 0 && s.ai.hold > 0.12) ||
            (hOpen && hAhead && s.ai.hold > 0.7 && Math.hypot(tgx - h.x, h.y) < 16 && ln > 1.0 && (h.wind >= 0 || s.ai.hold > 1.1)))
            c.passTo = h;
        }
        if (!c.passTo && s.ai.hold > 0.3) {
          // look for a teammate set up in the slot for a one-timer
          for (const m of this.skaters) {
            if (m.team !== s.team || m === s || m.human || !this.active(m)) continue;
            const mg = Math.hypot(tgx - m.x, m.y);
            if (mg < 12 && mg < dg + 2 && this.nearestOpp(m)[1] > 1.6 && this.laneGap(s.x, s.y, m.x, m.y, s.team) > 1.1
              && Math.abs(m.y - s.y) > 2.5 && this.rnd() < dt * (2 + 3 * sk)) { c.passTo = m; break; }
          }
        }
        if (!c.passTo) {
          const canShoot = ahead > 1.2 && dg < 14;
          if (canShoot && s.ai.hold > 0.25 && (dg < 9.5 || nd < 3 || s.ai.hold > 0.8)) {
            s.ai.windGoal = 0.33 + this.rnd() * (0.55 - 0.3 * sk); c.shoot = true;
          } else if ((nd < 2.3 && s.ai.hold > 0.4) || s.ai.hold > s.ai.patience || (anchor && s.ai.hold > 0.4)) {
            let best: Skater | null = null, bs = 0.2;
            for (const m of this.skaters) {
              if (m.team !== s.team || m === s || !this.active(m)) continue;
              const ln = this.laneGap(s.x, s.y, m.x, m.y, s.team);
              if (ln < 0.7) continue;
              const sc = (m.x - s.x) * dir * 0.08 + Math.min(ln, 2.5) + Math.min(this.nearestOpp(m)[1], 3) * 0.5 - (m.slot === 2 ? 1.6 : 0);
              if (sc > bs) { bs = sc; best = m; }
            }
            if (best) c.passTo = best;
            else if (s.ai.hold > 3) { s.ai.windGoal = 0.4; c.shoot = true; }
          }
        }
        if (no && nd < 4.5 && (no.x - s.x) * dir > -0.5) ty = clamp(ty + (s.y >= no.y ? 1 : -1) * 3.5, -W + 2, W - 2);
        if (anchor) tx = clamp(s.x + dir * 6, -L + 2, L - 2);
        c.burst = ahead > 10 && (nd > 3 || s.ai.hold < 1);
      }
    } else if (car && car.team === s.team) {
      support(car);
    } else if (car) {
      defend(car);
    } else if (p.kind === 'pass' && p.target) {
      if (p.target === s) {
        tx = p.ax; ty = p.ay;
        if (s.ai.oneT && Math.hypot(tgx - s.x, s.y) < 13) c.shoot = true;
      } else if (p.target.team === s.team) support(p.target);
      else defend(p.target);
    } else if (p.kind === 'shot' && p.lastTeam !== s.team && anchor) {
      guard();
    } else {
      // loose puck
      const fx = p.x + p.vx * 0.3, fy = p.y + p.vy * 0.3;
      const dMe = Math.hypot(fx - s.x, fy - s.y);
      let nearest = true;
      for (const m of this.skaters) {
        if (m.team !== s.team || m === s || !this.active(m)) continue;
        const d = Math.hypot(fx - m.x, fy - m.y) * (m.slot === 2 ? 1.5 : 1) * (m.human ? 1.25 : 1);
        if (d < dMe * (anchor ? 1.5 : 1)) nearest = false;
      }
      const inOwnZone = (p.x - ogx) * dir < 9 * KX;
      // only the nearest skater chases a loose puck; the rest keep their shape
      if (nearest && (!anchor || inOwnZone)) { tx = fx; ty = fy; c.burst = dMe > 4; }
      else if (anchor) guard();
      else if (p.x * dir > -2 * KX) { tx = clamp(p.x + dir * 5 * KX, -L + 5 * KX, L - 5 * KX); ty = (p.y > 0 ? -1 : 1) * (s.slot === 4 ? 1.5 : 3.5) * KY; }
      else { tx = p.x - dir * 4 * KX; ty = p.y * 0.3 + (s.slot === 1 ? -4 : s.slot === 3 ? 4 : 0) * KY; }
    }

    const dx = tx - s.x, dy = ty - s.y, d = Math.hypot(dx, dy);
    if (anchor && d > 5 && !(car && car.team === s.team)) c.burst = true;
    if (d > 0.35) {
      const sp = Math.hypot(s.vx, s.vy);
      if (!(d < 1.6 && sp > d * 4.5)) { c.mx = dx / d; c.my = dy / d; }
    }
    return c;
  }

  snapshot() {
    const p = this.pucks[0];
    return {
      phase: this.phase, score: this.score.slice(), clock: this.clock, ot: this.ot, foLive: this.foLive,
      heat: this.heat, tier: this.mult() - 1, fire: this.fireT, style: this.style, winner: this.winner,
      puck: { x: p.x, y: p.y, vx: p.vx, vy: p.vy, owner: p.owner ? p.owner.id : -1, kind: p.kind, target: p.target ? p.target.id : -1 },
      skaters: this.skaters.map(s => ({ id: s.id, team: s.team, x: s.x, y: s.y, vx: s.vx, vy: s.vy, stun: s.stun, ok: this.active(s), wind: s.wind, stamina: s.stamina, slow: s.slow })),
      stats: this.stats,
      goalies: this.goalies.map(g => ({ team: g.team, x: g.x, y: g.y })),
    };
  }
}

const NOCTL: Ctl = { mx: 0, my: 0, pass: false, shoot: false, check: false, burst: false };

/** Keep a circle inside the rounded rink. Pucks may enter the goal mouths. Returns true on a bounce. */
export function collideBoards(o: { x: number; y: number; vx: number; vy: number }, r: number, rest: number, puck: boolean): boolean {
  let hit = false;
  const sx = o.x < 0 ? -1 : 1, sy = o.y < 0 ? -1 : 1;
  const ax = Math.abs(o.x), ay = Math.abs(o.y);
  const ix = L - CR, iy = W - CR;
  if (ax > ix && ay > iy) {
    const dx = ax - ix, dy = ay - iy, d = Math.hypot(dx, dy), md = CR - r;
    if (d > md) {
      const nx = (dx / d) * sx, ny = (dy / d) * sy;
      o.x = sx * (ix + (dx / d) * md); o.y = sy * (iy + (dy / d) * md);
      const vn = o.vx * nx + o.vy * ny;
      if (vn > 0) { o.vx -= (1 + rest) * vn * nx; o.vy -= (1 + rest) * vn * ny; hit = vn > 1; }
    }
    return hit;
  }
  if (ax > L - r) {
    if (puck && ay < GOAL_HALF - PR) {
      // inside the goal mouth: keep it between the posts
      return false;
    }
    if (puck && ax > L + 0.05) { // inside net beside post: clamp to post
      o.y = sy * (GOAL_HALF - PR); o.vy = -o.vy * 0.3;
      return false;
    }
    o.x = sx * (L - r);
    if (o.vx * sx > 0) { hit = o.vx * sx > 1; o.vx = -o.vx * rest; }
  }
  if (ay > W - r) {
    o.y = sy * (W - r);
    if (o.vy * sy > 0) { hit = hit || o.vy * sy > 1; o.vy = -o.vy * rest; }
  }
  return hit;
}
