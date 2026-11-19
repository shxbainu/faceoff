// Player-facing feel settings: one intensity slider and four toggles, saved in localStorage.
// URL overrides for tests: ?fx=0.5 (intensity), ?noshake ?noflash ?noslowmo ?nochroma.

export interface FeelSettings {
  intensity: number;   // 0 .. 1.5 multiplier on every visual effect (audio is not scaled)
  shake: boolean;
  flashes: boolean;
  slowmo: boolean;     // hit stop and slow motion
  chroma: boolean;     // chromatic aberration and vignette pulses
}

const KEY = 'faceoff.feel';
export const FEEL_DEFAULTS: FeelSettings = { intensity: 1, shake: true, flashes: true, slowmo: true, chroma: true };

function load(): FeelSettings {
  let s: FeelSettings = { ...FEEL_DEFAULTS };
  try { const raw = localStorage.getItem(KEY); if (raw) s = { ...s, ...JSON.parse(raw) }; } catch { /* private window */ }
  const q = new URLSearchParams(location.search);
  if (q.has('fx')) s.intensity = Math.max(0, Math.min(1.5, Number(q.get('fx')) || 0));
  if (q.has('noshake')) s.shake = false;
  if (q.has('noflash')) s.flashes = false;
  if (q.has('noslowmo')) s.slowmo = false;
  if (q.has('nochroma')) s.chroma = false;
  s.intensity = Math.max(0, Math.min(1.5, Number(s.intensity) || 0));
  return s;
}

export const feel: FeelSettings = load();

export function saveFeel() {
  try { localStorage.setItem(KEY, JSON.stringify(feel)); } catch { /* keep it for this session */ }
}

export function setFeel(p: Partial<FeelSettings>) {
  Object.assign(feel, p);
  feel.intensity = Math.max(0, Math.min(1.5, Math.round(feel.intensity * 10) / 10));
  saveFeel();
}
