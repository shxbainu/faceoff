// Stick probe: over a bot match, how often each blade is below the ice and how far a carrier's drawn blade is from
// the drawn puck. Usage: node tests/stick_probe.mjs [--query ""] [--secs 12]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i < 0 ? d : process.argv[i + 1]; };
const Q = arg('query', ''), SECS = +arg('secs', 12);
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4173') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(`http://localhost:4173/?autoplay&seed=11${Q ? '&' + Q : ''}`);
await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
for (let i = 0; i < 60; i++) { const s = await page.evaluate(() => window.__faceoff.snap()); if (s.mode === 'match' && s.phase === 'play') break; if (s.mode !== 'match') await page.keyboard.press('Enter'); if (s.phase === 'faceoff' && s.foLive) await page.keyboard.press('KeyJ'); await page.waitForTimeout(150); }
let n = 0, under = 0, deep = 0, gaps = [], lats = [], off = {};
const t0 = Date.now();
while (Date.now() - t0 < SECS * 1000) {
  const r = await page.evaluate(() => { const F = window.__faceoff; const a = F.anims(), g = F.gait(); return F.skaters().map((k, i) => ({ st: F.stick(i), own: F.snap().puck.owner === k.id, stun: k.stun, why: `${a[i]?.clip}/${g[i]?.mode}${k.wind >= 0 ? ' wind' : ''}${k.spinT > 0 ? ' spin' : ''}${k.bh > 0.5 ? ' bh' : ''}${k.human ? ' you' : ''}` })); });
  for (const k of r) { if (!k.st || k.stun > 0) continue; n++; if (k.st.low < -0.01) under++; if (k.st.low < -0.08) deep++; if (k.own && k.st.gap != null) { gaps.push(k.st.gap); lats.push(k.st.lat); if (k.st.gap > 0.3) off[k.why] = (off[k.why] || 0) + 1; } }
  await page.waitForTimeout(50);
}
const q = (a, p) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(p * (a.length - 1))].toFixed(2) : '-';
console.log(`blades below the ice: ${(100 * under / n).toFixed(1)}% of samples (deeper than 0.08: ${(100 * deep / n).toFixed(1)}%), ${n} samples`);
console.log(`carrier: drawn puck to drawn blade median ${q(gaps, 0.5)} p90 ${q(gaps, 0.9)} max ${q(gaps, 1)} | puck lateral (shot side +) min ${q(lats, 0)} median ${q(lats, 0.5)} max ${q(lats, 1)}`);
console.log('puck off the drawn blade (> 0.3) by clip/leg mode:', JSON.stringify(off));
console.log('errors:', errors.length ? errors : 'none');
await browser.close(); process.kill(-server.pid);
