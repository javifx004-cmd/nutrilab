// Regenera marketing/NutriLab-dossier.pdf a partir de index.html (necesita Playwright y Pillow).
// Cada página se guarda como imagen nítida: así se ve igual en todos los visores, también en el iPhone.
//   node marketing/dossier/generar-pdf.mjs
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const out = here + '../NutriLab-dossier.pdf';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2.6 });
await p.goto('file://' + here + 'index.html'); await p.evaluate(() => document.fonts.ready);
const files = [];
for (let i = 0; i < await p.locator('.page').count(); i++) { const f = `${out}.p${i + 1}.png`; await p.locator('.page').nth(i).screenshot({ path: f }); files.push(f); }
await b.close();
execFileSync('python3', ['-c', `
import sys
from PIL import Image
out, fs = sys.argv[1], sys.argv[2:]
ims = [Image.open(f).convert('RGB') for f in fs]
ims[0].save(out, save_all=True, append_images=ims[1:], resolution=ims[0].width / (210 / 25.4), quality=88, optimize=True)
`, out, ...files]);
for (const f of files) execFileSync('rm', [f]);
