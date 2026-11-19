// Ragdoll probe (browser): in a real match, knocks five opponents down at once with big hits of each kind, then
// checks every ragdoll stays sane (finite, rigid links at length, nothing under the ice), that each skater blends
// back to animation and skates again, that a light hit staggers without a ragdoll, and the frame rate meanwhile.
// Saves close-ups to tests/out/rag-*.png.  Usage: node tests/ragdoll_probe.mjs   (exits 1 on a failure)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
mkdirSync('tests/out', { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4173') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', e => errs.push(String(e))); page.on('console', m => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:4173/?seed=3&movedbg');
await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
for (let i = 0; i < 30; i++) { const s = await page.evaluate(() => window.__faceoff.snap()); if (s.mode === 'match' && s.phase === 'play') break; await page.keyboard.press('Enter'); await page.keyboard.press('KeyJ'); await page.waitForTimeout(250); }
let fails = 0; const check = (ok, name, info = '') => { console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); if (!ok) fails++; };
// knock the five opponents down: varied directions, all big hits
const ids = await page.evaluate(() => { const f = window.__faceoff, s = f.snap(); const o = s.skaters.map((k, i) => [k, i]).filter(([k]) => k.team === 1 && k.ok).map(([, i]) => i);
  o.forEach((i, j) => { const a = j * 1.3; f.knock(i, 13 + j, Math.cos(a), Math.sin(a)); }); return o; });
const samples = await page.evaluate(async () => {
  const f = window.__faceoff, out = [], raf = () => new Promise(r => requestAnimationFrame(r));
  let last = performance.now();
  for (let t0 = performance.now(); performance.now() - t0 < 3200;) { await raf(); const now = performance.now(); out.push({ t: now - t0, ms: now - last, rag: f.rag(), anim: f.anims(), snap: f.snap().skaters.map(k => k.stun) }); last = now; }
  return out;
});
const maxRag = Math.max(...samples.map(s => s.rag.length));
check(maxRag >= 5, 'five ragdolls at once', `max running ${maxRag}`);
const all = samples.flatMap(s => s.rag);
check(all.every(r => r.finite), 'ragdolls stay finite (no exploding limbs)');
check(Math.max(...all.map(r => r.stretch)) < 0.08, 'rigid links stay near rest length', `worst stretch ${(Math.max(...all.map(r => r.stretch)) * 100).toFixed(1)}%`);
check(Math.min(...all.map(r => r.low)) > 0.05, 'nothing sinks into the ice', `lowest particle ${Math.min(...all.map(r => r.low)).toFixed(3)}`);
check(Math.min(...all.map(r => r.up)) < 0.35, 'big hits put them on the ice (torso near flat)', `flattest torso ${Math.min(...all.map(r => r.up)).toFixed(2)} (1 upright, 0 flat)`);
const fr = samples.slice(5).map(s => s.ms).sort((a, b) => a - b);
const avg = fr.reduce((a, b) => a + b, 0) / fr.length;
check(1000 / avg > 55, 'frame rate with five ragdolls', `${(1000 / avg).toFixed(1)} fps, p95 ${fr[Math.floor(fr.length * 0.95)].toFixed(1)} ms, worst ${fr.at(-1).toFixed(1)} ms`);
const end = samples.at(-1);
check(end.rag.length === 0, 'every ragdoll has blended back out', `still running ${end.rag.length}`);
check(ids.every(i => end.anim[i]?.clip !== 'fall' && end.snap[i] <= 0), 'they are up and skating again', ids.map(i => end.anim[i]?.clip).join(','));
// weight never jumps (no pop in or out): biggest change in w between frames, ignoring the fast blend in
let jump = 0; for (let k = 1; k < samples.length; k++) for (const r of samples[k].rag) { const p = samples[k - 1].rag.find(q => q.i === r.i); if (p && r.w < p.w) jump = Math.max(jump, p.w - r.w); }
check(jump < 0.15, 'blend out is gradual', `largest drop per frame ${jump.toFixed(2)}`);
// close-ups of one hit as it happens, and a light hit (stagger, no ragdoll)
await page.evaluate(() => { const f = window.__faceoff, s = f.snap(), i = s.skaters.findIndex(k => k.team === 1 && k.ok); window.__ri = i; f.knock(i, 15, 0, 1); });
for (const [n, wait] of [[0, 60], [1, 200], [2, 450], [3, 1300], [4, 1900]]) {
  await page.waitForTimeout(wait - (n ? [0, 60, 200, 450, 1300][n] : 0));
  const [x, y] = await page.evaluate(() => { const f = window.__faceoff, k = f.snap().skaters[window.__ri]; return f.screen(k.x, k.y); });
  await page.screenshot({ path: `tests/out/rag-${n}.png`, clip: { x: Math.max(0, Math.min(1280 - 360, x - 180)), y: Math.max(0, Math.min(720 - 360, y - 200)), width: 360, height: 360 } });
}
const st = await page.evaluate(async () => { const f = window.__faceoff, s = f.snap(), i = s.skaters.findIndex(k => k.team === 1 && k.ok && k.stun <= 0);
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' })); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'BracketRight' }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code: 'BracketRight' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft' }));
  await new Promise(r => setTimeout(r, 150)); return { rag: f.rag().length, stun: f.snap().skaters.filter(k => k.team === 1 && k.stun > 0).length }; });
check(st.rag === 0 || st.stun === 0, 'a light hit staggers without a ragdoll', JSON.stringify(st));
check(errs.length === 0, 'no errors', errs.slice(0, 3).join(' | '));
await browser.close(); process.kill(-server.pid);
console.log(fails ? `${fails} FAILED` : 'all pass');
process.exit(fails ? 1 : 0);
