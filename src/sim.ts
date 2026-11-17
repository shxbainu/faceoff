// Faceoff simulation. No rendering in here: fixed-step, seeded, input-driven,
// so the same code can later run on a game server for multiplayer.

export const L = 40; // half length (x). Was 22: skaters were ~10% of the rink width, the reference is ~3%
export const W = 19; // half width (y, screen-down is +y)
export const CR = 8.5; // corner radius
/** rink scale relative to the original 44x22 rink, for positions that should grow with the ice */
const KX = L / 22, KY = W / 11;
export const GOAL_HALF = 2.1;
export const NET_DEPTH = 1.5;
/** goal line: nets stand out from the end boards so play can go behind them (NHL: 11 ft of a 200 ft rink) */
export const GL = L - 4.4;
export const SR = 0.7; // skater radius: check reach and boards
const BODY = 0.5;      // body radius for skater-on-skater contact
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
  swap?: boolean;
  /** lifted pass that sails over sticks */
  saucer?: boolean;
  /** quick wrist shot, no wind-up (the held shoot button is the slapshot) */
  wrist?: boolean;
  /** poke check only (check is the body check) */
  poke?: boolean;
}

/** Skating model, per skater so roguelite upgrades can raise any of it:
 *  accel      speed gained per second while pushing (near-constant, arcade style)
 *  topSpeed   firm cap while pushing (knockback and boosts can exceed it briefly)
 *  glide      coasting friction per second when no direction is held (low = long glides)
 *  turnLow    turn rate (rad/s) of the skating direction near standstill: sharp pivots
 *  turnHigh   turn rate at top speed: wide carving arcs that keep their speed
 *  brake      deceleration when pushing against your own motion (skid to a hockey stop) */
export interface SkateStats { accel: number; topSpeed: number; glide: number; turnLow: number; turnHigh: number; brake: number }
export const SKATE_BASE: SkateStats = { accel: 19, topSpeed: 10.5, glide: 0.28, turnLow: 12, turnHigh: 2.2, brake: 30 };

export interface Skater {
  id: number; team: number; slot: number; human: boolean;
  x: number; y: number; vx: number; vy: number; face: number;
  stun: number; air: boolean; z: number; vz: number; out: number; boxed: number;
  wind: number; checkT: number; checkCd: number; blockT: number; pickupCd: number;
  stamina: number; calling: number; frost: boolean;
  slow: number; settle: number; // slowed by a standing check; just-received grace against pokes
  /** time spent in contact with an opponent; when beaten from behind; stay off the carrier for a moment */
  tangle: number; beaten: number; disengage: number;
  /** skating stats (upgradable): see SKATE_BASE */
  move: SkateStats;
  pPass: boolean; pShoot: boolean; pCheck: boolean; pSaucer: boolean; pWrist: boolean; pPoke: boolean;
  hits: Set<number>; lungeAt: Skater | null;
  ai: { hold: number; patience: number; windGoal: number; react: number; oneT: boolean; pinned?: boolean; stab?: number };
}

/** goalies stay in their crease and slide along the goal line */
export interface Goalie { team: number; x: number; y: number; vy: number; react: number }

