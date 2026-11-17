// Captures a dropped stick and its skater in a bot match (proof the drop is drawn): saves tests/out/stick-drop.png
// Usage: node tests/stick_drop_shot.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4173') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:4173/?autoplay&seed=7');
await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
let got = null;
for (let i = 0; i < 4000 && !got; i++) {
  const s = await page.evaluate(() => window.__faceoff.snap());
  if (s.mode !== 'match') { await page.keyboard.press('Enter'); await page.waitForTimeout(250); continue; }
  if (s.sticks.length && (s.skaters.find(q => q.id === s.sticks[0].owner)?.stickless ?? 0) > 0.35) {
    const k = s.sticks[0], o = s.skaters.find(q => q.id === k.owner);
    const [x, y] = await page.evaluate(([a, b]) => window.__faceoff.ground(a, b), [(k.x + o.x) / 2, (k.y + o.y) / 2]);
    if (x > 160 && x < 1120 && y > 160 && y < 600) { await page.screenshot({ path: 'tests/out/stick-drop.png', clip: { x: x - 160, y: y - 140, width: 320, height: 260 } }); got = { stick: k, owner: { id: o.id, stun: +o.stun.toFixed(2), stickless: +o.stickless.toFixed(2) } }; }
  }
  await page.waitForTimeout(20);
}
console.log(JSON.stringify(got ?? 'no stick drop seen'));
await browser.close(); process.kill(-server.pid);
