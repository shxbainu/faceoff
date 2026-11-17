// All sound is synthesised: no audio files.
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export function unlock() {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain(); master.gain.value = 0.35; master.connect(ctx.destination);
    } catch { ctx = null; }
  }
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

function osc(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, freq: number, q = 1) {
  if (!ctx || !master) return;
  const n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q; g.gain.value = vol;
  s.connect(f); f.connect(g); g.connect(master); s.start();
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
  board(v: number) { noise(0.06, Math.min(0.5, v / 50), 300, 1); },
  whistle() { osc('square', 2300, 2500, 0.18, 0.12); osc('square', 2500, 2350, 0.25, 0.12, 0.05); },
  drop() { osc('sine', 900, 500, 0.07, 0.4); },
  horn() { for (const f of [146, 185, 220]) { osc('sawtooth', f, f, 1.3, 0.28); } },
  fire() { osc('sawtooth', 200, 900, 0.6, 0.3); noise(0.6, 0.5, 1200, 0.5); },
  pick() { osc('triangle', 660, 660, 0.1, 0.4); osc('triangle', 990, 990, 0.2, 0.4, 0.09); },
  warn() { osc('square', 440, 440, 0.08, 0.15); osc('square', 440, 440, 0.08, 0.15, 0.15); },
  buzzer() { osc('sawtooth', 110, 105, 0.9, 0.4); },
  lose() { osc('triangle', 330, 110, 0.7, 0.4); },
};

/** Named sound hooks for gameplay events: audio.play('heavy_hit'), audio.play('stick_clack'), ...
 *  All synthesised like the rest; game code asks for a sound by name and never touches the synth. */
export type SoundName = 'heavy_hit' | 'hit' | 'stick_clack' | 'stick_whiff' | 'stick_drop' | 'stick_pickup' | 'body_thud';
const clack = (vol: number, delay = 0, pitch = 1) => {   // wood on wood: a sharp band of noise and a falling click
  if (!ctx) return;
  setTimeout(() => { noise(0.035, vol, 3200 * pitch, 6); osc('triangle', 1500 * pitch, 900 * pitch, 0.045, vol * 0.5); }, delay * 1000);
};
export const audio = {
  play(name: SoundName) {
    switch (name) {
      case 'heavy_hit': sfx.hit(true); osc('sine', 48, 24, 0.5, 0.9, 0.03); noise(0.12, 0.7, 180, 0.6); break;   // extra low crunch
      case 'hit': sfx.hit(false); break;
      case 'body_thud': osc('sine', 110, 45, 0.16, 0.6); noise(0.08, 0.4, 400, 0.8); break;
      case 'stick_clack': clack(0.8); clack(0.45, 0.04, 1.15); break;
      case 'stick_whiff': noise(0.09, 0.25, 1800, 1.2); break;
      case 'stick_drop': clack(0.6, 0.0, 0.9); clack(0.45, 0.09, 1.05); clack(0.3, 0.2, 0.95); clack(0.18, 0.33, 1.1); break;   // clatters as it bounces
      case 'stick_pickup': clack(0.35, 0, 1.3); osc('triangle', 660, 990, 0.12, 0.25, 0.03); break;
    }
  },
};
