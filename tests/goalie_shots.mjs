// Goalie close-ups in a bot match: one in the stance and several mid-save (taken ~0.15 s after a shot is fired at
// him, when the save clip should be at full reach). Also checks the gear is on goalies only.
// Usage: node tests/goalie_shots.mjs   (saves tests/out/goalie-*.png)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4173') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:4173/?autoplay&seed=9');
await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
const shot = async (name, gx, gy) => {
  const [x, y] = await page.evaluate(([a, b]) => window.__faceoff.ground(a, b), [gx, gy]);
  if (x < 140 || x > 1140 || y < 170 || y > 640) return false;
  await page.screenshot({ path: `tests/out/goalie-${name}.png`, clip: { x: x - 130, y: y - 160, width: 260, height: 210 } }); return true;
};
let stance = false, saves = 0, lastShot = null;
const clips = {};
for (let i = 0; i < 3000 && (saves < 4 || !stance); i++) {
  const s = await page.evaluate(() => window.__faceoff.snap());
  if (s.mode !== 'match') { await page.keyboard.press('Enter'); await page.waitForTimeout(250); continue; }
  const an = await page.evaluate(() => window.__faceoff.anims());
  s.goalies.forEach((g, gi) => { const a = an[s.skaters.length + gi]; if (a) clips[a.clip] = (clips[a.clip] || 0) + 1; });
  if (!stance) for (const g of s.goalies) if (!stance && await shot('stance', g.x, g.y)) stance = true;
  if (s.puck.kind === 'shot' && lastShot !== Math.round(s.puck.x * 10)) {
    const p = s.puck, g = s.goalies.find(g => Math.sign(g.x) === Math.sign(p.vx));
    if (g && Math.abs(g.x - p.x) < 12) { await page.waitForTimeout(120); if (await shot(`save${saves}`, g.x, g.y)) saves++; lastShot = Math.round(p.x * 10); await page.waitForTimeout(600); }
  }
  await page.waitForTimeout(15);
}
const gearOn = await page.evaluate(() => window.__faceoff.gearCheck?.());
console.log(JSON.stringify({ stance, saves, goalieClipsSeen: clips, gearOn }));
await browser.close(); process.kill(-server.pid);
