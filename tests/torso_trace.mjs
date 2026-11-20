// Torso and head trace (browser): the lone ?test skater skating straight up the ice; prints chest and head angles
// (deg) and heights (cm) every frame over two stride cycles, to see whether they move with the stride.
// Usage: node tests/torso_trace.mjs [extra query]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const Q = process.argv.find(a => a.startsWith('&')) || '';
const server = spawn('npx', ['vite', 'preview', '--port', '4178', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4178') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:4178/?test&seed=1${Q}`);
await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
for (let i = 0; i < 20; i++) { if ((await page.evaluate(() => window.__faceoff.snap())).mode === 'match') break; await page.keyboard.press('Enter'); await page.waitForTimeout(200); }
await page.keyboard.down('KeyW'); await page.waitForTimeout(1500);
const rows = await page.evaluate(async () => { const F = window.__faceoff, i = F.snap().skaters.findIndex(k => k.ctrl), out = [];
  for (let n = 0; n < 70; n++) { await new Promise(r => requestAnimationFrame(r)); out.push(F.torso(i)); } return out; });
await page.keyboard.up('KeyW');
const d = x => (x * 57.3).toFixed(1).padStart(6), c = x => (x * 100).toFixed(1).padStart(6);
console.log('mode    ph   chestP chestR chestY  neckY  headP  headY  headR  headY(cm)');
for (const r of rows) if (r) console.log(`${r.mode.padEnd(6)} ${r.ph.toFixed(2)} ${d(r.cp)} ${d(r.cr)} ${d(r.cy)} ${c(r.ny)} ${d(r.hp)} ${d(r.hy)} ${d(r.hr)} ${c(r.hh)}`);
await browser.close(); process.kill(-server.pid);
