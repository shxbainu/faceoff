// Headless checks for skating, facing, handedness and bot defense (the sim only, no browser).
// Usage: node tests/move_probe.mjs        exits 1 if any check fails
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const out = mkdtempSync(tmpdir() + '/move-') + '/sim.mjs';
await build({ entryPoints: ['src/sim.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const S = await import(pathToFileURL(out).href);
const P = Object.fromEntries(S.POWERS.map(p => [p.id, 0]));
const NO = { mx: 0, my: 0, pass: false, shoot: false, check: false, burst: false };
const DT = 1 / 120;
let fails = 0;
const check = (ok, name, info = '') => { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); if (!ok) fails++; };
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// --- skating on the empty test rink
const rink = () => { const g = new S.Game(1, S.OPPONENTS[0], P, 5); g.sandbox = true; g.step(DT, NO); const s = g.ctrl; Object.assign(s, { x: 0, y: 0, vx: 0, vy: 0, face: 0 }); return [g, s]; };
const run = (g, c, t) => { for (let i = 0; i < Math.round(t / DT); i++) g.step(DT, { ...NO, ...c }); };
const until = (g, c, cond, max = 3) => { let t = 0; while (!cond() && t < max) { g.step(DT, { ...NO, ...c }); t += DT; } return t; };
{
  let [g, s] = rink();
  const t = until(g, { mx: 1 }, () => Math.hypot(s.vx, s.vy) > 0.95 * s.move.topSpeed);
  check(t < 0.45, 'quick to top speed', `${t.toFixed(2)} s`);
  run(g, { mx: 1 }, 1);
  const ts = until(g, { mx: -1 }, () => s.vx < 0.3);
  check(ts < 0.3, 'hockey stop kills speed fast', `${ts.toFixed(2)} s from top speed`);
  [g, s] = rink(); run(g, { mx: 1 }, 1.5);
  const sp0 = Math.hypot(s.vx, s.vy); let low = sp0;
  const tt = until(g, { my: 1 }, () => { low = Math.min(low, Math.hypot(s.vx, s.vy)); return Math.atan2(s.vy, s.vx) > 1.5; }), kept = low / sp0;
  check(tt > 0.25 && tt < 0.6, '90 degree turn at full speed takes time', `${tt.toFixed(2)} s`);
  check(kept > 0.6 && kept < 0.93, 'tight turn costs some speed', `low point ${(kept * 100).toFixed(0)}% of top speed`);
  // no velocity snap: the biggest change in one step during a full reversal
  [g, s] = rink(); run(g, { mx: 1 }, 1.5);
  let jump = 0, pv = [s.vx, s.vy];
  for (let i = 0; i < 120; i++) { g.step(DT, { ...NO, mx: -1 }); jump = Math.max(jump, Math.hypot(s.vx - pv[0], s.vy - pv[1])); pv = [s.vx, s.vy]; }
  check(jump < 1.5, 'no velocity snap at the end of a stop', `max change per step ${jump.toFixed(2)}`);
  // spin the skater in circles both ways: facing stays finite and inside (-pi, pi]
  [g, s] = rink(); let bad = false;
  for (let i = 0; i < 30 * 120; i++) { const a = (i < 15 * 120 ? 1 : -1) * i * 0.05; g.step(DT, { ...NO, mx: Math.cos(a), my: Math.sin(a) }); if (!Number.isFinite(s.face) || Math.abs(s.face) > Math.PI + 1e-9 || !Number.isFinite(s.vx)) bad = true; }
  check(!bad, '30 s of spinning both ways: facing finite and wrapped');
}

// --- shots are taken facing the net
{
  const [g, s] = rink(); s.face = Math.PI / 2; Object.assign(s, { x: 10, y: 8 }); g.pucks[0].owner = s;
  g.doShot(s, 0.5, false, 0, true);
  const net = Math.atan2(-8, S.GL - 10);
  check(Math.abs(Math.atan2(Math.sin(s.face - net), Math.cos(s.face - net))) < 0.01, 'shooter faces the net on release', `facing ${(s.face * 57.3).toFixed(0)} net ${(net * 57.3).toFixed(0)} deg`);
}

// --- input buffer: a check pressed during its cooldown still goes off when the cooldown ends
{
  const [g, s] = rink(); s.checkCd = 0.08;
  g.step(DT, { ...NO, check: true }); for (let i = 0; i < 30 && s.checkT <= 0; i++) g.step(DT, NO);
  check(s.checkT > 0, 'buffered check fires after cooldown');
  const [g2, s2] = rink(); s2.checkCd = 0.4; s2.checkT = 0;
  g2.step(DT, { ...NO, check: true }); for (let i = 0; i < 60; i++) g2.step(DT, NO);
  check(s2.checkT <= 0 || s2.checkCd > 0.5, 'a stale press expires instead of firing late');
}

// --- a buffered press dies with a control switch: it never fires later for a skater with no key held
{
  const g = new S.Game(1, S.OPPONENTS[0], P, 9); g.step(DT, NO);
  for (let i = 0; i < 400 && g.phase !== 'play'; i++) g.step(DT, NO);
  const A = g.ctrl, B = g.skaters.find(k => k.team === 0 && k !== A);
  g.pucks[0].owner = null; g.step(DT, { ...NO, pass: true });   // pass with nobody holding it: buffered
  g.setCtrl(B); for (let i = 0; i < 30; i++) g.step(DT, NO);
  g.pucks[0].owner = A; g.setCtrl(A); const before = g.stats.passes[0] + g.events.filter(e => e.t === 'pass').length;
  g.events.length = 0; g.step(DT, NO);
  check(g.pucks[0].owner === A && !g.events.some(e => e.t === 'pass'), 'no phantom pass after switching control back');
}

// --- backhand passes are a little off line, forehand passes are on the tape
{
  const aim = bh => { const g = new S.Game(1, S.OPPONENTS[0], P, 9); g.step(DT, NO); const s = g.skaters[0], m = g.skaters[1];
    Object.assign(s, { x: 0, y: 0, vx: 0, vy: 0, face: 0, bh }); Object.assign(m, { x: 12, y: 0, vx: 0, vy: 0 }); g.pucks[0].owner = s;
    g.doPass(s, m, 0, 0, false); return [g.pucks[0].ax, g.pucks[0].ay]; };
  const f = aim(0), b = aim(1);
  check(Math.hypot(f[0] - 12, f[1]) < 0.01 && Math.hypot(b[0] - 12, b[1]) > 0.05, 'backhand pass misses the tape a little', `forehand (${f.map(v => v.toFixed(2))}) backhand (${b.map(v => v.toFixed(2))})`);
}

// --- your defender skates backward facing the carrier, and pivots on sprint
{
  const g = new S.Game(1, S.OPPONENTS[0], P, 9); g.step(DT, NO);
  for (let i = 0; i < 400 && g.phase !== 'play'; i++) g.step(DT, NO);
  const me = g.ctrl, car = g.skaters.find(k => k.team === 1);
  g.pucks[0].owner = car; g.pucks[0].kind = 'loose';
  for (const k of g.skaters) if (k !== me && k !== car) { k.out = 1e9; }
  Object.assign(me, { x: -5, y: 0, vx: 0, vy: 0, face: 0 }); Object.assign(car, { x: 3, y: 0, vx: -5, vy: 0, face: Math.PI });
  // hold S (back toward our net, -x) while he comes at you
  let backFacing = 0, n = 0;
  for (let i = 0; i < 90; i++) { car.vx = -5; car.vy = 0; g.step(DT, { ...NO, mx: -1 }); if (i > 30) { n++; const fc = Math.cos(wrap(me.face - Math.atan2(car.y - me.y, car.x - me.x))); if (fc > 0.9 && me.vx < -1) backFacing++; } }
  check(backFacing / n > 0.9, 'your defender skates backward facing the carrier', `${(100 * backFacing / n).toFixed(0)}% of frames, mode ${me.faceMode}`);
  for (let i = 0; i < 40; i++) { car.vx = -5; g.step(DT, { ...NO, mx: -1, burst: true }); }
  check(Math.cos(me.face - Math.PI) > 0.9, 'sprint pivots you to skate forward', `facing ${(me.face * 180 / Math.PI).toFixed(0)} deg`);
}

// --- handedness
{
  const g = new S.Game(1, S.OPPONENTS[0], P, 3);
  const hands = g.skaters.map(k => k.hand);
  const left = hands.filter(h => h < 0).length;
  check(left > 0 && left < hands.length, 'both shot sides on the ice', `${left} left, ${hands.length - left} right`);
  for (const t of [0, 1]) check(new Set(g.skaters.filter(k => k.team === t).map(k => k.hand)).size === 2, `team ${t} has lefties and righties`);
  // the puck rides on the shot side, and steering across the body pulls it to the backhand
  const [g2, s] = rink(); g2.pucks[0].owner = s; s.hand = -1;
  const step0 = g2.step.bind(g2); g2.step = (dt, c) => { step0(dt, c); g2.updatePuck(g2.pucks[0], dt); };   // the test rink skips the puck
  run(g2, { mx: 1 }, 0.5);
  const lat = () => { const p = g2.pucks[0]; return (-Math.sin(s.face) * (p.x - s.x) + Math.cos(s.face) * (p.y - s.y)) * s.hand; };
  check(lat() > 0.3, 'puck on the forehand (shot) side', `lateral ${lat().toFixed(2)}`);
  run(g2, { mx: 1, my: 1 }, 0.3);   // a left shot skating up-ice cuts right: across to the backhand
  check(s.bh > 0.9 && lat() < 0, 'cutting across pulls it to the backhand', `bh ${s.bh.toFixed(2)} lateral ${lat().toFixed(2)}`);
  run(g2, { mx: 1, my: 1 }, 1.5);
  check(s.bh < 0.2, 'let go and it drifts back to the forehand', `bh ${s.bh.toFixed(2)}`);
}

// --- body checks follow momentum: faster in, further out; square beats glancing
{
  const sent = (speed, angle) => {
    const g = new S.Game(1, S.OPPONENTS[0], P, 7); g.step(DT, NO);
    const a = g.skaters[0], b = g.skaters[5];
    Object.assign(b, { x: 0, y: 0, vx: 0, vy: 0, stun: 0, face: 0 });
    Object.assign(a, { x: -Math.cos(angle) * 1.2, y: -Math.sin(angle) * 1.2, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, stun: 0 });
    a.checkT = 0.3; a.hits.clear(); g.hit(a, b);
    return { v: Math.hypot(b.vx, b.vy), down: b.stun > 0 };
  };
  const vs = [6, 9, 12, 15, 18].map(v => sent(v, 0));
  console.log('      knockback by checker speed 6/9/12/15/18:', vs.map(r => r.v.toFixed(1) + (r.down ? '*' : '')).join(' '), '(* = knocked down)');
  check(vs.every((r, i) => i === 0 || r.v > vs[i - 1].v), 'faster checker sends the victim further');
  check(!vs[0].down && vs[3].down, 'slow bump ties up, fast hit knocks down');
  const g = new S.Game(1, S.OPPONENTS[0], P, 7); g.step(DT, NO);
  const sq = sent(14, 0).v, a = g.skaters[0], b = g.skaters[5];
  Object.assign(b, { x: 0, y: 0, vx: 0, vy: 0, stun: 0 }); Object.assign(a, { x: -0.6, y: -1.0, vx: 14, vy: 0, stun: 0 }); a.hits.clear(); g.hit(a, b);
  check(Math.hypot(b.vx, b.vy) < sq, 'glancing hit is worth less than a square one', `${Math.hypot(b.vx, b.vy).toFixed(1)} vs ${sq.toFixed(1)}`);
  Object.assign(b, { x: 0, y: 0, vx: 0, vy: 8, stun: 0 }); Object.assign(a, { x: -1.2, y: 0, vx: 14, vy: 0, stun: 0 }); a.hits.clear(); g.hit(a, b);
  check(b.vy > 3 && b.vx > 5, 'victim keeps his own momentum (sent on a diagonal)', `(${b.vx.toFixed(1)}, ${b.vy.toFixed(1)})`);
}

// --- bot defense over full bot-vs-bot matches
{
  const tally = { press: 0, steps: 0, back: 0, defSteps: 0, chasers: 0, ev: {} };
  for (let m = 0; m < 4; m++) {
    const g = new S.Game(1 + m, S.OPPONENTS[m % 3], P, 400 + m); g.autoplay = true;
    for (let k = 0; k < 120 * 200 && g.phase !== 'over'; k++) {
      g.step(DT, NO);
      for (const e of g.events) tally.ev[e.t] = (tally.ev[e.t] || 0) + 1;
      g.events.length = 0;
      const car = g.pucks[0].owner;
      if (g.phase !== 'play' || !car) continue;
      tally.steps++;
      const defs = g.skaters.filter(k => k.team !== car.team && k.stun <= 0 && k.out <= 0);
      const near = defs.filter(k => Math.hypot(k.x - car.x, k.y - car.y) < 3.5).length;
      tally.chasers += near;
      for (const d of defs) {
        const dir = d.team === 0 ? 1 : -1, ahead = (car.x - d.x) * dir > 0, dist = Math.hypot(car.x - d.x, car.y - d.y);
        if (ahead && dist < 12) { tally.defSteps++; if (d.faceMode === 'back' || d.faceMode === 'square') tally.back++; }
      }
    }
  }
  const e = tally.ev;
  console.log('      bot matches:', JSON.stringify({ goals: e.goal, shots: e.shot, hits: e.hit, pokes: e.poke, pokeTries: e.pokeTry, lunges: e.lunge, saves: e.save, turnovers: e.turnover }));
  check(tally.back / tally.defSteps > 0.45, 'defenders with the carrier in front of them face him', `${(100 * tally.back / tally.defSteps).toFixed(0)}% of defender-frames`);
  check(tally.chasers / tally.steps < 1.6, 'no swarm: defenders near the carrier on average', (tally.chasers / tally.steps).toFixed(2));
  check((e.poke || 0) + (e.hit || 0) > 10, 'defense takes the puck with pokes, lifts and hits', `${e.poke || 0} pokes/lifts, ${e.hit || 0} hits`);
  check((e.goal || 0) > 4 && (e.shot || 0) > 20, 'attack still gets through (beatable)', `${e.goal} goals from ${e.shot} shots`);
}
console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
process.exit(fails ? 1 : 0);
