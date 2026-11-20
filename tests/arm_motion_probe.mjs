// Arm motion (browser): samples every frame of an autoplay match and reports, per leg mode, how the top (left-hand
// side of the stick) hand moves in the skater's own heading frame, measured from the pelvis:
//   sway   p5-p95 range of the top hand forward / sideways / up (how much it swings with the stride)
//   speed  median and p99 speed of the top hand in that frame (m/s): a quiet top hand is slow
//   follow share of the top hand's motion that is the shoulder's own motion (1 = the arm moves as one piece with
//          the torso, 0 = the hand holds still while the body moves under it)
//   jump   frames where the hand moves more than 0.08 in one frame (a pop)
// Usage: node tests/arm_motion_probe.mjs [extra query, e.g. &noik] [--secs 15]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const Q = process.argv.find(a => a.startsWith('&')) || '', si = process.argv.indexOf('--secs'), SECS = si > 0 ? +process.argv[si + 1] : 15;
const server = spawn('npx', ['vite', 'preview', '--port', '4176', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4176') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.goto(`http://localhost:4176/?autoplay&seed=11${Q}`);
await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
for (let i = 0; i < 60; i++) { const s = await page.evaluate(() => window.__faceoff.snap()); if (s.mode === 'match' && s.phase === 'play') break; if (s.mode !== 'match') await page.keyboard.press('Enter'); if (s.phase === 'faceoff' && s.foLive) await page.keyboard.press('KeyJ'); await page.waitForTimeout(150); }
const rows = await page.evaluate(async secs => {
  const F = window.__faceoff, out = [], prev = {};
  let last = performance.now(); const t0 = last;
  while (performance.now() - t0 < secs * 1000) {
    await new Promise(r => requestAnimationFrame(r));
    const now = performance.now(), dt = (now - last) / 1000; last = now;
    const sn = F.snap(); if (sn.phase !== 'play') { for (const k in prev) delete prev[k]; continue; }
    const sk = F.skaters(), own = sn.puck.owner;
    for (let i = 0; i < sk.length; i++) {
      const L = F.limbs(i), s = sk[i];
      if (!L || !L.hl || s.stun > 0 || s.air || s.out > 0 || s.wind >= 0 || ['wrist_shot', 'slapshot', 'fall', 'check'].includes(L.clip)) { delete prev[i]; continue; }
      // the top hand: the left hand on a right shot; the model is mirrored for a left shot, so hand_l is still the top
      const p = prev[i];
      if (p && dt > 0 && dt < 0.05) {
        const dh = L.hl.map((x, k) => x - p.hl[k]), ds = L.sl.map((x, k) => x - p.sl[k]);
        const dT = L.T && p.T ? Math.hypot(...L.T.map((x, k) => x - p.T[k])) : 0, dS = L.spot && p.spot ? Math.hypot(...L.spot.map((x, k) => x - p.spot[k])) : 0, dK = L.knob && p.knob ? Math.hypot(...L.knob.map((x, k) => x - p.knob[k])) : 0, dR = Math.hypot(...L.hr.map((x, k) => x - p.hr[k])), dB = L.bot && p.bot ? Math.hypot(...L.bot.map((x, k) => x - p.bot[k])) : 0, dY = Math.abs(Math.atan2(Math.sin(L.yaw - p.yaw), Math.cos(L.yaw - p.yaw)));
        out.push({ one: L.one ?? 0, car: own === i, dhv: dh, dsv: ds, tw: L.tw, sl: L.sl, dK, dR, dB, dT, dS, dY, dW: Math.abs(L.ikW - p.w), m: L.mode, hl: L.hl, sp: Math.hypot(...dh) / dt, dh: Math.hypot(...dh), dot: dh.reduce((a, x, k) => a + x * ds[k], 0), dd: dh.reduce((a, x) => a + x * x, 0), w: L.ikW });
      }
      prev[i] = { hl: L.hl, sl: L.sl, hr: L.hr, knob: L.knob, bot: L.bot, T: L.T, spot: L.spot, yaw: L.yaw, w: L.ikW };
    }
  }
  return out;
}, SECS);
const q = (a, p) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(p * (a.length - 1))] : NaN;
const by = {};
for (const r of rows) (by[r.m] ??= []).push(r);
console.log(`query "${Q}"  ${rows.length} skater-frames`);
console.log('mode      n     sway fwd/side/up      speed med/p99   follow   jumps');
for (const [m, a] of Object.entries(by).sort((x, y) => y[1].length - x[1].length)) {
  const rng = k => (q(a.map(r => r.hl[k]), 0.95) - q(a.map(r => r.hl[k]), 0.05)).toFixed(2);
  const follow = a.reduce((s, r) => s + r.dot, 0) / Math.max(1e-9, a.reduce((s, r) => s + r.dd, 0));
  console.log(`${String(m).padEnd(8)} ${String(a.length).padStart(5)}   ${rng(0)}/${rng(1)}/${rng(2)}`.padEnd(38) + `${q(a.map(r => r.sp), 0.5).toFixed(2)}/${q(a.map(r => r.sp), 0.99).toFixed(2)}`.padEnd(16) + `${follow.toFixed(2)}`.padEnd(9) + a.filter(r => r.dh > 0.08).length);
}
// what moved on the frames the hand jumped: the blade target, the top hand's spot, the body's yaw, the IK weight
const J = rows.filter(r => r.dh > 0.08), cause = {};
for (const r of J) { const k = [r.dT > 0.15 && 'target', r.dS > 0.06 && 'spot', r.dY > 0.12 && 'yaw', r.dW > 0.1 && 'weight', r.dB > 0.08 && 'botTarget', r.dR > 0.08 && 'botHand', r.dK > 0.08 && 'knob'].filter(Boolean).join('+') || 'none'; cause[k] = (cause[k] || 0) + 1; }
console.log('jumps by what moved that frame:', JSON.stringify(cause));
// chest twist off the heading, and whether the top hand's sideways position goes with the shoulder's (correlation)
const corr = (a, b) => { const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n; let c = 0, va = 0, vb = 0; for (let i = 0; i < n; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; } return c / Math.sqrt(va * vb || 1); };
for (const m of ['stride', 'glide', 'cross']) { const a = by[m] || []; if (a.length < 50) continue;
  const dc = k => corr(a.map(r => r.dhv[k]), a.map(r => r.dsv[k]));
  console.log(`${m}: frame-to-frame, hand moves with shoulder: fwd ${dc(0).toFixed(2)} side ${dc(1).toFixed(2)} up ${dc(2).toFixed(2)}`);
  for (const [lab, sub] of [['carrying', a.filter(r => r.car)], ['not carrying', a.filter(r => !r.car)], ['  one hand', a.filter(r => !r.car && r.one > 0.9)], ['  two hands', a.filter(r => !r.car && r.one < 0.1)]]) if (sub.length > 40) { const d2 = k => corr(sub.map(r => r.dhv[k]), sub.map(r => r.dsv[k])); console.log(`   ${lab} (${sub.length}): fwd ${d2(0).toFixed(2)} side ${d2(1).toFixed(2)} up ${d2(2).toFixed(2)}`); }
  console.log(`${m}: chest twist p5/p95 ${q(a.map(r => r.tw), 0.05).toFixed(2)}/${q(a.map(r => r.tw), 0.95).toFixed(2)} rad; top hand side vs shoulder side corr ${corr(a.map(r => r.hl[1]), a.map(r => r.sl[1])).toFixed(2)}, hand fwd vs shoulder fwd ${corr(a.map(r => r.hl[0]), a.map(r => r.sl[0])).toFixed(2)}`); }
console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close(); process.kill(-server.pid);
