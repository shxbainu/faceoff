// Physics probe for the ?test rink: drives the lone skater with real key presses and measures
// heading vs keys (sim, screen and drawn body), acceleration and top speed, coasting glide, turn radius at
// low and high speed, braking, and which way the body leans in a turn.
// Usage: node tests/physics_probe.mjs [--port 4173]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe', detached: true });   // own process group, so the whole preview server can be stopped
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4173') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium',
  args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:4173/?test&seed=1');
await page.waitForFunction(() => window.__faceoff);
await page.evaluate(() => window.__faceoff.assetsReady());
for (let i = 0; i < 20; i++) {
  const s = await page.evaluate(() => window.__faceoff.snap());
  if (s.mode === 'match') break;
  await page.keyboard.press('Enter'); await page.waitForTimeout(200);
}
const deg = a => Math.round(a * 180 / Math.PI);
const state = () => page.evaluate(() => {
  const s = window.__faceoff.snap(), i = s.skaters.findIndex(k => k.ctrl), k = s.skaters[i];
  return { x: k.x, y: k.y, vx: k.vx, vy: k.vy, face: k.face, sp: Math.hypot(k.vx, k.vy), scr: window.__faceoff.screen(k.x, k.y), body: window.__faceoff.body(i), t: performance.now() / 1000 };
});
// hold keys for a time, sampling every ~40 ms
async function hold(keys, sec) {
  for (const k of keys) await page.keyboard.down(k);
  const out = []; const t0 = Date.now();
  while (Date.now() - t0 < sec * 1000) { out.push(await state()); await page.waitForTimeout(40); }
  for (const k of keys) await page.keyboard.up(k);
  return out;
}
const idle = sec => hold([], sec);
async function stopHere() {   // brake against the motion while fast, then let go and settle
  for (let i = 0; i < 120; i++) {
    const s = await state(); if (s.sp < 0.2) return;
    if (s.sp > 3) { const k = Math.abs(s.vx) > Math.abs(s.vy) ? (s.vx > 0 ? 'KeyS' : 'KeyW') : (s.vy > 0 ? 'KeyA' : 'KeyD'); await hold([k], 0.05); }
    else await idle(0.05);
  }
}
async function recenter() {   // skate back near the middle and stop
  for (let i = 0; i < 60; i++) {
    const s = await state(); if (Math.hypot(s.x, s.y) < 3) break;
    const keys = []; if (s.x > 1.5) keys.push('KeyS'); if (s.x < -1.5) keys.push('KeyW'); if (s.y > 1.5) keys.push('KeyA'); if (s.y < -1.5) keys.push('KeyD');
    await hold(keys, 0.15);
  }
  await stopHere();
}
const report = {};

// A. heading per key from rest: sim velocity, screen motion, drawn body forward
for (const [key, want] of [['KeyW', 'up-ice / screen up'], ['KeyD', 'screen right'], ['KeyS', 'screen down'], ['KeyA', 'screen left']]) {
  await recenter();
  const s0 = await state(); const tr = await hold([key], 0.7); const s1 = tr.at(-1);
  report['heading ' + key] = {
    expected: want,
    simVelocityDeg: deg(Math.atan2(s1.vy, s1.vx)),            // 0 = up-ice, +90 = screen right
    screenDir: await page.evaluate(([x, y, vx, vy]) => { const a = window.__faceoff.screen(x, y), b = window.__faceoff.screen(x + vx * 0.2, y + vy * 0.2);
      return [Math.round(b[0] - a[0]), Math.round(b[1] - a[1])]; }, [s1.x, s1.y, s1.vx, s1.vy]),   // same-instant projection: px, +x right, +y down
    facingDeg: deg(s1.face),
    bodyForwardDeg: deg(Math.atan2(s1.body.fwd[1], s1.body.fwd[0])),
  };
}

// B/C. acceleration to top speed, then coast with no keys
await recenter(); await hold(['KeyS'], 1.2); await stopHere();
let tr = await hold(['KeyW'], 3.0);
const top = Math.max(...tr.map(s => s.sp)), t90 = tr.find(s => s.sp >= 0.9 * top);
report.accelerate = { topSpeed: +top.toFixed(2), secTo90pct: +(t90.t - tr[0].t).toFixed(2) };
const c0 = tr.at(-1); tr = await idle(2.5);
const at = sec => tr.find(s => s.t - tr[0].t >= sec) ?? tr.at(-1);
report.coast = { startSpeed: +c0.sp.toFixed(2), after1s: +at(1).sp.toFixed(2), after2s: +at(2).sp.toFixed(2),
  distance2_5s: +Math.hypot(tr.at(-1).x - c0.x, tr.at(-1).y - c0.y).toFixed(2) };

