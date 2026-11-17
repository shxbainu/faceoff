// Headless sim probe: bot-vs-bot matches without graphics, measuring how play flows.
// Usage: node tests/sim_probe.mjs [path/to/sim.ts] [--matches 6]
// Reports: opponent body contact (share of time, longest single contact), how long defenders ride
// the carrier from behind, possession changes, passes, shots and goals per match.
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const src = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'src/sim.ts';
const mi = process.argv.indexOf('--matches'); const MATCHES = mi > 0 ? Number(process.argv[mi + 1]) : 6;
const ci = process.argv.indexOf('--contact'); const CONTACT = ci > 0 ? Number(process.argv[ci + 1]) : 1.05;   // body contact distance of the version under test
const out = mkdtempSync(tmpdir() + '/simprobe-') + '/sim.mjs';
await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const S = await import(pathToFileURL(out).href);
const noInput = { mx: 0, my: 0, pass: false, shoot: false, check: false, burst: false };
const tot = { crowd: 0, mateGap: 0, poss: 0, sT: 0, catches: 0, saveEv: 0, t: 0, contact: 0, longest: 0, ride: 0, rideLongest: 0, swaps: 0, passes: 0, shots: 0, goals: 0, hits: 0 };
for (let m = 0; m < MATCHES; m++) {
  const powers = Object.fromEntries(S.POWERS.map(p => [p.id, 0]));
  const g = new S.Game(1 + (m % 4), S.OPPONENTS[m % S.OPPONENTS.length], powers, 1234 + m * 97);
  g.autoplay = true;
  const pairT = new Map(), rideT = new Map(); let owner = null;
  const dt = 1 / 120;
  for (let k = 0; k < 120 * 200 && g.phase !== 'over'; k++) {
    g.step(dt, noInput);
    for (const e of g.events) { if (e.t === 'catch') tot.catches++; if (e.t === 'save') tot.saveEv++; if (e.t === 'spin') tot.spins = (tot.spins || 0) + 1; if (e.t === 'deke') tot.dekes = (tot.dekes || 0) + 1; }
    g.events.length = 0;
    if (g.phase !== 'play') continue;
    tot.t += dt;
    {   // spacing: skaters within 6 of the puck, and each skater's distance to his nearest teammate
      const pk = g.pucks[0]; let crowd = 0, gap = 0, n = 0;
      for (const a of g.skaters) { if (!g.active(a)) continue; if (Math.hypot(a.x - pk.x, a.y - pk.y) < 6) crowd++;
        let m = 99; for (const b of g.skaters) if (b !== a && b.team === a.team && g.active(b)) m = Math.min(m, Math.hypot(a.x - b.x, a.y - b.y)); if (m < 99) { gap += m; n++; } }
      tot.crowd += crowd * dt; tot.mateGap += (n ? gap / n : 0) * dt;
    }
    const sk = g.skaters, car = g.pucks[0].owner;
    if (car !== owner && car) { if (!owner || owner.team !== car.team) { tot.poss++; if (owner) tot.swaps++; } owner = car; }
    let any = false;
    for (let i = 0; i < sk.length; i++) for (let j = i + 1; j < sk.length; j++) {
      const a = sk[i], b = sk[j]; if (a.team === b.team || a.out > 0 || b.out > 0) continue;
      const key = i * 100 + j;
      if (Math.hypot(a.x - b.x, a.y - b.y) < CONTACT) { any = true; const v = (pairT.get(key) || 0) + dt; pairT.set(key, v); tot.longest = Math.max(tot.longest, v); }
      else pairT.set(key, 0);
    }
    if (any) tot.contact += dt;
    if (car) for (const d of sk) {
      if (d.team === car.team || d.out > 0) continue;
      const net = car.team === 0 ? -S.L : S.L;           // defender's own net is the one the carrier attacks
      const gx = (car.team === 0 ? S.L : -S.L) - car.x, gy = -car.y;
      const behind = (d.x - car.x) * gx + (d.y - car.y) * gy < 0;
      const close = Math.hypot(d.x - car.x, d.y - car.y) < 1.8;
      const v = behind && close ? (rideT.get(d.id) || 0) + dt : 0;
      rideT.set(d.id, v); if (v > 0) tot.ride += dt; tot.rideLongest = Math.max(tot.rideLongest, v);
      void net;
    }
  }
  tot.passes += g.stats.passes[0] + g.stats.passes[1]; tot.shots += g.stats.shots[0] + g.stats.shots[1];
  tot.goals += g.score[0] + g.score[1]; tot.hits += g.stats.hits[0] + g.stats.hits[1];
}
const per = v => +(v / MATCHES).toFixed(1);
console.log(JSON.stringify({
  src, matches: MATCHES, playSec: per(tot.t),
  contactShare: +(tot.contact / tot.t * 100).toFixed(1) + '%', longestContactSec: +tot.longest.toFixed(2),
  rideShare: +(tot.ride / tot.t * 100).toFixed(1) + '%', longestRideSec: +tot.rideLongest.toFixed(2),
  turnoversPerMatch: per(tot.swaps), passes: per(tot.passes), shots: per(tot.shots), goals: per(tot.goals), hits: per(tot.hits), goalieSaves: per(tot.saveEv), catches: per(tot.catches), spins: per(tot.spins || 0), crowdNearPuck: +(tot.crowd / tot.t).toFixed(2), nearestMateDist: +(tot.mateGap / tot.t).toFixed(2), shotsPerPossession: +(tot.shots / Math.max(1, tot.poss)).toFixed(2), spinsPast: per(tot.dekes || 0),
}));
