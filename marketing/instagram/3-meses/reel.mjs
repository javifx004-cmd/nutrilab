// node reel.mjs <día> [segundos de vista previa…]  → out/video/dNN-reel.mp4 y su portada
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const [, , id, ...prev] = process.argv;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
p.on('pageerror', (e) => console.log('ERROR', e.message));
await p.goto(`file://${process.cwd()}/reel.html?d=${id}`); await p.evaluate(() => document.fonts.ready);
await p.evaluate(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))));
const T = await p.evaluate(() => window.DURATION);
if (prev.length) {
  fs.mkdirSync('prev', { recursive: true });
  for (const t of prev) { await p.evaluate((t) => window.renderAt(t), +t); await p.screenshot({ path: `prev/r${id}-${t}.jpg`, type: 'jpeg', quality: 80 }); }
} else {
  const dir = `/tmp/claude-0/-home-user/259858dc-1a0d-5928-84f4-cc0a1b77cb06/scratchpad/frames-${id}`;
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync('out/video', { recursive: true });
  const N = Math.round(T * 30);
  for (let i = 0; i < N; i++) { await p.evaluate((t) => window.renderAt(t), i / 30); await p.screenshot({ path: `${dir}/${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 90 }); }
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '30', '-i', `${dir}/%05d.jpg`, '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', `out/video/d${id}-reel.mp4`]);
  fs.copyFileSync(`${dir}/${String(Math.round(1.6 * 30)).padStart(5, '0')}.jpg`, `out/video/d${id}-reel-portada.jpg`);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`d${id}: ${T.toFixed(1)} s`);
}
await b.close();
