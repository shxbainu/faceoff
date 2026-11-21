// Each limb joint's turn off its bind pose over a bot match (after every layer): swing and twist, p50/p95/p99/max deg.
// Usage: node tests/joint_probe.mjs [seconds=30] [extra query, e.g. &noik for the clip alone]
// Usage: node tests/grip_check.mjs [seconds=60] [extra query]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const secs = +(process.argv[2] || 60);
const server = spawn('npx', ['vite', 'preview', '--port', '4175', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4175') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://localhost:4175/?seed=8&autoplay' + (process.argv[3] || ''));
await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
for (let i = 0; i < 30; i++) { const s = await page.evaluate(() => window.__faceoff.snap()); if (s.mode === 'match' && s.phase === 'play') break; await page.keyboard.press('Enter'); await page.keyboard.press('KeyJ'); await page.waitForTimeout(250); }
await page.evaluate(() => window.__faceoff.jointCheck(true));
await page.waitForTimeout(secs * 1000);
const r = await page.evaluate(() => window.__faceoff.jointCheck(false)); for (const [k, x] of Object.entries(r)) console.log(k.padEnd(18), x); await browser.close(); try { process.kill(-server.pid); } catch {} process.exit(0);
console.log(`frames x skaters ${r.frames}  over 1 cm ${r.over}  worst ${(r.worst * 100).toFixed(3)} cm  (${r.who})`);
console.log('errors', errs.length, errs.slice(0, 2));
await browser.close(); try { process.kill(-server.pid); } catch { /* gone */ }
const ok = r.frames > 1000 && r.over === 0 && errs.length === 0;
console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
