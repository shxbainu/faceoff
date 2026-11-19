// PHYSICS_PLAN.md step 0: the Rapier spike in Node, Chromium, Firefox and WebKit (two fresh pages each). Fingerprints must match.
// Usage: node tests/rapier_spike.mjs
import { chromium, firefox, webkit } from 'playwright';
import { execSync } from 'node:child_process';
execSync('npx esbuild src/physics/spike.ts --bundle --platform=node --format=esm --outfile=tests/out/spike.mjs --log-level=warning');
const node = await (await import('../tests/out/spike.mjs')).run();
console.log('node    ', JSON.stringify(node));
// each engine runs the same browser bundle on a blank page (no game, so no WebGPU needed)
execSync('npx esbuild src/physics/spike.ts --bundle --platform=browser --format=iife --global-name=Spike --outfile=tests/out/spike.iife.js --log-level=warning');
const out = [node];
for (const [name, type] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  const browser = await type.launch({ headless: true });
  for (let k = 0; k < 2; k++) {
    const page = await browser.newPage();
    await page.addScriptTag({ path: 'tests/out/spike.iife.js' });
    const r = await page.evaluate(() => window.Spike.run());
    console.log(`${name} ${k + 1}`.padEnd(10), JSON.stringify(r)); out.push(r);
    await page.close();
  }
  await browser.close();
}
const same = out.every(r => r.fingerprint === node.fingerprint), escaped = out.some(r => r.escaped);
console.log(same ? 'PASS  same fingerprint in Node, Chromium, Firefox and WebKit' : 'FAIL  fingerprints differ');
console.log(escaped ? 'FAIL  the puck left the rink' : 'PASS  the puck stayed in the rink');
process.exit(same && !escaped ? 0 : 1);
