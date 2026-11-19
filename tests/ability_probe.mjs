// Headless ability checks (sim only): each ability does what it says, cooldown and cost hold, bots use all of them
// in real matches, and a balance comparison of bot matches with and without abilities.
// Usage: node tests/ability_probe.mjs        exits 1 if any check fails
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const out = mkdtempSync(tmpdir() + '/abil-') + '/sim.mjs';
await build({ entryPoints: ['src/sim.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const S = await import(pathToFileURL(out).href);

const P = Object.fromEntries(S.POWERS.map(p => [p.id, 0]));
const NO = { mx: 0, my: 0, pass: false, shoot: false, check: false, burst: false };
const DT = 1 / 120;
// abilities are off by default (ABILITY_ON); prove that, then switch them on for the rest
{ const g = new S.Game(1, S.OPPONENTS[0], P, 9); g.phase = 'play'; const s = g.ctrl; s.abCd = 0; s.stamina = 1;
  const ok = g.useAbility(s, 0, 0); console.log(`${ok ? 'FAIL' : 'pass'}  abilities are off unless ?abilities`); if (ok) process.exitCode = 1; }
S.ABILITY_ON.v = true;
let fails = 0;
const check = (ok, name, info = '') => { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); if (!ok) fails++; };

// a play-phase game with only the placed skaters on the ice (bots there stand still: their AI is replaced by NO)
function scene(...place) {
  const g = new S.Game(1, S.OPPONENTS[0], P, 9); g.phase = 'play';
  for (const s of g.skaters) Object.assign(s, { out: 1e9, x: 0, y: 0, vx: 0, vy: 0 });
  g.pucks[0].owner = null; g.pucks[0].x = 30; g.pucks[0].y = 15;
  const who = place.map(([i, o]) => Object.assign(g.skaters[i], { out: 0, stun: 0, stamina: 1, abCd: 0, ...o }));
  g.ai = () => ({ ...NO });   // bots hold still: the test drives everything
  return [g, who];
}
const run = (g, c, n) => { for (let i = 0; i < n; i++) g.step(DT, { ...NO, ...c }); };

// burst
{
  const [g, [h]] = scene([0, { x: -10, y: 0, face: 0, vx: 4, vy: 0 }]); g.setCtrl(h);
  const v0 = Math.hypot(h.vx, h.vy); run(g, { ability: true, mx: 1 }, 1); const v1 = Math.hypot(h.vx, h.vy);
  check(v1 > v0 + 4, 'burst skates: explosive push', `${v0.toFixed(1)} -> ${v1.toFixed(1)} u/s`);
  check(h.abCd > 3 && h.stamina < 0.9, 'burst: cooldown and sprint cost applied', `cd ${h.abCd.toFixed(2)}, bar ${h.stamina.toFixed(2)}`);
  const cd = h.abCd; run(g, { ability: false }, 2); run(g, { ability: true }, 1);
  check(h.abCd < cd && h.abCd > 3 - 0.1, 'burst: no second use on cooldown');
  const [g2, [w]] = scene([0, { x: 0, y: 0, face: 0, stamina: 0.05 }]); g2.setCtrl(w); run(g2, { ability: true }, 1);
  check(w.abCd <= 0, 'abilities need the sprint bar (a winded skater cannot)');
}
// charge: crouch (slows), lunge, lands a real check on the opponent in front
{
  const [g, [h, o]] = scene([0, { x: -4, y: 0, face: 0, vx: 6, ab: 'charge' }], [6, { x: 0.5, y: 0, face: Math.PI }]); g.setCtrl(h);
  run(g, { ability: true, mx: 1 }, 1); run(g, { mx: 1 }, Math.round(0.1 / DT));
  const crouch = Math.hypot(h.vx, h.vy);
  const evs = []; for (let i = 0; i < 70; i++) { g.step(DT, { ...NO, mx: 1 }); evs.push(...g.events.splice(0)); }
  const hit = evs.find(e => e.t === 'hit' && e.id === o.id);
  check(crouch < 6, 'charge: the crouch tell slows him first', `${crouch.toFixed(1)} u/s`);
  check(!!hit && o.stun > 0, 'charge: lands as a check on the skater in front', hit ? `hit value ${hit.n.toFixed(1)} (${hit.text})` : 'no hit');
  check(!!hit && hit.n >= 9, 'charge: hard enough to ragdoll (RAGDOLL.min 9)');
  const [g2, [m]] = scene([0, { x: 0, y: 0, face: 0, ab: 'charge' }]); g2.setCtrl(m);
  run(g2, { ability: true }, 1); run(g2, NO, Math.round(0.7 / DT));
  check(m.slow > 0 || m.abT <= 0 && m.hits.size === 0, 'charge: a whiff leaves him stumbling', `slow ${m.slow.toFixed(2)}`);
}
// a charge interrupted by a hit does not fire after the get-up
{
  const [g, [h, o]] = scene([0, { x: 0, y: 0, face: 0, ab: 'charge' }], [6, { x: 6, y: 0, face: Math.PI }]); g.setCtrl(h);
  run(g, { ability: true }, 1); run(g, NO, 6);
  g.debugKnock(h, -1, 0, 10);   // flattened mid-crouch
  let lunge = false; for (let i = 0; i < Math.round(3 / DT); i++) { g.step(DT, NO); lunge ||= h.checkT > 0; }
  check(!lunge && h.abT <= 0, 'charge: a hit during the crouch cancels it (no lunge after getting up)');
}
// bender: the shot bows out and comes back to the corner it was aimed at
{
  const track = (bend) => {
    const [g, [h]] = scene([0, { x: 20, y: 4, face: 0, ab: 'bender' }]); g.setCtrl(h);
    const p = g.pucks[0]; g.gain(p, h); h.settle = 0;
    g.goalies.forEach(k => { k.x = 99; k.y = 99; });   // no goalie: just the flight
    run(g, NO, 1);   // the puck settles on the blade
    if (bend) run(g, { ability: true }, 1);
    run(g, { wrist: true, my: 1 }, 1);
    const x0 = p.x, y0 = p.y, a = Math.atan2(p.vy, p.vx); let dev = 0, n = 0;
    while (p.x < S.GL - 0.3 && n++ < 200) { g.step(DT, NO); dev = Math.max(dev, Math.abs(-Math.sin(a) * (p.x - x0) + Math.cos(a) * (p.y - y0))); }
    return { dev, y: p.y, kind: p.kind };
  };
  const plain = track(false), bent = track(true);
  check(bent.dev > plain.dev + 0.3, 'bender: the shot curves', `max off-line ${plain.dev.toFixed(2)} -> ${bent.dev.toFixed(2)}`);
  check(Math.abs(bent.y - plain.y) < 0.9, 'bender: still arrives near the aimed corner', `at the goal line y ${plain.y.toFixed(2)} vs ${bent.y.toFixed(2)}`);
}
// long stick: lane stick and reach grow
{
  const [g, [h]] = scene([5, { x: 0, y: 0, face: 0, ab: 'reach', team: 1 }]);
  run(g, NO, 2); const d0 = Math.hypot(h.bx - h.x, h.by - h.y);
  g.useAbility(h, 0, 0); run(g, NO, 2); const d1 = Math.hypot(h.bx - h.x, h.by - h.y);
  check(d1 > d0 * 1.3, 'long stick: the blade reaches further', `${d0.toFixed(2)} -> ${d1.toFixed(2)}`);
  run(g, NO, Math.round(2.6 / DT)); const d2 = Math.hypot(h.bx - h.x, h.by - h.y);
  check(Math.abs(d2 - d0) < 0.05, 'long stick: wears off', `${d2.toFixed(2)}`);
}
// bots use them in real matches; balance with and without
function matches(n, rate) {
  const tot = { goals: 0, shots: 0, hits: 0, uses: {}, secs: 0 };
  for (let m = 0; m < n; m++) {
    const g = new S.Game(1 + m * 2, S.OPPONENTS[m % 3], P, 21 + m); g.autoplay = true;
    if (!rate) g.aiAbility = () => false;
    let t = 0;
    while (g.phase !== 'over' && t < 150) {
      g.step(DT, NO); t += DT;
      for (const e of g.events) { if (e.t === 'ability_used') tot.uses[e.tag] = (tot.uses[e.tag] || 0) + 1; if (e.t === 'goal') tot.goals++; if (e.t === 'shot') tot.shots++; if (e.t === 'hit') tot.hits++; }
      g.events.length = 0;
    }
    tot.secs += t;
  }
  return tot;
}
const on = matches(4, true), off = matches(4, false);
check(['burst', 'charge', 'bender', 'reach'].every(k => (on.uses[k] || 0) > 0), 'bots use every ability in real play', JSON.stringify(on.uses));
const perMin = (x, t) => (x / t * 60).toFixed(1);
console.log(`      with abilities: ${on.goals} goals / ${on.shots} shots / ${on.hits} hits in ${on.secs.toFixed(0)} s (uses per skater-minute ${(Object.values(on.uses).reduce((a, b) => a + b, 0) / on.secs * 60 / 10).toFixed(2)})`);
console.log(`      without:        ${off.goals} goals / ${off.shots} shots / ${off.hits} hits in ${off.secs.toFixed(0)} s`);
check(on.goals / Math.max(1, on.shots) < 0.4, 'abilities do not turn shooting into a formality', `shooting ${(on.goals / Math.max(1, on.shots) * 100).toFixed(0)}% (without ${(off.goals / Math.max(1, off.shots) * 100).toFixed(0)}%)`);
check(on.hits / on.secs < (off.hits / off.secs) * 2.5 + 0.05, 'hits stay a minority of plays', `hits per minute ${perMin(on.hits, on.secs)} (without ${perMin(off.hits, off.secs)})`);
console.log(fails ? `${fails} FAILED` : 'all pass');
process.exit(fails ? 1 : 0);
