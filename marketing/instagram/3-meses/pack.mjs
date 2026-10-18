// Monta el paquete final: una carpeta por día (archivos + texto.txt), calendario en CSV y Markdown, y un .zip por mes.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const { days } = createRequire(import.meta.url)('./content.js');
const OUT = 'paquete';
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT);
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const KIND = { reel: 'Reel', post: 'Publicación', carousel: 'Carrusel' };
const STORY = { poll: 'Encuesta', quiz: 'Quiz', slider: 'Barra deslizante', question: 'Caja de preguntas', countdown: 'Cuenta atrás', tip: 'Consejo', feature: 'Función', promo: 'Promoción' };
const plain = (h) => String(h || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
const title = (f) => plain(f.title || f.text || '');
const fmtDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${d} de ${MES[m - 1]} de ${y}`; };
const csv = [['Día', 'Fecha', 'Día de la semana', 'Tipo', 'Título', 'Hora publicación', 'Archivos', 'Texto', 'Hashtags', 'Historia', 'Hora historia', 'Sticker de la historia']];
let md = '# NutriLab · Calendario de Instagram (3 meses)\n\nDel 19 de octubre de 2026 al 17 de enero de 2027. Cada día: una pieza para el feed y una historia.\n\n'
  + '**Ritmo semanal:** lunes carrusel · martes reel · miércoles publicación · jueves reel · viernes carrusel · sábado reel · domingo publicación (algunas semanas cambian para cuadrar con Black Friday, Navidad y Año Nuevo).\n\n'
  + '**Horas recomendadas:** historias 10:00 · carruseles 13:00 · reels 19:30 · publicaciones 20:30.\n\n'
  + '**Reels:** van sin música. Al subirlos, añade una canción en tendencia desde Instagram a volumen bajo y elige como portada la imagen «reel-portada».\n\n'
  + '**Historias:** las que tienen un hueco libre son para añadir el sticker que se indica (encuesta, quiz, caja de preguntas…). En las de promoción, añade el sticker de enlace a la web de NutriLab.\n\n';
let month = '';
for (const d of days) {
  const [y, m] = d.date.split('-').map(Number);
  const mesDir = `${String(y)}-${String(m).padStart(2, '0')} ${MES[m - 1]}`;
  if (mesDir !== month) { month = mesDir; md += `\n## ${MES[m - 1][0].toUpperCase() + MES[m - 1].slice(1)} ${y}\n\n`; }
  const dir = path.join(OUT, mesDir, `${d.date} ${d.dow.toLowerCase()} · ${KIND[d.feed.kind].toLowerCase()}`);
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  const cp = (src, name) => { fs.copyFileSync(src, path.join(dir, name)); files.push(name); };
  if (d.feed.kind === 'reel') { cp(`out/video/d${d.id}-reel.mp4`, '1 reel.mp4'); cp(`out/video/d${d.id}-reel-portada.jpg`, '1 reel-portada.jpg'); }
  if (d.feed.kind === 'post') cp(`out/img/d${d.id}-post.jpg`, '1 publicacion.jpg');
  if (d.feed.kind === 'carousel') d.feed.slides.forEach((_, k) => cp(`out/img/d${d.id}-carrusel-${k + 1}.jpg`, `1 carrusel-${k + 1}.jpg`));
  cp(`out/img/d${d.id}-historia.jpg`, '2 historia.jpg');
  const st = d.story;
  const sticker = st.sticker || '—';
  const txt = `${fmtDate(d.date)} (${d.dow})\n\n`
    + `PUBLICACIÓN · ${KIND[d.feed.kind]} · ${d.time}\n${title(d.feed)}\n\n--- Texto (copia y pega) ---\n${d.caption}\n\n${d.hashtags}\n\n`
    + `HISTORIA · ${STORY[st.type]} · ${d.storyTime}\nSticker: ${sticker}\n`;
  fs.writeFileSync(path.join(dir, 'texto.txt'), txt);
  csv.push([d.n, d.date, d.dow, KIND[d.feed.kind], title(d.feed), d.time, files.join(' | '), d.caption, d.hashtags, STORY[st.type] + ': ' + plain(st.title), d.storyTime, sticker]);
  md += `### Día ${d.n} · ${d.dow} ${fmtDate(d.date)}\n\n**${KIND[d.feed.kind]} (${d.time}):** ${title(d.feed)}\n\n> ${d.caption.replace(/\n/g, '\n> ')}\n>\n> ${d.hashtags}\n\n**Historia (${d.storyTime}):** ${STORY[st.type]} · ${plain(st.title)}${st.sticker ? ` → *${st.sticker}*` : ''}\n\n`;
}
const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
fs.writeFileSync(path.join(OUT, 'calendario.csv'), '﻿' + csv.map((r) => r.map(esc).join(';')).join('\r\n'));
fs.writeFileSync(path.join(OUT, 'calendario.md'), md);
// un zip por mes (y el calendario en cada uno)
for (const mes of fs.readdirSync(OUT).filter((x) => /^\d{4}-\d{2}/.test(x))) {
  const z = path.resolve(`NutriLab-instagram ${mes}.zip`);
  fs.rmSync(z, { force: true });
  execFileSync('zip', ['-qr', z, mes, 'calendario.csv', 'calendario.md'], { cwd: OUT });
  console.log(path.basename(z), Math.round(fs.statSync(z).size / 1048576) + ' MB');
}
