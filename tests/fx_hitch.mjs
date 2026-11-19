// Hitch hunt: autoplay for N seconds, log every frame over 40 ms with what the feedback layer was doing.
// Usage: node tests/fx_hitch.mjs [seconds] [extra query]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const SEC = +(process.argv[2] || 60), Q = process.argv[3] || '';
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4173') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:4173/?seed=5&autoplay${Q ? '&' + Q : ''}`);
await page.waitForFunction(() => window.__faceoff);
await page.evaluate(() => window.__faceoff.assetsReady());
for (let i = 0; i < 10; i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(150); }
const hitches = await page.evaluate(async sec => {
  const out = []; let last = performance.now(); const t0 = last; let prevChroma = 0;
  while (performance.now() - t0 < sec * 1000) {
    await new Promise(r => requestAnimationFrame(r));
    const now = performance.now(), s = window.__faceoff.fx.state();
    if (now - last > 40) out.push({ t: +((now - t0) / 1000).toFixed(2), ms: +(now - last).toFixed(0), chroma: s.chroma, prevChroma, particles: s.particles, fired: Object.keys(s.fired).length });
    prevChroma = s.chroma; last = now;
    if (window.__faceoff.snap().mode !== 'match') { await new Promise(r => setTimeout(r, 1200)); }
  }
  return out;
}, SEC);
console.log(JSON.stringify(hitches));
await browser.close(); process.kill(-server.pid);
