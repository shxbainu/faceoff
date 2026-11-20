// Torso and head motion (browser): samples every frame of an autoplay match and reports, per leg mode, how much the
// chest and head move on their own (each signal minus its own 0.4 s moving average, so slow lean and look changes
// don't count): amplitude = p95 of |residual| (deg, or cm for heights), and the p99 frame-to-frame step (pops).
//   chest pitch/roll/yaw (pelvis-to-neck line, shoulder line), neck bob; head pitch/yaw/roll, head bob
// Usage: node tests/torso_probe.mjs [extra query, e.g. &nogait&noanat] [--secs 15]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const Q = process.argv.find(a => a.startsWith('&')) || '', si = process.argv.indexOf('--secs'), SECS = si > 0 ? +process.argv[si + 1] : 15;
const server = spawn('npx', ['vite', 'preview', '--port', '4177', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4177') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(`http://localhost:4177/?autoplay&seed=11${Q}`);
await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
for (let i = 0; i < 60; i++) { const s = await page.evaluate(() => window.__faceoff.snap()); if (s.mode === 'match' && s.phase === 'play') break; if (s.mode !== 'match') await page.keyboard.press('Enter'); if (s.phase === 'faceoff' && s.foLive) await page.keyboard.press('KeyJ'); await page.waitForTimeout(150); }
const series = await page.evaluate(async secs => {
  const F = window.__faceoff, out = {}; const t0 = performance.now();
  while (performance.now() - t0 < secs * 1000) {
    await new Promise(r => requestAnimationFrame(r));
    const sn = F.snap(), t = performance.now() / 1000; if (sn.phase !== 'play') continue;
    const sk = F.skaters();
    for (let i = 0; i < sk.length; i++) { const s = sk[i], T = F.torso(i);
      if (!T || s.stun > 0 || s.air || s.out > 0 || s.wind >= 0) { (out[i] ??= []).push(null); continue; }
      (out[i] ??= []).push({ t, ...T }); }
  }
  return out;
}, SECS);
const K = [['cp', 'chest pitch', 57.3], ['cr', 'chest roll', 57.3], ['cy', 'chest yaw', 57.3], ['ny', 'neck bob', 100], ['hp', 'head pitch', 57.3], ['hy', 'head yaw', 57.3], ['hr', 'head roll', 57.3], ['hh', 'head bob', 100]];
const wrap = x => Math.atan2(Math.sin(x), Math.cos(x));
const by = {};
for (const arr of Object.values(series)) {
  // runs of valid frames
  let run = [];
  const flush = () => { if (run.length > 30) for (let j = 0; j < run.length; j++) { const r = run[j], m = r.mode;
      const win = run.filter(o => Math.abs(o.t - r.t) < 0.2), row = (by[m] ??= { n: 0, res: {}, step: {} }); row.n++;
      for (const [k, , sc] of K) { const ang = k !== 'ny' && k !== 'hh';
        const mean = ang ? Math.atan2(win.reduce((a, o) => a + Math.sin(o[k]), 0), win.reduce((a, o) => a + Math.cos(o[k]), 0)) : win.reduce((a, o) => a + o[k], 0) / win.length;
        (row.res[k] ??= []).push(Math.abs(ang ? wrap(r[k] - mean) : r[k] - mean) * sc);
        if (j > 0 && r.t - run[j - 1].t < 0.05) (row.step[k] ??= []).push(Math.abs(ang ? wrap(r[k] - run[j - 1][k]) : r[k] - run[j - 1][k]) * sc); } }
    run = []; };
  for (const r of arr) { if (!r) { flush(); continue; } run.push(r); } flush();
}
const q = (a, p) => a?.length ? a.slice().sort((x, y) => x - y)[Math.floor(p * (a.length - 1))] : NaN;
console.log(`query "${Q}"   amplitude p95 |x - 0.4 s mean| (deg / cm), step p99 per frame in brackets`);
console.log('mode      n    ' + K.map(([, n]) => n.padStart(11)).join(' '));
for (const [m, r] of Object.entries(by).sort((a, b) => b[1].n - a[1].n)) if (r.n > 60)
  console.log(`${m.padEnd(7)} ${String(r.n).padStart(5)}    ` + K.map(([k]) => `${q(r.res[k], 0.95).toFixed(1)} [${q(r.step[k], 0.99).toFixed(1)}]`.padStart(11)).join(' '));
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close(); process.kill(-server.pid);
