// Pops (no physics): a bot match, every frame, how far each palm and the stick blade jump in the skater's own body
// frame (skating removed). Prints the distribution and which clip / gait-mode changes the jumps happen on.
// Pass: p99.9 < 6 cm, max < 15 cm. Usage: node tests/pop_probe.mjs [seconds=40] [extra query]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const secs = +(process.argv[2] || 40);
const server = spawn('npx', ['vite', 'preview', '--port', '4178', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4178') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://localhost:4178/?seed=8&autoplay' + (process.argv[3] || ''));
await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
for (let i = 0; i < 30; i++) { const s = await page.evaluate(() => window.__faceoff.snap()); if (s.mode === 'match' && s.phase === 'play') break; await page.keyboard.press('Enter'); await page.keyboard.press('KeyJ'); await page.waitForTimeout(250); }
await page.waitForTimeout(1000);
await page.evaluate(() => window.__faceoff.popCheck(true));
await page.waitForTimeout(secs * 1000);
const r = await page.evaluate(() => window.__faceoff.popCheck(false));
console.log(`frames ${r.frames}  jump p50 ${r.p50}  p99 ${r.p99}  p99.9 ${r.p999}  max ${r.max}  >6cm ${r.over6}  >15cm ${r.over15}`);
for (const [k, n] of r.jumps) console.log(String(n).padStart(5), k);
console.log('shoulders / pelvis / neck p50 p99 max', JSON.stringify(r.body)); const ok = r.p999 < 0.06 && r.max < 0.15 && !errs.length;
console.log(ok ? 'PASS' : 'FAIL', 'errors', errs.length, errs.slice(0, 2));
await browser.close(); try { process.kill(-server.pid); } catch { /* gone */ }
process.exit(ok ? 0 : 1);
