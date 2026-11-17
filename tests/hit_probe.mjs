// Hit / stick-drop probe (headless). Stages real body checks in a live sim and checks the rules:
//   - a big hit downs the target for HIT.stunBig seconds and always knocks the stick loose
//   - a normal knockdown downs him for HIT.stunNormal and drops the stick about HIT.dropNormal of the time
//   - without a stick he cannot pick up the puck, wind up a shot or poke
//   - he gets it back by skating over it (bots go for it), else a spare after HIT.STICK_SPARE seconds
// Usage: node tests/hit_probe.mjs [path/to/sim.ts]
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const src = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'src/sim.ts';
const out = mkdtempSync(tmpdir() + '/hitprobe-') + '/sim.mjs';
await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const S = await import(pathToFileURL(out).href);
const idle = { mx: 0, my: 0, pass: false, shoot: false, check: false, burst: false };
const dt = 1 / 120;
function setup(seed) {
  const powers = Object.fromEntries(S.POWERS.map(p => [p.id, 0]));
  const g = new S.Game(1, S.OPPONENTS[0], powers, seed);
  g.autoplay = true;
  for (let k = 0; k < 120 * 6 && g.phase !== 'play'; k++) g.step(dt, idle);
  return g;
}
// one staged hit: checker a (team 1) at closing speed v into target b (team 0) standing still
function stage(seed, v) {
  const g = setup(seed);
  const a = g.skaters.find(s => s.team === 1), b = g.skaters.find(s => s.team === 0 && s !== g.ctrl) ?? g.skaters.find(s => s.team === 0);
  for (const s of g.skaters) if (s !== a && s !== b) { s.x = -30 + s.id; s.y = 15; s.vx = s.vy = 0; }
  b.x = 0; b.y = 0; b.vx = b.vy = 0; b.stun = 0; b.stickless = 0;
  a.x = -1.6; a.y = 0; a.vx = v; a.vy = 0; a.face = 0; a.checkT = 0.3; a.hits.clear(); a.stun = 0;
  const ev = [];
  for (let k = 0; k < 6 && !ev.some(e => e.t === 'hit' || e.t === 'bump'); k++) { g.step(dt, idle); ev.push(...g.events); g.events.length = 0; }
  const hit = ev.find(e => e.t === 'hit');
  return { g, a, b, hit, bump: ev.some(e => e.t === 'bump'), stun: b.stun, stickless: b.stickless > 0, sticks: g.sticks.length };
}
const log = {};
// big hits
const big = [];
for (let i = 0; i < 20; i++) { const r = stage(100 + i, 17); big.push(r); }
log.bigHit = { trials: big.length, hits: big.filter(r => r.hit?.big).length, meanStunSec: +(big.reduce((x, r) => x + r.stun, 0) / big.length).toFixed(2),
  stickDropped: big.filter(r => r.stickless && r.sticks === 1).length };
// normal hits
const nor = [];
for (let i = 0; i < 60; i++) nor.push(stage(300 + i, 10));
const nh = nor.filter(r => r.hit && !r.hit.big);
log.normalHit = { trials: nor.length, knockdowns: nh.length, meanStunSec: +(nh.reduce((x, r) => x + r.stun, 0) / (nh.length || 1)).toFixed(2), dropRate: +(nh.filter(r => r.stickless).length / (nh.length || 1)).toFixed(2) };
// without a stick: no puck pickup, no wind-up, no poke; then the recovery
{
  const r = big.find(x => x.stickless);
  const { g, b } = r;
  const p = g.pucks[0];
  const res = {};
  // let him get up, then park the puck on him: he must not take it while stickless
  while (b.stun > 0) g.step(dt, idle);
  p.owner = null; p.kind = 'loose'; p.x = b.x + 0.4; p.y = b.y; p.vx = p.vy = 0;
  const st = g.sticks[0]; st.x = b.x + 12; st.y = b.y; st.vx = st.vy = 0;   // stick far away so he can't grab it at once
  b.human = true; g.ctrl = b;
  let took = false;
  for (let k = 0; k < 30; k++) { p.x = b.x + 0.4; p.y = b.y; p.vx = p.vy = 0; g.step(dt, { ...idle, shoot: true }); if (p.owner === b) took = true; }
  res.pickedUpPuckWithoutStick = took;
  res.woundUpWithoutStick = b.wind >= 0;
  b.checkCd = 0; const before = g.events.length; g.step(dt, { ...idle, poke: true }); g.step(dt, idle);
  res.pokedWithoutStick = g.events.slice(before).some(e => e.t === 'pokeTry' || e.t === 'poke');
  // recovery: skate to the stick (drive him toward it as a player would)
  let t = 0;
  while (b.stickless > 0 && t < 12) { const dx = st.x - b.x, dy = st.y - b.y, d = Math.hypot(dx, dy) || 1; g.step(dt, { ...idle, mx: dx / d, my: dy / d }); t += dt; }
  res.recoveredBySkatingOver = b.stickless <= 0 && t < S.HIT.STICK_SPARE; res.secToRecover = +t.toFixed(2);
  log.stickless = res;
}
// bots: how long until a bot whose stick was knocked loose has it back
{
  const times = [];
  for (const r of big.filter(x => x.stickless)) {
    const { g, b } = r; b.human = false; let t = 0;
    while (b.stickless > 0 && t < 15) { g.step(dt, idle); t += dt; }
    times.push(t);
  }
  times.sort((a, b) => a - b);
  log.botRecovery = { n: times.length, medianSec: +times[Math.floor(times.length / 2)].toFixed(2), maxSec: +times.at(-1).toFixed(2), spareCap: S.HIT.STICK_SPARE };
}
console.log(JSON.stringify(log, null, 1));
