// Determinism guard for the feedback layer: runs seeded bot-vs-bot matches headless and prints a fingerprint
// of every step's state (positions, velocities, score, phase). The feedback system must never change it:
// gameplay only emits events, so adding or removing feedback events leaves this hash identical.
// Usage: node tests/fx_determinism.mjs [path/to/sim.ts] [--matches 4]   (compare against a baseline run)
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
const src = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'src/sim.ts';
const mi = process.argv.indexOf('--matches'); const MATCHES = mi > 0 ? Number(process.argv[mi + 1]) : 4;
const out = mkdtempSync(tmpdir() + '/fxdet-') + '/sim.mjs';
await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const S = await import(pathToFileURL(out).href);
const noInput = { mx: 0, my: 0, pass: false, shoot: false, check: false, burst: false };
const h = createHash('sha256');
const evCount = {};
const r6 = v => Math.round(v * 1e6);
for (let m = 0; m < MATCHES; m++) {
  const powers = Object.fromEntries(S.POWERS.map(p => [p.id, 0]));
  if (m % 2) { powers.split = 1; powers.shock = 1; powers.curve = 1; }
  const g = new S.Game(1 + (m % 4), S.OPPONENTS[m % S.OPPONENTS.length], powers, 777 + m * 131);
  g.autoplay = true;
  for (let k = 0; k < 120 * 200 && g.phase !== 'over'; k++) {
    g.step(1 / 120, noInput);
    for (const e of g.events) evCount[e.t] = (evCount[e.t] || 0) + 1;
    g.events.length = 0;
    const st = [g.phase, g.score[0], g.score[1], r6(g.heat), r6(g.style)];
    for (const s of g.skaters) st.push(r6(s.x), r6(s.y), r6(s.vx), r6(s.vy), r6(s.stun));
    for (const p of g.pucks) st.push(r6(p.x), r6(p.y), r6(p.vx), r6(p.vy));
    h.update(st.join(','));
  }
  console.log(`match ${m}: ${g.score.join('-')} phase ${g.phase} t ${g.time.toFixed(2)}`);
}
console.log('fingerprint', h.digest('hex').slice(0, 16));
console.log('events', JSON.stringify(Object.fromEntries(Object.entries(evCount).sort())));
