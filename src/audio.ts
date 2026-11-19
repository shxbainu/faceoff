// All sound is synthesised: no audio files (placeholders until recorded sounds replace them; see PLAN.md).
// Voices are pooled: a hard cap on sounds playing at once, and one shared noise buffer instead of a new buffer
// per sound. Every voice takes a pitch multiplier so the feedback system can randomise and climb pitch.
import type { Cue } from './feedback/config';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let voices = 0;
let voiceCap = 26;
export const audioStats = { voices: 0, dropped: 0, played: 0 };

export function unlock() {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain(); master.gain.value = 0.35; master.connect(ctx.destination);
      // one 2 s buffer of white noise, played from a random offset by every noise voice
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch { ctx = null; }
  }
  if (ctx && ctx.state === 'suspended') ctx.resume();
}
export function setVoiceCap(n: number) { voiceCap = n; }

/** true if there is room for another voice (low-priority sounds give way first) */
function room(pri: number) {
  if (!ctx || !master) return false;
  const limit = pri >= 2 ? voiceCap + 6 : pri >= 1 ? voiceCap : voiceCap - 6;
  if (voices >= limit) { audioStats.dropped++; return false; }
  return true;
}
function track(node: AudioScheduledSourceNode) {
  voices++; audioStats.voices = voices; audioStats.played++;
  node.onended = () => { voices--; audioStats.voices = voices; };
}

function osc(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0, pitch = 1, pri = 1) {
  if (!room(pri)) return;
  const c = ctx!, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f0 * pitch, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * pitch), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master!); o.start(t); o.stop(t + dur + 0.02); track(o);
}

/** filtered noise: `attack` > 0 swells in (crowd), otherwise it starts hard and decays */
function noise(dur: number, vol: number, freq: number, q = 1, delay = 0, pitch = 1, opts: { type?: BiquadFilterType; attack?: number; sweep?: number; pri?: number } = {}) {
  if (!room(opts.pri ?? 1) || !noiseBuf) return;
  const c = ctx!, t = c.currentTime + delay;
  const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = noiseBuf; s.playbackRate.value = pitch;
  f.type = opts.type ?? 'bandpass'; f.frequency.setValueAtTime(freq * pitch, t); f.Q.value = q;
  if (opts.sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * pitch * opts.sweep), t + dur);
  const a = opts.attack ?? 0;
  if (a > 0) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + a); }
  else g.gain.setValueAtTime(vol, t);
  g.gain.linearRampToValueAtTime(0, t + dur);
  s.connect(f); f.connect(g); g.connect(master!);
  s.start(t, Math.random() * 1.2, dur + 0.05); s.stop(t + dur + 0.05); track(s);
}

const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
export const sfx = {
  tone(n: number) { const st = SCALE[Math.min(n, SCALE.length - 1)]; const f = 523 * Math.pow(2, st / 12); osc('triangle', f, f, 0.16, 0.5); osc('sine', f * 2, f * 2, 0.1, 0.2, 0.03); },
  pass() { noise(0.05, 0.5, 2500, 2); },
  recv() { noise(0.04, 0.4, 1600, 3); },
  shot(big: boolean) { noise(0.12, big ? 1 : 0.6, big ? 900 : 1400, 1); osc('square', big ? 220 : 180, 60, 0.08, 0.25); },
  hit(big: boolean) {
    osc('sine', big ? 170 : 130, 30, big ? 0.45 : 0.2, 1);
    noise(big ? 0.3 : 0.12, big ? 1 : 0.6, 500, 0.7);
    if (big) { osc('square', 90, 40, 0.12, 0.5); noise(0.09, 0.9, 2600, 1.5); noise(0.7, 0.35, 900, 0.4); osc('sine', 60, 28, 0.6, 0.8, 0.02); }
  },
  cool() { osc('triangle', 392, 196, 0.35, 0.4); },
  slam() { osc('sine', 95, 40, 0.2, 0.7); noise(0.15, 0.6, 250, 0.8); },
  save() { osc('triangle', 700, 300, 0.09, 0.4); noise(0.06, 0.4, 3000, 2); },
  post() { osc('sine', 1800, 1750, 0.35, 0.5); },
  board(v: number) { noise(0.06, Math.min(0.5, v / 50), 300, 1, 0, 1, { pri: 0 }); },
  whistle() { osc('square', 2300, 2500, 0.18, 0.12, 0, 1, 2); osc('square', 2500, 2350, 0.25, 0.12, 0.05, 1, 2); },
  drop() { osc('sine', 900, 500, 0.07, 0.4, 0, 1, 2); },
  horn() { for (const f of [146, 185, 220]) { osc('sawtooth', f, f, 1.3, 0.28, 0, 1, 2); } },
  fire() { osc('sawtooth', 200, 900, 0.6, 0.3); noise(0.6, 0.5, 1200, 0.5); },
  pick() { osc('triangle', 660, 660, 0.1, 0.4, 0, 1, 2); osc('triangle', 990, 990, 0.2, 0.4, 0.09, 1, 2); },
  warn() { osc('square', 440, 440, 0.08, 0.15, 0, 1, 2); osc('square', 440, 440, 0.08, 0.15, 0.15, 1, 2); },
  buzzer() { osc('sawtooth', 110, 105, 0.9, 0.4, 0, 1, 2); },
  lose() { osc('triangle', 330, 110, 0.7, 0.4, 0, 1, 2); },
};

