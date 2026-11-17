// Playbot: plays Faceoff through real keyboard input in Chromium, takes screenshots,
// and reports frame timing. Usage: node tests/playbot.mjs [--matches 1] [--headed] [--webgl] [--query "round=2"] [--dpr 2]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : (process.argv[i + 1] ?? true); };
const MATCHES = +arg('matches', 1);
const HEADED = process.argv.includes('--headed');
const QUERY = [process.argv.includes('--webgl') ? 'webgl=1' : '', arg('query', '')].filter(Boolean).join('&');
const TAG = arg('tag', 'run');
const OUT = 'tests/out';
mkdirSync(OUT, { recursive: true });
const L = 40;

const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => {
  server.stdout.on('data', d => String(d).includes('4173') && res());
  server.on('exit', c => rej(new Error('preview exited ' + c)));
  setTimeout(res, 4000);
});

process.on('unhandledRejection', e => { console.error(e); server.kill(); process.exit(2); });
process.on('uncaughtException', e => { console.error(e); server.kill(); process.exit(2); });
const browser = await chromium.launch({
  headless: !HEADED, channel: 'chromium',
  args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(arg('dpr', 1)) });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
const t0 = Date.now();
await page.goto('http://localhost:4173/' + (QUERY ? '?' + QUERY : ''));
await page.waitForFunction(() => window.__faceoff, null, { timeout: 20000 });
const loadMs = Date.now() - t0;
await page.evaluate(() => window.__faceoff.assetsReady());
const assets = await page.evaluate(() => window.__faceoff.assets());
const assetMs = Date.now() - t0;
let shotN = 0;
const shot = async name => { await page.screenshot({ path: `${OUT}/${TAG}-${String(++shotN).padStart(2, '0')}-${name}.png` }); };
await shot('title');

const held = new Set();
async function hold(want) {
  for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
  for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
}
const tap = async k => { if (held.has(k)) { await page.keyboard.up(k); held.delete(k); } await page.keyboard.press(k); };

