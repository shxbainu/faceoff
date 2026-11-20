// A close camera on one skater (game camera angle), a frame every ~80 ms for a second while he skates, as a strip:
// to judge by eye whether the arms and stick move with the body. Usage: node tests/arm_strip.mjs out.png [extra query]
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const OUT = process.argv[2] || 'tests/out/arm_strip.png', Q = process.argv[3] || '', DIST = +(process.argv[4] || 4.5), ANG = +(process.argv[5] || 0.6);
const server = spawn('npx', ['vite', 'preview', '--port', '4180', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4180') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
await page.goto('http://localhost:4180/?autoplay&seed=4' + Q);
await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
for (let i = 0; i < 60; i++) { const s = await page.evaluate(() => window.__faceoff.snap()); if (s.mode === 'match' && s.phase === 'play') break; await page.keyboard.press('Enter'); await page.keyboard.press('KeyJ'); await page.waitForTimeout(150); }
await page.addStyleTag({ content: 'body > *:not(canvas) { display: none !important; }' });
await page.waitForTimeout(4000);
// a home skater (not the puck carrier) striding at speed
const who = await page.evaluate(async () => { const F = window.__faceoff;
  for (let n = 0; n < 3000; n++) { await new Promise(r => requestAnimationFrame(r)); const sn = F.snap(), g = F.gait();
    for (let i = 0; i < sn.skaters.length; i++) { const k = sn.skaters[i]; if (g[i]?.mode === 'stride' && Math.hypot(k.vx, k.vy) > 8 && sn.puck.owner !== i && !k.ctrl && !(k.stickless > 0)) return i; } } return -1; });
await page.evaluate(i => window.__faceoff.closeCam(i[0], i[1], i[2]), [who, DIST, ANG]);
const dir = mkdtempSync(tmpdir() + '/strip-'), files = [], info = [];
for (let f = 0; f < 12; f++) { const p = `${dir}/${String(f).padStart(2, '0')}.png`; await page.screenshot({ path: p, clip: { x: 200, y: 150, width: 500, height: 600 } }); files.push(p); info.push(await page.evaluate(i => { const F = window.__faceoff, L = F.limbs(i), k = F.snap().skaters[i]; return `one ${L.one.toFixed(2)} sp ${Math.hypot(k.vx, k.vy).toFixed(1)} ${L.mode}/${L.clip} stickless ${(k.stickless ?? 0) > 0}`; }, who).then(t => `${f}: ${t}`)); await page.waitForTimeout(60); }
console.log(info.join('\n'));
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...files.flatMap(f => ['-i', f]), '-filter_complex', `${files.map((_, i) => `[${i}]scale=250:-1[s${i}]`).join(';')};${files.map((_, i) => `[s${i}]`).join('')}xstack=inputs=12:layout=${[0,1,2,3,4,5].map(c => `${c * 250}_0`).join('|')}|${[0,1,2,3,4,5].map(c => `${c * 250}_300`).join('|')}`, OUT]);
console.log('skater', who, 'saved', OUT);
await browser.close(); try { process.kill(-server.pid); } catch {}
