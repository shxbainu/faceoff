// Feedback layer probe (Playwright, built game). Checks that:
//  1. every feedback event fires from the debug path at low, medium and high intensity
//  2. frame rate holds through the heaviest sequence (back-to-back max goals on top of live play) and the full sweep
//  3. the toggles (shake, flashes, slow-mo, chroma) and the intensity slider do what they say, and the feel panel works by keyboard
//  4. the config is live (editing an entry changes what the next event does)
//  5. the goal celebration is skippable; a tap during hit stop still reaches the sim (input buffer); ?netfx never scales sim time
// Usage: node tests/fx_probe.mjs [--webgl]. Screenshots go to tests/out/fx-*.png, results to tests/out/fx-report.json
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('tests/out', { recursive: true });
const WEBGL = process.argv.includes('--webgl');
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4173') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium',
  args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const report = { checks: [], perf: {} };
const check = (name, ok, info = '') => { report.checks.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); };
const errors = [];

async function open(query = '') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', m => { if (m.type() === 'error' && !/swapchain|size 0/i.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  await page.goto(`http://localhost:4173/?seed=5${WEBGL ? '&webgl' : ''}${query ? '&' + query : ''}`);
  await page.waitForFunction(() => window.__faceoff);
  await page.evaluate(() => window.__faceoff.assetsReady());
  for (let i = 0; i < 40; i++) {
    const s = await page.evaluate(() => window.__faceoff.snap());
    if (s.mode === 'match') break;
    await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  }
  return page;
}
const st = page => page.evaluate(() => window.__faceoff.fx.state());
const fire = (page, n, i) => page.evaluate(([n, i]) => window.__faceoff.fx.fire(n, i), [n, i]);
const wait = (page, ms) => page.waitForTimeout(ms);

// ---------------------------------------------------------------- 1. every event at three levels
{
  const page = await open();
  await wait(page, 2500);   // into live play
  await page.keyboard.press('Backquote');
  const names = await page.evaluate(() => window.__faceoff.fx.names());
  const expectKey = n => n;   // debug names are the config keys
  const missing = [];
  for (const n of names) for (const i of [0.15, 0.55, 1]) {
    const before = (await st(page)).fired[expectKey(n)] ?? 0;
    await fire(page, n, i);
    await wait(page, n.startsWith('goal') ? 400 : 90);
    const s = await st(page);
    const after = s.fired[expectKey(n)] ?? 0;
    if (after <= before) missing.push(`${n}@${i}`);
    if (i === 1 && ['goal_scored', 'check_board', 'one_timer', 'check_landed', 'save_made'].includes(n)) await page.screenshot({ path: `tests/out/fx-${n}.png` });
    if (n.startsWith('goal')) { await page.evaluate(() => window.__faceoff.fx.skip()); await wait(page, 300); }
  }
  check('every debug event fires at low, medium and high', missing.length === 0, missing.length ? 'missing ' + missing.join(', ') : `${names.length} events x 3 levels`);
  await page.screenshot({ path: 'tests/out/fx-debug-panel.png' });
  // keyboard hotkeys themselves (not only the API): , low then 8 = check, / high then B = goal
  const b0 = (await st(page)).fired.check_landed ?? 0;
  await page.keyboard.press('Comma'); await page.keyboard.press('Digit8'); await wait(page, 120);
  await page.keyboard.press('Slash'); await page.keyboard.press('Digit8'); await wait(page, 120);
  const s1 = await st(page);
  check('debug hotkeys fire from the keyboard (low and high)', (s1.fired.check_landed ?? 0) === b0 + 2, `lastI ${s1.lastI.check_landed}`);
  await page.keyboard.press('Backquote');
  await page.close();
}