/** Named sound hooks for gameplay events: audio.play('heavy_hit'), audio.play('stick_clack'), ...
 *  All synthesised like the rest; game code asks for a sound by name and never touches the synth. */
export type SoundName = 'heavy_hit' | 'hit' | 'stick_clack' | 'stick_whiff' | 'stick_drop' | 'stick_pickup' | 'body_thud';
const clack = (vol: number, delay = 0, pitch = 1) => {   // wood on wood: a sharp band of noise and a falling click
  noise(0.035, vol, 3200 * pitch, 6, delay); osc('triangle', 1500 * pitch, 900 * pitch, 0.045, vol * 0.5, delay);
};
export const audio = {
  play(name: SoundName) {
    switch (name) {
      case 'heavy_hit': sfx.hit(true); osc('sine', 48, 24, 0.5, 0.9, 0.03); noise(0.12, 0.7, 180, 0.6); break;   // extra low crunch
      case 'hit': sfx.hit(false); break;
      case 'body_thud': osc('sine', 110, 45, 0.16, 0.6); noise(0.08, 0.4, 400, 0.8); break;
      case 'stick_clack': clack(0.8); clack(0.45, 0.04, 1.15); break;
      case 'stick_whiff': noise(0.09, 0.25, 1800, 1.2, 0, 1, { pri: 0 }); break;
      case 'stick_drop': clack(0.6, 0.0, 0.9); clack(0.45, 0.09, 1.05); clack(0.3, 0.2, 0.95); clack(0.18, 0.33, 1.1); break;   // clatters as it bounces
      case 'stick_pickup': clack(0.35, 0, 1.3); osc('triangle', 660, 990, 0.12, 0.25, 0.03); break;
    }
  },
};

