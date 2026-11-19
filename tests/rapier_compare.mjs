// PHYSICS_PLAN.md: the hand-written physics against the Rapier version over seeded bot matches, in Node.
// Reports what a player would feel (goals, shots, saves, board and post hits, puck speed off the boards) and checks
// the Rapier run is deterministic (two runs, same fingerprint) and the puck never leaves the rink.
// Usage: node tests/rapier_compare.mjs [--matches 8]
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
const mi = process.argv.indexOf('--matches'); const MATCHES = mi > 0 ? Number(process.argv[mi + 1]) : 8;
const out = mkdtempSync(tmpdir() + '/rapcmp-') + '/sim.mjs';
await build({ entryPoints: ['tests/rapier_entry.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const S = await import(pathToFileURL(out).href);
await S.initPhysics();
const noInput = { mx: 0, my: 0, pass: false, shoot: false, check: false, burst: false };
const r6 = v => Math.round(v * 1e6);
function run(rapier) {
  S.PHYS.rapier = rapier;
  const h = createHash('sha256'), t = { goals: 0, shots: 0, saves: 0, board: 0, post: 0, escapes: 0, boardSpeed: 0, steps: 0 };
  for (let m = 0; m < MATCHES; m++) {
    const powers = Object.fromEntries(S.POWERS.map(p => [p.id, 0]));
    if (m % 2) { powers.split = 1; powers.shock = 1; powers.curve = 1; }
    const g = new S.Game(1 + (m % 4), S.OPPONENTS[m % S.OPPONENTS.length], powers, 777 + m * 131);
    g.autoplay = true;
    for (let k = 0; k < 120 * 200 && g.phase !== 'over'; k++) {
      g.step(1 / 120, noInput); t.steps++;
      for (const e of g.events) {
        if (e.t === 'goal') t.goals++; else if (e.t === 'shot') t.shots++; else if (e.t === 'save') t.saves++;
        else if (e.t === 'post') t.post++; else if (e.t === 'board') { t.board++; t.boardSpeed += e.n ?? 0; }
      }
      g.events.length = 0;
      const st = [g.phase, g.score[0], g.score[1]];
      for (const p of g.pucks) { st.push(r6(p.x), r6(p.y), r6(p.vx), r6(p.vy)); if (g.phase === 'play' && p.alive && (Math.abs(p.x) > S.L + 0.05 || Math.abs(p.y) > S.W + 0.05 || !Number.isFinite(p.x))) { t.escapes++; t.esc ??= `match ${m} ${p.kind} owner ${!!p.owner} at ${p.x.toFixed(2)},${p.y.toFixed(2)} v ${p.vx.toFixed(1)},${p.vy.toFixed(1)}`; } }
      for (const s of g.skaters) st.push(r6(s.x), r6(s.y));
      h.update(st.join(','));
    }
  }
  t.boardSpeed = +(t.boardSpeed / Math.max(1, t.board)).toFixed(1);
  return { fp: h.digest('hex').slice(0, 16), ...t };
}
const old = run(false), rap = run(true), rap2 = run(true);
const row = (n, r) => console.log(n.padEnd(8), Object.entries(r).map(([k, v]) => `${k} ${v}`).join('  '));
row('old', old); row('rapier', rap);
let fail = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) fail++; };
ok(rap.fp === rap2.fp, `Rapier is deterministic (${rap.fp} twice)`);
ok(rap.escapes === 0, `the puck never leaves the rink with Rapier (${rap.escapes} steps outside; old ${old.escapes})`);
// same feel: per-match rates within 25% of the old physics (or within 2 events for rare ones)
for (const k of ['goals', 'shots', 'saves', 'board', 'post', 'boardSpeed']) {
  const a = old[k], b = rap[k], close = Math.abs(a - b) <= Math.max(2, 0.25 * a);
  ok(close, `${k}: old ${a}, Rapier ${b}`);
}
process.exit(fail ? 1 : 0);