// ---------------------------------------------------------------- 2. frame rate: heaviest goal sequence and the full sweep
{
  const page = await open();
  await wait(page, 2500);
  await page.evaluate(() => window.__faceoff.resetPerf());
  await wait(page, 3000);
  const base = await page.evaluate(() => window.__faceoff.perf());
  // heaviest: max-intensity goals with everything on, back to back, plus a big board hit and a one-timer inside each
  await page.evaluate(() => { window.__faceoff.fx.set({ intensity: 1.5 }); window.__faceoff.resetPerf(); });
  let peakParticles = 0, peakVoices = 0, maxFx = 0;
  for (let k = 0; k < 5; k++) {
    await fire(page, 'one_timer', 1); await fire(page, 'goal_scored', 1);
    for (let j = 0; j < 12; j++) {
      await wait(page, 200);
      if (j === 3) await fire(page, 'check_board', 1);
      const s = await st(page); peakParticles = Math.max(peakParticles, s.particles); peakVoices = Math.max(peakVoices, s.voices); maxFx = Math.max(maxFx, s.fxMs);
      if (k === 0 && j === 1) await page.screenshot({ path: 'tests/out/fx-goal-peak.png' });
    }
  }
  const goal = await page.evaluate(() => window.__faceoff.perf());
  await page.evaluate(() => { window.__faceoff.fx.set({ intensity: 1 }); window.__faceoff.resetPerf(); window.__faceoff.fx.sweep(); });
  while (await page.evaluate(() => window.__faceoff.fx.sweeping())) await wait(page, 500);
  const sweep = await page.evaluate(() => window.__faceoff.perf());
  report.perf = { baseline: base, heaviestGoal: { ...goal, peakParticles, peakVoices, maxFxMs: maxFx }, sweep };
  console.log('perf', JSON.stringify(report.perf));
  check('baseline play holds 60 fps', base.fps >= 57, `${base.fps} fps, p95 ${base.p95Ms} ms`);
  // during slow-mo and hit stop the game still renders every frame, so fps is the right measure
  check('heaviest goal sequence holds 60 fps', goal.fps >= 57 && goal.p95Ms < 20, `${goal.fps} fps, p95 ${goal.p95Ms} ms, max ${goal.maxMs} ms, ${peakParticles} particles, ${peakVoices} voices, fx ${maxFx.toFixed(2)} ms/frame`);
  check('full sweep (every event x3) holds 60 fps', sweep.fps >= 57, `${sweep.fps} fps, p95 ${sweep.p95Ms} ms, max ${sweep.maxMs} ms`);
  check('particle budget respected', peakParticles <= 900, `${peakParticles}`);
  await page.close();
}

