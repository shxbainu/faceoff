// Powered-ragdoll spike check (PHYSICS_PLAN.md step 4, revised): a bot match with ?phys, every skater and goalie on a
// physics body. Prints physics cost per frame, drift from the animated pose, joint gaps, error jumps, fast parts, NaN,
// drawn blade against the layers' (sim) stick, and palm-to-grip from the drawn result. Exit 1 on any fail.
// Usage: node tests/phys_spike.mjs [seconds=60] [extra query]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const secs = +(process.argv[2] || 60);
const server = spawn('npx', ['vite', 'preview', '--port', '4177', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4177') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('console', m => m.type() === 'warning' && /ragdoll/.test(m.text()) && errs.push(m.text()));
await page.goto('http://localhost:4177/?seed=8&autoplay&phys' + (process.argv[3] || ''));
await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
for (let i = 0; i < 30; i++) { const s = await page.evaluate(() => window.__faceoff.snap()); if (s.mode === 'match' && s.phase === 'play') break; await page.keyboard.press('Enter'); await page.keyboard.press('KeyJ'); await page.waitForTimeout(250); }
await page.waitForTimeout(1500);
const rigs = await page.evaluate(() => { window.__faceoff.gripCheck(true); return window.__faceoff.physCheck(true); });
await page.waitForTimeout(secs * 1000);
const r = await page.evaluate(() => window.__faceoff.physCheck(false)), gr = await page.evaluate(() => window.__faceoff.gripCheck(false));
console.log('rigs', rigs, JSON.stringify(r));
console.log(`grip: frames x skaters ${gr.frames}  over 1 cm ${gr.over}  worst ${(gr.worst * 100).toFixed(3)} cm  (${gr.who})`);
const checks = [
  ['cost mean < 2 ms', r.ms.mean < 2], ['cost p95 < 3 ms', r.ms.p95 < 3],
  ['grip every frame < 1 cm', gr.over === 0 && gr.frames > 1000],
  ['bone angle p50 < 5 deg', r.angDeg.p50 < 5], ['bone angle p95 < 15 deg', r.angDeg.p95 < 15], ['pelvis/palms p95 < 3 cm', r.posM.p95 < 0.03],
  ['no NaN', r.nan === 0], ['joint gaps < 2 cm', r.gapM < 0.02], ['no error jumps > 20 deg', r.jumps === 0], ['no part > 30 m/s', r.fast === 0],
  ['blade p99 < 3 cm', r.bladeM.p99 < 0.03], ['blade worst < 6 cm', r.bladeM.max < 0.06], ['no errors', errs.length === 0],
];
for (const [n, ok] of checks) console.log(ok ? 'pass' : 'FAIL', n);
console.log('errors', errs.length, errs.slice(0, 3));
await browser.close(); try { process.kill(-server.pid); } catch { /* gone */ }
process.exit(checks.every(c => c[1]) ? 0 : 1);
