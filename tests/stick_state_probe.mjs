// Stick and body in every state (browser): samples every skater in an autoplay match and groups by state (carrying,
// each leg mode, shots, checks) and reports the drawn stick against real hockey:
//   shaft   angle of the shaft from vertical (a held stick runs about 40-60 deg; a cane is under 25)
//   bladeY  blade height above the ice (on the ice: under about 0.15)
//   fwd/lat blade position off the body (ahead, toward the shot side)
//   top     top hand's distance from its grip on the shaft (0 = holding it)
//   toSim   drawn blade vs the sim's stick collider
// plus knee, lean and hip per state. Exits 1 if a skating state holds the stick like a cane or lets go of it.
// Usage: node tests/stick_state_probe.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4173') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://localhost:4173/?seed=8&autoplay' + (process.argv[2] || ''));
await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
for (let i = 0; i < 30; i++) { const s = await page.evaluate(() => window.__faceoff.snap()); if (s.mode === 'match' && s.phase === 'play') break; await page.keyboard.press('Enter'); await page.keyboard.press('KeyJ'); await page.waitForTimeout(250); }
const rows = await page.evaluate(async () => {
  const f = window.__faceoff, out = [];
  for (let n = 0; n < 160; n++) {
    await new Promise(r => setTimeout(r, 50));
    const s = f.snap(), g = f.gait(), a = f.anims(), sk = f.skaters();
    s.skaters.forEach((k, i) => {
      if (!k.ok && k.stun <= 0) return;
      const sp = f.stickPose(i); if (!sp) return;
      const clip = a[i]?.clip, st = k.stun > 0 ? 'down' : ['wrist_shot', 'slapshot', 'check'].includes(clip) ? clip : f.puckOwner?.() === i ? (sk[i].bh > 0.5 ? 'backhand' : 'puck') : g[i]?.mode;
      out.push({ st, ...sp, efL: sp.elbowFwd?.[0], efR: sp.elbowFwd?.[1], wrL: sp.wristDev?.[0], wrR: sp.wristDev?.[1], euL: sp.elbowUp?.[0], euR: sp.elbowUp?.[1], hp: sp.headPitch, huL: sp.handUp?.[0], huR: sp.handUp?.[1], hh: sp.handHead, bm: sp.botMiss, tl: sp.handLat?.[0], bl: sp.handLat?.[1], hand: sk[i].hand, kb: sp.knobBody, hy: sp.headYaw, hr: Math.abs(sp.headRoll), knee: g[i]?.knee, lean: g[i]?.lean, hip: g[i]?.hip, twist: g[i]?.twist, chest: Math.abs(g[i]?.chestOff ?? NaN), hips: Math.abs(g[i]?.hipsOff ?? NaN), stickless: k.stickless > 0 });
    });
  }
  // knocked down and getting up (big hits on two opponents), and the faceoff stance after a goal-free reset
  const s0 = f.snap(); s0.skaters.forEach((k, i) => { if (k.team === 1 && k.ok && i % 2) f.knock(i, 14, 1, 0); });
  for (let n = 0; n < 60; n++) {
    await new Promise(r => setTimeout(r, 50));
    const s = f.snap(), a = f.anims(), rag = f.rag();
    s.skaters.forEach((k, i) => { if (k.stun <= 0 && !rag.some(r => r.i === i)) return;
      const sp = f.stickPose(i); out.push({ st: a[i]?.clip === 'fall' && k.stun < 0.75 ? 'getup' : 'down', ...(sp ?? {}), finite: !!sp && Object.values(sp).every(Number.isFinite), stickless: k.stickless > 0 }); });
  }
  return out;
});
const downs = rows.filter(r => r.st === 'down' || r.st === 'getup');
if (downs.length) {
  const bad = downs.filter(r => !r.stickless && r.finite === false).length;
  console.log(`${bad ? 'FAIL' : 'pass'}  knocked down / getting up: ${downs.length} samples, ${downs.filter(r => r.stickless).length} with the stick dropped, ${bad} non-finite`);
  if (bad) process.exitCode = 1;
}
const q = (a, p) => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(b.length * p))] : NaN; };
let fails = 0;
console.log('state     n    shaft p10/med/p90   bladeY p90   fwd med  lat med   top med/p90 toSim p90   knee med  lean med  hip med');
for (const st of [...new Set(rows.map(r => r.st))].sort()) {
  const R = rows.filter(r => r.st === st && !r.stickless); if (R.length < 5) continue;
  const c = k => R.map(r => r[k]);
  const line = `${String(st).padEnd(9)} ${String(R.length).padStart(4)}   ${q(c('shaft'), 0.1)}/${q(c('shaft'), 0.5)}/${q(c('shaft'), 0.9)}`.padEnd(38) +
    `${q(c('bladeY'), 0.9).toFixed(2)}`.padEnd(13) + `${q(c('fwd'), 0.5).toFixed(2)}`.padEnd(9) + `${q(c('lat'), 0.5).toFixed(2)}`.padEnd(10) +
    `${q(c('topHand'), 0.5).toFixed(2)}/${q(c('topHand'), 0.9).toFixed(2)}`.padEnd(11) + `${q(c('toSim'), 0.9).toFixed(2)}`.padEnd(12) +
    `${q(R.flatMap(r => r.knee ?? []), 0.5)}`.padEnd(10) + `${q(c('lean'), 0.5)}`.padEnd(10) + `${q(c('hip'), 0.5)}`.padEnd(8) + `elbowFwd L ${q(c('efL'), 0.1)}/${q(c('efL'), 0.5)} R ${q(c('efR'), 0.1)}/${q(c('efR'), 0.5)}  wrist L ${q(c('wrL'), 0.5)}/${q(c('wrL'), 0.9)} R ${q(c('wrR'), 0.5)}/${q(c('wrR'), 0.9)}  head pitch ${q(c('hp'), 0.1)}/${q(c('hp'), 0.5)}/${q(c('hp'), 0.9)} roll p90 ${q(c('hr'), 0.9)}  elbowUp max L ${Math.max(...c('euL').filter(Number.isFinite))} R ${Math.max(...c('euR').filter(Number.isFinite))}  ` + `flipL ${(R.filter(r => r.elbowFlip?.[0]).length / R.length * 100).toFixed(0)}% flipR ${(R.filter(r => r.elbowFlip?.[1]).length / R.length * 100).toFixed(0)}%  ` + `twist ${q(c('twist'), 0.5)}/${q(c('twist'), 0.9)}  chest ${q(c('chest'), 0.5)}/${q(c('chest'), 0.9)}  hips ${q(c('hips'), 0.5)}/${q(c('hips'), 0.9)}`;
  console.log(line);
  console.log(`          hands above shoulder p90 L ${q(c('huL'), 0.9)} R ${q(c('huR'), 0.9)}  hand-head min ${Math.min(...c('hh').filter(Number.isFinite))} p10 ${q(c('hh'), 0.1)}  knob-spine p10 ${q(c('kb'), 0.1)}  head yaw p90 ${q(c('hy'), 0.9)}  bottom-hand miss med ${q(c('bm'), 0.5)} p90 ${q(c('bm'), 0.9)}  lat top/bottom R-shots ${q(R.filter(r => r.hand > 0).map(r => r.tl), 0.5)}/${q(R.filter(r => r.hand > 0).map(r => r.bl), 0.5)} L-shots ${q(R.filter(r => r.hand < 0).map(r => r.tl), 0.5)}/${q(R.filter(r => r.hand < 0).map(r => r.bl), 0.5)}`);
  // skating states: the stick is held (top hand on it), angled like a stick not a cane, blade near the ice
  if (['stride', 'glide', 'cross', 'back', 'ready', 'puck', 'backhand', 'stop'].includes(st)) {
    // top hand: the knuckles sit about 0.1 off the shaft line in a closed fist; a glove is about 0.15 across
    // the cane this probe was written for measured a median shaft of 29-32 deg; a held stick runs 40-60
    const bad = q(c('shaft'), 0.5) < 36 || q(c('shaft'), 0.1) < 25 || q(c('topHand'), 0.5) > 0.15 || q(c('topHand'), 0.9) > 0.3 || q(c('bladeY'), 0.9) > (st === 'stop' ? 0.45 : 0.35);   // a hard stop lifts the blade a little, as players do
    if (bad) { console.log(`FAIL  ${st}: cane-like or loose stick`); fails++; }
    // the body doesn't screw into itself: shoulders within about 30 degrees of the hips (crossovers turn into the turn)
    if (R.some(r => r.elbowFlip?.[0] || r.elbowFlip?.[1])) { console.log(`FAIL  ${st}: an elbow bends against its natural hinge (chicken wing)`); fails++; }
    // anatomy, not the clip (the clips themselves hike the elbows): elbows below the shoulders, not swung far back,
    // wrists within 30 deg of straight (bind pose); a leaning skater's top-hand upper arm runs along his side (about -0.7)
    if (Math.max(...c('euL'), ...c('euR')) > -0.02) { console.log(`FAIL  ${st}: an elbow at or above shoulder height (max ${Math.max(...c('euL'), ...c('euR'))})`); fails++; }
    if (q(c('efL'), 0.1) < -0.85 || q(c('efR'), 0.1) < -0.85) { console.log(`FAIL  ${st}: an elbow swung back behind the body`); fails++; }
    // head: eyes on the ice a few metres ahead (about 10-35 deg below level), not rolled onto a shoulder
    if (q(c('hp'), 0.1) < 5 || q(c('hp'), 0.9) > 45 || q(c('hr'), 0.9) > 10) { console.log(`FAIL  ${st}: head not looking at the ice ahead, or rolled`); fails++; }
    if (q(c('kb'), 0.1) < 0.4) { console.log(`FAIL  ${st}: the knob comes into the torso (p10 ${q(c('kb'), 0.1)} from the spine line)`); fails++; }
    if (Math.max(...c('wrL'), ...c('wrR')) > 30) { console.log(`FAIL  ${st}: a wrist bent more than 30 deg`); fails++; }
    if (q(c('twist'), 0.9) > 32) { console.log(`FAIL  ${st}: shoulders twisted off the hips (p90 ${q(c('twist'), 0.9)} deg)`); fails++; }
  }
}
console.log('errors', errs.length, errs.slice(0, 2));
await browser.close(); try { process.kill(-server.pid); } catch { /* already gone */ }
console.log(fails ? `${fails} FAILED` : 'all pass');
process.exit(fails ? 1 : 0);