// ---------------------------------------------------------------- 3 + 4. toggles, slider, feel panel, live config
{
  const page = await open();
  await wait(page, 2500);
  const peak = async (n, i, ms = 60) => { await fire(page, n, i); await wait(page, ms); return st(page); };
  let s = await peak('check_landed', 1);
  check('hit: shake, hit stop and chroma on by default', s.trauma > 0.2 && (s.time.stop > 0 || s.time.slow < 1) && s.chroma > 0, `trauma ${s.trauma} stop ${s.time.stop.toFixed(3)} slow ${s.time.slow.toFixed(2)} chroma ${s.chroma}`);
  await wait(page, 1500);
  await page.evaluate(() => window.__faceoff.fx.set({ shake: false }));
  s = await peak('check_landed', 1);
  check('shake off: camera never moves', s.cam.ox === 0 && s.cam.oz === 0 && s.cam.roll === 0 && s.cam.punch === 0 && s.cam.fov === 0, JSON.stringify(s.cam));
  await wait(page, 1500);
  await page.evaluate(() => window.__faceoff.fx.set({ shake: true, slowmo: false }));
  s = await peak('check_landed', 1, 30);
  check('slow-mo off: no hit stop or slow motion', s.time.stop <= 0 && s.time.slow === 1, JSON.stringify(s.time));
  await wait(page, 1500);
  await page.evaluate(() => window.__faceoff.fx.set({ slowmo: true, chroma: false }));
  s = await peak('check_landed', 1);
  check('chroma off: no chromatic or vignette pulse', s.chroma === 0 && s.vignette === 0, `chroma ${s.chroma} vignette ${s.vignette}`);
  await wait(page, 1500);
  await page.evaluate(() => window.__faceoff.fx.set({ chroma: true }));
  s = await peak('goal_scored', 1, 40);
  check('goal: white flash, capped', s.flash > 0 && s.flash <= 0.32, `flash ${s.flash}`);
  await page.evaluate(() => window.__faceoff.fx.skip()); await wait(page, 2500);
  await page.evaluate(() => window.__faceoff.fx.set({ flashes: false }));
  s = await peak('goal_scored', 1, 40);
  const flashEl = await page.evaluate(() => getComputedStyle(document.getElementById('fxflash')).opacity);
  check('flashes off: no screen flash drawn', +flashEl === 0, `opacity ${flashEl}`);
  await page.evaluate(() => window.__faceoff.fx.skip()); await wait(page, 2500);
  // flash rate limit: three goals 50 ms apart give one flash, not three
  await page.evaluate(() => window.__faceoff.fx.set({ flashes: true }));
  const flashes = await page.evaluate(async () => {
    let n = 0, prev = 0;
    const rd = () => +getComputedStyle(document.getElementById('fxflash')).opacity;
    const t0 = performance.now();
    for (let k = 0; k < 3; k++) window.__faceoff.fx.fire('heat_fire', 1);
    while (performance.now() - t0 < 300) { const v = rd(); if (v > prev + 0.05) n++; prev = v; await new Promise(r => requestAnimationFrame(r)); }
    return n;
  });
  check('flash rate limit: a burst of flash events makes one flash', flashes <= 1, `${flashes} rising edges in 300 ms`);
  await wait(page, 1500);
  // intensity slider
  await page.evaluate(() => window.__faceoff.fx.set({ intensity: 0.3 }));
  const lo = await peak('check_landed', 1, 30); await wait(page, 1500);
  await page.evaluate(() => window.__faceoff.fx.set({ intensity: 1.5 }));
  const hi = await peak('check_landed', 1, 30); await wait(page, 1500);
  await page.evaluate(() => window.__faceoff.fx.set({ intensity: 0 }));
  const zero = await peak('check_landed', 1, 30); await wait(page, 600);
  check('intensity slider scales effects (0.3 < 1.5, 0 = none)', lo.trauma < hi.trauma && zero.trauma === 0 && zero.time.stop <= 0, `trauma 0.3:${lo.trauma} 1.5:${hi.trauma} 0:${zero.trauma}`);
  await page.evaluate(() => window.__faceoff.fx.set({ intensity: 1 }));
  // feel panel by keyboard: P opens and pauses, D raises intensity, S then D toggles shake, P closes
  const t0 = (await page.evaluate(() => window.__faceoff.snap())).time;
  await page.keyboard.press('KeyP'); await wait(page, 400);
  const t1 = (await page.evaluate(() => window.__faceoff.snap())).time;
  await page.keyboard.press('KeyD'); await page.keyboard.press('KeyS'); await page.keyboard.press('KeyD');
  await page.screenshot({ path: 'tests/out/fx-feel-panel.png' });
  s = await st(page);
  check('feel panel: opens with P, pauses play, keyboard edits settings', await page.evaluate(() => window.__faceoff.fx.feelOpen()) && Math.abs(t1 - t0) < 0.05 && Math.abs(s.settings.intensity - 1.1) < 1e-6 && s.settings.shake === false, `paused ${Math.abs(t1 - t0) < 0.05} intensity ${s.settings.intensity} shake ${s.settings.shake}`);
  await page.keyboard.press('KeyD');   // shake back on
  await page.keyboard.press('KeyW'); await page.keyboard.press('KeyA');   // intensity back to 1
  await page.keyboard.press('KeyP');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('faceoff.feel')));
  check('settings saved', saved && saved.shake === true && Math.abs(saved.intensity - 1) < 1e-6, JSON.stringify(saved));
  // live config: zero the hit's trauma and give it the max hit stop
  await wait(page, 800);
  await page.evaluate(() => { const c = window.__faceoff.fx.config.events.check_landed; c._t = c.trauma; c.trauma = [0, 0]; c.kick = [0, 0]; });
  s = await peak('check_landed', 1, 20);
  check('config is live: zeroed trauma gives no shake', s.trauma === 0, `trauma ${s.trauma}`);
  await page.evaluate(() => { const c = window.__faceoff.fx.config.events.check_landed; c.trauma = c._t; c.kick = [0.5, 1.6]; });
  await page.close();
}

