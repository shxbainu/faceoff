// Hard check: every rendered frame of a 60 s bot match, every skater holding a stick, each palm (middle_01) must be
// within 1 cm of its grip on the stick (bottom where gripBottom put it, top at the knob grip), and no frame on his feet
// with the shaft or a palm inside a body capsule (BODY_CAPS). Measured in the renderer after every layer (gripMeasure),
// from the final bones and stick. Also prints how far the drawn blade lands from its target. Exits 1 on any fail.
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
await page.evaluate(() => window.__faceoff.gripCheck(true));
await page.waitForTimeout(secs * 1000);
const r = await page.evaluate(() => window.__faceoff.gripCheck(false));
console.log(`frames x skaters ${r.frames}  over 1 cm ${r.over}  worst ${(r.worst * 100).toFixed(3)} cm  (${r.who})`);
console.log(`on their feet ${r.live}  shaft or a palm inside a body capsule: ${r.clip} frames ${JSON.stringify(r.byCap)}  first: ${r.clipWho}`);
if (r.blade?.length) { const b = r.blade.sort((x, y) => x - y), q = f => (b[Math.floor(f * (b.length - 1))] * 100).toFixed(1); console.log(`drawn blade to its target (aimed frames): p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} cm`); }
console.log('errors', errs.length, errs.slice(0, 2));
await browser.close(); try { process.kill(-server.pid); } catch { /* gone */ }
const ok = r.frames > 1000 && r.over === 0 && r.clip === 0 && errs.length === 0;
console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
