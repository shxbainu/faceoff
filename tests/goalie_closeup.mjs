// Goalie close-ups for checking the gear's look: a camera placed in front of (and beside) a goalie, the goalie held
// in each save pose, under each layer switch (CLAUDE.md: isolate the pass before fixing an artifact).
// Runs against the Vite dev server (it hooks the renderer's camera, which the built bundle does not expose).
// Usage: node tests/goalie_closeup.mjs [modes...]   modes: normal nohull noink hulldbg (default: normal hulldbg)
//        HIDE=g_glove,g_blocker node tests/goalie_closeup.mjs nohull   (hide gear pieces to see the bare hands)
// Saves tests/out/gclose-<mode>-<pose>-<view>.png, and prints per pose (model metres, ice = 0): the blocker and
// glove hand heights against the head, where along the goalie stick the blocker hand holds it (the paddle top is
// about 0.54 of the way from the blade) and the stick's lowest point (below 0 = in the ice).
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const PORT = 5188;
const modes = process.argv.slice(2).length ? process.argv.slice(2) : ['normal', 'hulldbg'];
const poses = ['goalie:0.1', 'g_butterfly:0.4', 'g_glove:0.35', 'g_blocker:0.35', 'g_pad_l:0.35'];
const views = { front: { az: 0, el: 0.5, d: 3.0 }, side: { az: 1.2, el: 0.35, d: 3.0 }, glove: { az: -0.5, el: 0.25, d: 1.3, bone: 'hand_l' } };
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => { server.stdout.on('data', d => String(d).includes(String(PORT)) && r()); setTimeout(r, 6000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
const errors = [], numbers = {};
page.on('pageerror', e => errors.push(String(e)));
for (const mode of modes) for (const pose of poses) {
  const q = new URLSearchParams({ autoplay: '', seed: '9', pose }); if (mode !== 'normal') q.set(mode, '');
  await page.goto(`http://localhost:${PORT}/?${q.toString().replace(/=(&|$)/g, '$1')}`);
  await page.waitForFunction(() => window.__faceoff);
  await page.evaluate(async hide => {
    window.__closeup = { gi: 0, az: 0, el: 0.5, d: 3.0 };
    const mod = await import('/src/render.ts');
    const P = mod.View.prototype, orig = P.frame;
    P.frame = function (g, dt, rdt) {
      if (!this.__hooked) {
        this.__hooked = true; const v = this, R = v.renderer; window.__view = v;
        const place = () => {
          const c = window.__closeup, gl = v.game?.goalies?.[c.gi]; if (!gl) return;
          let x = gl.x, z = gl.y, ty = 0.75; const out = Math.sign(-gl.x);
          if (c.bone) {   // aim at a bone of goalie gi (the glove hand) instead of the goalie's middle
            const b = v.skaters[v.game.skaters.length + c.gi]?.body.getObjectByName(c.bone);
            if (b) { const p = b.getWorldPosition(v.camera.position.clone()); x = p.x; z = p.z; ty = p.y; }
          }
          v.camera.position.set(x + out * Math.cos(c.el) * c.d * Math.cos(c.az), Math.sin(c.el) * c.d + ty + (c.bone ? 0 : 0.15), z + Math.cos(c.el) * c.d * Math.sin(c.az));
          v.camera.lookAt(x, ty, z); v.camera.updateMatrixWorld();
        };
        for (const k of ['render', 'renderAsync']) if (R[k]) { const f = R[k].bind(R); R[k] = (s, cam) => { place(); return f(s, cam); }; }
      }
      return orig.call(this, g, dt, rdt);
    };
    await window.__faceoff.assetsReady();
    for (let i = 0; i < 40 && window.__faceoff.snap().mode !== 'match'; i++) {
      for (const t of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter' }));
      await new Promise(r => setTimeout(r, 300));
    }
    document.getElementById('hud').style.display = 'none';
    await new Promise(r => setTimeout(r, 400));
    if (hide) for (const v of window.__view.skaters) v.body.traverse(o => { if (hide.split(',').some(p => o.name.startsWith(p))) o.visible = false; });
  }, process.env.HIDE || '');
  if (mode === 'normal') numbers[pose] = await page.evaluate(() => {
    // in the goalie's model space: Blender metres, y up, ice at 0
    const V = window.__view, v = V.skaters[V.game.skaters.length];
    let model = null; v.body.traverse(o => { if (!model && o.parent === v.body && o.getObjectByName?.('hand_r')) model = o; });
    model.updateMatrixWorld(true);
    const inv = model.matrixWorld.clone().invert(), V3 = model.position.constructor;
    const at = n => { const p = new V3(); model.getObjectByName(n).getWorldPosition(p); return p.applyMatrix4(inv); };
    const pts = []; const st = model.getObjectByName('g_stick');
    st.traverse(o => { if (!o.isMesh || o.material.side === 1) return; const a = o.geometry.attributes.position; for (let i = 0; i < a.count; i++) pts.push(new V3().fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv)); });
    const low = pts.reduce((a, b) => b.y < a.y ? b : a), knob = pts.reduce((a, b) => b.distanceTo(low) > a.distanceTo(low) ? b : a);
    const hr = at('hand_r'), ax = knob.clone().sub(low);
    const r2 = x => +x.toFixed(2);
    return { blocker: r2(hr.y), glove: r2(at('hand_l').y), head: r2(at('Head').y), gripAlongStick: r2(hr.clone().sub(low).dot(ax) / ax.lengthSq()), stickLow: +low.y.toFixed(3) };
  });
  for (const [name, v] of Object.entries(views)) {
    await page.evaluate(v => Object.assign(window.__closeup, { bone: undefined }, v), v);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `tests/out/gclose-${mode}-${pose.split(':')[0]}-${name}.png` });
  }
}
console.log(JSON.stringify({ modes, numbers, errors }, null, 1));
await browser.close(); try { process.kill(-server.pid); } catch { /* the server already exited */ }
