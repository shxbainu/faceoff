import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const Q = process.argv[2] || '';
const server = spawn('npx', ['vite', 'preview', '--port', '4181', '--strictPort'], { stdio: 'pipe', detached: true, cwd: '/Users/brianyao/claude-web-game' });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4181') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:4181/?autoplay&seed=11' + Q);
await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
for (let i = 0; i < 60; i++) { const s = await page.evaluate(() => window.__faceoff.snap()); if (s.mode === 'match' && s.phase === 'play') break; await page.keyboard.press('Enter'); await page.keyboard.press('KeyJ'); await page.waitForTimeout(150); }
const r = await page.evaluate(async () => { const F = window.__faceoff, out = [];
  for (let n = 0; n < 600; n++) { await new Promise(r => requestAnimationFrame(r)); const sk = F.skaters();
    for (let i = 0; i < sk.length; i++) { const L = F.limbs(i); if (L && L.blade) out.push({ one: L.one, b: L.blade, hl: L.hl, hr: L.hr }); } }
  return out; });
const q = (a, p) => a.slice().sort((x, y) => x - y)[Math.floor(p * (a.length - 1))];
for (const [lab, a] of [['one', r.filter(x => x.one > 0.9)], ['two', r.filter(x => x.one < 0.1)], ['mid', r.filter(x => x.one >= 0.1 && x.one <= 0.9)]]) {
  if (!a.length) { console.log(lab, 0); continue; }
  const f = k => [0.05, 0.5, 0.95].map(p => q(a.map(x => x.b[k]), p).toFixed(2)).join('/');
  console.log(lab, a.length, 'blade fwd', f(0), 'side', f(1), 'up', f(2), 'hands apart med', q(a.map(x => Math.hypot(...x.hl.map((v, k) => v - x.hr[k]))), 0.5).toFixed(2));
}
await browser.close(); process.kill(-server.pid);
