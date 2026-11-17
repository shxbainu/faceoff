// Plays a bot match for ~25 s and reports how often each clip is on screen (share of skater-samples), each
// skater's own playback rhythm (spread across the team), and the upper-body layer: mean |chest twist| toward
// the puck and how often it is active (|twist| > 0.05 rad).
// Usage: node tests/clip_usage.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4173') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:4173/?autoplay&seed=2');
await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
const count = {}; let n = 0; const rates = new Set(); let tw = 0, twOn = 0;
for (let i = 0; i < 260; i++) {
  const s = await page.evaluate(() => window.__faceoff.snap());
  if (s.mode !== 'match') { await page.keyboard.press('Enter'); await page.waitForTimeout(250); continue; }
  for (const a of await page.evaluate(() => window.__faceoff.anims())) if (a) { count[a.clip] = (count[a.clip] || 0) + 1; n++; rates.add(a.rate); tw += Math.abs(a.twist); if (Math.abs(a.twist) > 0.05) twOn++; }
  await page.waitForTimeout(100);
}
console.log(JSON.stringify({ clips: Object.fromEntries(Object.entries(count).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, (100 * v / n).toFixed(1) + '%'])),
  rhythm: { skaters: rates.size, min: Math.min(...rates), max: Math.max(...rates) },
  upperBody: { meanTwistRad: +(tw / n).toFixed(3), activeShare: (100 * twOn / n).toFixed(1) + '%' } }));
await browser.close(); process.kill(-server.pid);