export interface Puck {
  x: number; y: number; vx: number; vy: number;
  owner: Skater | null; lastTeam: number; shooter: Skater | null;
  kind: 'loose' | 'pass' | 'shot'; target: Skater | null; from: Skater | null;
  ax: number; ay: number; q: number; oneTimer: boolean; fire: boolean;
  ghost: boolean; alive: boolean; checked: Set<number>; age: number;
  /** saucer pass in the air: cannot be picked off; liftT is its flight time */
  lifted: boolean; liftT: number;
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
  /** test hook: bots also play the player's skater */
  autoplay = false;
  /** test rink (?test): your skater alone on empty ice, no AI, goalies, clock, faceoffs or goals */
  sandbox = false;
  /** the skater the player is steering; changes hands with the puck and on the switch key */
  ctrl!: Skater;
  private pSwap = false;
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
        stamina: 1, calling: 0, frost: false, slow: 0, settle: 0, tangle: 0, beaten: 0, disengage: 0, move: { ...SKATE_BASE },
        pPass: false, pShoot: false, pCheck: false, pSaucer: false, pWrist: false, pPoke: false,
        hits: new Set(), lungeAt: null,
        ai: { hold: 0, patience: 2, windGoal: 0.5, react: 0.3, oneT: false },
      });
    }
    this.ctrl = this.skaters[0];
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
      ax: 0, ay: 0, q: 0, oneTimer: false, fire: false, ghost: false, alive: true, checked: new Set(), age: 0, lifted: false, liftT: 0,
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
      s.tangle = 0; s.beaten = 0; s.disengage = 0;
      s.calling = 0; s.ai.hold = 0; s.slow = 0; s.settle = 0; s.stamina = Math.max(s.stamina, 0.6);
      if (s.boxed > 0) s.boxed = 0;
    }
    for (const g of this.goalies) { g.y = 0; g.vy = 0; }
    if (this.ctrl) this.setCtrl(this.skaters[0]);
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
    const hs = this.ctrl;
    const swapEdge = !!human.swap && !this.pSwap; this.pSwap = !!human.swap;
    if (swapEdge && this.phase === 'play') this.swapToPuck();
    this.lastHumanMy = human.my;

    if (this.sandbox) {
      this.phase = 'play';
      const me = this.ctrl;
      for (const k of this.skaters) if (k !== me) { k.out = 1e9; k.x = k.y = 0; k.vx = k.vy = 0; }
      this.updateSkater(me, human, dt);
      collideNet(me, BODY, 0.2);
      return;
    }

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
      const c = s.human && !this.autoplay ? human : this.ai(s, dt);
      this.updateSkater(s, c, dt);
    }
    this.collide(dt);
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
    if (tr !== this.lastTier) { this.ev({ t: 'tier', n: tr, big: tr > this.lastTier, x: this.ctrl.x, y: this.ctrl.y }); this.lastTier = tr; }
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
        ln.x = clamp(this.ctrl.x + (this.rnd() - 0.3) * 8, -L + 5, L - 5);
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
      const gx = g.team === 0 ? -GL : GL, dir = g.team === 0 ? 1 : -1;
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

  /** hand control to another home skater without firing any button on the way */
  setCtrl(n: Skater) {
    const o = this.ctrl;
    if (n === o || n.team !== 0) return;
    o.human = false; o.wind = -1; o.calling = 0;
    n.human = true; n.pPass = true; n.pCheck = true; n.pShoot = false; n.pSaucer = true; n.pWrist = true; n.pPoke = true;
    this.ctrl = n;
    this.ev({ t: 'switch', x: n.x, y: n.y });
  }

  /** switch key: the home skater nearest the puck, or the next nearest if you already are */
  private swapToPuck() {
    const p = this.pucks[0];
    const ours = this.skaters.filter(k => k.team === 0 && this.active(k))
      .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
    const pick = ours[0] === this.ctrl ? ours[1] : ours[0];
    if (pick) this.setCtrl(pick);
  }

  deepest(team: number): Skater | null {
    const gx = team === 0 ? -GL : GL;
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
    let m = s.move.topSpeed;
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
    const mv = s.move;
    let max = this.maxSpeed(s), acc = mv.accel;
    if (has) max *= 0.93;                       // carrying the puck costs a little speed (footwork and passing matter)
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
      // Skating on edges: the skating direction turns toward the input at a rate that falls with speed
      // (sharp pivots when slow, wide carves that keep speed when fast); pushing against your own motion
      // skids to a stop first (NHL '94 style); letting go glides with very little friction.
      let sp = Math.hypot(s.vx, s.vy), hd = sp > 1e-4 ? Math.atan2(s.vy, s.vx) : Math.atan2(my, mx);
      if (ml > 0) {
        const want = Math.atan2(my, mx);
        let da = want - hd; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
        if (Math.abs(da) > 2.35 && sp > 2.5) {
          sp = Math.max(0, sp - mv.brake * dt);   // skid: shed speed before turning around
        } else {
          const f = Math.min(1, sp / Math.max(1, max));
          const rate = sp < 1 ? 40 : mv.turnLow + (mv.turnHigh - mv.turnLow) * Math.pow(f, 1.2);
          const step = clamp(da, -rate * dt, rate * dt);
          hd += step;
          sp *= 1 - 0.05 * Math.abs(step) * f;   // a hard carve bleeds a little speed, gentle arcs keep it
          // push: near-constant acceleration, easing in over the last unit before the cap
          if (Math.abs(da) < 1.3) sp = Math.min(Math.max(sp, max), sp + acc * dt * clamp(max - sp, 0, 1));
          else sp += acc * 0.35 * dt * clamp(max - sp, 0, 1);   // pushing sideways while turning: some drive
        }
      } else sp *= Math.exp(-(mv.glide + 2.2 * clamp(1 - sp / 2.5, 0, 1)) * dt);   // glide; dig in and settle once slow
      if (sp > max) sp = max + (sp - max) * Math.exp(-3 * dt);   // over the cap (knockback, boost): bleed back down
      s.vx = Math.cos(hd) * sp; s.vy = Math.sin(hd) * sp;
    }
    // facing
    const sp = Math.hypot(s.vx, s.vy);
    let ta = s.face;
    if (s.wind >= 0 && has) ta = Math.atan2(-s.y, (s.team === 0 ? GL : -GL) - s.x);
    else if (sp > 2.5) ta = Math.atan2(s.vy, s.vx);   // face where you are actually skating (arcs, skids)
    else if (ml > 0) ta = Math.atan2(my, mx);
    let da = ta - s.face; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    s.face += clamp(da, -14 * dt, 14 * dt);
    if (s.face > Math.PI) s.face -= 2 * Math.PI; else if (s.face < -Math.PI) s.face += 2 * Math.PI;

    // buttons
    const passEdge = c.pass && (!s.pPass || !s.human);
    const checkEdge = c.check && (!s.pCheck || !s.human);
    const saucerEdge = !!c.saucer && (!s.pSaucer || !s.human);
    const wristEdge = !!c.wrist && (!s.pWrist || !s.human);
    const pokeEdge = !!c.poke && (!s.pPoke || !s.human);
    if (has && (c.passTo || passEdge || saucerEdge)) this.doPass(s, c.passTo || null, mx, my, ml > 0, saucerEdge && !passEdge);
    else if (has && wristEdge && s.wind < 0) this.doShot(s, 0.5, false, my, true);
    else if (passEdge && s.human && p.owner && p.owner.team === s.team) { s.calling = 0.9; this.ev({ t: 'call' }); }
    if (c.shoot) {
      s.wind = s.wind < 0 ? 0 : s.wind + dt;
      if (p.owner === s && s.wind > 1.5) { this.doShot(s, s.wind, false, my); s.wind = -1; }
    } else if (s.pShoot || s.wind >= 0) {
      if (p.owner === s && s.wind >= 0) this.doShot(s, s.wind, false, my);
      s.wind = -1;
    }
    if (checkEdge && s.checkCd <= 0 && p.owner !== s) this.startCheck(s, s.human ? 'body' : 'auto');
    if (pokeEdge && s.checkCd <= 0 && p.owner !== s) this.startCheck(s, 'poke');
    s.pPass = c.pass; s.pShoot = c.shoot; s.pCheck = c.check; s.pSaucer = !!c.saucer; s.pWrist = !!c.wrist; s.pPoke = !!c.poke;

    s.x += s.vx * dt; s.y += s.vy * dt;
    collideBoards(s, SR, 0.2, false);
    collideNet(s, BODY, 0.2);
  }

  /** 'poke' = stick only, 'body' = shoulder check, 'auto' = bots pick by distance and speed */
  private startCheck(s: Skater, mode: 'poke' | 'body' | 'auto' = 'auto') {
    const p = this.pucks[0], car = p.owner;
    const sp = Math.hypot(s.vx, s.vy);
    const dC = car ? Math.hypot(car.x - s.x, car.y - s.y) : 99;
    if (mode === 'poke' && !(car && car.team !== s.team && dC < 1.9)) { s.checkCd = 0.45; this.ev({ t: 'poke', x: s.x + Math.cos(s.face), y: s.y + Math.sin(s.face) }); return; }
    if (mode !== 'body' && car && car.team !== s.team && dC < 1.9 && (mode === 'poke' || sp < 4.5 || Math.hypot(s.vx - car.vx, s.vy - car.vy) < 4.5)) {
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
    p.lifted = false;
    p.owner = s; p.kind = 'loose'; p.target = null; p.from = null; p.cc = 0; p.oneTimer = false; p.fire = false;
    p.lastTeam = s.team; p.checked.clear();
    if (prevTeam !== s.team) this.chain = 0;
    s.ai.hold = 0; s.ai.patience = 2.6 + this.rnd() * 1.6; s.settle = 0.45;
    if (this.phase === 'play' || this.phase === 'faceoff') {
      if (s.team === 0) this.setCtrl(s);
      else if (prevTeam !== s.team || this.ctrl.team === 0) {
        // they have it: take the home skater nearest the carrier, if clearly nearer than yours
        let best = this.ctrl, bd = Math.hypot(this.ctrl.x - s.x, this.ctrl.y - s.y) - 2;
        for (const k of this.skaters) {
          if (k.team !== 0 || !this.active(k)) continue;
          const d = Math.hypot(k.x - s.x, k.y - s.y);
          if (d < bd) { bd = d; best = k; }
        }
        this.setCtrl(best);
      }
    }
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

  private doPass(s: Skater, to: Skater | null, mx: number, my: number, hasDir: boolean, lifted = false) {
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
    // crisp passes: about 3x skating speed, harder over distance (was a flat 18, which drifted)
    const far = to ? Math.hypot(to.x - s.x, to.y - s.y) : 12;
    const speed = clamp(16 + far * 0.55, 20, 28) * (lifted ? 0.8 : 1) + 2 * this.pw(s.team, 'curve');
    p.lifted = lifted; p.liftT = 0;
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
    if (lifted) p.liftT = Math.hypot(tx - p.x, ty - p.y) / speed;
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
    if (s.human) this.setCtrl(to);
    this.ev({ t: 'pass', x: s.x, y: s.y });
  }

  private doShot(s: Skater, wind: number, oneTimer: boolean, my: number, wrist = false) {
    const p = this.pucks[0];
    const dir = s.team === 0 ? 1 : -1, gx = dir * GL;
    const sweet = oneTimer || (wind >= 0.32 && wind <= 0.82);
    let pw = clamp(wind / 0.32, 0.3, 1);
    if (wind > 0.82) pw = Math.max(0.55, 1 - (wind - 0.82) * 0.8);
    if (oneTimer) pw = 1;
    if (wrist) pw = 0.75; // quick release: accurate, not as hard
    const fire = s.team === 0 && this.fireT > 0;
    let speed = 18 + 7 * pw + (sweet ? 4 : 0) + (oneTimer ? 7 : 0);
    if (wrist) speed *= 0.86;
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

  private collide(dt: number) {
    const S = this.skaters, owner = this.pucks[0].owner;
    for (const s of S) { s.disengage -= dt; s.tangle = Math.max(0, s.tangle - dt * 2); }
    for (let i = 0; i < S.length; i++) for (let j = i + 1; j < S.length; j++) {
      const a = S[i], b = S[j];
      if (a.air || b.air || a.out > 0 || b.out > 0 || a.boxed > 0 || b.boxed > 0) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d >= SR * 2 || d < 1e-4) continue;
      if (a.team !== b.team) {
        if (a.checkT > 0 && !a.hits.has(b.id) && b.stun <= 0) { this.hit(a, b); continue; }
        if (b.checkT > 0 && !b.hits.has(a.id) && a.stun <= 0) { this.hit(b, a); continue; }
      }
      // bodies are smaller than the check reach, so skaters brush past instead of locking together
      if (d >= BODY * 2) continue;
      const nx = dx / d, ny = dy / d, ov = BODY * 2 - d;
      // whoever is moving faster, or carrying the puck, keeps more of their momentum
      const ia = 1 / (1 + 0.12 * Math.hypot(a.vx, a.vy) + (owner === a ? 0.8 : 0));
      const ib = 1 / (1 + 0.12 * Math.hypot(b.vx, b.vy) + (owner === b ? 0.8 : 0));
      const wa = ia / (ia + ib), wb = ib / (ia + ib);
      a.x -= nx * ov * wa; a.y -= ny * ov * wa; b.x += nx * ov * wb; b.y += ny * ov * wb;
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) {
        const pa = Math.hypot(a.vx, a.vy), pb = Math.hypot(b.vx, b.vy);
        const ca = pa > 0 ? Math.abs(a.vx * nx + a.vy * ny) / pa : 1, cb = pb > 0 ? Math.abs(b.vx * nx + b.vy * ny) / pb : 1;
        const jn = (-(1 + 0.15) * rv) / (ia + ib);
        a.vx -= nx * jn * ia; a.vy -= ny * jn * ia; b.vx += nx * jn * ib; b.vy += ny * jn * ib;
        // glancing contact: deflect off the shoulder and keep most of your speed instead of stopping dead
        for (const [k, pre, cs, sgn] of [[a, pa, ca, -1], [b, pb, cb, 1]] as [Skater, number, number, number][]) {
          if (pre < 3 || cs > 0.75 || k.checkT > 0) continue;
          const now = Math.hypot(k.vx, k.vy), keep = 0.88 * pre;
          if (now >= keep) continue;
          if (now > 0.5) { k.vx *= keep / now; k.vy *= keep / now; }
          else { const tx = -ny * sgn, ty = nx * sgn; k.vx = tx * keep; k.vy = ty * keep; }
        }
      }
      if (a.team === b.team) continue;
      // the carrier peels off around the defender, sliding the way he is already leaning
      const c = owner === a ? a : owner === b ? b : null;
      if (c) {
        const tx = -ny, ty = nx, side = Math.sign(c.vx * tx + c.vy * ty) || (c === a ? 1 : -1);
        c.vx += tx * side * 9 * dt; c.vy += ty * side * 9 * dt;
      }
      // two skaters grinding against each other get pushed apart, and the defender backs off
      a.tangle += dt * 3; b.tangle += dt * 3;
      if (a.tangle > 0.35 && b.tangle > 0.35) {
        a.vx -= nx * 2.5; a.vy -= ny * 2.5; b.vx += nx * 2.5; b.vy += ny * 2.5;
        a.tangle = b.tangle = 0;
        for (const k of [a, b]) if (k !== owner) k.disengage = 0.7;
      }
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
    const gx = s.team === 0 ? -GL : GL;
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
    // tape to tape: a pass bends gently toward its receiver as he moves (not for curve passes mid-bend)
    if (p.kind === 'pass' && p.target && this.active(p.target) && !(p.cc > 0 && p.age < p.cT)) {
      const t = p.target, sp0 = Math.hypot(p.vx, p.vy) || 1;
      const lead = Math.min(0.4, Math.hypot(t.x - p.x, t.y - p.y) / sp0);
      const wx = t.x + t.vx * lead - p.x, wy = t.y + t.vy * lead - p.y, wl = Math.hypot(wx, wy) || 1;
      const cur = Math.atan2(p.vy, p.vx), want = Math.atan2(wy, wx);
      let da = want - cur; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      if (Math.abs(da) < 1.1 && wl > 0.8) {
        const turn = clamp(da, -2.2 * dt, 2.2 * dt), na = cur + turn;
        p.vx = Math.cos(na) * sp0; p.vy = Math.sin(na) * sp0;
      }
    }
    if (this.goalieTouch(p, x0, y0)) return;
    // goal: the puck crosses the goal line between the posts, coming from the front
    const gs = p.x >= 0 ? 1 : -1;
    if (Math.abs(p.x) >= GL && Math.abs(x0) < GL && x0 * gs > 0 && Math.abs(p.y) < GOAL_HALF - PR * 0.5) { this.goal(p); return; }
    let bounced = collideBoards(p, PR, 0.55, true);
    if (collideNet(p, PR, 0.4, true)) { bounced = true; if (Math.abs(p.y) > GOAL_HALF - 0.3 && Math.abs(p.y) < GOAL_HALF + 0.4) this.ev({ t: 'post', x: p.x, y: p.y }); }
    if (bounced) {
      if (p.ghost) { p.alive = false; return; }
      this.ev({ t: 'board', x: p.x, y: p.y, n: Math.hypot(p.vx, p.vy) });
      if (p.kind === 'shot') {
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
          if (p.lifted) { if (p.lastTeam === 0) this.addHeat(100, 'Saucer pass', s.x, s.y); continue; }
          let ch = s.blockT > 0 ? 0.8 : 0.35;
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
      s.face = Math.atan2(-s.y, (s.team === 0 ? GL : -GL) - s.x);
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
  /** which side of the ice a role plays: -1 left, 1 right, 0 middle (attack-relative) */
  private laneOf(s: Skater): number {
    if (TEAM === 3) return s.slot === 1 ? (this.pucks[0].y * (s.team === 0 ? 1 : -1) > 0 ? -1 : 1) : 0;
    return s.slot === 1 || s.slot === 2 ? -1 : s.slot === 3 || s.slot === 4 ? 1 : 0;
  }

  /** the one skater on a team who goes after the carrier or the loose puck; everyone else keeps shape */
  private presser(team: number, tx: number, ty: number): Skater | null {
    let best: Skater | null = null, bd = 1e9;
    const deep = (team === 0 ? tx < -0.3 * L : tx > 0.3 * L);
    for (const k of this.skaters) {
      if (k.team !== team || !this.active(k)) continue;
      if (k.disengage > 0 && !k.human) continue;   // just untangled from the carrier
      const isD = k.slot === 2 || k.slot === 4;
      // defenders only press inside their own zone
      // a defender already goal-side of the puck should take it; one chasing from behind is a last resort
      const ngx = (team === 0 ? -GL : GL) - tx, behind = (k.x - tx) * ngx + (k.y - ty) * -ty < 0;
      const d = Math.hypot(k.x - tx, k.y - ty) * (isD && !deep ? 2.2 : 1) * (k.human ? 0.75 : 1) * (behind && !k.human ? 2.5 : 1);
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  /** formation spot for a skater, in world coordinates. Home spots shift with the puck */
  private spot(s: Skater, attacking: boolean): [number, number] {
    const p = this.pucks[0], dir = s.team === 0 ? 1 : -1;
    const pu = p.x * dir, pv = p.y * dir; // attack-relative: +u toward the net we attack
    const lane = this.laneOf(s), isD = s.slot === 2 || s.slot === 4;
    const BL = 0.3 * L, ph = this.time * 1.3 + s.id * 1.7;
    let u: number, v: number;
    if (attacking) {
      if (isD) {
        // defenders trail the rush, then hold the blue line once the puck is in
        u = pu > BL ? BL + 2.5 : clamp(pu - 11, -GL + 7, BL + 2.5);
        v = (TEAM === 3 ? pv * 0.3 : lane * 0.33 * W);
      } else if (s.slot === 0) {
        // centre: trail and support up ice, take the net front in their zone
        if (pu > BL) { u = GL - 6; v = Math.sin(ph) * 2; }
        else { u = pu - 1.5; v = (pv > 0 ? -1 : 1) * 0.15 * W; }
      } else {
        // wingers stretch their own lane ahead of the puck, then work the half-wall
        u = pu > BL ? GL - 11 + Math.cos(ph) * 1.5 : clamp(pu + 6, -GL + 8, GL - 9);
        v = lane * (0.55 * W + Math.sin(ph) * 1.5);
      }
    } else {
      const dz = pu < -BL; // puck in our defensive zone
      if (dz) {
        // box in front of the net: defenders low, forwards cover the points
        if (isD) { u = -GL + 5.5; v = lane === 0 ? pv * 0.3 : lane * 2.6; }
        else { u = -GL + 12.5; v = (lane === 0 ? pv * 0.25 : lane * 0.38 * W); }
      } else {
        // 1-2-2 back-check: forwards a step behind the puck, defenders keep a gap
        if (isD) { u = clamp(pu - 13, -GL + 6, BL); v = lane === 0 ? pv * 0.3 : lane * 0.3 * W; }
        else { u = clamp(pu - 5, -GL + 10, GL - 8); v = lane === 0 ? pv * 0.4 : lane * 0.35 * W; }
      }
      // pick up the nearest attacker to that spot and stay goal-side of him
      let m: Skater | null = null, md = 6;
      for (const o of this.skaters) {
        if (o.team === s.team || !this.active(o) || o === p.owner) continue;
        const d = Math.hypot(o.x * dir - u, o.y * dir - v);
        if (d < md) { md = d; m = o; }
      }
      if (m) { u = u * 0.4 + (m.x * dir - 1.6) * 0.6; v = v * 0.4 + m.y * dir * 0.6; }
    }
    // a small pull toward the puck keeps the shape alive without collapsing it
    u = u * 0.88 + pu * 0.12; v = v * 0.88 + pv * 0.12;
    return [clamp(u * dir, -GL + 2, GL - 2), clamp(v * dir, -W + 1.5, W - 1.5)];
  }

  // ---------------------------------------------------------------- bots
  private ai(s: Skater, dt: number): Ctl {
    const c: Ctl = { mx: 0, my: 0, pass: false, shoot: false, check: false, burst: false };
    const p = this.pucks[0], car = p.owner;
    const dir = s.team === 0 ? 1 : -1, tgx = dir * GL;
    const sk = s.team === 1 ? this.skillLevel : 0.7;
    const isD = s.slot === 2 || s.slot === 4;
    let tx = s.x, ty = s.y;

    // who has it: carrier, or the side a pass belongs to
    const ownTeam = car ? car.team : p.kind === 'pass' ? p.lastTeam : -1;

    if (car === s) {
      s.ai.hold += dt;
      const dg = Math.hypot(tgx - s.x, s.y), ahead = (tgx - s.x) * dir;
      const [no, nd] = this.nearestOpp(s);
      // carry up your own lane, cut toward the slot once in their zone
      const inZone = s.x * dir > 0.3 * L;
      tx = tgx - dir * 5; ty = inZone ? clamp(s.y * 0.5, -4, 4) : clamp(s.y, -0.6 * W, 0.6 * W);
      if (s.wind >= 0) c.shoot = s.wind < s.ai.windGoal;
      else {
        const h = s.team === 0 ? this.ctrl : null;
        if (h && h !== s && this.active(h)) {
          const hOpen = this.nearestOpp(h)[1] > 1.7;
          const hAhead = (h.x - s.x) * dir > -3;
          const ln = this.laneGap(s.x, s.y, h.x, h.y, 0);
          if ((h.calling > 0 && s.ai.hold > 0.12) ||
            (hOpen && hAhead && s.ai.hold > 0.7 && Math.hypot(tgx - h.x, h.y) < 16 && ln > 1.0 && (h.wind >= 0 || s.ai.hold > 1.1)))
            c.passTo = h;
        }
        if (!c.passTo && s.ai.hold > 0.6 && s.x * dir > 0.3 * L) {
          // look for a teammate set up in the slot for a one-timer
          for (const m of this.skaters) {
            if (m.team !== s.team || m === s || m.human || !this.active(m)) continue;
            const mg = Math.hypot(tgx - m.x, m.y);
            if (mg < 12 && mg < dg + 2 && this.nearestOpp(m)[1] > 1.6 && this.laneGap(s.x, s.y, m.x, m.y, s.team) > 1.1
              && Math.abs(m.y - s.y) > 2.5 && this.rnd() < dt * (2 + 3 * sk)) { c.passTo = m; break; }
          }
        }
        if (!c.passTo) {
          // shoot from the slot freely, from range when there is a lane or pressure coming
          const canShoot = ahead > 1.2 && dg < 17 && Math.abs(s.y) < 0.55 * W;
          const lane = this.laneGap(s.x, s.y, tgx, 0, s.team) > 1.2;
          if (canShoot && s.ai.hold > 0.25 && (dg < 10.5 || (lane && s.ai.hold > 0.5) || nd < 2.5 || s.ai.hold > 1.2)) {
            s.ai.windGoal = 0.33 + this.rnd() * (0.55 - 0.3 * sk); c.shoot = true;
          } else if ((nd < 1.8 && s.ai.hold > 0.35 * s.ai.patience) || s.ai.hold > s.ai.patience || (isD && s.ai.hold > 1.1)) {
            // move it to an open teammate further up the ice; with nobody ahead, keep carrying it
            const pressured = nd < 1.8;
            let best: Skater | null = null, bs = 0.2;
            for (const m of this.skaters) {
              if (m.team !== s.team || m === s || !this.active(m)) continue;
              if (!pressured && (m.x - s.x) * dir < 2) continue;
              const ln = this.laneGap(s.x, s.y, m.x, m.y, s.team);
              if (ln < 0.8) continue;
              const sc = (m.x - s.x) * dir * 0.08 + Math.min(ln, 2.5) + Math.min(this.nearestOpp(m)[1], 3) * 0.5;
              if (sc > bs) { bs = sc; best = m; }
            }
            if (best) c.passTo = best;
            else if (s.ai.hold > 3 && canShoot) { s.ai.windGoal = 0.4; c.shoot = true; }
          }
        }
        if (no && nd < 4.5 && (no.x - s.x) * dir > -0.5) ty = clamp(ty + (s.y >= no.y ? 1 : -1) * 3.5, -W + 2, W - 2);
        c.burst = ahead > 10 && (nd > 3 || s.ai.hold < 1);
      }
    } else if (p.kind === 'pass' && p.target === s) {
      tx = p.ax; ty = p.ay;
      if (s.ai.oneT && Math.hypot(tgx - s.x, s.y) < 13) c.shoot = true;
    } else {
      // target to chase: the carrier, the pass receiver, or where the loose puck is going
      const tgt = car ?? (p.kind === 'pass' && p.target ? p.target : null);
      const fx = tgt ? tgt.x + tgt.vx * 0.2 : p.x + p.vx * 0.3, fy = tgt ? tgt.y + tgt.vy * 0.2 : p.y + p.vy * 0.3;
      const attacking = ownTeam === s.team || (ownTeam < 0 && p.x * dir > 0);
      const pr = ownTeam === s.team ? null : this.presser(s.team, fx, fy);
      if (pr === s) {
        tx = fx; ty = fy;
        if (car && car.team !== s.team) {
          // 1-on-1 defending, after hockey coaching practice (gap control, angling, stick before body)
          // built from standard steering behaviours (pursuit, interpose, offset):
          // predict where the carrier is going, stand between that point and our net at a stick-length
          // gap, shade to the inside so the open lane runs to the boards, tighten the gap near our net or
          // once he is pinned on the boards. Beaten from behind: come alongside for a poke, then give up.
          const ngx = -dir * GL;
          const dC = Math.hypot(car.x - s.x, car.y - s.y);
          const lead = clamp(dC / 9, 0.1, 0.45);
          const px = car.x + car.vx * lead, py = car.y + car.vy * lead;
          const gx = ngx - px, gy = -py, gl = Math.hypot(gx, gy) || 1, ux = gx / gl, uy = gy / gl;
          const behind = (s.x - car.x) * (ngx - car.x) + (s.y - car.y) * -car.y < 0;   // carrier between me and my net
          s.beaten = behind ? s.beaten + dt : 0;
          const pinned = Math.abs(py) > W - 4.5, danger = gl < 12;
          const gap = pinned ? 1.1 : danger ? 1.3 : 1.55;   // about one poke length: close enough to work the puck
          // inside = toward the middle of the ice, perpendicular to the line to our net
          let ix = -uy, iy = ux; if (iy * -Math.sign(py || 1) < 0) { ix = -ix; iy = -iy; }
          const shade = pinned ? 0.2 : 0.75;
          tx = px + ux * gap + ix * shade; ty = py + uy * gap + iy * shade;
          if (behind) {   // beaten: come alongside for a poke instead of trailing in his skate marks
            const qx = -uy, qy = ux, side = Math.sign((s.x - car.x) * qx + (s.y - car.y) * qy) || 1;
            tx = car.x + ux * 0.6 + qx * 1.2 * side; ty = car.y + uy * 0.6 + qy * 1.2 * side;
          }
          if (s.beaten > 0.55) { s.disengage = 1.2; s.beaten = 0; }   // stop riding him: backcheck to position
          s.ai.pinned = pinned;
          // from a good gap, attack the puck in short bursts (stick first), then settle back
          s.ai.stab = (s.ai.stab ?? 0) - dt;
          if (!behind && dC < 2.8 && s.ai.stab <= -0.4 && this.rnd() < dt * (1.4 + 1.6 * sk)) s.ai.stab = 0.3;
          if (s.ai.stab > 0 && !behind) { tx = p.x; ty = p.y; }
        }
        const dS = Math.hypot(fx - s.x, fy - s.y);
        c.burst = dS > 5;
        if (car && car.team !== s.team) {
          // only commit when the stick can reach the puck, or with real closing speed for a hit
          const closing = ((car.x - s.x) * (s.vx - car.vx) + (car.y - s.y) * (s.vy - car.vy)) / (dS || 1);
          const dPk = Math.hypot(p.x - s.x, p.y - s.y);
          const poke = dPk < 1.45 && dPk < dS + 0.1 && dS < 1.9;
          const body = (s.ai.pinned && dS < 2.2 && closing > 2.5) || (dS < 3.4 && closing > 6);
          if ((poke || body) && s.checkCd <= 0) {
            s.ai.react -= dt;
            if (s.ai.react <= 0) { c.check = true; s.ai.react = (0.6 - 0.38 * sk) * (0.7 + this.rnd() * 0.6); }
          }
        }
      } else {
        [tx, ty] = this.spot(s, attacking);
        // a carrier skating straight through your spot still gets hit
        if (car && car.team !== s.team && s.checkCd <= 0) {
          const dS = Math.hypot(car.x - s.x, car.y - s.y);
          const closing = ((car.x - s.x) * (s.vx - car.vx) + (car.y - s.y) * (s.vy - car.vy)) / (dS || 1);
          if (dS < 2.2 && closing > 6 && this.rnd() < dt * 4) c.check = true;
        }
        c.burst = Math.hypot(tx - s.x, ty - s.y) > 9;
      }
    }

    const dx = tx - s.x, dy = ty - s.y, d = Math.hypot(dx, dy);
    if (d > 0.35) {
      const sp = Math.hypot(s.vx, s.vy);
      // ease into a spot instead of overshooting it
      if (!(d < 1.6 && sp > d * 4.5)) { c.mx = dx / d; c.my = dy / d; }
      if (d < 2.5 && !c.burst) { c.mx *= d / 2.5; c.my *= d / 2.5; }
    }
    return c;
  }

  snapshot() {
    const p = this.pucks[0];
    return {
      ctrl: this.ctrl.id,
      phase: this.phase, score: this.score.slice(), clock: this.clock, ot: this.ot, foLive: this.foLive,
      heat: this.heat, tier: this.mult() - 1, fire: this.fireT, style: this.style, winner: this.winner,
      puck: { x: p.x, y: p.y, vx: p.vx, vy: p.vy, owner: p.owner ? p.owner.id : -1, kind: p.kind, target: p.target ? p.target.id : -1 },
      skaters: this.skaters.map(s => ({ id: s.id, team: s.team, x: s.x, y: s.y, vx: s.vx, vy: s.vy, face: s.face, ctrl: s === this.ctrl, stun: s.stun, ok: this.active(s), wind: s.wind, stamina: s.stamina, slow: s.slow })),
      stats: this.stats,
      goalies: this.goalies.map(g => ({ team: g.team, x: g.x, y: g.y })),
    };
  }
}

const NOCTL: Ctl = { mx: 0, my: 0, pass: false, shoot: false, check: false, burst: false };

/** Keep a circle inside the rounded rink (the end boards are solid; the nets stand in front of them).
 *  Returns true on a bounce. */
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
    o.x = sx * (L - r);
    if (o.vx * sx > 0) { hit = o.vx * sx > 1; o.vx = -o.vx * rest; }
  }
  if (ay > W - r) {
    o.y = sy * (W - r);
    if (o.vy * sy > 0) { hit = hit || o.vy * sy > 1; o.vy = -o.vy * rest; }
  }
  return hit;
}

/** The net as a solid box from the goal line back NET_DEPTH, between the posts: skaters skate around it and the
 *  puck rebounds off its sides and back (goals are scored through the open front, see updatePuck). */
export function collideNet(o: { x: number; y: number; vx: number; vy: number }, r: number, rest: number, openMouth = false): boolean {
  const sx = o.x < 0 ? -1 : 1, lx = Math.abs(o.x) - GL, ly = o.y;
  if (openMouth && lx < 0.5 && Math.abs(ly) < GOAL_HALF - r) return false;   // the puck can go in the front
  // closest point on the box [0, NET_DEPTH] x [-GOAL_HALF, GOAL_HALF] (local x into the net)
  const cx = clamp(lx, 0, NET_DEPTH), cy = clamp(ly, -GOAL_HALF, GOAL_HALF);
  let dx = lx - cx, dy = ly - cy, d = Math.hypot(dx, dy);
  if (d >= r) return false;
  if (d < 1e-6) {   // centre inside the box: push out the nearest way (not through the front mouth for a puck going in)
    const outs: [number, number, number][] = [[lx, -1, 0], [NET_DEPTH - lx, 1, 0], [GOAL_HALF - ly, 0, 1], [ly + GOAL_HALF, 0, -1]];
    outs.sort((a, b) => a[0] - b[0]); dx = outs[0][1]; dy = outs[0][2]; d = 0;
  } else { dx /= d; dy /= d; }
  const push = r - d;
  o.x += sx * dx * push; o.y += dy * push;
  const nx = sx * dx, ny = dy, vn = o.vx * nx + o.vy * ny;
  if (vn < 0) { o.vx -= (1 + rest) * vn * nx; o.vy -= (1 + rest) * vn * ny; return -vn > 1; }
  return false;
}

