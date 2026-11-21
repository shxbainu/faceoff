import { PHYS, initPhysics } from './physics/rink';
import { Game, Ctl, PowerId, POWERS, HOME, OPPONENTS, ROUND_ORDER, RUN_ROUNDS, TeamDef, WIN_GOALS, Ev, setTeamSize, AI, MOVE, HANDS, HAND_FORCE, CHECK, SHOT, STICK, ABILITY_FORCE, ABILITY_ON } from './sim';
import { View, GAIT } from './render';
import { RAGDOLL } from './ragdoll';
import { ABILITIES, ABILITY_IDS, AbilityId } from './abilities';
import { sfx, unlock, audio } from './audio';
import { FeedbackSystem } from './feedback/system';
import { feel, setFeel, FEEL_DEFAULTS } from './feedback/settings';
import { FEEDBACK } from './feedback/config';
import '@fontsource/archivo/latin-500.css';
import '@fontsource/archivo/latin-800.css';

const $ = (id: string) => document.getElementById(id)!;
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const params = new URLSearchParams(location.search);
if (params.has('hands')) HAND_FORCE.v = params.get('hands') === 'l' ? -1 : 1;   // test: one shot side for everyone
if (params.has('ability')) ABILITY_FORCE.v = params.get('ability') as AbilityId;   // test: everyone gets this ability
ABILITY_ON.v = params.has('abilities') || params.has('ability');   // abilities are off until their design is settled
// debug keys that change play (] knock down, ' swap ability) only with ?fxdebug, ?movedbg or ?abilities: never in a normal live game
const DEV = params.has('fxdebug') || params.has('movedbg') || params.has('abilities') || params.has('ability') || params.has('colliders');
if (params.has('ai')) AI.difficulty = Math.max(0, Math.min(1, Number(params.get('ai')) || 0));   // bot difficulty 0..1

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
// Input buffer: a press is latched until a sim step has seen it, so a tap during hit stop or slow-mo
// (when no step may run for a few frames) still lands on the next step instead of being lost.
const LATCH = new Set(['KeyJ', 'Space', 'KeyK', 'KeyL', 'KeyH', 'KeyU', 'KeyQ', 'KeyI', 'KeyO']);
const latched = new Set<string>();
window.addEventListener('keydown', e => {
  if (GAME_KEYS.has(e.code) || DEBUG_CODES.has(e.code) || e.code === 'KeyP' || e.code === 'Backquote') e.preventDefault();
  if (e.repeat) return;
  unlock();
  if (uiKey(e.code)) return;   // feel panel, debug panel, goal skip: these keys never reach the game
  keys.add(e.code);
  if (LATCH.has(e.code) && !(scheme === 'simple' && e.code === 'KeyK')) latched.add(e.code);
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
  const k = (...c: string[]) => c.some(x => keys.has(x) || latched.has(x));
  if (scheme === 'simple') {
    const now = performance.now() / 1000;
    if (keys.has('KeyK') && shootDownAt < 0) shootDownAt = now;
    const held = shootDownAt >= 0 ? now - shootDownAt : 0;
    const wrist = wristQueued; wristQueued = false;
    // check key: poke when the stick can reach the puck, shoulder check otherwise
    const h = game?.ctrl, p = game?.pucks[0];
    // with the puck it is the spin move (the sim reads it from check), so it must not become a poke
    const carrying = !!(h && p && p.owner === h);
    const near = !carrying && !!(h && p && Math.hypot(p.x - h.x, p.y - h.y) < 1.8);
    return {
      mx: (k('KeyW', 'ArrowUp') ? 1 : 0) - (k('KeyS', 'ArrowDown') ? 1 : 0),
      my: (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0),
      pass: k('KeyJ', 'Space'), saucer: false, wrist, shoot: held >= TAP,
      check: k('KeyL') && !near, poke: k('KeyL') && near,
      burst: k('ShiftLeft', 'ShiftRight'), swap: k('KeyQ'), ability: k('KeyO'),
    };
  }
  return {
    // the camera looks up-ice (+x), so screen up is +x and screen right is +y
    mx: (k('KeyW', 'ArrowUp') ? 1 : 0) - (k('KeyS', 'ArrowDown') ? 1 : 0),
    my: (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0),
    pass: k('KeyJ', 'Space'), saucer: k('KeyK'), wrist: k('KeyL'), shoot: k('KeyI'), check: k('KeyH'), poke: k('KeyU'),
    burst: k('ShiftLeft', 'ShiftRight'), swap: k('KeyQ'), ability: k('KeyO'),
  };
}

/** debug (] key): a big hit on the opponent nearest you, from your side (shift+] for a light, stagger-sized one) */
function forceRagdoll(imp = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 5 : 15) {
  const h = game.ctrl, foe = game.skaters.filter(k => k.team === 1 && k.stun <= 0 && k.out <= 0).sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y))[0];
  if (!foe) return;
  const dx = foe.x - h.x, dy = foe.y - h.y, d = Math.hypot(dx, dy) || 1;
  if (imp < 7) handle({ t: 'bump', x: foe.x, y: foe.y, id: foe.id, dx: dx / d, dy: dy / d, n: imp });
  else game.debugKnock(foe, dx / d, dy / d, imp);
}

