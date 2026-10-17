// node reel.mjs <n> [preview tiempos...]  → out/reel-<n>.mp4 (1080x1920, 30 fps) o capturas de prueba
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const [, , n, ...prev] = process.argv;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
await p.goto(`file://${process.cwd()}/reel.html?r=${n}`); await p.evaluate(() => document.fonts.ready);
await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
const T = await p.evaluate(() => window.DURATION);
if (prev.length) {
  for (const t of prev) { await p.evaluate((t) => window.renderAt(t), +t); await p.screenshot({ path: `prev/r${n}-${t}.jpg`, type: 'jpeg', quality: 80 }); }
} else {
  const dir = `frames${n}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
  const N = Math.round(T * 30);
  for (let i = 0; i < N; i++) {
    await p.evaluate((t) => window.renderAt(t), i / 30);
    await p.screenshot({ path: `${dir}/${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 });
  }
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', `${dir}/%05d.jpg`, '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', `out/reel-${n}.mp4`]);
  console.log(`reel-${n}: ${T}s, ${N} fotogramas`);
}
await b.close();
