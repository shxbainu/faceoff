// Spin probe: your skater alone on the test rink, steered in fast circles clockwise for 15 s and then
// counter-clockwise for 15 s, sampling the head, spine and arm layer every 100 ms (no NaN, no runaway).
// Usage: node tests/spin_probe.mjs [--query nolayerfix]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const Q = arg('query', '');
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4173') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => m.type() === 'error' && errors.push(m.text()));
await page.goto(`http://localhost:4173/?test${Q ? '&' + Q : ''}`);
await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
const ring = [['KeyW'], ['KeyW', 'KeyD'], ['KeyD'], ['KeyS', 'KeyD'], ['KeyS'], ['KeyS', 'KeyA'], ['KeyA'], ['KeyW', 'KeyA']];
let worst = { head: 0, spine: 0, arms: 0, twist: 0 }, nan = false, held = [], frames = 0;
const t0 = Date.now();
while (Date.now() - t0 < 30000) {
  const cw = Date.now() - t0 < 15000, k = Math.floor((Date.now() - t0) / 90) % 8, keys = ring[cw ? k : 7 - k];
  for (const h of held) if (!keys.includes(h)) await page.keyboard.up(h);
  for (const h of keys) if (!held.includes(h)) await page.keyboard.down(h);
  held = keys;
  const h = await page.evaluate(() => window.__faceoff.head(window.__faceoff.snap().ctrl));
  if (h) { frames++; nan ||= h.nan || !Number.isFinite(h.twist); for (const key of ['head', 'spine', 'arms']) worst[key] = Math.max(worst[key], h[key]); worst.twist = Math.max(worst.twist, Math.abs(h.twist)); }
  if (frames === 120) await page.screenshot({ path: 'tests/out/spin-mid.png' });
}
for (const h of held) await page.keyboard.up(h);
console.log(`30 s spin (${frames} samples): head ${worst.head.toFixed(2)} spine ${worst.spine.toFixed(2)} arms ${worst.arms.toFixed(2)} rad off the clip pose, look yaw max ${worst.twist.toFixed(2)}${nan ? '  NaN!' : ''}`);
console.log('errors:', errors.length ? errors.slice(0, 5) : 'none');
await browser.close(); process.kill(-server.pid);
