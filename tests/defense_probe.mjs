// Headless defence probe: bot-vs-bot matches, watching the defender nearest the puck carrier.
// Usage: node tests/defense_probe.mjs [path/to/sim.ts] [--matches 6]
// Reports:
//   faceOffDeg      how far the nearest defender (within 5) faces away from the carrier, on average (0 = square to him)
//   faceAwayShare   share of that time he faces more than 90 degrees away (his back to the carrier)
//   reversalsPerMin the pressing defender flipping direction (velocity turns > 120 deg within 0.4 s at speed): the up-down yo-yo
//   challengedShare share of carry time with a defender goal-side within 2.5 (someone actually on him)
//   freeRunShare    share of carry time inside the attacking half with nobody goal-side within 4 (walking in)
//   pokes, takeaways, hits per match
//   hipAngleDeg     pressing defender's facing vs the line to the carrier (angle control: ~30-40, not 0 = chest to chest)
//   insideShare     share of zone time the pressing defender is on the carrier's inside (closer to the middle of the ice)
//   carrierWideShare share of zone carry time the carrier is pushed wide (|y| > 0.45 W) toward the boards
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const src = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'src/sim.ts';
const mi = process.argv.indexOf('--matches'); const MATCHES = mi > 0 ? Number(process.argv[mi + 1]) : 6;
const out = mkdtempSync(tmpdir() + '/defprobe-') + '/sim.mjs';
await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const S = await import(pathToFileURL(out).href);
const noInput = { mx: 0, my: 0, pass: false, shoot: false, check: false, burst: false };
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const T = { zone: 0, inside: 0, wide: 0, hipN: 0, hip: 0, carry: 0, near: 0, faceOff: 0, faceAway: 0, challenged: 0, free: 0, half: 0, rev: 0, play: 0, pokes: 0, takeaways: 0, hits: 0, backward: 0 };
for (let m = 0; m < MATCHES; m++) {
  const powers = Object.fromEntries(S.POWERS.map(p => [p.id, 0]));
  const g = new S.Game(1 + (m % 4), S.OPPONENTS[m % S.OPPONENTS.length], powers, 4321 + m * 89);
  g.autoplay = true;
  const dt = 1 / 120, hist = new Map(); let lastOwner = null, lastSwap = -9; const carHist = [];
  for (let k = 0; k < 120 * 200 && g.phase !== 'over'; k++) {
    g.step(dt, noInput);
    for (const e of g.events) { if (e.t === 'poke') T.pokes++; if (e.t === 'pokeTry') T.pokeTries = (T.pokeTries || 0) + 1; if (e.t === 'hit') T.hits++; }
    g.events.length = 0;
    if (g.phase !== 'play') continue;
    T.play += dt;
    const car = g.pucks[0].owner;
    if (car && lastOwner && car.team !== lastOwner.team) { T.takeaways++; lastSwap = T.play; }
    if (car) lastOwner = car;
    if (!car) continue;
    T.carry += dt;
    const dir = car.team === 0 ? 1 : -1, gx = dir * S.GL;   // net the carrier attacks
    let near = null, nd = 1e9, goalSide = 1e9;
    for (const s of g.skaters) {
      if (s.team === car.team || !g.active(s)) continue;
      const d = Math.hypot(s.x - car.x, s.y - car.y);
      if (d < nd) { nd = d; near = s; }
      const gs = (s.x - car.x) * (gx - car.x) + (s.y - car.y) * (0 - car.y) > 0;   // between the carrier and the net
      if (gs && d < goalSide) goalSide = d;
    }
    if (goalSide < 2.5) T.challenged += dt;
    // in the defending zone: is the presser inside him, is he pushed wide, how are the presser's hips angled
    if (car.x * dir > 0.3 * S.L) {
      T.zone += dt;
      if (Math.abs(car.y) > 0.45 * S.W) T.wide += dt;
      const pr = g.pressing?.[1 - car.team];
      if (pr && g.active(pr) && Math.hypot(pr.x - car.x, pr.y - car.y) < 5) {
        if (Math.abs(pr.y) < Math.abs(car.y)) T.inside += dt;
        if (pr.ai.look) { T.hip += Math.abs(wrap(Math.atan2(car.y - pr.y, car.x - pr.x) - pr.face)) * dt; T.hipN += dt; }
      }
    }
    if (car.x * dir > 0) { T.half += dt; if (goalSide > 4) T.free += dt; }
    if (near && nd < 5) {
      T.near += dt;
      const off = Math.abs(wrap(Math.atan2(car.y - near.y, car.x - near.x) - near.face));
      T.faceOff += off * dt; if (off > Math.PI / 2) T.faceAway += dt;
      const sp = Math.hypot(near.vx, near.vy);
      if (sp > 1 && (near.vx * Math.cos(near.face) + near.vy * Math.sin(near.face)) / sp < -0.3) T.backward += dt;
    }
    // yo-yo: the nearest defender's velocity now vs 0.4 s ago
    carHist.push([car.vx, car.vy]); if (carHist.length > 48) carHist.shift();
    if (near) {
      const h = hist.get(near.id) ?? []; h.push([T.play, near.vx, near.vy]); while (h.length && T.play - h[0][0] > 0.4) h.shift(); hist.set(near.id, h);
      const [t0, vx0, vy0] = h[0], s0 = Math.hypot(vx0, vy0), s1 = Math.hypot(near.vx, near.vy);
      if (T.play - lastSwap > 1.2 && T.play - t0 > 0.35 && s0 > 2.5 && s1 > 2.5 && (vx0 * near.vx + vy0 * near.vy) / (s0 * s1) < -0.5) { T.rev++; hist.set(near.id, []);
        const role = g.pressing?.[near.team] === near ? 'presser' : 'other'; if (process.env.DUMP && (T.dump = (T.dump || 0) + 1) <= 12) { const c = car; const ch = (hist0 => hist0)(carHist); console.error(JSON.stringify({ t: +T.play.toFixed(2), role, def: [+near.x.toFixed(1), +near.y.toFixed(1)], dv0: [+vx0.toFixed(1), +vy0.toFixed(1)], dv1: [+near.vx.toFixed(1), +near.vy.toFixed(1)], car: [+c.x.toFixed(1), +c.y.toFixed(1)], cv0: ch[0] ? ch[0].map(v => +v.toFixed(1)) : null, cv1: [+c.vx.toFixed(1), +c.vy.toFixed(1)], stab: +(near.ai.stab ?? 0).toFixed(2), d: +nd.toFixed(1) })); } const k2 = role + (near.ai.stab > -0.5 ? '+stab' : '') + (near.disengage > 0 ? '+diseng' : '') + (near.checkT > 0 || near.checkCd > 0.3 ? '+check' : ''); (T.why ??= {})[k2] = (T.why[k2] || 0) + 1; }
    }
  }
}
const pct = x => (100 * x).toFixed(1) + '%', per = x => +(x / MATCHES).toFixed(1);
console.log(JSON.stringify({
  src, matches: MATCHES,
  faceOffDeg: Math.round(T.faceOff / T.near * 180 / Math.PI), faceAwayShare: pct(T.faceAway / T.near), backwardShare: pct(T.backward / T.near),
  reversalsPerMin: +(T.rev / (T.play / 60)).toFixed(1),
  challengedShare: pct(T.challenged / T.carry), freeRunShare: pct(T.free / T.half),
  hipAngleDeg: Math.round(T.hip / (T.hipN || 1) * 180 / Math.PI), insideShare: pct(T.inside / T.zone), carrierWideShare: pct(T.wide / T.zone),
  pokeTries: per(T.pokeTries || 0), pokes: per(T.pokes), takeaways: per(T.takeaways), hits: per(T.hits), why: T.why,
}));
