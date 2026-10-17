// Captura cada <section class="post"> de un HTML como PNG en out/
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const file = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 1400 }, deviceScaleFactor: 1 });
await p.goto('file://' + process.cwd() + '/' + file); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
for (const id of await p.$$eval('section.post', (l) => l.map((x) => x.id))) await p.locator('#' + id).screenshot({ path: `out/${id}.png` });
console.log((await p.$$('section.post')).length, 'imágenes'); await b.close();
