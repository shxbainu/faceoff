// PHYSICS_PLAN.md: the hand-written physics against the Rapier version over seeded bot matches, in Node.
// Reports what a player would feel (goals, shots, saves, board and post hits, puck speed off the boards) and checks
// the Rapier run is deterministic (two runs, same fingerprint) and the puck never leaves the rink.
// Usage: node tests/rapier_compare.mjs [--matches 8] [--seed 777]
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const MATCHES = arg('--matches', 8), SEED = arg('--seed', 777);
const out = mkdtempSync(tmpdir() + '/rapcmp-') + '/sim.mjs';
await build({ entryPoints: ['tests/rapier_entry.ts'], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const S = await import(pathToFileURL(out).href);
await S.initPhysics();
const noInput = { mx: 0, my: 0, pass: false, shoot: false, check: false, burst: false };
const r6 = v => Math.round(v * 1e6);
function run(rapier) {
  S.PHYS.rapier = rapier;
  const h = createHash('sha256'), t = { goals: 0, shots: 0, saves: 0, board: 0, post: 0, escapes: 0, boardSpeed: 0, passes: 0, recv: 0, hits: 0, hitN: 0, slams: 0, bodyOut: 0, bodyOverlap: 0, bodyDeep: 0, steps: 0 };
  for (let m = 0; m < MATCHES; m++) {
    const powers = Object.fromEntries(S.POWERS.map(p => [p.id, 0]));
    if (m % 2) { powers.split = 1; powers.shock = 1; powers.curve = 1; }
    const g = new S.Game(1 + (m % 4), S.OPPONENTS[m % S.OPPONENTS.length], powers, SEED + m * 131);
    g.autoplay = true;
    for (let k = 0; k < 120 * 200 && g.phase !== 'over'; k++) {
      g.step(1 / 120, noInput); t.steps++;
      for (const e of g.events) {
        if (e.t === 'goal') t.goals++; else if (e.t === 'shot') t.shots++; else if (e.t === 'save') t.saves++;
        else if (e.t === 'post') t.post++; else if (e.t === 'pass') t.passes++; else if (e.t === 'recv') t.recv++; else if (e.t === 'slam') t.slams++; else if (e.t === 'hit' && e.n) { t.hits++; t.hitN += e.n; } else if (e.t === 'board') { t.board++; t.boardSpeed += e.n ?? 0; }
      }
      g.events.length = 0;
      const st = [g.phase, g.score[0], g.score[1]];
      for (const p of g.pucks) { st.push(r6(p.x), r6(p.y), r6(p.vx), r6(p.vy)); if (g.phase === 'play' && p.alive && (Math.abs(p.x) > S.L + 0.05 || Math.abs(p.y) > S.W + 0.05 || !Number.isFinite(p.x))) { t.escapes++; t.esc ??= `match ${m} ${p.kind} owner ${!!p.owner} at ${p.x.toFixed(2)},${p.y.toFixed(2)} v ${p.vx.toFixed(1)},${p.vy.toFixed(1)}`; } }
      for (const s of g.skaters) {
        st.push(r6(s.x), r6(s.y));
        if (g.phase === 'play' && !s.air && !(s.out > 0) && !(s.boxed > 0) && !S.insideRink(s.x, s.y, S.SR - 0.05)) {
          let r = S.SR; while (r > 0 && !S.insideRink(s.x, s.y, r)) r -= 0.01; t.bodyDeep = Math.max(t.bodyDeep, +(S.SR - r).toFixed(2)); t.bodyOut++; t.bout ??= `match ${m} skater ${s.id} at ${s.x.toFixed(2)},${s.y.toFixed(2)}`; }
      }
      // two skaters sunk deep into each other (more than a third of a body): contacts not solved
      if (g.phase === 'play') for (let i = 0; i < g.skaters.length; i++) for (let j = i + 1; j < g.skaters.length; j++) {
        const a = g.skaters[i], b = g.skaters[j];
        if (a.air || b.air || a.out > 0 || b.out > 0 || a.boxed > 0 || b.boxed > 0) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) < S.BODY * 2 * 0.66) t.bodyOverlap++;
      }
      h.update(st.join(','));
    }
  }
  t.boardSpeed = +(t.boardSpeed / Math.max(1, t.board)).toFixed(1);
  t.passPct = Math.round((100 * t.recv) / Math.max(1, t.passes)); t.hitN = +(t.hitN / Math.max(1, t.hits)).toFixed(2);
  return { fp: h.digest('hex').slice(0, 16), ...t };
}
const old = run(false), rap = run(true), rap2 = run(true);
const row = (n, r) => console.log(n.padEnd(8), Object.entries(r).map(([k, v]) => `${k} ${v}`).join('  '));
row('old', old); row('rapier', rap);
let fail = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) fail++; };
ok(rap.fp === rap2.fp, `Rapier is deterministic (${rap.fp} twice)`);
ok(rap.escapes === 0, `the puck never leaves the rink with Rapier (${rap.escapes} steps outside; old ${old.escapes})`);
// Rapier's contacts are soft: a skater can sink a hair into the boards for a step (the old clamp was exact)
ok(rap.bodyDeep <= 0.15, `skaters stay inside the boards with Rapier (deepest ${rap.bodyDeep} into the boards, ${rap.bodyOut} steps past 0.05; old ${old.bodyDeep}) ${rap.bout ?? ''}`);
ok(rap.bodyOverlap <= Math.max(5, old.bodyOverlap * 1.5), `skaters don't sink into each other (deep overlaps: old ${old.bodyOverlap}, Rapier ${rap.bodyOverlap})`);
for (const k of ['goals', 'shots', 'saves', 'board', 'post', 'boardSpeed', 'passPct', 'hits', 'hitN', 'slams']) {
  // counts are noisy (one changed contact changes the whole match after it): allow 25%, or 3 standard deviations
  // of a count (3 sqrt n) for rare events; other seeds (--seed) show posts and hits swing both ways
  const a = old[k], b = rap[k], rate = k === 'boardSpeed' || k === 'passPct' || k === 'hitN';
  const close = Math.abs(a - b) <= Math.max(2, 0.25 * a, rate ? 0 : 3 * Math.sqrt(Math.max(a, b)));
  ok(close, `${k}: old ${a}, Rapier ${b}`);
}
process.exit(fail ? 1 : 0);