function onPress(code: string) {
  if (code === 'Semicolon') { view.moveDbg = !view.moveDbg; moveDbgEl.style.display = view.moveDbg ? 'block' : 'none'; return; }
  if (code === 'BracketLeft') { view.colDbg = !view.colDbg; return; }   // stick and body colliders
  if (code === 'Quote' && game && ABILITY_ON.v) {   // debug: give your skater the next ability, ready to use
    const h = game.ctrl; h.ab = ABILITY_IDS[(ABILITY_IDS.indexOf(h.ab) + 1) % ABILITY_IDS.length]; h.abCd = 0; h.stamina = 1;
    pop(`Ability: ${ABILITIES[h.ab].name}`, h.x, h.y, false); return;
  }
  if (code === 'BracketRight' && mode === 'match' && DEV) { forceRagdoll(); return; }   // debug: flatten the nearest opponent
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
const fb = new FeedbackSystem(view, () => game);
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
  fb.reset();
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
const pop = (text: string, x: number, y: number, big: boolean) => fb.popAt(text, x, y, big);

// Every sim event goes to the renderer (animation, props) and to the feedback system (all game feel).
// What is left here is HUD text and the sounds that belong to no feedback event.
function handle(e: Ev) {
  view.handle(e);
  fb.handle(e);
  switch (e.t) {
    case 'tier': {
      const n = e.n || 0;
      $('buffs').textContent = n ? `Momentum · shots +${n * 2}% · stamina +${n * 8}%` : 'No bonus yet';
      const hp = $('heat'); hp.classList.remove('bump'); void hp.offsetWidth; hp.classList.add('bump');
      if (n < 4) { pop(e.big ? `Heat x${n + 1}` : n ? `Cooling off · x${n + 1}` : 'Heat lost', e.x!, e.y!, !!e.big); e.big ? sfx.tone(4 + n * 2) : sfx.cool(); }
      break;
    }
    case 'switch': case 'pickup': sfx.recv(); break;
    case 'poke': if (e.text === 'air') audio.play('stick_whiff'); break;   // a poke at nothing (a landed one is a feedback event)
    case 'pokeTry': audio.play('stick_whiff'); break;
    case 'stick': if (e.text !== 'body' && e.text !== 'trap') audio.play('stick_clack'); break;   // blade on puck or stick on stick
    case 'stickDrop':
      audio.play('stick_drop');
      if (game.skaters.find(k => k.id === e.id)?.human) pop('Stick down! Skate over it', e.x!, e.y!, true);
      break;
    case 'stickPickup': case 'stickSpare': audio.play('stick_pickup'); break;
    case 'catch': sfx.save(); break;
    case 'board': sfx.board(e.n || 10); break;
    case 'drop': sfx.drop(); flashT = Math.min(flashT, 0.15); break;
    case 'early': flash('Too early', '', 0.5); break;
    case 'faceoff': if (mode === 'match') { flash('Faceoff', 'Tap J on the drop', 1.2); sfx.whistle(); } break;
    case 'goal': if (e.team !== 0) flash(`${opp.code} score`, '', 1.0); break;   // our goals get the feedback system's goal card
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
const abilEl = $('abil'), abilName = abilEl.querySelector('span') as HTMLElement, abilFill = abilEl.querySelector('i') as HTMLElement;
let lastAbilW = -1, abilReady = false;
let lastScore = '', lastClock = '', lastHeat = -1, lastMult = 0, lastStyle = -1;
// movement debug overlay (; key or ?movedbg): your skater's facing, skating direction, head yaw and shot side,
// and every bot's AI state; the arrows on the ice are drawn by the view
const moveDbgEl = Object.assign(document.createElement('pre'), { id: 'movedbg' });
moveDbgEl.style.cssText = 'position:fixed;left:8px;top:96px;margin:0;padding:8px;background:#14171d;border:2px solid #3a424e;color:#eef1f4;font:500 11px/1.4 Archivo,monospace;z-index:50;pointer-events:none;display:none';
document.body.appendChild(moveDbgEl);
if (params.has('movedbg')) moveDbgEl.style.display = 'block';
const deg = (a: number) => Math.round(a * 180 / Math.PI);
function moveDbgText() {
  const h = game.ctrl, sp = Math.hypot(h.vx, h.vy), hs = view.headState(game.skaters.indexOf(h));
  const lines = [`you #${h.id}  ${h.hand > 0 ? 'right' : 'left'} shot${h.bh > 0.5 ? ' (backhand)' : ''}`,
    `facing ${deg(h.face)}  skating ${sp > 0.3 ? deg(Math.atan2(h.vy, h.vx)) : '-'}  speed ${sp.toFixed(1)}  ${h.faceMode}`,
    `head yaw ${hs ? deg(hs.twist) : '-'}  (limit ${deg(0.75)})`, ''];
  const gs = view.gaitState(), an = view.animStates(), gi = (k: typeof h) => { const i = game.skaters.indexOf(k), q = gs[i];
    return q ? `${(an[i]?.clip ?? '').padEnd(10)} legs ${q.mode.padEnd(6)} phase ${q.ph.toFixed(2)} stride ${q.amp.toFixed(2)}` : ''; };
  lines.splice(3, 0, `anim ${gi(h)}`, `stick ${h.bOn ? 'on ice' : 'off'}${h.liftT > 0 ? ' lifted' : ''}${h.tieT > 0 ? ' knocked' : ''}${h.pokeT > 0 ? ' poking' : ''}`);
  for (const k of game.skaters) if (!k.human) lines.push(`#${k.id} ${k.team === 0 ? 'home' : 'away'} ${k.hand > 0 ? 'R' : 'L'} ${k.faceMode.padEnd(7)} ${gi(k)}  ${k.ai.state ?? ''}`);
  return lines.join('\n');
}

function hud() {
  if (view.moveDbg && game) moveDbgEl.textContent = moveDbgText();
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
  // ability chip under the sprint bar: always there in a match so the key is learnable; the line along its bottom
  // fills as the cooldown runs down, the chip lights when it is ready and steps up once at that moment
  if (ABILITY_ON.v && mode === 'match' && h.out <= 0 && game.phase !== 'over') {
    const [x, y] = view.project(h.x - 1.15, 0, h.y), def = ABILITIES[h.ab];
    abilEl.style.display = 'block'; abilEl.style.left = x + 'px'; abilEl.style.top = (y + 12) + 'px';
    if (abilName.textContent !== def.name) abilName.textContent = def.name;
    const ready = h.abCd <= 0 && h.stamina >= def.cost && (h.ab !== 'bender' || game.pucks[0].owner === h), w = Math.round(100 * (1 - Math.max(0, h.abCd) / def.cd));
    if (w !== lastAbilW) { lastAbilW = w; abilFill.style.width = (ready ? 0 : w) + '%'; }
    if (ready && !abilReady) { abilEl.classList.remove('pop'); void abilEl.offsetWidth; abilEl.classList.add('pop'); }
    abilReady = ready;
    abilEl.classList.toggle('ready', ready); abilEl.classList.toggle('live', h.abT > 0);
  } else abilEl.style.display = 'none';
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

let frozen = false;
function tick(now: number) {
  requestAnimationFrame(tick);
  const rdt = Math.min(0.05, (now - last) / 1000 || 0.016);
  if (last) { frameMs.push(now - last); if (frameMs.length > 900) frameMs.shift(); }
  last = now;
  modeT += rdt;
  const paused = fb.hud.feelOpen || frozen;   // the feel panel pauses play while you tune (frozen: test hook)
  if (mode === 'match' && !paused) {
    // hit stop and slow-mo only change how much real time the fixed step is fed: the sim runs the same
    // steps on the same (latched) inputs either way. In net mode the scale is always 1.
    acc += rdt * fb.time.simScale();
    if (acc >= STEP) {
      const input = ctl();
      const t0 = performance.now();
      let n = 0;
      while (acc >= STEP && n < 8) { game.step(STEP, input); acc -= STEP; n++; }
      if (n === 8) acc = 0;
      latched.clear();
      simMs += performance.now() - t0; simN++;
    }
    for (const e of game.events) handle(e);
    game.events.length = 0;
    if (game.phase === 'over') { overT += rdt; if (overT > 0.9) showEnd(); }
  }
  debugTick(rdt);
  fb.update(paused ? 0 : rdt, mode === 'match');
  if (flashT > 0) { flashT -= rdt; if (flashT <= 0) flashEl.classList.remove('on'); }
  if (game) { hud(); view.frame(game, mode === 'match' && !paused ? rdt * fb.time.animScale() : 0, rdt); }
}

function perf() {
  const f = frameMs.slice().sort((a, b) => a - b);
  const avg = f.reduce((a, b) => a + b, 0) / (f.length || 1);
  return {
    backend: view.backend, frames: f.length, fps: +(1000 / avg).toFixed(1), avgMs: +avg.toFixed(2),
    p95Ms: +(f[Math.floor(f.length * 0.95)] || 0).toFixed(2), maxMs: +(f[f.length - 1] || 0).toFixed(2),
    simMsPerFrame: +(simMs / (simN || 1)).toFixed(3), fxMs: +fb.stats.frameMs.toFixed(3),
  };
}

(async () => {
  setTeamSize(params.get('team') === '3' ? 3 : 5);
  PHYS.rapier = params.has('rapier');   // PHYSICS_PLAN.md: Rapier puck, boards and nets
  // loads alongside the renderer and its assets; if it fails, play on the old physics instead of hanging
  const physReady = PHYS.rapier ? initPhysics().catch(e => { console.warn('Rapier failed, old physics', e); PHYS.rapier = false; }) : null;
  await view.init($('gl') as HTMLCanvasElement, params.has('webgl'), params.has('noassets') ? 'off' : params.has('breakassets') ? 'break' : 'on');
  await physReady;
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
    gait: () => view.gaitState(), feet: (i: number) => view.feet(i), rag: () => view.ragState(),
    stickPose: (i: number) => view.stickPose(i),
    jointCheck: (on = true) => { if (on) { view.jointStat = {}; return null; } const r = view.jointStat!; view.jointStat = null; const o: Record<string, string> = {}; for (const [k, a] of Object.entries(r)) { if (k.startsWith('ctx')) { const c: Record<string, number> = {}; for (const x of a as unknown as string[]) c[x] = (c[x] ?? 0) + 1; o[k] = JSON.stringify(c); continue; } a.sort((x, y) => x - y); const p = (f: number) => a[Math.min(a.length - 1, Math.floor(f * a.length))].toFixed(0); o[k] = `p50 ${p(0.5)} p95 ${p(0.95)} p99 ${p(0.99)} max ${p(1)}`; } return o; },
    physCheck: (on = true) => { const P = view.phys; if (!P) return null; if (on) { P.stats(true); return P.rigs.size; } const r = P.stats()!; P.stat = null;
      const q = (a: number[], f: number) => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y); return +b[Math.min(b.length - 1, Math.floor(f * b.length))].toFixed(3); };
      return { rigs: P.rigs.size, frames: r.frames, ms: { mean: +(r.ms.reduce((x, y) => x + y, 0) / r.ms.length).toFixed(3), p95: q(r.ms, 0.95), max: q(r.ms, 1) }, angDeg: { p50: q(r.ang, 0.5), p95: q(r.ang, 0.95), max: q(r.ang, 1) }, posM: { p95: q(r.pos, 0.95), max: q(r.pos, 1) }, bladeM: { p99: q(r.blade, 0.99), max: q(r.blade, 1) }, bad: r.bad, tgrip: { p50: q((r as any).tgrip ?? [], 0.5), p95: q((r as any).tgrip ?? [], 0.95), max: q((r as any).tgrip ?? [], 1) }, tgap: r.tgap, gapM: +r.gap.toFixed(4), jumps: r.jumps, fast: r.fast, nan: r.nan }; },
    gripCheck: (on = true) => { if (on) view.gripStat = { worst: 0, frames: 0, over: 0, who: '' }; const r = view.gripStat; if (!on) view.gripStat = null; return r; }, puckOwner: () => { const o = game.pucks[0].owner; return o ? game.skaters.indexOf(o) : -1; },
    knock: (i: number, imp = 15, dx = 1, dy = 0) => game.debugKnock(game.skaters[i], dx, dy, imp),
    cam: () => view.camState(),
    freeze: (on: boolean) => { frozen = on; }, closeCam: (i: number, d = 6, a = 0) => { view.closeCam = i < 0 ? null : { i, d, a }; },
    gearCheck: () => view.gearCheck(),
    screen: (x: number, y: number) => view.project(x, 1.1, y),
    ground: (x: number, y: number) => view.project(x, 0.05, y),
    // test rink only: put the loose puck at a point (puck readability probes)
    puckTo: (x: number, y: number) => { if (game.sandbox) { const p = game.pucks[0]; p.owner = null; p.x = x; p.y = y; p.vx = p.vy = 0; } },
    body: (i: number) => view.bodyFrame(i),
    head: (i: number) => view.headState(i),
    arms: (i: number) => view.armState(i),
    limbs: (i: number) => view.limbs(i), torso: (i: number) => view.torso(i),
    puckDrawn: () => view.puckDrawn(),
    stick: (i: number) => view.stickState(i),
    // movement, facing, handedness and AI state for every skater (tests/move_probe.mjs, tests/hockey_probe.mjs)
    skaters: () => game.skaters.map(k => ({ id: k.id, team: k.team, human: k.human, x: k.x, y: k.y, vx: k.vx, vy: k.vy, face: k.face, hand: k.hand, bh: k.bh, mode: k.faceMode, ai: k.ai.state ?? '', stun: k.stun })),
    tuning: { MOVE, AI, HANDS, CHECK, SHOT, GAIT, STICK, RAGDOLL, ABILITIES },
    setClock: (sec: number) => { game.clock = sec; },   // tests: keep a long probe inside one match
    ability: (i: number, id?: AbilityId) => { const s = game.skaters[i]; if (id) s.ab = id; s.abCd = 0; s.stamina = 1; return game.useAbility(s, 0, 0); },   // live: edits apply on the next step
    stickDebug: (i: number) => view.stickDebug(i),
    blade: (i: number) => { const k = game.skaters[i]; return k ? view.bladeOffset(i, k.face, k.x, k.y) : null; },
    // feedback layer: fire any event at an intensity, read what fired, change settings, run the full sweep
    fx: {
      fire: (name: string, i: number) => debugFire(name, i),
      names: () => DEBUG.map(d => d[2]),
      state: () => fb.snapshot(),
      set: (p: Partial<typeof feel>) => { setFeel(p); fb.hud.drawFeel(); },
      sweep: () => startSweep(),
      sweeping: () => sweep.length > 0,
      skip: () => fb.skip(),
      config: FEEDBACK,   // live: edits apply to the next event
      feelOpen: () => fb.hud.feelOpen,
    },
  };
  if (params.has('fxdebug')) { fb.hud.showDbg(true); drawDbg(); }
  requestAnimationFrame(tick);
})();


// ---------------------------------------------------------------- feel panel, debug hotkeys, goal skip
// Debug: ` opens the panel. In a match the keys below fire every feedback event at the chosen intensity
// (, low  . medium  / high), and \ fires all of them at all three levels in turn. Debug events go only to the
// feedback system, never to the sim.
type DebugEntry = [code: string, label: string, name: string];
const DEBUG: DebugEntry[] = [
  ['KeyT', 'T', 'pass_released'], ['Digit1', '1', 'pass_completed'], ['Digit2', '2', 'one_touch'], ['Digit3', '3', 'one_timer'],
  ['Digit4', '4', 'shot_released'], ['Digit5', '5', 'post_hit'], ['Digit6', '6', 'near_miss'], ['Digit7', '7', 'save_made'],
  ['Digit8', '8', 'check_landed'], ['Digit9', '9', 'check_board'], ['Digit0', '0', 'got_hit'], ['KeyY', 'Y', 'check_shove'],
  ['KeyF', 'F', 'check_poke'], ['Minus', '-', 'streak_end'], ['Equal', '=', 'speed_burst'], ['KeyZ', 'Z', 'spin_move'],
  ['KeyX', 'X', 'beat_defender'], ['KeyC', 'C', 'turnover_won'], ['KeyV', 'V', 'turnover_lost'], ['KeyM', 'M', 'faceoff_won'],
  ['KeyG', 'G', 'heat_fire'], ['KeyB', 'B', 'goal_scored'], ['KeyN', 'N', 'goal_conceded'], ['KeyE', 'E', 'ability_used'],
];
const DEBUG_CODES = new Set([...DEBUG.map(d => d[0]), 'Comma', 'Period', 'Slash', 'Backslash']);
const LEVELS: Record<string, [string, number]> = { Comma: ['low', 0.15], Period: ['medium', 0.55], Slash: ['high', 1] };
let dbgLevel: [string, number] = LEVELS.Period;
let dbgStreak = 0;
const sweep: { name: string; i: number; at: number }[] = [];
let sweepClock = 0;

/** a synthetic event at your skater (or the net), sent straight to the feedback system */
function debugFire(name: string, i: number) {
  const h = game.ctrl, f = h.face, dx = Math.cos(f), dy = Math.sin(f);
  const foe = game.skaters.filter(k => k.team === 1).sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y))[0];
  const base: Ev = { t: name, i, x: h.x, y: h.y, team: 0, id: h.id, dx, dy };
  const netX = 35.6;
  const e: Ev = (() => {
    switch (name) {
      case 'pass_completed': dbgStreak++; return { ...base, n: dbgStreak, vid: h.id, tag: 'tape' };
      case 'one_touch': dbgStreak++; return { ...base, n: dbgStreak };
      case 'streak_end': { const n = Math.max(2, dbgStreak); dbgStreak = 0; return { ...base, n, tag: 'broken' }; }
      case 'shot_released': return { ...base, big: i > 0.7, tag: 'slap', n: 30 + 30 * i };
      case 'post_hit': return { ...base, x: netX, y: 2.1 };
      case 'near_miss': return { ...base, x: netX, y: 2.6 };
      case 'save_made': return { ...base, team: 1, x: netX - 1.5, y: 0.6, big: i > 0.7, tag: 'glove', dx: 1, dy: 0 };
      case 'check_landed': return { ...base, vid: foe?.id, tag: i > 0.8 ? 'big' : 'hit', timed: i > 0.9 };
      case 'check_board': return { ...base, t: 'check_landed', vid: foe?.id, tag: 'hit', board: true };
      case 'got_hit': return { ...base, t: 'check_landed', team: 1, id: foe?.id, vid: h.id, tag: 'hit', dx: -dx, dy: -dy };
      case 'check_shove': return { ...base, t: 'check_landed', vid: foe?.id, tag: 'shove' };
      case 'check_poke': return { ...base, t: 'check_landed', vid: foe?.id, tag: 'poke' };
      case 'turnover_won': return { ...base, t: 'turnover', tag: 'pickoff' };
      case 'turnover_lost': return { ...base, t: 'turnover', team: 1, id: foe?.id };
      case 'beat_defender': return { ...base, vid: foe?.id, tag: 'spin' };
      case 'heat_fire': return { ...base, t: 'fire' };
      case 'ability_used': return { ...base, tag: game.ctrl.ab };
      case 'goal_scored': return { ...base, x: netX + 0.3, y: 0.4, n: i > 0.5 ? 3 : 0, text: i > 0.8 ? 'one_timer winner streak' : '' };
      case 'goal_conceded': return { ...base, t: 'goal_scored', team: 1, x: -netX - 0.3, y: 0 };
      default: return base;
    }
  })();
  if (name === 'goal_scored' || name === 'goal_conceded') view.netGoal(e.team ?? 0);
  fb.handle(e, true);
}

