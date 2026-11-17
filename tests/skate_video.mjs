// Records the lone skater in the ?test rink running a fixed skating drill (sprint, hard carve, 180,
// quick cuts, stop) and logs which clip plays when, so stride / crossover / reversal changes can be seen.
// Usage: node tests/skate_video.mjs [--out tests/out/skating.mp4]
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const OUT = arg('out', 'tests/out/skating.mp4'), TMP = 'tests/out/skate-tmp';
rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4173') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium',
  args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: TMP, size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
await page.goto('http://localhost:4173/?test&seed=1');
await page.waitForFunction(() => window.__faceoff);
await page.evaluate(() => window.__faceoff.assetsReady());
for (let i = 0; i < 20; i++) {
  if ((await page.evaluate(() => window.__faceoff.snap())).mode === 'match') break;
  await page.keyboard.press('Enter'); await page.waitForTimeout(200);
}
const log = [];
const sample = async tag => {
  const r = await page.evaluate(() => { const s = window.__faceoff.snap(), i = s.skaters.findIndex(k => k.ctrl), k = s.skaters[i];
    return { sp: +Math.hypot(k.vx, k.vy).toFixed(1), clip: window.__faceoff.anims()[i]?.clip }; });
  log.push(`${tag} ${r.clip} ${r.sp}`);
};
async function hold(keys, sec, tag) {
  for (const k of keys) await page.keyboard.down(k);
  const t0 = Date.now(); while (Date.now() - t0 < sec * 1000) { await sample(tag); await page.waitForTimeout(100); }
  for (const k of keys) await page.keyboard.up(k);
}
await hold(['KeyS'], 0.8, 'back-off');
await hold([], 0.6, 'settle');
await hold(['KeyW'], 1.4, 'sprint');
await hold(['KeyD'], 0.9, 'carve-right');
await hold(['KeyS'], 0.9, 'carve-down');
await hold(['KeyW'], 1.0, 'reverse-180');
await hold(['KeyW', 'KeyA'], 0.5, 'cut-left');
await hold(['KeyW', 'KeyD'], 0.5, 'cut-right');
await hold(['KeyA'], 0.9, 'carve-left');
await hold([], 1.2, 'coast');
const v = page.video(); await ctx.close(); await browser.close(); process.kill(-server.pid);
const src = await v.path();
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', OUT]);
rmSync(TMP, { recursive: true, force: true });
const runs = []; for (const l of log) { const [tag, clip] = l.split(' '); const last = runs.at(-1); if (last && last[0] === tag && last[1] === clip) last[2]++; else runs.push([tag, clip, 1]); }
console.log(runs.map(r => `${r[0]}: ${r[1]} x${r[2]}`).join('\n'));
console.log('video', OUT);
