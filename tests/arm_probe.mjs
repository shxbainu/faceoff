// Arm probe: close-ups of the puck carrier and the closest elbow/hand-to-torso distance over a bot match, with
// the stick IK on and off (?noik). Usage: node tests/arm_probe.mjs [--query ""] [--tag run]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const Q = arg('query', ''), TAG = arg('tag', 'run');
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4173') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 3 });
await page.goto(`http://localhost:4173/?autoplay&seed=11${Q ? '&' + Q : ''}`);
await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
for (let i = 0; i < 60; i++) { const s = await page.evaluate(() => window.__faceoff.snap()); if (s.mode === 'match' && s.phase === 'play') break; if (s.mode !== 'match') await page.keyboard.press('Enter'); if (s.phase === 'faceoff' && s.foLive) await page.keyboard.press('KeyJ'); await page.waitForTimeout(150); }
const hist = { carrier: [], other: [] }; let shots = 0;
for (let f = 0; f < 80; f++) {
  const st = await page.evaluate(() => { const S = window.__faceoff.skaters(), o = window.__faceoff.snap().puck.owner; return S.map((k, i) => ({ i, own: k.id === o, hand: k.hand, a: window.__faceoff.arms(i), p: window.__faceoff.screen(k.x, k.y) })); });
  for (const k of st) { if (!k.a) continue; const m = Math.min(k.a.lowerarm_r, k.a.hand_r, k.a.lowerarm_l, k.a.hand_l); (k.own ? hist.carrier : hist.other).push(m); }
  const c = st.find(k => k.own);
  if (c && shots < 8 && f % 6 === 0 && c.p[0] > 80 && c.p[0] < 1200 && c.p[1] > 100 && c.p[1] < 680) {
    await page.screenshot({ path: `tests/out/arm-${TAG}-${shots}.png`, clip: { x: c.p[0] - 70, y: c.p[1] - 95, width: 140, height: 130 } });
    console.log(`shot ${shots}: skater ${c.i} ${c.hand > 0 ? 'right' : 'left'} shot`, JSON.stringify(c.a)); shots++;
  }
  await page.waitForTimeout(90);
}
const q = (a, p) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(p * (a.length - 1))].toFixed(3) : '-';
console.log(`closest arm-to-torso: carrier min ${q(hist.carrier, 0)} p10 ${q(hist.carrier, 0.1)} median ${q(hist.carrier, 0.5)} | others min ${q(hist.other, 0)} p10 ${q(hist.other, 0.1)} median ${q(hist.other, 0.5)}`);
await browser.close(); process.kill(-server.pid);
