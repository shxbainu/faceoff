// DOM side of the feedback layer: popups, pass streak meter, flow rank, screen flash and vignette layers,
// the goal card, the feel settings panel and the debug panel. Styles live in index.html (HUD tokens).
// Everything is pooled or created once; per-frame writes only happen when a value changes.

import { feel } from './settings';

const el = (tag: string, id: string, cls = '', html = '') => {
  const e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; e.innerHTML = html; return e;
};

export class FxHud {
  private root = document.getElementById('hud')!;
  private pops = document.getElementById('pops')!;
  private popPool: { e: HTMLElement; text: string; t: number; pri: number }[] = [];
  private flashEl = el('div', 'fxflash');
  private vigEl = el('div', 'fxvig');
  private flowEl = el('div', 'flow', 'panel', '<div class="row"><span class="lbl">Flow</span><span id="rank">D</span></div><div id="flowbar"><i></i></div>'
    + '<div id="streak"><span class="lbl">Pass streak</span><b id="streakn">x0</b><span id="pips"></span></div>');
  private goalEl = el('div', 'goalcard', '', '<b></b><small></small><kbd>J</kbd><span class="hint">to skip</span>');
  private feelEl = el('div', 'feel', 'panel');
  private dbgEl = el('div', 'fxdbg', 'panel');
  private last = { flash: -1, vig: -1, rank: '', bar: -1, streak: -1 };
  private streakFade = 0;

  constructor() {
    this.root.prepend(this.vigEl, this.flashEl);
    this.root.append(this.flowEl, this.goalEl, this.feelEl, this.dbgEl);
  }

  // ------------------------------------------------------------ popups
  /** a floating text popup at a screen point. size: sm | md | lg; k scales the punch-in (intensity) */
  popup(text: string, sx: number, sy: number, size: 'sm' | 'md' | 'lg', k = 1, pri = 1, max = 7) {
    const now = performance.now() / 1000;
    // the same label again within a moment: bump the one already up instead of stacking another
    const same = this.popPool.find(p => p.text === text && now - p.t < 0.6 && p.e.isConnected);
    if (same) { this.retrigger(same.e); same.t = now; return; }
    let slot = this.popPool.find(p => !p.e.isConnected);
    if (!slot) {
      if (this.popPool.length < max) { slot = { e: el('div', '', 'pop'), text: '', t: 0, pri: 0 }; this.popPool.push(slot); }
      else {   // full: replace the least important, oldest one (never a bigger one than this)
        const cand = this.popPool.filter(p => p.pri <= pri).sort((a, b) => a.pri - b.pri || a.t - b.t)[0];
        if (!cand) return;
        slot = cand;
      }
    }
    slot.text = text; slot.t = now; slot.pri = pri;
    const e = slot.e;
    e.textContent = text;
    e.className = 'pop ' + size;
    e.style.setProperty('--k', String(Math.max(0.6, Math.min(1.6, k))));
    // keep clear of popups already up near this spot: step up one line per neighbour
    const near = this.popPool.filter(p => p !== slot && p.e.isConnected && now - p.t < 0.7
      && Math.abs(parseFloat(p.e.style.left) - sx) < 160 && Math.abs(parseFloat(p.e.style.top) - sy) < 90).length;
    e.style.left = Math.max(90, Math.min(window.innerWidth - 90, sx)) + 'px';
    e.style.top = Math.max(70 + near * 30, sy - near * 30) + 'px';
    this.pops.appendChild(e);
    this.retrigger(e);
    clearTimeout((e as any)._t);
    (e as any)._t = setTimeout(() => e.remove(), size === 'lg' ? 1300 : 1000);
  }
  private retrigger(e: HTMLElement) { e.style.animation = 'none'; void e.offsetWidth; e.style.animation = ''; }

  // ------------------------------------------------------------ screen layers
  layers(flash: number, vignette: number) {
    const f = Math.round(flash * 100) / 100, v = Math.round(vignette * 100) / 100;
    if (f !== this.last.flash) { this.last.flash = f; this.flashEl.style.opacity = String(f); }
    if (v !== this.last.vig) { this.last.vig = v; this.vigEl.style.opacity = String(v); }
  }

