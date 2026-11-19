// Skating gait probe: runs the lone skater in the ?test rink through sprint, cruise, carve, stop, backward and
// stand still, and measures from the drawn skeleton:
//   spread  - widest lateral gap between the two skates, in leg lengths (a real push reads as > 0.9)
//   alt     - share of the cycle where one skate is clearly further out than the other (alternating pushes)
//   skid    - median angle (deg) between a skate's heading and its path over the ice while it is on the ice
//             (0 = the blade runs along its edge, 90 = sliding sideways: foot slide)
//   modes   - gait modes seen per phase
// Also saves close-up frames to tests/out/gait-*.png. Usage: node tests/gait_probe.mjs [--old] (old = ?nogait)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const OLD = process.argv.includes('--old'), TAG = OLD ? 'old' : 'new';
mkdirSync('tests/out', { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4173') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://localhost:4173/?test&seed=1${OLD ? '&nogait' : ''}`);
await page.waitForFunction(() => window.__faceoff);
await page.evaluate(() => window.__faceoff.assetsReady());
for (let i = 0; i < 20; i++) { if ((await page.evaluate(() => window.__faceoff.snap())).mode === 'match') break; await page.keyboard.press('Enter'); await page.waitForTimeout(200); }
const rows = [];
async function run(keys, sec, tag, shots = 0) {
  for (const k of keys) await page.keyboard.down(k);
  const t0 = Date.now(); let n = 0;
  while (Date.now() - t0 < sec * 1000) {
    const r = await page.evaluate(() => { const f = window.__faceoff, s = f.snap(), i = s.skaters.findIndex(k => k.ctrl);
      return { t: performance.now() / 1000, sp: Math.hypot(s.skaters[i].vx, s.skaters[i].vy), ft: f.feet(i), g: f.gait()[i], clip: f.anims()[i]?.clip }; });
    rows.push({ tag, ...r });
    if (shots && Date.now() - t0 > (sec * 1000 / (shots + 1)) * (n + 1) && n < shots) {
      const box = await page.evaluate(() => { const f = window.__faceoff, s = f.snap(), k = s.skaters.find(k => k.ctrl); return f.screen(k.x, k.y); });
      const [cx, cy] = box ?? [640, 400];
      await page.screenshot({ path: `tests/out/gait-${TAG}-${tag}-${n}.png`, clip: { x: Math.max(0, cx - 90), y: Math.max(0, cy - 110), width: 180, height: 180 } });
      n++;
    }
    await page.waitForTimeout(16);
  }
  for (const k of keys) await page.keyboard.up(k);
}
await run([], 0.8, 'ready', 1);
await run(['KeyW'], 1.6, 'sprint', 4);
await run(['KeyW'], 1.2, 'cruise', 2);
await run(['KeyD'], 1.0, 'carve', 2);
await run(['KeyA'], 0.6, 'stop', 2);
await run([], 1.0, 'glide', 1);
await run(['KeyS'], 0.3, 'turn');
await run(['KeyW'], 1.2, 'back2', 2);
console.log('errors', errs.length, errs.slice(0, 3));
await browser.close(); process.kill(-server.pid);
// metrics per phase
const med = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
for (const tag of [...new Set(rows.map(r => r.tag))]) {
  const R = rows.filter(r => r.tag === tag && r.ft), leg = R.find(r => r.g?.leg)?.g.leg || 1.03;   // leg length (thigh + calf, world units); the old run has no gait rig
  let spread = 0, alt = 0; const skid = [], spreads = [];
  R.forEach((r, j) => {
    const f = r.ft.feet, side = [Math.sin(r.ft.face), -Math.cos(r.ft.face)];
    const lat = f.map(p => (p.x - r.ft.cx) * side[0] + (p.z - r.ft.cz) * side[1]);
    const mid = 0;   // the body's own centre line
    spread = Math.max(spread, Math.abs(lat[0] - lat[1]) / leg); spreads.push(Math.abs(lat[0] - lat[1]) / leg);
    if (Math.abs(Math.abs(lat[0] - mid) - Math.abs(lat[1] - mid)) > 0.15 * leg) alt++;
    const p = R[j - 1]; if (!p || r.t - p.t > 0.06 || r.t - p.t < 0.004) return;
    f.forEach((q, k) => {
      const o = p.ft.feet[k], dx = q.x - o.x, dz = q.z - o.z, d = Math.hypot(dx, dz);
      if (q.y > 0.25 || d / (r.t - p.t) < 1.5) return;   // lifted or barely moving
      const ax = q.toe, al = Math.hypot(...ax) || 1;   // the blade's heading: foot bone to toe (ball) bone
      const c = Math.abs((dx * ax[0] + dz * ax[1]) / (d * al));
      skid.push(Math.acos(Math.min(1, c)) * 180 / Math.PI);
    });
  });
  const modes = {}; R.forEach(r => { const m = r.g?.mode ?? r.clip; modes[m] = (modes[m] || 0) + 1; });
  console.log(`${TAG} ${tag.padEnd(7)} sp ${med(R.map(r => r.sp)).toFixed(1).padStart(5)}  spread max ${spread.toFixed(2)} med ${med(spreads).toFixed(2)}  alt ${(alt / Math.max(1, R.length)).toFixed(2)}  skid ${med(skid).toFixed(0).padStart(3)}deg (n ${skid.length})  modes ${JSON.stringify(modes)}`);
}
