import { Game, Ctl, PowerId, POWERS, HOME, OPPONENTS, ROUND_ORDER, RUN_ROUNDS, TeamDef, WIN_GOALS, Ev, setTeamSize } from './sim';
import { View } from './render';
import { sfx, unlock } from './audio';
import '@fontsource/archivo/latin-500.css';
import '@fontsource/archivo/latin-800.css';

const $ = (id: string) => document.getElementById(id)!;
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const params = new URLSearchParams(location.search);

type Mode = 'title' | 'intro' | 'match' | 'end' | 'pick';
let mode: Mode = 'title';
let modeT = 0;
let round = 1;
let powers = emptyPowers();
let runStyle = 0;
let game: Game;
let opp: TeamDef;
let cards: PowerId[] = [];
let champion = false;
let overT = 0;

function emptyPowers(): Record<PowerId, number> {
  const p = {} as Record<PowerId, number>;
  for (const d of POWERS) p[d.id] = 0;
  return p;
}

// ---------------------------------------------------------------- input
const keys = new Set<string>();
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyJ', 'KeyK', 'KeyL', 'KeyI', 'KeyU', 'KeyO', 'KeyQ', 'KeyH',
  'ShiftLeft', 'ShiftRight', 'Space', 'Enter', 'Digit1', 'Digit2', 'Digit3', 'KeyR', 'KeyC']);

// Two control schemes. Advanced: one key per move (pass, saucer, wrist, slapshot, body check, poke).
// Simple: three keys. J pass, K shoot (tap for a wrist shot, hold for a slapshot), L check (poke when
// the puck is within reach, body check otherwise). C on the title screen switches; the choice is saved.
type Scheme = 'simple' | 'advanced';
const SCHEME_KEY = 'faceoff.controls';
let scheme: Scheme = (() => {
  const q = new URLSearchParams(location.search).get('controls');
  if (q === 'simple' || q === 'advanced') return q;
  try { return localStorage.getItem(SCHEME_KEY) === 'simple' ? 'simple' : 'advanced'; } catch { return 'advanced'; }
})();
const TAP = 0.18;            // simple scheme: a shoot press shorter than this is a wrist shot
let shootDownAt = -1, wristQueued = false;
window.addEventListener('keydown', e => {
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  if (e.repeat) return;
  unlock();
  keys.add(e.code);
  onPress(e.code);
});
window.addEventListener('keyup', e => {
  keys.delete(e.code);
  if (e.code === 'KeyK' && scheme === 'simple' && shootDownAt >= 0) {
    if (performance.now() / 1000 - shootDownAt < TAP) wristQueued = true;   // quick tap: wrist shot
    shootDownAt = -1;
  }
});
window.addEventListener('blur', () => keys.clear());

function ctl(): Ctl {
  const k = (...c: string[]) => c.some(x => keys.has(x));
  if (scheme === 'simple') {
    const now = performance.now() / 1000;
    if (keys.has('KeyK') && shootDownAt < 0) shootDownAt = now;
    const held = shootDownAt >= 0 ? now - shootDownAt : 0;
    const wrist = wristQueued; wristQueued = false;
    // check key: poke when the stick can reach the puck, shoulder check otherwise
    const h = game?.ctrl, p = game?.pucks[0];
    const near = !!(h && p && Math.hypot(p.x - h.x, p.y - h.y) < 1.8);
    return {
      mx: (k('KeyW', 'ArrowUp') ? 1 : 0) - (k('KeyS', 'ArrowDown') ? 1 : 0),
      my: (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0),
      pass: k('KeyJ', 'Space'), saucer: false, wrist, shoot: held >= TAP,
      check: k('KeyL') && !near, poke: k('KeyL') && near,
      burst: k('ShiftLeft', 'ShiftRight'), swap: k('KeyQ'),
    };
  }
  return {
    // the camera looks up-ice (+x), so screen up is +x and screen right is +y
    mx: (k('KeyW', 'ArrowUp') ? 1 : 0) - (k('KeyS', 'ArrowDown') ? 1 : 0),
    my: (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0),
    pass: k('KeyJ', 'Space'), saucer: k('KeyK'), wrist: k('KeyL'), shoot: k('KeyI'), check: k('KeyH'), poke: k('KeyU'),
    burst: k('ShiftLeft', 'ShiftRight'), swap: k('KeyQ'),
  };
}