const results = [];
let hitsSeen = 0, hitShots = 0;
const seen = new Set();
let shootUntil = 0, lastCall = 0, lastCheck = 0, lastPass = 0, lastPlayShot = 0, restartMs = null;
const start = Date.now();
let prevMode = '';
while (Date.now() - start < 9 * 60000 && results.length < MATCHES + 0.5) {
  const s = await page.evaluate(() => window.__faceoff.snap());
  const now = Date.now();
  if (s.mode !== prevMode) { prevMode = s.mode; await hold(new Set()); await page.waitForTimeout(350); if (s.mode !== 'match') await shot(s.mode + '-r' + s.round); }
  if (s.mode === 'title') { await tap('Enter'); await page.waitForTimeout(100); continue; }
  if (s.mode === 'intro') { await page.waitForTimeout(400); await tap('Enter'); continue; }
  if (s.mode === 'end') {
    results.push({ round: s.round, score: s.score, winner: s.winner, clockLeft: +s.clock.toFixed(1), ot: s.ot, stats: s.stats, style: Math.round(s.style), wallSec: Math.round((now - start) / 1000) });
    console.log('match finished', JSON.stringify(results.at(-1)));
    if (results.length >= MATCHES && s.winner !== 0) break;
    await page.waitForTimeout(700); await tap('Enter'); await page.waitForTimeout(300);
    continue;
  }
  if (s.mode === 'pick') {
    await page.waitForTimeout(400); await tap('Digit1'); await page.waitForTimeout(500);
    const a = await page.evaluate(() => window.__faceoff.snap());
    console.log('picked power; stack:', JSON.stringify(Object.fromEntries(Object.entries(a.powers).filter(e => e[1]))), '→ round', a.round);
    await shot('after-pick');
    if (results.length >= MATCHES) break;
    continue;
  }
  // ---- match
  if (s.phase === 'faceoff') {
    if (!seen.has('faceoff')) { seen.add('faceoff'); await shot('faceoff'); }
    if (s.foLive) await tap('KeyJ');
    await page.waitForTimeout(25);
    continue;
  }
  if (s.phase !== 'play') {
    if (s.phase === 'goal' && !seen.has('goal' + s.score.join(''))) { seen.add('goal' + s.score.join('')); await hold(new Set()); await page.waitForTimeout(250); await shot('goal-' + s.score.join('-')); }
    await page.waitForTimeout(30); continue;
  }
  if (s.fire > 0 && !seen.has('fire')) { seen.add('fire'); await shot('on-fire'); }
  if (s.stats.hits[0] > hitsSeen && hitShots < 3) { hitShots++; await shot('hit'); }
  hitsSeen = s.stats.hits[0];
  if (s.tier >= 2 && !seen.has('tier')) { seen.add('tier'); await shot('heat-tier' + s.tier); }
  if (now - lastPlayShot > 9000) { lastPlayShot = now; await shot('play'); }
  if (process.argv.includes('--idle')) { await page.waitForTimeout(40); continue; }
  const me = s.skaters.find(k => k.id === s.ctrl) || s.skaters[0], p = s.puck, want = new Set();
  const go = (x, y) => {
    const dx = x - me.x, dy = y - me.y;
    if (Math.abs(dx) > 0.6) want.add(dx > 0 ? 'KeyW' : 'KeyS');
    if (Math.abs(dy) > 0.6) want.add(dy > 0 ? 'KeyD' : 'KeyA');
  };
  const opps = s.skaters.filter(k => k.team === 1 && k.ok);
  const near = opps.reduce((m, k) => Math.min(m, Math.hypot(k.x - me.x, k.y - me.y)), 99);
  const dGoal = Math.hypot(L - me.x, me.y);
  if (p.owner === me.id) {
    if (held.has('KeyI') && !shootUntil) shootUntil = now + 420;
    if (shootUntil) {
      want.add('KeyI');
      if (now >= shootUntil) { want.delete('KeyI'); shootUntil = 0; }
    } else if (dGoal < 10.5 && me.x < L - 1.5) { want.add('KeyI'); shootUntil = now + 450; }
    else if (near < 2.3 && now - lastPass > 900 && dGoal > 12) { lastPass = now; await tap('KeyJ'); }
    go(L - 5, me.y * 0.4);
  } else {
    shootUntil = 0;
    const owner = s.skaters.find(k => k.id === p.owner);
    if ((owner && owner.team === 0) || (p.kind === 'pass' && p.target === me.id)) {
      const oy = owner ? owner.y : p.y;
      if (p.target === me.id) go(me.x + 0.01, me.y); else go(L - 7, oy > 0 ? -3.4 : 3.4);
      if (dGoal < 12) { want.add('KeyI'); if (owner && now - lastCall > 700) { lastCall = now; await tap('KeyJ'); } }
    } else if (owner) {
      go(owner.x + owner.vx * 0.2, owner.y + owner.vy * 0.2);
      const d = Math.hypot(owner.x - me.x, owner.y - me.y);
      if (d < 3.2 && now - lastCheck > 600) { lastCheck = now; await tap('KeyH'); }
    } else go(p.x + p.vx * 0.25, p.y + p.vy * 0.25);
  }
  await hold(want);
  await page.waitForTimeout(25);
}
await hold(new Set());

// restart-in-one-second check: press R mid-flow and time until a new intro is up
if (process.argv.includes('--restart')) {
  const r0 = Date.now();
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => window.__faceoff.snap().mode === 'intro');
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Enter');
    if (await page.evaluate(() => window.__faceoff.snap().mode === 'match')) break;
    await page.waitForTimeout(50);
  }
  restartMs = Date.now() - r0;
  await page.waitForTimeout(1500);
  await shot('after-restart');
}
const perf = await page.evaluate(() => window.__faceoff.perf());
const report = { loadMs, assetMs, assets, perf, results, restartMs, errors: errors.slice(0, 10), screenshots: shotN };
writeFileSync(`${OUT}/${TAG}-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
server.kill();
process.exit(results.length ? 0 : 1);
process.on('unhandledRejection', e => { console.error(e); server.kill(); process.exit(2); });
