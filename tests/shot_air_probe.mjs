// Shots in the air and goals into the net (browser): over an autoplay match, the drawn puck height during shots
// (at the goal line, max, and that it never goes over the crossbar or below the ice), that it comes back down after a
// save, and that on a goal it is drawn inside the net (not behind the boards). Saves close-ups of the first goal.
// Usage: node tests/shot_air_probe.mjs [--secs 90]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const si = process.argv.indexOf('--secs'), SECS = si > 0 ? +process.argv[si + 1] : 90;
const server = spawn('npx', ['vite', 'preview', '--port', '4179', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4179') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:4179/?autoplay&seed=2');
await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
for (let i = 0; i < 60; i++) { const s = await page.evaluate(() => window.__faceoff.snap()); if (s.mode === 'match' && s.phase === 'play') break; if (s.mode !== 'match') await page.keyboard.press('Enter'); if (s.phase === 'faceoff' && s.foLive) await page.keyboard.press('KeyJ'); await page.waitForTimeout(150); }
const GL = 35.6, ND = 1.5, L = 40, GH = 2.1;
let shots = [], cur = null, after = null, goals = [], shotN = 0, t0 = Date.now(), shotPics = 0, lastScore = null;
while (Date.now() - t0 < SECS * 1000) {
  const r = await page.evaluate(() => { const F = window.__faceoff, s = F.snap(); return { phase: s.phase, mode: s.mode, p: s.puck, d: F.puckDrawn(), score: s.score }; });
  if (r.mode !== 'match') { await page.keyboard.press('Enter'); continue; }
  const [dx, dh, dz] = r.d;
  if (r.p.kind === 'shot' && r.p.owner < 0) {
    if (!cur) { cur = { max: 0, atLine: null, under: 0 }; shotN++; }
    cur.max = Math.max(cur.max, dh); if (dh < 0.04) cur.under++;
    if (cur.atLine === null && Math.abs(dx) > GL - 1.5) cur.atLine = dh;
    if (shotPics < 3 && dh > 0.4 && Math.abs(dx) > GL - 8) { const sc = await page.evaluate(([x, h, y]) => window.__faceoff.screen(x, y), r.d); await page.screenshot({ path: `tests/out/shotair_${shotPics++}.png`, clip: { x: Math.max(0, Math.min(1280 - 360, sc[0] - 180)), y: Math.max(0, Math.min(720 - 260, sc[1] - 160)), width: 360, height: 260 } }); }
  } else if (cur) { shots.push(cur); after = { h: dh, t: Date.now() }; cur = null; }
  if (after && Date.now() - after.t > 900) { shots.at(-1).landed = dh < 0.08; after = null; }
  if (lastScore && (r.score[0] !== lastScore[0] || r.score[1] !== lastScore[1])) {
    const pics = [];
    for (const ms of [60, 250, 700]) {
      await page.waitForTimeout(ms === 60 ? 60 : ms - 60);
      const q = await page.evaluate(() => { const F = window.__faceoff; return { d: F.puckDrawn(), p: F.snap().puck }; });
      const [x, h, z] = q.d, inNet = Math.abs(x) >= GL - 0.05 && Math.abs(x) <= GL + ND && Math.abs(z) <= GH && h < 1.3;
      pics.push({ ms, inNet, x: +x.toFixed(2), h: +h.toFixed(2), z: +z.toFixed(2), simX: +q.p.x.toFixed(2) });
      if (goals.length < 2) { const sc = await page.evaluate(([x, h, y]) => window.__faceoff.screen(x, y), q.d); await page.screenshot({ path: `tests/out/goal${goals.length}_${ms}.png`, clip: { x: Math.max(0, Math.min(1280 - 360, sc[0] - 180)), y: Math.max(0, Math.min(720 - 260, sc[1] - 160)), width: 360, height: 260 } }); }
    }
    goals.push(pics);
  }
  lastScore = r.score;
}
const q = (a, p) => { a = a.filter(x => x !== null && x !== undefined).sort((x, y) => x - y); return a.length ? a[Math.floor(p * (a.length - 1))].toFixed(2) : '-'; };
console.log(`shots ${shots.length}: height at the goal line p10 ${q(shots.map(s => s.atLine), 0.1)} median ${q(shots.map(s => s.atLine), 0.5)} p90 ${q(shots.map(s => s.atLine), 0.9)}; max ${q(shots.map(s => s.max), 1)} (crossbar 1.35)`);
const landed = shots.filter(s => s.landed !== undefined);
console.log(`back on the ice 0.9 s after the shot ended: ${landed.filter(s => s.landed).length}/${landed.length}`);
console.log(`goals ${goals.length}: drawn in the net ${goals.flat().filter(g => g.inNet).length}/${goals.flat().length} samples`, JSON.stringify(goals));
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close(); process.kill(-server.pid);