  // ------------------------------------------------------------ flow rank and streak
  flow(rank: string, frac: number, hot: boolean, rankUp: boolean, show: boolean) {
    this.flowEl.style.display = show ? '' : 'none';
    if (rank !== this.last.rank) {
      this.last.rank = rank;
      const r = document.getElementById('rank')!;
      r.textContent = rank;
      this.flowEl.classList.toggle('hot', hot);
      if (rankUp) { r.classList.remove('up'); void r.offsetWidth; r.classList.add('up'); }
    }
    const b = Math.round(frac * 100);
    if (b !== this.last.bar) { this.last.bar = b; (this.flowEl.querySelector('#flowbar i') as HTMLElement).style.width = b + '%'; }
  }

  /** state: up (a pass added), cashed (it ended in a shot), broken (lost), hide */
  streak(n: number, state: 'up' | 'cashed' | 'broken' | 'hide') {
    const row = document.getElementById('streak')!, num = document.getElementById('streakn')!, pips = document.getElementById('pips')!;
    if (state === 'hide') { row.className = ''; this.last.streak = -1; return; }
    num.textContent = state === 'cashed' ? `x${n} cashed` : state === 'broken' ? 'Broken' : `x${n}`;
    pips.innerHTML = '<i></i>'.repeat(Math.min(8, n));
    row.className = 'on ' + state;
    void row.offsetWidth; row.classList.add('kick');
    this.last.streak = n;
    this.streakFade = state === 'up' ? 0 : 1.1;
  }
  tick(rdt: number) {
    if (this.streakFade > 0) { this.streakFade -= rdt; if (this.streakFade <= 0) this.streak(0, 'hide'); }
  }

  // ------------------------------------------------------------ goal card
  goalCard(title: string, sub: string, skippable: boolean) {
    const g = this.goalEl;
    (g.querySelector('b') as HTMLElement).textContent = title;
    (g.querySelector('small') as HTMLElement).textContent = sub;
    g.classList.toggle('skip', skippable);
    g.classList.remove('on'); void g.offsetWidth; g.classList.add('on');
  }
  hideGoal() { this.goalEl.classList.remove('on'); }

  // ------------------------------------------------------------ feel settings panel
  feelRows = ['Intensity', 'Screen shake and camera kicks', 'Flashes', 'Hit stop and slow motion', 'Chromatic and vignette pulses', 'Reset to defaults'];
  feelSel = 0;
  get feelOpen() { return this.feelEl.classList.contains('on'); }
  showFeel(on: boolean) { this.feelEl.classList.toggle('on', on); if (on) this.drawFeel(); }
  drawFeel() {
    const v = [`${Math.round(feel.intensity * 100)}%`, feel.shake ? 'On' : 'Off', feel.flashes ? 'On' : 'Off', feel.slowmo ? 'On' : 'Off', feel.chroma ? 'On' : 'Off', ''];
    this.feelEl.innerHTML = `<h3>Feel</h3>` + this.feelRows.map((r, i) =>
      `<div class="fr${i === this.feelSel ? ' sel' : ''}"><span>${r}</span><b>${i === 0 ? `<span class="bar"><i style="width:${(feel.intensity / 1.5) * 100}%"></i></span>` : ''}${v[i]}</b></div>`).join('')
      + `<p><kbd>W</kbd> <kbd>S</kbd> choose · <kbd>A</kbd> <kbd>D</kbd> change · <kbd>P</kbd> close</p>`;
  }

  // ------------------------------------------------------------ debug panel
  get dbgOpen() { return this.dbgEl.classList.contains('on'); }
  showDbg(on: boolean) { this.dbgEl.classList.toggle('on', on); }
  drawDbg(keys: [string, string][], level: string, readout: string) {
    this.dbgEl.innerHTML = `<h3>Feedback debug · intensity <b>${level}</b></h3>`
      + `<div class="dk">${keys.map(([k, n]) => `<span><kbd>${k}</kbd> ${n}</span>`).join('')}</div>`
      + `<p><kbd>,</kbd> low <kbd>.</kbd> medium <kbd>/</kbd> high · <kbd>\\</kbd> fire all at 3 levels · <kbd>\`</kbd> close</p><pre>${readout}</pre>`;
  }
}
