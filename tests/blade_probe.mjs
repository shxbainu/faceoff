// Blade probe: where the stick blade sits relative to the skater (sim frame: fwd along facing, lat to his right)
// in each clip, using ?pose=clip:phase to freeze every skater, plus the gap between blade and puck in live play.
// Usage: node tests/blade_probe.mjs [--live]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4173') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const out = {};
if (!process.argv.includes('--live')) {
  for (const pose of ['idle:0.1', 'glide:0.1', 'glide:0.6', 'stride:0.0', 'stride:0.25', 'stride:0.5', 'stride:0.75', 'handle:0.0', 'handle:0.25', 'handle:0.5', 'handle:0.75', 'back:0.3']) {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    await page.goto(`http://localhost:4173/?test&seed=1&pose=${pose}`);
    await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
    for (let i = 0; i < 20; i++) { if ((await page.evaluate(() => window.__faceoff.snap())).mode === 'match') break; await page.keyboard.press('Enter'); await page.waitForTimeout(200); }
    await page.waitForTimeout(600);
    out[pose] = await page.evaluate(() => { const s = window.__faceoff.snap(), i = s.skaters.findIndex(k => k.ctrl); return window.__faceoff.blade(i); });
    await page.close();
  }
} else {
  // live: bot match, every carrier, blade-to-puck distance on screen-plane (sim units)
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto('http://localhost:4173/?autoplay&seed=6');
  await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
  const gaps = [];
  for (let i = 0; i < 500; i++) {
    const s = await page.evaluate(() => window.__faceoff.snap());
    if (s.mode !== 'match') { await page.keyboard.press('Enter'); await page.waitForTimeout(250); continue; }
    if (s.puck.owner >= 0) {
      const g = await page.evaluate(() => { const s = window.__faceoff.snap(), i = s.skaters.findIndex(k => k.id === s.puck.owner), k = s.skaters[i], b = window.__faceoff.blade(i);
        if (!b) return null; const bx = k.x + Math.cos(k.face) * b.fwd - Math.sin(k.face) * b.lat, by = k.y + Math.sin(k.face) * b.fwd + Math.cos(k.face) * b.lat;
        return { d: Math.hypot(bx - s.puck.x, by - s.puck.y), clip: b.clip, fwd: b.fwd, lat: b.lat, h: b.h }; });
      if (g) gaps.push(g);
    }
    await page.waitForTimeout(40);
  }
  gaps.sort((a, b) => a.d - b.d);
  const q = f => +gaps[Math.floor(f * (gaps.length - 1))].d.toFixed(3);
  const m = k => +(gaps.reduce((a, g) => a + g[k], 0) / gaps.length).toFixed(3);
  out.live = { samples: gaps.length, bladeToPuck: { median: q(0.5), p90: q(0.9), max: q(1), within015: (100 * gaps.filter(g => g.d < 0.15).length / gaps.length).toFixed(1) + '%' },
    carrierBlade: { fwd: m('fwd'), lat: m('lat'), h: m('h') } };
}
console.log(JSON.stringify(out, null, 1));
await browser.close(); process.kill(-server.pid);
