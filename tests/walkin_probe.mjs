// Walk-in probe: the human skater does nothing clever. Whenever it has the puck it skates straight at the
// opponent net and never passes, shoots or dekes. Measures whether the defence actually stops that.
// Usage: node tests/walkin_probe.mjs [path/to/sim.ts] [--matches 6]
//   carries          times the human picked up the puck
//   reachedSlotPct   share of carries that got within 9 of the net with the puck still on the stick
//   avgCarrySec      how long a carry lasted before losing it (or reaching the slot)
//   lostTo           how carries ended: poke, hit, other (picked off, loose)
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
const src = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'src/sim.ts';
const mi = process.argv.indexOf('--matches'); const MATCHES = mi > 0 ? Number(process.argv[mi + 1]) : 6;
const out = mkdtempSync(tmpdir() + '/walkin-') + '/sim.mjs';
await build({ entryPoints: [src], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const S = await import(pathToFileURL(out).href);
const T = { carries: 0, slot: 0, carryT: 0, poke: 0, hit: 0, other: 0 };
for (let m = 0; m < MATCHES; m++) {
  const powers = Object.fromEntries(S.POWERS.map(p => [p.id, 0]));
  const g = new S.Game(1 + (m % 4), S.OPPONENTS[m % S.OPPONENTS.length], powers, 777 + m * 53);
  const dt = 1 / 120; let carrying = false, t0 = 0, time = 0, ended = false;
  for (let k = 0; k < 120 * 200 && g.phase !== 'over'; k++) {
    const h = g.ctrl, p = g.pucks[0], has = p.owner === h;
    let c = { mx: 0, my: 0, pass: false, shoot: false, check: false, burst: false };
    if (has) { const dx = S.GL - h.x, dy = -h.y, d = Math.hypot(dx, dy) || 1; c.mx = dx / d; c.my = dy / d; }
    else if (g.phase === 'play') { const dx = p.x - h.x, dy = p.y - h.y, d = Math.hypot(dx, dy) || 1; c.mx = dx / d; c.my = dy / d; }   // chase the puck
    if (g.phase === 'faceoff' && g.foLive) c.pass = (k % 20) < 2;
    g.step(dt, c);
    let why = null;
    for (const e of g.events) { if (e.t === 'poke') why = why ?? 'poke'; if (e.t === 'hit') why = why ?? 'hit'; }
    g.events.length = 0;
    time += dt;
    const nowHas = g.pucks[0].owner === g.ctrl;
    if (nowHas && !carrying) { carrying = true; t0 = time; ended = false; T.carries++; }
    if (carrying && !ended && nowHas && Math.hypot(S.GL - g.ctrl.x, g.ctrl.y) < 9) { T.slot++; ended = true; T.carryT += time - t0; }
    if (carrying && !nowHas) {
      if (!ended) { T.carryT += time - t0; T[why ?? 'other']++; }
      carrying = false;
    }
  }
}
console.log(JSON.stringify({ src, matches: MATCHES, carries: T.carries, reachedSlotPct: Math.round(100 * T.slot / T.carries) + '%',
  avgCarrySec: +(T.carryT / T.carries).toFixed(2), lostTo: { poke: T.poke, hit: T.hit, other: T.other } }));