// D/E. 90 degree turn (heading up-ice, then hold D) at high and low speed
async function turnTest(runUp) {
  await recenter(); await hold(['KeyS'], 1.0); await stopHere();
  await hold(['KeyW'], runUp);
  const tr = await hold(['KeyD'], 1.6);
  const s0 = tr[0]; let done = tr.findIndex(s => Math.abs(Math.atan2(s.vy, s.vx) - Math.PI / 2) < 0.17);
  if (done < 0) done = tr.length - 1;
  const span = tr.slice(0, done + 1);
  // radius from path: arc length / heading change
  let arc = 0; for (let i = 1; i < span.length; i++) arc += Math.hypot(span[i].x - span[i - 1].x, span[i].y - span[i - 1].y);
  const dh = Math.abs(Math.atan2(span.at(-1).vy, span.at(-1).vx) - Math.atan2(s0.vy, s0.vx));
  // lean: drawn body's up vector toward the turn centre (+y side for this right turn) is positive
  const mid = span[Math.floor(span.length / 2)];
  return { entrySpeed: +s0.sp.toFixed(2), turnSec: +(span.at(-1).t - s0.t).toFixed(2), radius: +(arc / (dh || 1e-3)).toFixed(2),
    speedKeptPct: Math.round(100 * span.at(-1).sp / (s0.sp || 1)), leanTowardCentre: +(mid.body.up[2]).toFixed(3), leanVar: +mid.body.lean.toFixed(3), bodyRot: mid.body.rot.map(v => +v.toFixed(2)), faceDeg: deg(mid.face) };
}
report.turnHighSpeed = await turnTest(2.5);
report.turnLowSpeed = await turnTest(0.25);

// F. braking: top speed then hold the opposite key
await recenter(); await hold(['KeyS'], 1.0); await stopHere(); await hold(['KeyW'], 2.5);
tr = await hold(['KeyS'], 1.5);
const stopAt = tr.find(s => s.vx <= 0.3);
report.brake = { fromSpeed: +tr[0].sp.toFixed(2), secToStop: stopAt ? +(stopAt.t - tr[0].t).toFixed(2) : '>1.5' };

// G. reversal: full speed up-ice, then hold the opposite key; track facing and drawn body heading
await recenter(); await hold(['KeyS'], 1.0); await stopHere(); await hold(['KeyW'], 2.0);
tr = await hold(['KeyS'], 1.4);
const unwrap = a => { const out = [a[0]]; for (let i = 1; i < a.length; i++) { let d = a[i] - a[i - 1]; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; out.push(out[i - 1] + d); } return out; };
const bodyH = unwrap(tr.map(s => Math.atan2(s.body.fwd[1], s.body.fwd[0]))), faceH = unwrap(tr.map(s => s.face));
const travel = a => { let t = 0; for (let i = 1; i < a.length; i++) t += Math.abs(a[i] - a[i - 1]); return t; };
const tTurn = tr.find((s, i) => Math.abs(bodyH[i] - bodyH[0]) > Math.PI * 0.9);
report.reverse180 = { bodyTurnedDeg: deg(bodyH.at(-1) - bodyH[0]), bodyRotationTravelDeg: deg(travel(bodyH)), faceTravelDeg: deg(travel(faceH)),
  secToFaceBack: tTurn ? +(tTurn.t - tr[0].t).toFixed(2) : '>1.4', endSpeed: +tr.at(-1).sp.toFixed(2), endVelDeg: deg(Math.atan2(tr.at(-1).vy, tr.at(-1).vx)) };
// H. sprint bar: hold W + Shift from rest until winded, then let go and time the refill
await recenter(); await hold(['KeyS'], 1.0); await stopHere();
const bar = () => page.evaluate(() => { const s = window.__faceoff.snap(), k = s.skaters.find(k => k.ctrl); return { st: k.stamina, sprint: k.sprint, gassed: k.gassed, sp: Math.hypot(k.vx, k.vy) }; });
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
const t0 = Date.now(); let topSp = 0, gassedAt = null;
while (Date.now() - t0 < 4000) { const b = await bar(); topSp = Math.max(topSp, b.sp); if (b.gassed && gassedAt == null) gassedAt = (Date.now() - t0) / 1000; if (gassedAt) break; await page.waitForTimeout(40); }
const winded = await bar();
await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
const t1 = Date.now(); let unlockAt = null, fullAt = null;
while (Date.now() - t1 < 6000) { const b = await bar(); if (!b.gassed && unlockAt == null) unlockAt = (Date.now() - t1) / 1000; if (b.st >= 0.999) { fullAt = (Date.now() - t1) / 1000; break; } await page.waitForTimeout(40); }
report.sprint = { sprintTopSpeed: +topSp.toFixed(2), secToEmpty: gassedAt, windedSpeed: +winded.sp.toFixed(2), secToUnlock: unlockAt, secToFull: fullAt };
console.log(JSON.stringify(report, null, 1));
await browser.close(); process.kill(-server.pid);
