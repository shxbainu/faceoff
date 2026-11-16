// Anim probe: starts a bot-played match and records which clip each skater plays, plus a burst of
// close-up frames of the controlled skater, to check the animation really moves on screen.
// Usage: node tests/anim_probe.mjs [--dpr 2]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const OUT = 'tests/out'; mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe' });
await new Promise(r => server.stdout.on('data', d => { if (String(d).includes('4173')) r(); }));
const browser = await chromium.launch({ headless: true, channel: 'chromium',
  args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(arg('dpr', 2)) });
await page.goto('http://localhost:4173/?autoplay');
await page.waitForFunction(() => window.__faceoff);
await page.evaluate(() => window.__faceoff.assetsReady());
for (let i = 0; i < 60; i++) {
  const s = await page.evaluate(() => window.__faceoff.snap());
  if (s.mode === 'match' && s.phase === 'play') break;
  if (s.mode !== 'match') await page.keyboard.press('Enter');
  if (s.phase === 'faceoff' && s.foLive) await page.keyboard.press('KeyJ');
  await page.waitForTimeout(150);
}
await page.waitForTimeout(2500);
const counts = {};
for (let k = 0; k < 20; k++) {
  for (const a of await page.evaluate(() => window.__faceoff.anims())) if (a) counts[a.clip] = (counts[a.clip] || 0) + 1;
  await page.waitForTimeout(100);
}
console.log('clip samples over 2 s (all skaters):', JSON.stringify(counts));
// burst: full frames, then crop around the chosen skater (positions logged per frame)
const pick = await page.evaluate(() => { const s = window.__faceoff.snap(); let b = 0, bi = 0; s.skaters.forEach((k, i) => { const v = Math.hypot(k.vx, k.vy); const p = window.__faceoff.screen(k.x, k.y); if (v > b && k.ok && p[0] > 150 && p[0] < 1130 && p[1] > 150 && p[1] < 600) { b = v; bi = i; } }); return bi; });
const log = [];
for (let f = 0; f < 10; f++) {
  const st = await page.evaluate(i => { const s = window.__faceoff.snap().skaters[i]; return { p: window.__faceoff.screen(s.x, s.y), a: window.__faceoff.anims()[i] }; }, pick);
  await page.screenshot({ path: `${OUT}/anim-${f}.png` });
  log.push({ f, x: Math.round(st.p[0]), y: Math.round(st.p[1]), clip: st.a.clip, t: st.a.t });
}
console.log('skater', pick, JSON.stringify(log));
await browser.close(); server.kill();
