// Close-ups of one skater's arms from several angles on one frozen frame, to inspect joint creases (skinning) and the
// outline shell. Usage: node tests/pinch_shots.mjs outdir [extra query, e.g. &hulldbg] [mode=stride|cross|back|glide]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const dir = process.argv[2] || 'verify/pinch'; mkdirSync(dir, { recursive: true });
const want = process.argv[4] || 'stride';
const server = spawn('npx', ['vite', 'preview', '--port', '4176', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4176') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:4176/?seed=8&autoplay' + (process.argv[3] || ''));
await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
for (let i = 0; i < 30; i++) { const s = await page.evaluate(() => window.__faceoff.snap()); if (s.mode === 'match' && s.phase === 'play') break; await page.keyboard.press('Enter'); await page.keyboard.press('KeyJ'); await page.waitForTimeout(250); }
await page.addStyleTag({ content: 'body > *:not(canvas) { display: none !important; }' });
await page.waitForTimeout(4000);
let hit = null;
for (let n = 0; n < 2000 && !hit; n++) {
  hit = await page.evaluate((want) => { const f = window.__faceoff, k = f.skaters(), g = f.gait();
    for (let i = 0; i < k.length; i++) { const c = k[i]; if (c.stun > 0 || g[i]?.mode !== want || Math.hypot(c.vx, c.vy) < 3) continue;
      if (k.some((o, j) => j !== i && Math.hypot(o.x - c.x, o.y - c.y) < 2.5)) continue;
      f.freeze(true); return { i }; } return null; }, want);
  if (!hit) await page.waitForTimeout(25);
}
for (const [nm, a] of [['back', 0], ['side', Math.PI / 2], ['front', Math.PI], ['other', -Math.PI / 2]]) {
  await page.evaluate(([i, a]) => window.__faceoff.closeCam(i, 3.2, a), [hit.i, a]); await page.waitForTimeout(250);
  await page.screenshot({ path: `${dir}/${want}_${nm}.png`, clip: { x: 390, y: 60, width: 500, height: 560 } });
}
console.log('skater', hit.i);
await browser.close(); try { process.kill(-server.pid); } catch { /* gone */ }
