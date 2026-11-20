// Goalie save timing (browser): over an autoplay match, at every goalie save, how far the save clip is from its
// reach peak when the puck gets there (0 = full extension at contact; negative = the reach is still coming; positive
// = it already peaked). Also reports saves where no save clip was playing.
// Usage: node tests/goalie_timing_probe.mjs [--secs 60]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const si = process.argv.indexOf('--secs'), SECS = si > 0 ? +process.argv[si + 1] : 60;
const server = spawn('npx', ['vite', 'preview', '--port', '4178', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4178') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto('http://localhost:4178/?autoplay&seed=3');
await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
for (let i = 0; i < 60; i++) { const s = await page.evaluate(() => window.__faceoff.snap()); if (s.mode === 'match' && s.phase === 'play') break; if (s.mode !== 'match') await page.keyboard.press('Enter'); if (s.phase === 'faceoff' && s.foLive) await page.keyboard.press('KeyJ'); await page.waitForTimeout(150); }
const res = await page.evaluate(async secs => {
  const F = window.__faceoff, PEAK = 0.15, out = []; let last = null, prevG = [null, null]; const t0 = performance.now();
  while (performance.now() - t0 < secs * 1000) {
    await new Promise(r => requestAnimationFrame(r));
    const sn = F.snap(), sv = sn.stats.saves, n = sn.skaters.length, a = F.anims();
    if (last) for (const team of [0, 1]) if (sv[team] > last[team]) {
      const g = a[n + team]?.gsave;
      const pg = prevG[team];   // the frame before contact: where the save really was (the save event snaps it to the peak)
      out.push(g ? { clip: g.clip, off: +(g.t - PEAK).toFixed(3), pre: pg ? +(pg.t - PEAK).toFixed(3) : null, preClip: pg?.clip ?? null } : { clip: null });
    }
    last = sv.slice(); prevG = [a[n]?.gsave ?? null, a[n + 1]?.gsave ?? null];
    if (sn.mode !== 'match') { document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' })); }
  }
  return out;
}, SECS);
const offs = res.filter(r => r.clip).map(r => r.off).sort((a, b) => a - b), q = p => offs.length ? offs[Math.floor(p * (offs.length - 1))] : NaN;
console.log(`saves ${res.length}, with a save clip ${offs.length}, none ${res.length - offs.length}`);
console.log(`clip time past its reach peak at contact (s): p10 ${q(0.1)} median ${q(0.5)} p90 ${q(0.9)} | within 0.06 of the peak: ${offs.filter(o => Math.abs(o) <= 0.06).length}/${offs.length}`);
const pre = res.filter(r => r.clip).map(r => r.pre), noClip = pre.filter(x => x === null).length, pv = pre.filter(x => x !== null).sort((a, b) => a - b), pq = p => pv.length ? pv[Math.floor(p * (pv.length - 1))] : NaN;
console.log(`the frame before contact: no save clip yet ${noClip}; clip time past its peak p10 ${pq(0.1)} median ${pq(0.5)} p90 ${pq(0.9)}; within 0.06 of the peak ${pv.filter(o => Math.abs(o) <= 0.06).length}/${res.length}`);
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close(); process.kill(-server.pid);
