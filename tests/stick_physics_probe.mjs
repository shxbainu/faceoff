// Headless checks for the stick colliders (sim only): passes meet a lane blade, fast pucks never tunnel, pokes and
// lifts act on contact only, blades never enter bodies, boards or nets, handedness holds.
// Usage: node tests/stick_physics_probe.mjs        exits 1 if any check fails
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const out = mkdtempSync(tmpdir() + '/stick-') + '/sim.mjs';
await build({ entryPoints: ['src/sim.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const S = await import(pathToFileURL(out).href);
const P = Object.fromEntries(S.POWERS.map(p => [p.id, 0]));
const DT = 1 / 120;
let fails = 0;
const check = (ok, name, info = '') => { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); if (!ok) fails++; };

// a play-phase game with every skater off the ice except the ones a test places
function scene(...place) {
  const g = new S.Game(1, S.OPPONENTS[0], P, 7);
  g.phase = 'play';
  for (const s of g.skaters) Object.assign(s, { out: 1e9, x: 0, y: 0, vx: 0, vy: 0 });
  const p = g.pucks[0]; p.owner = null;
  const who = place.map(([i, o]) => Object.assign(g.skaters[i], { out: 0, stun: 0, pickupCd: 0, checkCd: 0, settle: 0, stickAng: 0, ...o }));
  for (const s of who) { s.stickX = s.x + Math.cos(s.face) * S.STICK_R; s.stickY = s.y + Math.sin(s.face) * S.STICK_R; g.placeBlade(s, DT); g.placeBlade(s, DT); }
  return [g, p, who];
}
const stepPuck = (g, p, n, who = []) => { for (let i = 0; i < n; i++) { for (const s of who) g.placeBlade(s, DT); g.updatePuck(p, DT); if (p.owner || !p.alive) return i; } return n; };

// 1. a pass across a defender's lane blade: soft is trapped, hard deflects, nothing goes through
for (const speed of [12, 30, 80]) {
  const [g, p, [d]] = scene([6, { team: 1, x: 0, y: 0, face: 0 }]);
  Object.assign(p, { x: d.bx - 3, y: d.by, vx: speed, vy: 0, kind: 'pass', lastTeam: 0, from: g.skaters[0], target: g.skaters[1], age: 0.5 });
  p.checked.clear();
  stepPuck(g, p, 120, [d]);
  const through = p.owner !== d && p.x > d.bx + 0.5 && Math.abs(p.y - d.by) < 0.2 && p.vx > speed * 0.9;
  check(!through, `pass at ${speed} meets the lane blade`, p.owner === d ? 'trapped' : `deflected to (${p.vx.toFixed(1)}, ${p.vy.toFixed(1)})`);
  if (speed === 12) check(p.owner === d, 'soft pass is picked off by the blade');
}
// 2. a saucer pass sails over the blade
{
  const [g, p, [d]] = scene([6, { team: 1, x: 0, y: 0, face: 0 }]);
  Object.assign(p, { x: d.bx - 3, y: d.by, vx: 14, vy: 0, kind: 'pass', lastTeam: 0, from: g.skaters[0], target: g.skaters[1], age: 0.5, lifted: true, liftT: 1 });
  stepPuck(g, p, 60, [d]);
  check(p.owner !== d && p.x > d.bx + 1, 'saucer pass goes over the blade');
}
// 2b. a saucer still earns Heat for each lane stick it clears (home team)
{
  const [g, p, [d]] = scene([6, { team: 1, x: 0, y: 0, face: 0 }]);
  Object.assign(p, { x: d.bx - 3, y: d.by, vx: 14, vy: 0, kind: 'pass', lastTeam: 0, from: g.skaters[0], target: g.skaters[1], age: 0.5, lifted: true, liftT: 1 });
  const h0 = g.heat; stepPuck(g, p, 60, [d]);
  check(g.heat > h0, 'saucer pass over a blade still earns Heat', `heat ${h0} -> ${g.heat}`);
}
// 2c. a Split ghost puck dies on a blade (it can never be trapped and carried)
{
  const [g, p, [d]] = scene([6, { team: 1, x: 0, y: 0, face: 0 }]);
  Object.assign(p, { x: d.bx - 3, y: d.by, vx: 12, vy: 0, kind: 'shot', lastTeam: 0, shooter: g.skaters[0], age: 0.5, ghost: true });
  stepPuck(g, p, 60, [d]);
  check(!p.alive && p.owner !== d, 'a ghost puck dies on a blade');
}
// 3. no tunnelling: a 120 u/s puck at a blade moves at most 1 unit per step, and still hits it
{
  const [g, p, [d]] = scene([6, { team: 1, x: 0, y: 0, face: 0 }]);
  Object.assign(p, { x: d.bx - 4, y: d.by, vx: 120, vy: 0, kind: 'shot', lastTeam: 0, shooter: g.skaters[0], age: 0.5 });
  stepPuck(g, p, 10, [d]);
  check(p.vx < 100, 'a 120 u/s shot does not tunnel through a blade', `vx after ${p.vx.toFixed(1)}`);
}
// 4. a moving blade sweeps a still puck (stick swing hits it even if the puck sits between two steps of the blade)
{
  const [g, p, [d]] = scene([6, { team: 1, x: 0, y: 0, face: 0 }]);
  Object.assign(p, { x: d.bx, y: d.by + 0.9, vx: 0, vy: 0, kind: 'loose', lastTeam: 0, age: 1 });
  d.pickupCd = 1;   // can't take it: it must be knocked
  d.stickY = d.by + 2; g.placeBlade(d, DT); g.updatePuck(p, DT);
  check(Math.hypot(p.vx, p.vy) > 1 && Math.hypot(p.vx, p.vy) <= 30, 'a swung blade hits a puck it passes over in one step', `puck speed ${Math.hypot(p.vx, p.vy).toFixed(1)}`);
}
// 5. pokes: the blade must reach the puck; the carrier's body shields it
function pokeAt(cface) {
  const [g, p, [c, d]] = scene([0, { team: 0, x: 0, y: 0, face: cface }], [6, { team: 1, x: 1.9, y: 0, face: Math.PI }]);
  p.owner = c; c.settle = 0; c.spinT = 0;
  for (let i = 0; i < 3; i++) { g.updatePuck(p, DT); g.placeBlade(c, DT); g.placeBlade(d, DT); }
  g.startCheck(d, 'poke');
  for (let i = 0; i < 40 && p.owner === c; i++) { d.pokeT -= DT; g.placeBlade(c, DT); g.placeBlade(d, DT); if (!d.pokeHit) g.pokeContact(d, DT); g.updatePuck(p, DT); }
  return [p.owner === c, c, d];
}
{ const [kept] = pokeAt(0); check(!kept, 'poke at a puck out front knocks it loose'); }
{ const [kept] = pokeAt(Math.PI); check(kept, 'carrier turned away shields the puck from a poke'); }
// 6. stick lift from behind: his stick comes off the ice and the puck stays
{
  const [g, p, [c, d]] = scene([0, { team: 0, x: 0, y: 0, face: 0, vx: 4 }], [6, { team: 1, x: -0.9, y: 0.7 * S.handOf(0), face: 0 }]);   // behind him on his stick side
  p.owner = c;
  for (let i = 0; i < 3; i++) { g.updatePuck(p, DT); g.placeBlade(c, DT); g.placeBlade(d, DT); }
  g.startCheck(d, 'poke');
  let lifted = false;
  for (let i = 0; i < 40; i++) { d.pokeT -= DT; g.placeBlade(c, DT); g.placeBlade(d, DT); if (!d.pokeHit) g.pokeContact(d, DT); g.updatePuck(p, DT); lifted ||= c.liftT > 0; }
  check(lifted && p.owner !== c, 'stick lift from behind lifts his stick and frees the puck', `liftT seen ${lifted}`);
  check(!c.bOn || c.liftT <= 0, 'a lifted stick has no blade on the ice');
}
// 6b. stick lift from directly behind (on his centre line): reaching round him for the shaft still works
{
  const [g, p, [c, d]] = scene([0, { team: 0, x: 0, y: 0, face: 0, vx: 4 }], [6, { team: 1, x: -1.1, y: 0, face: 0 }]);
  p.owner = c;
  for (let i = 0; i < 3; i++) { g.updatePuck(p, DT); g.placeBlade(c, DT); g.placeBlade(d, DT); }
  g.startCheck(d, 'poke');
  let lifted = false;
  for (let i = 0; i < 40; i++) { d.pokeT -= DT; g.placeBlade(c, DT); g.placeBlade(d, DT); if (!d.pokeHit) g.pokeContact(d, DT); g.updatePuck(p, DT); lifted ||= c.liftT > 0; }
  check(lifted, 'stick lift from directly behind');
}
// 7. stick on stick from the front, carrier turned away: his stick is knocked aside
{
  const [g, p, [c, d]] = scene([0, { team: 0, x: 0, y: 0, face: Math.PI / 2 }], [6, { team: 1, x: 1.8, y: 1.6, face: Math.PI }]);
  p.owner = c;
  for (let i = 0; i < 3; i++) { g.updatePuck(p, DT); g.placeBlade(c, DT); g.placeBlade(d, DT); }
  d.stickX = c.bx; d.stickY = c.by; g.startPoke(d, c.hx + (c.bx - c.hx) * 0.5, c.hy + (c.by - c.hy) * 0.5);
  let tied = false;
  for (let i = 0; i < 40; i++) { d.pokeT -= DT; g.placeBlade(c, DT); g.placeBlade(d, DT); if (!d.pokeHit) g.pokeContact(d, DT); g.updatePuck(p, DT); tied ||= c.tieT > 0 || c.liftT > 0 || p.owner !== c; }
  check(tied, 'a poke into his stick knocks it aside or frees the puck');
}
// 8. handedness: the carried puck rides on the shot side, forehand
for (const hand of [1, -1]) {
  const [g, p, [c]] = scene([0, { team: 0, x: 0, y: 0, face: 0, hand }]);
  p.owner = c; c.bh = 0;
  for (let i = 0; i < 60; i++) { g.placeBlade(c, DT); g.updatePuck(p, DT); }
  const lat = -Math.sin(c.face) * (p.x - c.x) + Math.cos(c.face) * (p.y - c.y);
  check(Math.sign(lat) === hand && p.x === c.bx, `${hand > 0 ? 'right' : 'left'} shot carries on the forehand, on the blade`, `lat ${lat.toFixed(2)}`);
}
// 9. a full bot match: no blade ever inside another skater's body, outside the boards or inside a net
{
  const g = new S.Game(3, S.OPPONENTS[1], P, 11); g.autoplay = true;
  const NO = { mx: 0, my: 0, pass: false, shoot: false, check: false, burst: false };
  let worstBody = 9, outside = 0, inNet = 0, steps = 0, stick = {};
  const evs = () => { for (const e of g.events) if (e.t === 'stick') stick[e.text] = (stick[e.text] || 0) + 1; g.events.length = 0; };
  while (g.phase !== 'over' && steps < 120 * 150) {
    g.step(DT, NO); evs(); steps++;
    for (const s of g.skaters) {
      if (!s.bOn) continue;
      for (const o of g.skaters) if (o !== s && o.out <= 0 && !o.air) worstBody = Math.min(worstBody, Math.hypot(s.bx - o.x, s.by - o.y));
      if (!S.insideRink(s.bx, s.by, S.STICK.r)) outside++;
      const lx = Math.abs(s.bx) - S.GL; if (lx > 0.02 && lx < S.NET_DEPTH - 0.02 && Math.abs(s.by) < S.GOAL_HALF - 0.02) inNet++;
    }
  }
  check(worstBody >= S.STICK.bodyR - 0.1,   // the boards win where a body pins a blade against them
    'no blade inside another body over a full match', `closest blade to a body ${worstBody.toFixed(2)} (body radius ${S.STICK.bodyR})`);
  check(outside === 0, 'no blade through the boards', `${outside} blade-steps outside`);
  check(inNet === 0, 'no blade inside a net', `${inNet} blade-steps inside`);
  check(Object.keys(stick).length > 1, 'stick contacts happen in real play', JSON.stringify(stick));
  console.log(`match: ${(steps / 120).toFixed(0)} s, score ${g.score.join('-')}`);
}
console.log(fails ? `${fails} FAILED` : 'all pass');
process.exit(fails ? 1 : 0);