function onPress(code: string) {
  const go = code === 'Enter' || code === 'Space' || code === 'KeyJ';
  if (code === 'KeyR' && mode !== 'title') { startRun(); return; }
  if (code === 'KeyC' && mode === 'title') {
    scheme = scheme === 'simple' ? 'advanced' : 'simple';
    try { localStorage.setItem(SCHEME_KEY, scheme); } catch { /* private window: keep it for this session */ }
    showTitle(); return;
  }
  if (mode === 'title' && go) startRun();
  else if (mode === 'intro' && go && modeT > 0.3) beginMatch();
  else if (mode === 'end' && go && modeT > 0.5) {
    if (game.winner === 0 && round < RUN_ROUNDS) showPick();
    else if (game.winner === 0) { champion = true; showTitle(); }
    else startRun();
  } else if (mode === 'pick' && modeT > 0.25) {
    const i = ['Digit1', 'Digit2', 'Digit3'].indexOf(code);
    if (i >= 0 && cards[i]) { powers[cards[i]]++; sfx.pick(); round++; startRound(); }
  }
}

const ICON: Record<PowerId, string> = {
  curve: '<path d="M4 19C4 9 13 6 18 10"/><path d="M19 4v7l-7-1"/>',
  shock: '<circle cx="12" cy="12" r="3" fill="currentColor"/><circle cx="12" cy="12" r="8"/>',
  split: '<path d="M3 12h7l9-7M10 12l9 7"/>',
  burner: '<path d="M5 5l7 7-7 7M12 5l7 7-7 7"/>',
  magnet: '<path d="M6 4v9a6 6 0 0 0 12 0V4"/><path d="M3 8h6M15 8h6"/>',
  slapper: '<ellipse cx="13" cy="15" rx="7" ry="4" fill="currentColor"/><path d="M3 6h7M2 10h5"/>',
  hot: '<path d="M12 3c4 5 6 8 6 12a6 6 0 0 1-12 0c0-3 2-4 3-7 1 2 2 2 3-5z"/>',
  wall: '<path d="M4 6h16v12H4zM4 12h16M12 6v6M8 12v6M16 12v6"/>',
};
const icon = (id: PowerId) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${ICON[id]}</svg>`;

// ---------------------------------------------------------------- flow
const view = new View();
const overlay = $('overlay');

function showOverlay(html: string) { overlay.innerHTML = html; overlay.classList.add('on'); }
function hideOverlay() { overlay.classList.remove('on'); }

function showTitle() {
  mode = 'title'; modeT = 0;
  showOverlay(`<div>
    ${champion ? '<div class="tag">Run complete · champions</div>' : ''}
    <h1>Faceoff</h1>
    <p>5-on-5 arcade hockey. First to ${WIN_GOALS} goals. Win a round, stack a power, face a team that bends the rules.</p>
    ${controlsHelp()}
    <div class="go">Press Enter to drop the puck</div></div>`);
}

function controlsHelp() {
  const skate = '<span><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd></span><span>Skate</span>'
    + '<span><kbd>Shift</kbd></span><span>Sprint (hold) · drains the sprint bar under you; empty it and you are winded until it refills</span>';
  const swap = '<span><kbd>Q</kbd></span><span>Switch to the skater nearest the puck</span>';
  const rows = scheme === 'simple' ? `
      <span><kbd>J</kbd> / <kbd>Space</kbd></span><span>Pass · tap without the puck to call for it · tap on the faceoff drop</span>
      <span><kbd>K</kbd></span><span>Shoot · tap for a quick wrist shot, hold to wind up a slapshot</span>
      <span><kbd>L</kbd></span><span>Check · pokes when the puck is in reach, body checks otherwise · with the puck: spin move</span>` : `
      <span><kbd>J</kbd> / <kbd>Space</kbd></span><span>Pass · tap without the puck to call for it · tap on the faceoff drop</span>
      <span><kbd>K</kbd></span><span>Saucer pass · lifted over sticks</span>
      <span><kbd>L</kbd></span><span>Wrist shot · quick release</span>
      <span><kbd>I</kbd></span><span>Slapshot · hold to wind up, release · hold before a pass lands for a one-timer</span>
      <span><kbd>H</kbd></span><span>Body check · needs speed · with the puck: spin move</span>
      <span><kbd>U</kbd></span><span>Poke check · reach the puck with your stick</span>`;
  return `<div class="tag">Controls: ${scheme === 'simple' ? 'Simple' : 'Advanced'} · press <kbd>C</kbd> to switch</div>
    <div class="keys">${skate}${rows}${swap}</div>`;
}

function startRun() {
  champion = false;
  round = Math.max(1, Math.min(RUN_ROUNDS, parseInt(params.get('round') || '1') || 1));
  powers = emptyPowers();
  for (const part of (params.get('powers') || '').split(',')) {
    const [id, lv] = part.split(':');
    if (id in powers) powers[id as PowerId] = parseInt(lv || '1') || 1;
  }
  runStyle = 0;
  startRound();
}

function startRound() {
  opp = OPPONENTS[ROUND_ORDER[round - 1]];
  const seed = parseInt(params.get('seed') || '0') || (Date.now() & 0x7fffffff);
  game = new Game(round, opp, powers, seed + round * 7919);
  game.autoplay = params.has('autoplay');
  game.sandbox = params.has('test') || params.has('sandbox');
  if (game.sandbox) { game.goalies.length = 0; game.pucks[0].x = 30; game.pucks[0].y = 15; }   // empty ice; puck parked in a corner
  game.events.length = 0;
  const owned = POWERS.filter(p => powers[p.id] > 0);
  view.setTeams(HOME, opp, owned.map(p => parseInt(p.color.slice(1), 16)));
  $('c0').style.background = hex(HOME.color); $('c1').style.background = hex(opp.color);
  $('n0').textContent = HOME.code; $('n1').textContent = opp.code;
  $('banner').textContent = `Round ${round} of ${RUN_ROUNDS} · first to ${WIN_GOALS}`;
  $('stack').innerHTML = owned.map(p => `<div class="pw" style="background:${p.color}">${icon(p.id)}<b>${powers[p.id]}</b></div>`).join('');
  mode = 'intro'; modeT = 0;
  const elite = round > 3 && opp.gimmick !== 'zamboni';
  showOverlay(`<div>
    <div class="tag">${opp.gimmick === 'zamboni' ? 'Boss game' : elite ? 'Elite team · round ' + round : 'Round ' + round}</div>
    <div class="vs"><span class="chip" style="background:${hex(HOME.color)}"></span>${HOME.name}<i>vs</i>${opp.name}<span class="chip" style="background:${hex(opp.color)}"></span></div>
    <p>${opp.blurb}</p>
    <div class="go">Enter to play</div></div>`);
}

function beginMatch() {
  mode = 'match'; modeT = 0; overT = 0;
  hideOverlay();
  flash('Faceoff', 'Tap J the instant the puck lands', 1.6);
  sfx.whistle();
}

function showEnd() {
  mode = 'end'; modeT = 0;
  const s = game.stats, won = game.winner === 0;
  runStyle += game.style;
  const tm = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const row = (a: string | number, l: string, b: string | number) => `<span>${a}</span><span>${l}</span><span>${b}</span>`;
  showOverlay(`<div>
    <div class="tag">${won ? 'Round won' : 'Run over'}</div>
    <h2>${HOME.code} ${game.score[0]} – ${game.score[1]} ${opp.code}</h2>
    <div class="stats">
      ${row(s.shots[0], 'Shots', s.shots[1])}${row(s.hits[0], 'Hits', s.hits[1])}${row(s.passes[0], 'Passes', s.passes[1])}
      ${row(s.saves[0], 'Saves', s.saves[1])}${row(tm(s.attack[0]), 'Time on attack', tm(s.attack[1]))}
      ${row(s.oneTimers, 'One-timers', '–')}${row(Math.round(game.style), 'Style', '–')}
    </div>
    <p>${won ? (round < RUN_ROUNDS ? 'Pick a power for the next round.' : 'The Union is beaten.') : `Run ended in round ${round} with ${Math.round(runStyle)} style. A fresh run starts with an empty stack.`}</p>
    <div class="go">${won ? 'Enter to continue' : 'Enter for a new run'}</div></div>`);
  if (!won) sfx.lose();
}

function showPick() {
  mode = 'pick'; modeT = 0;
  const pool = POWERS.map(p => p.id);
  cards = [];
  while (cards.length < 3) cards.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  const owned = POWERS.filter(p => powers[p.id] > 0);
  const next = OPPONENTS[ROUND_ORDER[round]];
  showOverlay(`<div>
    <h2>Pick a power</h2>
    <div class="cards">${cards.map((id, i) => {
      const p = POWERS.find(q => q.id === id)!, lv = powers[id];
      return `<div class="card" style="--c:${p.color}"><div class="ic">${icon(p.id)}</div><h3>${p.name}</h3>
        <div class="lv">${lv ? `Level ${lv} to ${lv + 1}` : 'New power'}</div><p>${p.desc}</p><kbd>${i + 1}</kbd></div>`;
    }).join('')}</div>
    <div class="row2"><span>Your stack</span>${owned.length ? owned.map(p => `<div class="pw" style="background:${p.color}">${icon(p.id)}<b>${powers[p.id]}</b></div>`).join('') : '<span>empty</span>'}</div>
    <p>Next: round ${round + 1} vs <b>${next.name}</b></p></div>`);
}

// ---------------------------------------------------------------- HUD
const flashEl = $('flash');
let flashT = 0;
function flash(big: string, small = '', t = 1.2) {
  flashEl.innerHTML = big + (small ? `<small>${small}</small>` : '');
  flashEl.classList.add('on'); flashT = t;
}
const pops = $('pops');
function pop(text: string, x: number, y: number, big: boolean) {
  if (pops.childElementCount > 14) pops.firstElementChild!.remove();
  const [sx, sy] = view.project(x, 2.4, y);
  const el = document.createElement('div');
  el.className = 'pop' + (big ? ' big' : '');
  el.textContent = text;
  el.style.left = Math.max(90, Math.min(window.innerWidth - 90, sx)) + 'px';
  el.style.top = Math.max(70, sy - pops.childElementCount * 6) + 'px';
  pops.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

let slowT = 0, freezeT = 0;
function handle(e: Ev) {
  view.handle(e);
  switch (e.t) {
    case 'pop': pop(e.text!, e.x!, e.y!, !!e.big); sfx.tone(e.n || 0); break;
    case 'tier': {
      const n = e.n || 0;
      $('buffs').textContent = n ? `Momentum · shots +${n * 2}% · stamina +${n * 8}%` : 'No bonus yet';
      const hp = $('heat'); hp.classList.remove('bump'); void hp.offsetWidth; hp.classList.add('bump');
      if (n < 4) { pop(e.big ? `Heat x${n + 1}` : n ? `Cooling off · x${n + 1}` : 'Heat lost', e.x!, e.y!, !!e.big); e.big ? sfx.tone(4 + n * 2) : sfx.cool(); }
      break;
    }
    case 'pass': sfx.pass(); break;
    case 'spin': sfx.pass(); break;
    case 'deke': sfx.recv(); break;
    case 'switch': sfx.recv(); break;
    case 'recv': case 'pickup': sfx.recv(); break;
    case 'shot': sfx.shot(!!e.big); break;
    case 'hit': sfx.hit(!!e.big); break;
    case 'slam': sfx.slam(); break;
    case 'bump': sfx.board(e.big ? 22 : 10); break;
    case 'save': case 'catch': sfx.save(); break;
    case 'post': sfx.post(); break;
    case 'board': sfx.board(e.n || 10); break;
    case 'slowmo': slowT = Math.max(slowT, e.n || 0.3); break;
    case 'freeze': freezeT = Math.max(freezeT, e.n || 0.05); break;
    case 'drop': sfx.drop(); flashT = Math.min(flashT, 0.15); break;
    case 'early': flash('Too early', '', 0.5); break;
    case 'faceoff': if (mode === 'match') { flash('Faceoff', 'Tap J on the drop', 1.2); sfx.whistle(); } break;
    case 'goal': sfx.horn(); flash(e.team === 0 ? 'Goal' : `${opp.code} score`, e.big && e.team === 0 ? 'One-timer' : '', 1.3); break;
    case 'fire': sfx.fire(); flash('On fire', 'Big hits launch them over the boards', 1.6); break;
    case 'warn': sfx.warn(); flash(opp.gimmick === 'zamboni' ? 'Ice machine' : 'Frost lane', 'Get out of the lane', 1.1); break;
    case 'lights': if (e.n === 0) { flash('Lights out', '', 1); sfx.warn(); } break;
    case 'ot': flash('Sudden death', 'Next goal wins', 1.6); sfx.whistle(); break;
    case 'buzzer': sfx.buzzer(); break;
  }
}

const windEl = $('wind'), windFill = windEl.querySelector('u') as HTMLElement;
const sprintEl = $('sprint'), sprintFill = sprintEl.querySelector('i') as HTMLElement;
let sprintShow = 0, lastSprintW = -1;
let lastScore = '', lastClock = '', lastHeat = -1, lastMult = 0, lastStyle = -1;
function hud() {
  const sc = game.score.join('-');
  if (sc !== lastScore) { lastScore = sc; $('s0').textContent = '' + game.score[0]; $('s1').textContent = '' + game.score[1]; }
  const c = game.ot ? 'OT' : `${Math.floor(game.clock / 60)}:${String(Math.ceil(game.clock) % 60).padStart(2, '0')}`;
  const ck = game.ot ? 'OT' : `${Math.floor(Math.ceil(game.clock) / 60)}:${String(Math.ceil(game.clock) % 60).padStart(2, '0')}`;
  if (ck !== lastClock) { lastClock = ck; $('clock').textContent = ck; $('clock').classList.toggle('ot', game.ot); }
  void c;
  const hp = Math.round(game.heat / 10);
  if (hp !== lastHeat) { lastHeat = hp; $('heatfill').style.width = hp + '%'; }
  const m = game.fireT > 0 ? 5 : game.mult();
  if (m !== lastMult) { lastMult = m; $('mult').textContent = game.fireT > 0 ? 'On fire x5' : 'x' + m; $('heat').classList.toggle('fire', game.fireT > 0); }
  const st = Math.round(game.style);
  if (st !== lastStyle) { lastStyle = st; $('style').textContent = 'Style ' + st; }
  const h = game.ctrl;
  const you = $('you');
  if (mode === 'match' && h.out <= 0) {
    // name tag follows you; if you are ever off screen it pins to the nearest edge
    const [yx, yy] = view.project(h.x, h.z + 4.4, h.y);
    you.style.display = 'block';
    you.style.left = Math.max(28, Math.min(window.innerWidth - 28, yx)) + 'px';
    you.style.top = Math.max(28, Math.min(window.innerHeight - 100, yy)) + 'px';
  } else you.style.display = 'none';
  // sprint bar under your skater: shows while it is in use or refilling, fades once full
  sprintShow = h.stamina < 0.999 || h.sprint ? 1 : Math.max(0, sprintShow - 1 / 45);
  if (mode === 'match' && h.out <= 0 && sprintShow > 0) {
    const [x, y] = view.project(h.x - 1.15, 0, h.y);
    sprintEl.style.display = 'block'; sprintEl.style.left = x + 'px'; sprintEl.style.top = y + 'px';
    sprintEl.style.opacity = String(Math.min(1, sprintShow * 1.5));
    const w = Math.round(h.stamina * 100);
    if (w !== lastSprintW) { lastSprintW = w; sprintFill.style.width = w + '%'; }
    sprintEl.classList.toggle('on', h.sprint); sprintEl.classList.toggle('gassed', h.gassed);
  } else sprintEl.style.display = 'none';
  if (mode === 'match' && h.wind >= 0 && game.phase === 'play') {
    const [x, y] = view.project(h.x, 0, h.y + 1.6);
    windEl.style.display = 'block'; windEl.style.left = x + 'px'; windEl.style.top = y + 'px';
    windFill.style.left = Math.min(100, (h.wind / 1.5) * 100) + '%';
  } else windEl.style.display = 'none';
}

// ---------------------------------------------------------------- loop
const STEP = 1 / 120;
let acc = 0, last = 0;
const frameMs: number[] = [];
let simMs = 0, simN = 0;

function tick(now: number) {
  requestAnimationFrame(tick);
  const rdt = Math.min(0.05, (now - last) / 1000 || 0.016);
  if (last) { frameMs.push(now - last); if (frameMs.length > 900) frameMs.shift(); }
  last = now;
  modeT += rdt;
  let sdt = 0;
  if (mode === 'match') {
    if (freezeT > 0) freezeT -= rdt;
    else {
      let scale = 1;
      if (slowT > 0) { slowT -= rdt; scale = 0.25; }
      sdt = rdt * scale;
      acc += sdt;
      const input = ctl();
      const t0 = performance.now();
      let n = 0;
      while (acc >= STEP && n < 8) { game.step(STEP, input); acc -= STEP; n++; }
      if (n === 8) acc = 0;
      simMs += performance.now() - t0; simN++;
    }
    for (const e of game.events) handle(e);
    game.events.length = 0;
    if (game.phase === 'over') { overT += rdt; if (overT > 0.9) showEnd(); }
  }
  if (flashT > 0) { flashT -= rdt; if (flashT <= 0) flashEl.classList.remove('on'); }
  if (game) { hud(); view.frame(game, sdt, rdt); }
}

function perf() {
  const f = frameMs.slice().sort((a, b) => a - b);
  const avg = f.reduce((a, b) => a + b, 0) / (f.length || 1);
  return {
    backend: view.backend, frames: f.length, fps: +(1000 / avg).toFixed(1), avgMs: +avg.toFixed(2),
    p95Ms: +(f[Math.floor(f.length * 0.95)] || 0).toFixed(2), maxMs: +(f[f.length - 1] || 0).toFixed(2),
    simMsPerFrame: +(simMs / (simN || 1)).toFixed(3),
  };
}

(async () => {
  setTeamSize(params.get('team') === '3' ? 3 : 5);
  await view.init($('gl') as HTMLCanvasElement, params.has('webgl'), params.has('noassets') ? 'off' : params.has('breakassets') ? 'break' : 'on');
  opp = OPPONENTS[0];
  game = new Game(1, opp, powers, 1);
  game.events.length = 0;
  view.setTeams(HOME, opp, []);
  if (params.has('test') || params.has('sandbox')) { startRun(); beginMatch(); }   // test rink: straight onto the ice
  else showTitle();
  (window as any).__faceoff = {
    snap: () => ({ mode, round, cards, powers, ...game.snapshot() }),
    perf, resetPerf: () => { frameMs.length = 0; simMs = 0; simN = 0; },
    assets: () => ({ ...view.assets }), assetsReady: () => view.assetsReady,
    anims: () => view.animStates(),
    cam: () => view.camState(),
    screen: (x: number, y: number) => view.project(x, 1.1, y),
    ground: (x: number, y: number) => view.project(x, 0.05, y),
    // test rink only: put the loose puck at a point (puck readability probes)
    puckTo: (x: number, y: number) => { if (game.sandbox) { const p = game.pucks[0]; p.owner = null; p.x = x; p.y = y; p.vx = p.vy = 0; } },
    body: (i: number) => view.bodyFrame(i),
    stickDebug: (i: number) => view.stickDebug(i),
    blade: (i: number) => { const k = game.skaters[i]; return k ? view.bladeOffset(i, k.face, k.x, k.y) : null; },
  };
  requestAnimationFrame(tick);
})();