/** Layered cues for the feedback system (src/feedback/config.ts). vol 0..1, pitch is a multiplier. */
export function cue(name: Cue, vol: number, pitch = 1, delay = 0, pri = 1) {
  if (!ctx) return;
  const v = vol, p = pitch, d = delay;
  switch (name) {
    case 'pass_snap': noise(0.03, 0.7 * v, 4200, 3, d, p); osc('triangle', 1900, 1100, 0.03, 0.25 * v, d, p); break;
    case 'catch': {   // the streak note: a clean triangle tick plus a soft tape thump
      osc('triangle', 660, 660, 0.12, 0.42 * v, d, p, pri); osc('sine', 1320, 1320, 0.07, 0.14 * v, d + 0.012, p, pri);
      noise(0.04, 0.35 * v, 1400, 2.5, d, 1); break;
    }
    case 'streak_break': osc('triangle', 520, 300, 0.16, 0.35 * v, d, p, 0); osc('triangle', 400, 230, 0.18, 0.25 * v, d + 0.08, p, 0); break;
    case 'shot_crack': noise(0.06, 1.0 * v, 2400, 1.2, d, p); osc('square', 240, 60, 0.07, 0.3 * v, d, p); osc('sine', 130, 40, 0.12, 0.5 * v, d, p); break;
    case 'shot_whoosh': noise(0.26, 0.6 * v, 3200, 1.4, d, p, { attack: 0.03, sweep: 0.3 }); break;
    case 'post_ping': osc('sine', 1800, 1760, 0.6, 0.55 * v, d, p, 2); osc('sine', 2730, 2700, 0.35, 0.2 * v, d, p, 2); noise(0.03, 0.6 * v, 5000, 4, d, p); break;
    case 'ooh': noise(0.55, 0.45 * v, 520, 3.2, d, p, { attack: 0.16, sweep: 1.35, type: 'bandpass', pri: 0 }); noise(0.5, 0.2 * v, 900, 2, d + 0.03, p, { attack: 0.18, sweep: 1.25, pri: 0 }); break;
    case 'save_thump': osc('sine', 180, 60, 0.12, 0.7 * v, d, p); noise(0.08, 0.6 * v, 900, 1, d, p); noise(0.05, 0.3 * v, 3000, 2, d, p); break;
    case 'glove_pop': noise(0.05, 0.8 * v, 1500, 2, d, p); osc('sine', 300, 120, 0.06, 0.5 * v, d, p); break;
    case 'hit_thud': osc('sine', 150, 32, 0.32, 1.0 * v, d, p, 2); noise(0.18, 0.8 * v, 420, 0.7, d, p); osc('sine', 62, 26, 0.45, 0.7 * v, d + 0.015, p); break;
    case 'hit_crack': noise(0.07, 0.9 * v, 2700, 1.4, d, p); osc('square', 110, 45, 0.09, 0.35 * v, d, p); break;
    case 'board_boom': osc('sine', 80, 28, 0.6, 1.0 * v, d, p, 2); noise(0.35, 0.8 * v, 180, 0.6, d, p); noise(0.12, 0.6 * v, 900, 0.8, d, p); break;
    case 'glass_rattle': for (let k = 0; k < 4; k++) noise(0.05, (0.5 - k * 0.1) * v, 2200 + k * 400, 4, d + k * 0.045, p * (0.95 + Math.random() * 0.1), { pri: 0 }); break;
    case 'shove': osc('sine', 120, 60, 0.1, 0.5 * v, d, p, 0); noise(0.06, 0.35 * v, 500, 1, d, p, { pri: 0 }); break;
    case 'goal_horn': for (const f of [146, 185, 220]) osc('sawtooth', f, f, 1.5, 0.27 * v, d, p, 2); osc('sine', 73, 73, 1.5, 0.25 * v, d, p, 2); break;
    case 'crowd_roar': noise(2.4, 0.55 * v, 700, 0.5, d, p, { type: 'lowpass', attack: 0.3, pri: 2 }); noise(2.0, 0.3 * v, 1600, 0.8, d + 0.1, p, { attack: 0.35, pri: 2 }); break;
    case 'crowd_groan': noise(0.7, 0.4 * v, 380, 1.6, d, p, { attack: 0.1, sweep: 0.6, pri: 2 }); break;
    case 'spin_swish': noise(0.22, 0.45 * v, 2600, 1.4, d, p, { attack: 0.05, sweep: 0.5 }); break;
    case 'burst_scrape': noise(0.2, 0.5 * v, 5200, 1.2, d, p, { attack: 0.02, sweep: 0.6, pri: 0 }); break;
    case 'rank_up': osc('triangle', 784, 784, 0.1, 0.32 * v, d, p, 2); osc('triangle', 1175, 1175, 0.16, 0.3 * v, d + 0.07, p, 2); break;
    case 'lose_puck': osc('triangle', 300, 220, 0.12, 0.3 * v, d, p, 0); break;
    case 'win_puck': clack(0.45 * v, d, p); osc('triangle', 880, 1100, 0.08, 0.2 * v, d + 0.02, p); break;
    case 'stick_clack': clack(0.8 * v, d, p); clack(0.45 * v, d + 0.04, p * 1.15); break;
    case 'draw_click': clack(0.6 * v, d, p * 1.2); break;
    case 'sting': osc('sawtooth', 440, 880, 0.18, 0.18 * v, d, p, 2); osc('triangle', 880, 1760, 0.22, 0.25 * v, d + 0.02, p, 2); noise(0.18, 0.3 * v, 6000, 1, d, p, { attack: 0.02 }); break;
  }
}

/** a held tone for the slapshot wind-up: rises with the wind, its own voice outside the pool */
let hum: { o: OscillatorNode; o2: OscillatorNode; g: GainNode } | null = null;
export function humSet(level: number, pitch: number) {
  if (!ctx || !master) return;
  if (level <= 0.001) { humStop(); return; }
  if (!hum) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sawtooth'; o2.type = 'sine'; g.gain.value = 0;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    o.connect(f); o2.connect(g); f.connect(g); g.connect(master); o.start(); o2.start();
    hum = { o, o2, g };
  }
  const t = ctx.currentTime;
  hum.o.frequency.setTargetAtTime(90 * pitch, t, 0.03); hum.o2.frequency.setTargetAtTime(180 * pitch, t, 0.03);
  hum.g.gain.setTargetAtTime(level, t, 0.04);
}
export function humStop() {
  if (!hum || !ctx) return;
  const h = hum; hum = null;
  h.g.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
  h.o.stop(ctx.currentTime + 0.2); h.o2.stop(ctx.currentTime + 0.2);
}
