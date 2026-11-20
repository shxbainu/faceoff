// Records a short clip of a bot-played match (Playwright video), converted to mp4 with ffmpeg.
// Usage: node tests/video.mjs [--seconds 8] [--out tests/out/gameplay.mp4]
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const SECS = Number(arg('seconds', 8)), OUT = arg('out', 'tests/out/gameplay.mp4'), TMP = 'tests/out/video-tmp';
rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe', detached: true });   // own process group, so the whole preview server can be stopped
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4173') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium',
  args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: TMP, size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
await page.goto('http://localhost:4173/?autoplay' + arg('query', ''));   // --query '&sidecam&rapier'
await page.waitForFunction(() => window.__faceoff);
await page.evaluate(() => window.__faceoff.assetsReady());
for (let i = 0; i < 80; i++) {
  const s = await page.evaluate(() => window.__faceoff.snap());
  if (s.mode === 'match' && s.phase === 'play') break;
  if (s.mode !== 'match') await page.keyboard.press('Enter');
  if (s.phase === 'faceoff' && s.foLive) await page.keyboard.press('KeyJ');
  await page.waitForTimeout(120);
}
await page.waitForTimeout(SECS * 1000);
await ctx.close(); await browser.close(); process.kill(-server.pid);
const webm = readdirSync(TMP).find(f => f.endsWith('.webm'));
// keep only the play part (the video starts at page load)
execFileSync('ffmpeg', ['-v', 'error', '-y', '-sseof', String(-SECS), '-i', `${TMP}/${webm}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', OUT]);
console.log('saved', OUT);
