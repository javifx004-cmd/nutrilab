// node shoot.mjs [filtro]  → captura cada <section> de feed.html como JPG en out/<mes>/...
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const outDir = process.argv[3] || 'out/png';
fs.mkdirSync(outDir, { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 2000 }, deviceScaleFactor: 1 });
p.on('pageerror', (e) => console.log('ERROR', e.message));
await p.goto('file://' + process.cwd() + '/feed.html'); await p.evaluate(() => document.fonts.ready);
const ids = (await p.$$eval('section', (l) => l.map((x) => x.id))).filter((id) => !filter || filter.test(id));
for (const id of ids) {
  const el = p.locator('#' + id); await el.scrollIntoViewIfNeeded();
  await p.evaluate((id) => Promise.all([...document.getElementById(id).querySelectorAll('img')].map((i) => i.decode().catch(() => {}))), id);
  await el.screenshot({ path: `${outDir}/${id}.jpg`, type: 'jpeg', quality: 92 });
}
console.log(ids.length, 'imágenes'); await b.close();
