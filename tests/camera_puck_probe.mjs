// Camera and puck readability probe, in a bot-played match.
// Usage: node tests/camera_puck_probe.mjs
// Camera (sampled every 50 ms while play is live):
//   leadCorrX      correlation between the look-ahead offset and the puck's up-ice velocity (1 = leads exactly with motion)
//   leadAtSpeed    mean |look-ahead| (units) when the puck moves faster than 15
//   trackErrMean   mean distance between where the camera wants to be and where it is (lag)
//   aheadPx        puck's screen offset from centre along its travel when fast (negative = ice ahead is in view)
//   puckOnScreen   share of samples with the puck inside the middle 80% of the screen
// Puck: screenshots around the loose puck, converted to grey with ffmpeg, then
//   iceL, ringL    mean luminance (0..255) of the ice just outside the halo and of the darkest ring pixels
//   contrast       WCAG contrast ratio between them (4.5+ is high contrast)
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
mkdirSync('tests/out', { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4173') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:4173/?autoplay&seed=4');
await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
const S = []; const lum = [];
for (let i = 0; i < 700; i++) {
  const s = await page.evaluate(() => {
    const f = window.__faceoff, s = f.snap(), p = s.puck, own = p.owner >= 0 ? s.skaters.find(k => k.id === p.owner) : null;
    const vx = own ? own.vx : p.vx, vy = own ? own.vy : p.vy, a = f.ground(p.x, p.y), b = f.ground(p.x + vx * 0.1, p.y + vy * 0.1);
    return { mode: s.mode, phase: s.phase, p, vx, vy, cam: f.cam(), scr: a, sdir: [b[0] - a[0], b[1] - a[1]] };
  });
  if (s.mode !== 'match') { await page.keyboard.press('Enter'); await page.waitForTimeout(250); continue; }
  if (s.phase === 'play') S.push(s);
  await page.waitForTimeout(50);
}
// puck contrast: the parked puck in the empty test rink, still, on plain ice, at 1x and 2x pixel density
for (const dpr of [1, 2]) {
  const pg = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: dpr });
  await pg.goto('http://localhost:4173/?test&seed=1');
  await pg.waitForFunction(() => window.__faceoff); await pg.evaluate(() => window.__faceoff.assetsReady());
  for (let i = 0; i < 20; i++) { if ((await pg.evaluate(() => window.__faceoff.snap())).mode === 'match') break; await pg.keyboard.press('Enter'); await pg.waitForTimeout(200); }
  await pg.waitForTimeout(1500);
  const [x, y] = await pg.evaluate(() => { const f = window.__faceoff, k = f.snap().skaters.find(k => k.ctrl);
    f.puckTo(k.x + 3, k.y + 3); return new Promise(r => setTimeout(() => r(f.ground(k.x + 3, k.y + 3)), 600)); });
  const file = `tests/out/puck-dpr${dpr}.png`, H = 32;
  await pg.screenshot({ path: file, clip: { x: x - H, y: y - H, width: 2 * H, height: 2 * H } });
  const N = 2 * H * dpr;
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  const ring = [], ice = [];
  for (let v = 0; v < N; v++) for (let u = 0; u < N; u++) {
    const r = Math.hypot(u - N / 2, v - N / 2) / dpr;
    if (r < 9) ring.push(raw[v * N + u]); else if (r > 16 && r < 30) ice.push(raw[v * N + u]);
  }
  ring.sort((a, b) => a - b); ice.sort((a, b) => a - b);
  const dark = ring.slice(0, Math.max(1, Math.floor(ring.length * 0.25)));
  lum.push({ dpr, ringL: dark.reduce((a, b) => a + b, 0) / dark.length, iceL: ice[Math.floor(ice.length / 2)] });
  await pg.close();
}
// occlusion: the puck parked right under the skater's body. Count the neon cue pixels (lime: high green, low blue)
// around the puck in the crop: with the x-ray ring the puck's spot still shows through skates and pads
const occ = [];
for (const where of ['open', 'under']) {
  const pg = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await pg.goto('http://localhost:4173/?test&seed=1');
  await pg.waitForFunction(() => window.__faceoff); await pg.evaluate(() => window.__faceoff.assetsReady());
  for (let i = 0; i < 20; i++) { if ((await pg.evaluate(() => window.__faceoff.snap())).mode === 'match') break; await pg.keyboard.press('Enter'); await pg.waitForTimeout(200); }
  await pg.waitForTimeout(1200);
  const [x, y] = await pg.evaluate(w => { const f = window.__faceoff, k = f.snap().skaters.find(k => k.ctrl);
    const px = w === 'under' ? k.x : k.x + 3, py = w === 'under' ? k.y : k.y + 3; f.puckTo(px, py);
    return new Promise(r => setTimeout(() => r(f.ground(px, py)), 500)); }, where);
  const file = `tests/out/puck-${where}.png`, H = 40;
  await pg.screenshot({ path: file, clip: { x: x - H, y: y - H, width: 2 * H, height: 2 * H } });
  const raw = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  let lime = 0; for (let i = 0; i < raw.length; i += 3) { const r = raw[i], gg = raw[i + 1], b = raw[i + 2]; if (gg > 200 && b < 140 && r > 120 && r < 235 && gg - b > 90) lime++; }
  occ.push({ where, limePixels: lime });
  await pg.close();
}
const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const corr = (a, b) => { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / Math.sqrt(da * db || 1); };
const fast = S.filter(s => Math.hypot(s.vx, s.vy) > 15);
const rel = l => { const c = (l / 255) <= 0.03928 ? (l / 255) / 12.92 : (((l / 255) + 0.055) / 1.055) ** 2.4; return c; };
const contrast = lum.map(({ ringL, iceL }) => (rel(iceL) + 0.05) / (rel(ringL) + 0.05));
console.log(JSON.stringify({
  samples: S.length,
  camera: {
    leadCorrX: +corr(S.map(s => s.cam.leadX), S.map(s => s.vx)).toFixed(3),
    leadAtSpeed: +mean(fast.map(s => Math.hypot(s.cam.leadX, s.cam.leadZ))).toFixed(2),
    trackErrMean: +mean(S.map(s => Math.hypot(s.cam.errX, s.cam.errZ))).toFixed(2),
    // where the puck sits on screen along its own direction of travel: negative = behind centre, i.e. the view shows ice ahead of it
    aheadPx: +mean(fast.filter(s => Math.abs(s.sdir[1]) > Math.abs(s.sdir[0])).map(s => (s.scr[1] - 360) * Math.sign(s.sdir[1]))).toFixed(1),   // up/down-ice travel only
    puckOnScreen: (100 * S.filter(s => s.scr[0] > 128 && s.scr[0] < 1152 && s.scr[1] > 72 && s.scr[1] < 648).length / S.length).toFixed(1) + '%',
  },
  puckIndicator: occ,
  puck: lum.map((l, i) => ({ dpr: l.dpr, iceL: +l.iceL.toFixed(1), darkL: +l.ringL.toFixed(1), contrast: +contrast[i].toFixed(2) })),
}));
await browser.close(); process.kill(-server.pid);
