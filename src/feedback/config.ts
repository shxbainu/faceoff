// All feedback tuning in one place. The feedback system (system.ts) reads only this; nothing here is code.
//
// Ranges: every [a, b] pair is lerped by the event's effective intensity (0 -> a, 1 -> b).
// Units: hit stop in frames at 60 fps; slow-mo scale is the fraction of real time fed to the sim; trauma 0..1
// (shake = trauma^2); kick and punch in world units / fraction of camera distance; fov in degrees;
// flash, chroma and vignette are peak strengths before the global intensity slider and the caps below.

export type Range = [number, number];
export type ParticleKind = 'burst' | 'spray' | 'sparks' | 'confetti' | 'ring' | 'dust';
export type Cue =
  | 'pass_snap' | 'catch' | 'streak_break' | 'shot_crack' | 'shot_whoosh' | 'post_ping' | 'ooh' | 'save_thump' | 'glove_pop'
  | 'hit_thud' | 'hit_crack' | 'board_boom' | 'glass_rattle' | 'shove' | 'goal_horn' | 'crowd_roar' | 'crowd_groan'
  | 'spin_swish' | 'burst_scrape' | 'rank_up' | 'lose_puck' | 'win_puck' | 'stick_clack' | 'draw_click' | 'sting';

export interface ParticleSpec {
  kind: ParticleKind;
  count: Range;
  color: number | number[];   // a list picks at random per particle
  speed: Range;
  up?: number; size?: number; life?: number;
  /** spray along the event's direction (dx, dy) instead of all round */
  directional?: boolean;
  /** spawn height above the ice */
  h?: number;
}

export interface SoundSpec {
  cue: Cue;
  vol: Range;
  /** base pitch multiplier by intensity; `perStreak` raises it in semitones per streak step */
  pitch?: Range;
  jitter?: number;        // random pitch spread, in semitones (+/-)
  perStreak?: number;
  delay?: number;         // seconds
}

export interface SlowSpec { scale: Range; in: number; hold: Range; out: number; minI?: number }

export interface FxSpec {
  /** bigger events win when effects collide (hit stop, slow-mo, flash, popups) */
  priority: number;
  /** 'bad' moments are kept short and quiet so the good ones stand out */
  valence: 'good' | 'bad' | 'neutral';
  hitStop?: Range;
  slowmo?: SlowSpec;
  trauma?: Range;
  kick?: Range;
  punch?: Range;
  fov?: Range;
  flash?: Range;
  chroma?: Range;
  vignette?: Range;
  squash?: Range;          // on the victim or receiver (negative stretches)
  particles?: ParticleSpec[];
  sounds?: SoundSpec[];
  /** popup text for events that have no style-points popup from the sim. {n} = streak */
  popup?: { text: string; minI?: number; size: 'sm' | 'md' | 'lg' };
  flow?: number;           // flow points (negative drains the rank)
  /** only when the event involves the skater you control (otherwise scaled by `others`) */
  meOnly?: boolean;
  /** seconds before this event may fire its effects again */
  cooldown?: number;
}

const ICE = 0xe8f4ff, WHITE = 0xffffff, ACCENT = 0xe5482d, GOLD = 0xffb400;
const CONFETTI = [0xffb400, 0xffffff, 0x1e90ff, 0xe5482d, 0x7dff8a];