// ---------------------------------------------------------------- 5. skip, input buffer, net mode
{
  const page = await open();
  await wait(page, 2500);
  await fire(page, 'goal_scored', 1); await wait(page, 300);
  const a = await st(page);
  await page.keyboard.press('KeyJ'); await wait(page, 200);
  const b = await st(page);
  check('goal celebration skips with J', a.celebrating && !b.celebrating && b.time.slow > 0.9, `before ${a.celebrating}/${a.time.slow.toFixed(2)} after ${b.celebrating}/${b.time.slow.toFixed(2)}`);
  await page.close();
}
{
  // the faceoff draw: wait for the drop, start a long hit stop, tap J inside it. Sim time is frozen, so the bot
  // can't win the draw during the freeze; the latched tap reaches the first step after it and wins the draw.
  const page = await open();
  const res = await page.evaluate(async () => {
    const f = window.__faceoff, raf = () => new Promise(r => requestAnimationFrame(r));
    for (let k = 0; k < 600 && !(f.snap().phase === 'faceoff' && f.snap().foLive); k++) await raf();
    f.fx.fire('check_board', 1);   // 8-frame hit stop
    await raf(); await raf();
    const during = f.fx.state().time, sim0 = f.snap().time;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyJ' }));
    const frozen = f.snap().time === sim0;
    await new Promise(r => setTimeout(r, 600));
    const s = f.snap();
    return { during, frozen, phase: s.phase, owner: s.puck.owner, ownerTeam: s.skaters.find(q => q.id === s.puck.owner)?.team, won: f.fx.state().fired.faceoff_won ?? 0 };
  });
  check('input buffer: a tap during hit stop still lands (wins the faceoff draw)', res.during.stop > 0 && res.frozen && res.ownerTeam === 0 && res.won > 0,
    `stop ${res.during.stop.toFixed(3)} s left at the tap, sim frozen ${res.frozen}, then ${res.phase}, puck with team ${res.ownerTeam}`);
  await page.close();
}
{
  const page = await open('netfx');
  await wait(page, 2500);
  const t0 = await page.evaluate(() => performance.now());
  const c0 = (await page.evaluate(() => window.__faceoff.snap())).time;
  let sawStop = false, minScale = 1;
  await fire(page, 'goal_scored', 1);
  for (let k = 0; k < 10; k++) { await wait(page, 100); const s = await st(page); if (s.time.stop > 0) sawStop = true; minScale = Math.min(minScale, s.time.slow); }
  const c1 = (await page.evaluate(() => window.__faceoff.snap())).time, t1 = await page.evaluate(() => performance.now());
  const ratio = (c1 - c0) / ((t1 - t0) / 1000);
  check('net mode: sim time keeps wall-clock pace through hit stop and slow-mo', minScale === 1 && ratio > 0.93, `sim/real ${ratio.toFixed(3)}, hit stop seen ${sawStop}`);
  await page.close();
}

{
  // real play: bots play every skater (autoplay) for up to 75 s; which feedback events come from gameplay itself
  const page = await open('autoplay');
  let shot = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 75000) {
    await wait(page, 100);
    const s = await st(page);
    if (s.celebrating && !shot) { await wait(page, 250); await page.screenshot({ path: 'tests/out/fx-real-goal.png' }); shot = true; }
    if ((await page.evaluate(() => window.__faceoff.snap().mode)) !== 'match') break;
  }
  const s = await st(page);
  const perf = await page.evaluate(() => window.__faceoff.perf());
  console.log('real play fired', JSON.stringify(s.fired));
  const want = ['pass_released', 'pass_completed', 'shot_released', 'save_made', 'turnover_won', 'turnover_lost'];   // faceoff_won needs a human tap: covered by the input buffer check
  const miss = want.filter(k => !s.fired[k]);
  check('real play drives the feedback system (no debug)', miss.length === 0, miss.length ? 'never fired: ' + miss.join(', ') : `${Object.keys(s.fired).length} kinds fired, ${perf.fps} fps p95 ${perf.p95Ms} ms`);
  report.realPlay = { fired: s.fired, perf, goalShot: shot };
  await page.close();
}
check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
writeFileSync('tests/out/fx-report.json', JSON.stringify(report, null, 2));
await browser.close(); process.kill(-server.pid);
process.exit(report.checks.every(c => c.ok) ? 0 : 1);
