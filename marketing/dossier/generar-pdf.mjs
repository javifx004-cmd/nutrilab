// Regenera marketing/NutriLab-dossier.pdf a partir de index.html (necesita Playwright).
//   node marketing/dossier/generar-pdf.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
const b = await chromium.launch();
const p = await b.newPage();
await p.goto('file://' + here + 'index.html'); await p.evaluate(() => document.fonts.ready);
await p.pdf({ path: here + '../NutriLab-dossier.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true });
await b.close();