export const FEEDBACK = {
  /** caps and budgets that hold whatever the events ask for */
  global: {
    frame: 1 / 60,                 // one hit-stop frame
    hitStopMax: 8,                 // frames
    hitStopMin: 2,                 // the smallest hit stop that is worth doing at all
    slowmoMin: 0.2,                // never slower than this
    trauma: { decay: 1.5, max: 1, exponent: 2, offset: 0.9, roll: 0.035, freq: 22 },
    kick: { omega: 26, max: 2.2 },          // directional camera kick: spring back speed, cap
    punch: { decay: 4.5, max: 0.16 },       // zoom punch: fraction of camera distance
    fov: { omega: 14, max: 5 },             // degrees
    flash: { maxAlpha: 0.32, minGap: 0.34, fade: 0.16 },   // at most ~3 flashes per second (WCAG 2.3.1), short fades
    chroma: { max: 0.006, decay: 3.2 },
    vignette: { max: 0.55, decay: 2.4 },
    particles: { budget: 900, perEventCap: 120 },
    voices: 26,
    popups: { max: 7, merge: 0.6 },
    /** events far from the action count for less: full within near, nothing past far (world units from the view) */
    distance: { near: 22, far: 55, floor: 0.25 },
    /** the same event by a skater you don't control (teammate or opponent) plays at this fraction */
    others: 0.55,
    /** effective intensity for good events rises with the flow rank (per rank step) and the pass streak (per pass) */
    escalate: { perRank: 0.05, perStreak: 0.04, max: 0.25 },
    /** bad events: everything scaled down and shortened */
    negative: 0.55,
  },

  /** continuous effects that read game state every frame */
  continuous: {
    windup: { vignette: 0.32, fov: -2.2, hum: 0.16, sweetPulse: 0.5 },   // slapshot held: tension builds, sweet spot pulses
    speedLines: { minSpeed: 13, perSecond: 26, color: ICE, len: 1.6 },  // fast pucks
    skateLines: { minFrac: 0.92, perSecond: 14 },                        // controlled skater near top speed
    trail: { pass: 0xbfe6ff, shot: WHITE, fire: ACCENT, perSecond: 70, life: 0.22 },
  },

  /** pass streak meter: rising pitch per pass (semitone steps), resets when it breaks */
  streak: { minShow: 2, scale: [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19], basePitch: 1, hold: 2.4 },

  /** flow rank: rises with good play, decays when idle, drops on bad moments. Display and intensity only. */
  flow: {
    ranks: [
      { name: 'D', at: 0 }, { name: 'C', at: 90 }, { name: 'B', at: 220 },
      { name: 'A', at: 400 }, { name: 'S', at: 640 }, { name: 'S+', at: 900 },
    ],
    max: 1100,
    idleDelay: 1.8,      // seconds of nothing before it starts to drain
    decay: 55,           // points per second, more at higher ranks
    decayPerRank: 18,
  },

  /** goal sequence extras: skip keys end it early, repeat goals in one match get a shorter cut */
  goal: { skipAfter: 0.12, repeatScale: 0.65, repeatWindow: 25, cardTime: 1.5, celebrateTime: 1.7 },

  events: {
    // ------------------------------------------------------------------ passes
    pass_released: {
      priority: 1, valence: 'neutral',
      trauma: [0, 0.04], fov: [0, 0.4],
      particles: [{ kind: 'dust', count: [3, 7], color: ICE, speed: [2, 4], up: 1.5, size: 0.08, directional: true }],
      sounds: [{ cue: 'pass_snap', vol: [0.35, 0.6], pitch: [0.95, 1.15], jitter: 1.2 }],
    },
    pass_completed: {
      priority: 2, valence: 'good', meOnly: false,
      hitStop: [0, 1], trauma: [0, 0.05], squash: [-0.05, -0.12],
      particles: [{ kind: 'ring', count: [1, 1], color: 0xbfe6ff, speed: [1.4, 2.4] }, { kind: 'dust', count: [3, 8], color: ICE, speed: [1.5, 3], up: 2, size: 0.08 }],
      sounds: [{ cue: 'catch', vol: [0.32, 0.5], pitch: [1, 1], jitter: 0.3, perStreak: 1 }],
      popup: { text: 'Nice pass x{n}', minI: 0, size: 'sm' },
      flow: 30,
    },
    one_touch: {
      priority: 3, valence: 'good',
      hitStop: [1, 2], trauma: [0.06, 0.1], fov: [0.6, 1],
      particles: [{ kind: 'sparks', count: [6, 12], color: 0xbfe6ff, speed: [5, 9], up: 2 }],
      sounds: [{ cue: 'stick_clack', vol: [0.4, 0.6], pitch: [1.1, 1.25], jitter: 0.8 }],
      flow: 45,
    },
    streak_end: {
      priority: 1, valence: 'neutral',
      sounds: [{ cue: 'streak_break', vol: [0.16, 0.24], pitch: [1, 0.9] }],
      flow: 0,
    },
    // ------------------------------------------------------------------ shots
    shot_released: {
      priority: 4, valence: 'neutral',
      hitStop: [0, 2], trauma: [0.06, 0.2], kick: [0.1, 0.35], fov: [0.8, 2.2], punch: [0, 0.02],
      particles: [{ kind: 'spray', count: [6, 16], color: ICE, speed: [5, 11], up: 3, directional: true },
        { kind: 'ring', count: [1, 1], color: WHITE, speed: [1.6, 2.6] }],
      sounds: [{ cue: 'shot_crack', vol: [0.45, 0.85], pitch: [1.1, 0.9], jitter: 1.5 }, { cue: 'shot_whoosh', vol: [0.2, 0.45], pitch: [0.9, 1.2], jitter: 1, delay: 0.03 }],
      flow: 15,
    },
    one_timer: {
      priority: 7, valence: 'good',
      hitStop: [3, 5], slowmo: { scale: [0.45, 0.3], in: 0.03, hold: [0.12, 0.22], out: 0.35 },
      trauma: [0.25, 0.4], fov: [2, 3.5], chroma: [0.5, 0.8], flash: [0, 0.12],
      particles: [{ kind: 'sparks', count: [14, 26], color: [WHITE, 0xbfe6ff], speed: [8, 14], up: 3, directional: true }],
      sounds: [{ cue: 'sting', vol: [0.3, 0.45], pitch: [1, 1.12] }],
      flow: 120,
    },
    post_hit: {
      priority: 5, valence: 'neutral',
      hitStop: [2, 4], trauma: [0.18, 0.32], punch: [0.02, 0.04],
      particles: [{ kind: 'sparks', count: [10, 20], color: [0xff7a5a, WHITE], speed: [6, 11], up: 5 }],
      sounds: [{ cue: 'post_ping', vol: [0.45, 0.7], pitch: [0.96, 1.04], jitter: 0.6 }, { cue: 'ooh', vol: [0.25, 0.45], delay: 0.08 }],
      popup: { text: 'Off the post', size: 'md' },
      flow: 25,
    },
    near_miss: {
      priority: 3, valence: 'neutral', cooldown: 0.4,
      trauma: [0.05, 0.12],
      sounds: [{ cue: 'ooh', vol: [0.2, 0.4] }],
      popup: { text: 'Just wide', minI: 0.35, size: 'sm' },
      flow: 10,
    },
    save_made: {
      priority: 4, valence: 'neutral',
      hitStop: [1, 3], trauma: [0.08, 0.25], punch: [0, 0.03],
      particles: [{ kind: 'burst', count: [10, 20], color: 0x9fd0ff, speed: [5, 9], up: 4 }, { kind: 'spray', count: [6, 14], color: ICE, speed: [6, 10], up: 3, directional: true }],
      sounds: [{ cue: 'save_thump', vol: [0.45, 0.75], pitch: [1.05, 0.9], jitter: 1 }],
      flow: 20,
    },
    // ------------------------------------------------------------------ hits
    check_landed: {
      priority: 6, valence: 'good',
      hitStop: [3, 8], slowmo: { scale: [0.6, 0.38], in: 0.02, hold: [0.04, 0.14], out: 0.25, minI: 0.6 },
      trauma: [0.3, 0.75], kick: [0.5, 1.6], punch: [0.04, 0.12], fov: [-0.6, -2.2], chroma: [0, 0.6], vignette: [0, 0.25], squash: [0.12, 0.24],
      particles: [{ kind: 'burst', count: [18, 40], color: WHITE, speed: [7, 12], up: 6, size: 0.18 },
        { kind: 'spray', count: [16, 40], color: ICE, speed: [12, 20], up: 4, directional: true },
        { kind: 'ring', count: [1, 1], color: WHITE, speed: [1.8, 3.4] }],
      sounds: [{ cue: 'hit_thud', vol: [0.7, 1], pitch: [1.15, 0.8], jitter: 1.5 }, { cue: 'hit_crack', vol: [0.35, 0.8], pitch: [1.1, 0.9], jitter: 2 }],
      flow: 110,
    },
    // variants picked by the system from tags (see system.ts `variant`)
    check_board: {   // pinned on the boards: heavier, deeper boom, glass rattle, the camera kicks toward the wall
      priority: 6, valence: 'good',
      hitStop: [4, 8], slowmo: { scale: [0.55, 0.35], in: 0.02, hold: [0.05, 0.16], out: 0.28, minI: 0.55 },
      trauma: [0.4, 0.85], kick: [0.8, 2], punch: [0.05, 0.13], fov: [-0.8, -2.4], chroma: [0, 0.5], vignette: [0.05, 0.3], squash: [0.18, 0.3],
      particles: [{ kind: 'burst', count: [20, 44], color: WHITE, speed: [6, 11], up: 7, size: 0.18 },
        { kind: 'spray', count: [10, 26], color: ICE, speed: [8, 14], up: 6, directional: true }],
      sounds: [{ cue: 'board_boom', vol: [0.8, 1], pitch: [1.1, 0.8], jitter: 1.5 }, { cue: 'glass_rattle', vol: [0.35, 0.7], jitter: 2, delay: 0.02 }, { cue: 'hit_thud', vol: [0.45, 0.7], pitch: [1, 0.85] }],
      popup: { text: 'Pinned', minI: 0.5, size: 'md' },
      flow: 130,
    },
    check_shove: {   // a standing check: a nudge, nothing more
      priority: 1, valence: 'neutral', meOnly: true,
      trauma: [0.03, 0.08], squash: [0.04, 0.08],
      particles: [{ kind: 'dust', count: [3, 8], color: ICE, speed: [2, 4], up: 1.5 }],
      sounds: [{ cue: 'shove', vol: [0.3, 0.5], jitter: 2 }],
    },
    check_poke: {
      priority: 2, valence: 'good',
      hitStop: [1, 2], trauma: [0.05, 0.1],
      particles: [{ kind: 'sparks', count: [6, 10], color: [WHITE, 0xffe9a8], speed: [4, 7], up: 2.5 }],
      sounds: [{ cue: 'stick_clack', vol: [0.6, 0.8], jitter: 1.5 }],
      flow: 40,
    },
    got_hit: {       // the other team flattened one of yours
      priority: 5, valence: 'bad',
      hitStop: [2, 4], trauma: [0.2, 0.45], kick: [0.3, 0.8], vignette: [0.15, 0.35], squash: [0.12, 0.2],
      particles: [{ kind: 'burst', count: [8, 18], color: WHITE, speed: [5, 9], up: 4, size: 0.14 }, { kind: 'spray', count: [8, 18], color: ICE, speed: [8, 14], up: 3, directional: true }],
      sounds: [{ cue: 'hit_thud', vol: [0.5, 0.75], pitch: [0.9, 0.75], jitter: 1 }],
      flow: -120,
    },
    // ------------------------------------------------------------------ moves
    spin_move: {
      priority: 2, valence: 'good', meOnly: true,
      trauma: [0.03, 0.06], fov: [0.4, 0.9],
      particles: [{ kind: 'spray', count: [8, 14], color: ICE, speed: [4, 7], up: 2 }],
      sounds: [{ cue: 'spin_swish', vol: [0.3, 0.45], jitter: 1 }],
      flow: 20,
    },
    beat_defender: {
      priority: 4, valence: 'good',
      hitStop: [1, 3], slowmo: { scale: [0.6, 0.45], in: 0.02, hold: [0.05, 0.12], out: 0.22, minI: 0.6 },
      trauma: [0.08, 0.15], fov: [1, 2], chroma: [0.2, 0.4],
      particles: [{ kind: 'sparks', count: [10, 18], color: 0x7fd8ff, speed: [5, 9], up: 3 }],
      sounds: [{ cue: 'sting', vol: [0.25, 0.4], pitch: [0.94, 1.06] }],
      popup: { text: 'Beat him', size: 'md' },
      flow: 90,
    },
    speed_burst: {
      priority: 1, valence: 'good', meOnly: true, cooldown: 1.2,
      fov: [1, 2.2], trauma: [0, 0.03],
      particles: [{ kind: 'spray', count: [6, 12], color: ICE, speed: [5, 9], up: 2.5, directional: true }],
      sounds: [{ cue: 'burst_scrape', vol: [0.22, 0.4], jitter: 1.5 }],
      flow: 5,
    },
    ability_used: {   // an ability going off: a crisp kick of ice and a scrape; the payoff (hit, goal) has its own event
      priority: 2, valence: 'good',
      fov: [0.6, 1.4], trauma: [0.02, 0.05],
      particles: [{ kind: 'spray', count: [8, 14], color: ICE, speed: [4, 8], up: 2.5, directional: true }],
      sounds: [{ cue: 'burst_scrape', vol: [0.3, 0.5], jitter: 2 }, { cue: 'stick_clack', vol: [0.1, 0.2], jitter: 1 }],
      flow: 10,
    },
    // ------------------------------------------------------------------ possession
    turnover_won: {
      priority: 3, valence: 'good',
      hitStop: [0, 2], trauma: [0.04, 0.1],
      particles: [{ kind: 'sparks', count: [4, 10], color: [WHITE, 0xbfe6ff], speed: [4, 7], up: 2 }],
      sounds: [{ cue: 'win_puck', vol: [0.3, 0.45], jitter: 0.5 }],
      flow: 35,
    },
    turnover_lost: {
      priority: 2, valence: 'bad', cooldown: 0.5,
      trauma: [0, 0.04],
      sounds: [{ cue: 'lose_puck', vol: [0.14, 0.22] }],
      flow: -60,
    },
    faceoff_won: {
      priority: 2, valence: 'good',
      hitStop: [0, 1], trauma: [0.03, 0.06],
      particles: [{ kind: 'dust', count: [4, 8], color: ICE, speed: [2, 4], up: 2 }],
      sounds: [{ cue: 'draw_click', vol: [0.35, 0.5], jitter: 1 }],
      flow: 25,
    },
    // ------------------------------------------------------------------ goals
    goal_scored: {   // the biggest payoff
      priority: 10, valence: 'good',
      hitStop: [6, 8], slowmo: { scale: [0.32, 0.22], in: 0.04, hold: [0.45, 0.7], out: 0.55 },
      trauma: [0.55, 0.85], kick: [1, 1.8], punch: [0.1, 0.16], fov: [-3, -5], flash: [0.22, 0.32], chroma: [0.8, 1], vignette: [0.15, 0.3],
      particles: [{ kind: 'burst', count: [30, 50], color: WHITE, speed: [8, 13], up: 7, size: 0.18, h: 0.6 },
        { kind: 'confetti', count: [80, 120], color: CONFETTI, speed: [7, 12], up: 10, size: 0.3, h: 3 },
        { kind: 'sparks', count: [16, 30], color: [GOLD, WHITE], speed: [9, 15], up: 6 },
        { kind: 'ring', count: [1, 1], color: GOLD, speed: [3, 5] }],
      sounds: [{ cue: 'goal_horn', vol: [0.8, 1] }, { cue: 'crowd_roar', vol: [0.55, 0.85], delay: 0.04 }, { cue: 'hit_thud', vol: [0.7, 0.9], pitch: [0.8, 0.7] }],
      flow: 260,
    },
    goal_conceded: { // short and flat: a groan, a dim, done
      priority: 8, valence: 'bad',
      hitStop: [2, 3], trauma: [0.12, 0.2], vignette: [0.25, 0.35],
      particles: [{ kind: 'burst', count: [8, 14], color: 0x9aa3b0, speed: [4, 7], up: 3, h: 0.6 }],
      sounds: [{ cue: 'crowd_groan', vol: [0.35, 0.5] }],
      flow: -260,
    },
    // ------------------------------------------------------------------ meta (from existing sim events)
    heat_fire: {     // Heat full: the team is on fire
      priority: 7, valence: 'good',
      hitStop: [3, 3], trauma: [0.3, 0.3], flash: [0.18, 0.18], chroma: [0.6, 0.6], fov: [2, 2],
      particles: [{ kind: 'sparks', count: [30, 30], color: [ACCENT, GOLD, WHITE], speed: [8, 12], up: 7 }],
      sounds: [{ cue: 'sting', vol: [0.45, 0.45], pitch: [0.8, 0.8] }],
      flow: 150,
    },
    slam: {          // any skater driven into the boards at speed
      priority: 2, valence: 'neutral',
      trauma: [0.06, 0.16], kick: [0.1, 0.3],
      particles: [{ kind: 'burst', count: [6, 14], color: WHITE, speed: [4, 6], up: 4 }],
      sounds: [{ cue: 'board_boom', vol: [0.25, 0.45], pitch: [1.2, 1], jitter: 2 }, { cue: 'glass_rattle', vol: [0.1, 0.25], jitter: 2 }],
    },
  } satisfies Record<string, FxSpec>,
};

export type FxKey = keyof typeof FEEDBACK.events;
