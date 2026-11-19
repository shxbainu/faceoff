// Twist probe: body twisting and arm clipping. Idles the title screen, then watches a bot-played match.
// Logs how far the layered bones (spine, head, arms) sit from their clip pose, and saves close-up crops of
// skaters to tests/out/twist-*.png. Usage: node tests/twist_probe.mjs [--query "nolayerfix"] [--secs 8] [--idle 10]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const OUT = 'tests/out'; mkdirSync(OUT, { recursive: true });
const Q = arg('query', ''), SECS = +arg('secs', 8), IDLE = +arg('idle', 10), TAG = arg('tag', 'run');
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4173') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.goto(`http://localhost:4173/?autoplay&seed=11${Q ? '&' + Q : ''}`);
await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
const worst = async () => page.evaluate(() => { const r = { head: 0, spine: 0, arms: 0, nan: false }; for (let i = 0; i < 12; i++) { const h = window.__faceoff.head(i); if (!h) continue; r.head = Math.max(r.head, h.head); r.spine = Math.max(r.spine, h.spine); r.arms = Math.max(r.arms, h.arms); r.nan ||= h.nan; } return r; });
const fmt = r => `head ${r.head.toFixed(2)} spine ${r.spine.toFixed(2)} arms ${r.arms.toFixed(2)}${r.nan ? ' NaN!' : ''}`;
// title screen idle
let t0 = Date.now(), idleWorst = { head: 0, spine: 0, arms: 0, nan: false };
while (Date.now() - t0 < IDLE * 1000) { const w = await worst(); for (const k of ['head', 'spine', 'arms']) idleWorst[k] = Math.max(idleWorst[k], w[k]); idleWorst.nan ||= w.nan; await page.waitForTimeout(250); }
console.log(`title idle ${IDLE}s worst: ${fmt(idleWorst)}`);
await page.screenshot({ path: `${OUT}/twist-${TAG}-title.png` });
for (let i = 0; i < 60; i++) {
  const s = await page.evaluate(() => window.__faceoff.snap());
  if (s.mode === 'match' && s.phase === 'play') break;
  if (s.mode !== 'match') await page.keyboard.press('Enter');
  if (s.phase === 'faceoff' && s.foLive) await page.keyboard.press('KeyJ');
  await page.waitForTimeout(150);
}
let playWorst = { head: 0, spine: 0, arms: 0, nan: false }, shots = 0; t0 = Date.now();
while (Date.now() - t0 < SECS * 1000) {
  const w = await worst(); for (const k of ['head', 'spine', 'arms']) playWorst[k] = Math.max(playWorst[k], w[k]); playWorst.nan ||= w.nan;
  if (shots < 6 && (Date.now() - t0) > shots * (SECS * 1000 / 6)) {
    // crop around the skater nearest the puck
    const c = await page.evaluate(() => { const s = window.__faceoff.snap(), p = s.pucks?.[0] ?? s.puck; const k = window.__faceoff.skaters().filter(k => k.stun <= 0).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0]; return window.__faceoff.screen(k.x, k.y); });
    const x = Math.max(0, Math.min(1280 - 260, c[0] - 130)), y = Math.max(0, Math.min(720 - 260, c[1] - 150));
    await page.screenshot({ path: `${OUT}/twist-${TAG}-${shots}.png`, clip: { x, y, width: 260, height: 260 } });
    shots++;
  }
  await page.waitForTimeout(100);
}
console.log(`match ${SECS}s worst: ${fmt(playWorst)}`);
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close(); process.kill(-server.pid);
