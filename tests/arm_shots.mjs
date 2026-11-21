// Six fixed-camera close-ups of skaters' arms, stick and head at the game camera's angle (CAM_EL), for review by
// eye: sprinting, tight turn (crossovers), backward skating, carrying the puck on the backhand, mid-shot, a stretched
// reach (blade far out in front), and the playtest screenshot's pose (skating away up the boards beside another player).
// Left- and right-shot skaters are mixed. The match is frozen on the frame that matched, then shot.
// Usage: node tests/arm_shots.mjs [outdir=verify] [extra query, e.g. &noik]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const dir = process.argv[2] || 'verify'; mkdirSync(dir, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4173') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://localhost:4173/?seed=8&autoplay' + (process.argv[3] || ''));
await page.waitForFunction(() => window.__faceoff); await page.evaluate(() => window.__faceoff.assetsReady());
for (let i = 0; i < 30; i++) { const s = await page.evaluate(() => window.__faceoff.snap()); if (s.mode === 'match' && s.phase === 'play') break; await page.keyboard.press('Enter'); await page.keyboard.press('KeyJ'); await page.waitForTimeout(250); }
await page.addStyleTag({ content: 'body > *:not(canvas) { display: none !important; }' });   // no HUD in the shots
// [name, preferred hand (1 right, -1 left), test]
const shots = [['1_sprint', 1], ['2_reach', -1], ['3_tight_turn', 1], ['4_backward', -1], ['5_backhand_carry', 1], ['6_mid_shot', -1], ['7_screenshot', -1]];
const got = [];
for (const [name, hand] of shots) {
  let hit = null;
  for (let n = 0; n < 3000 && !hit; n++) {
    hit = await page.evaluate(([name, hand, late]) => {
      const f = window.__faceoff, k = f.skaters(), g = f.gait(), a = f.anims(), own = f.puckOwner(), s = f.snap();
      if (s.phase !== 'play') return null;
      for (let i = 0; i < k.length; i++) {
        const c = k[i], sp = Math.hypot(c.vx, c.vy), m = g[i]?.mode, clip = a[i]?.clip;
        if (c.stun > 0 || (!late && c.hand !== hand)) continue;
        if (!late && !['1_sprint', '7_screenshot'].includes(name) && Math.cos(c.face) > -0.2) continue;
        if (!late && name !== '7_screenshot' && k.some((o, j) => j !== i && Math.hypot(o.x - c.x, o.y - c.y) < 2.5)) continue;   // nobody close enough to block the view   // facing the camera (arms in view), except the sprint, shot from behind as in play
        const ok = name === '1_sprint' ? m === 'stride' && sp > 7.5 && own !== i
          : name === '2_reach' ? (f.stickPose(i)?.fwd ?? 0) > (late ? 1.3 : 1.5) && m !== 'off'
          : name === '7_screenshot' ? m === 'stride' && sp > 5 && Math.cos(c.face) > 0.3 && k.some((o, j) => j !== i && o.team !== c.team && Math.hypot(o.x - c.x, o.y - c.y) < 1.8)
          : name === '3_tight_turn' ? m === 'cross'
          : name === '4_backward' ? m === 'back' && sp > 2
          : name === '5_backhand_carry' ? own === i && c.bh > 0.7
          : ['wrist_shot', 'slapshot'].includes(clip) && a[i].t > 0.12 && f.stickPose(i)?.bladeY < (late ? 0.35 : 0.2);   // blade on the ice: at the puck, not the follow-through
        if (ok) { f.freeze(true); f.closeCam(i, 5.5); return { i, hand: c.hand, speed: +sp.toFixed(1), mode: m, clip, bh: +c.bh.toFixed(2) }; }
      }
      return null;
    }, [name, hand, n > 900]);
    if (!hit) await page.waitForTimeout(25);
  }
  if (!hit) { console.log(`MISS  ${name}`); continue; }
  await page.waitForTimeout(250);   // a few frozen frames: the camera and the layers settle
  const file = `${dir}/${name}.png`;
  await page.screenshot({ path: file, clip: { x: 340, y: 40, width: 600, height: 640 } });
  console.log(`${file}  skater ${hit.i} ${hit.hand > 0 ? 'right' : 'left'} shot, ${JSON.stringify(hit)}`);
  if (process.env.SIDE) { await page.evaluate(([i]) => window.__faceoff.closeCam(i, 5.5, Math.PI / 2), [hit.i]); await page.waitForTimeout(200); await page.screenshot({ path: `${dir}/${name}_side.png`, clip: { x: 340, y: 40, width: 600, height: 640 } }); }   // SIDE=1: a second angle, for checking only
  got.push({ name, ...hit, pose: await page.evaluate(i => window.__faceoff.stickPose(i), hit.i) });
  await page.evaluate(() => { window.__faceoff.closeCam(-1); window.__faceoff.freeze(false); });
}
console.log('errors', errs.length, errs.slice(0, 2));
await browser.close(); try { process.kill(-server.pid); } catch { /* already gone */ }
