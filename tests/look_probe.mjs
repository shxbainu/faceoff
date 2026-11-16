// Look probe: the same opening faceoff (fixed seed) captured at 2x for each look variant, so rendering
// changes can be compared like for like. Usage: node tests/look_probe.mjs [variant ...]
// Variants are URL switches, e.g. "" (normal), "nohull", "noink". Saves tests/out/look-<variant>.png
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
const variants = process.argv.slice(2).length ? process.argv.slice(2) : ['normal', 'nohull', 'noink'];
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe' });
await new Promise(r => { server.stdout.on('data', d => String(d).includes('4173') && r()); setTimeout(r, 4000); });
const browser = await chromium.launch({ headless: true, channel: 'chromium',
  args: ['--enable-gpu', '--use-angle=metal', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
for (const v of variants) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await page.goto(`http://localhost:4173/?seed=5${v === 'normal' ? '' : '&' + v}`);
  await page.waitForFunction(() => window.__faceoff);
  await page.evaluate(() => window.__faceoff.assetsReady());
  for (let i = 0; i < 30; i++) {
    const s = await page.evaluate(() => window.__faceoff.snap());
    if (s.mode === 'match' && s.phase === 'faceoff') break;
    await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `tests/out/look-${v.replace(/[^a-z0-9_.-]+/gi, "_")}.png` });
  await page.close();
}
await browser.close(); server.kill();
console.log("saved", variants.map(v => `tests/out/look-${v.replace(/[^a-z0-9_.-]+/gi, "_")}.png`).join(" "));