function startSweep() {
  sweep.length = 0; sweepClock = 0;
  let at = 0.2;
  for (const [, , name] of DEBUG) for (const i of [0.15, 0.55, 1]) {
    sweep.push({ name, i, at });
    at += name.startsWith('goal') ? 2.6 : name === 'heat_fire' || name.includes('check') || name === 'one_timer' ? 0.9 : 0.5;
  }
}
function debugTick(rdt: number) {
  if (!sweep.length || mode !== 'match') return;
  sweepClock += rdt;
  while (sweep.length && sweep[0].at <= sweepClock) { const s = sweep.shift()!; debugFire(s.name, s.i); }
  if (fb.hud.dbgOpen) drawDbg();
}
function drawDbg() {
  const st = fb.snapshot();
  const fired = Object.entries(st.fired).map(([k, v]) => `${k} ${v} (i ${st.lastI[k] ?? '-'})`).join('\n');
  fb.hud.drawDbg(DEBUG.map(d => [d[1], d[2].replace(/_/g, ' ')]), dbgLevel[0],
    `flow ${st.flow.rank} ${st.flow.pts} · streak ${st.streak} · particles ${st.particles} · voices ${st.voices}${st.net ? ' · net mode' : ''}\n${fired}`);
}

/** keys for the panels and the goal skip; true when the key was used up here */
function uiKey(code: string): boolean {
  if (code === 'KeyP') { fb.hud.showFeel(!fb.hud.feelOpen); keys.clear(); return true; }
  if (fb.hud.feelOpen) {
    const n = fb.hud.feelRows.length;
    if (code === 'KeyW' || code === 'ArrowUp') fb.hud.feelSel = (fb.hud.feelSel + n - 1) % n;
    else if (code === 'KeyS' || code === 'ArrowDown') fb.hud.feelSel = (fb.hud.feelSel + 1) % n;
    else if (['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'Enter', 'Space'].includes(code)) {
      const d = code === 'KeyA' || code === 'ArrowLeft' ? -1 : 1, r = fb.hud.feelSel;
      if (r === 0) setFeel({ intensity: feel.intensity + d * 0.1 });
      else if (r === 1) setFeel({ shake: !feel.shake });
      else if (r === 2) setFeel({ flashes: !feel.flashes });
      else if (r === 3) setFeel({ slowmo: !feel.slowmo });
      else if (r === 4) setFeel({ chroma: !feel.chroma });
      else setFeel({ ...FEEL_DEFAULTS });
    } else if (code === 'Escape') fb.hud.showFeel(false);
    fb.hud.drawFeel();
    return true;
  }
  if (code === 'Backquote') { fb.hud.showDbg(!fb.hud.dbgOpen); if (fb.hud.dbgOpen) drawDbg(); return true; }
  if (fb.hud.dbgOpen && mode === 'match' && DEBUG_CODES.has(code)) {
    if (LEVELS[code]) dbgLevel = LEVELS[code];
    else if (code === 'Backslash') startSweep();
    else { const d = DEBUG.find(x => x[0] === code); if (d) debugFire(d[2], dbgLevel[1]); }
    drawDbg();
    return true;
  }
  // goal celebration: J, Space, Enter or K cuts it short (only once it has had a moment to land)
  if (mode === 'match' && fb.celebrating && ['KeyJ', 'Space', 'Enter', 'KeyK'].includes(code)) return fb.skip();
  return false;
}
