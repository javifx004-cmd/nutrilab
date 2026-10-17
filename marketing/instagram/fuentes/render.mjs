// node render.mjs archivo.html salida.png ancho alto [selector]
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const [, , file, out, w, h] = process.argv;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
await p.goto('file://' + process.cwd() + '/' + file); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(200);
await p.screenshot({ path: out });
await b.close();
