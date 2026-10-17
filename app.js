/* NutriLab – clientes, dietas (manuales o con IA) y progreso · by Javier Carbonell
 * (las claves internas de almacenamiento conservan el nombre «javinutricion» para no perder datos) */
(() => {
  'use strict';

  // ================================================================ estado
  const BASE_KEY = 'javinutricion-v1';
  let KEY = BASE_KEY;
  // Modo nube (cuentas + suscripción) si config.js tiene los datos de Supabase; si no, todo queda en este dispositivo.
  const CFG = window.NUTRILAB_CONFIG || {};
  const CLOUD = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
  let cloud = null;          // módulo cloud.js
  let acct = null;           // { user, profile }
  let gate = CLOUD ? 'loading' : null; // pantalla previa a la app: loading | auth | paywall | newpass
  let recovering = false;    // abierta desde el enlace de «recuperar contraseña»
  let viewing = null;        // administrador viendo los datos de otro nutricionista (solo lectura)
  let portal = null;         // cliente viendo su dieta con su enlace: { token, data, day, error }
  const AI_KEY = 'javinutricion-ai';
  const LISTS = ['clients', 'measures', 'plans', 'foods'];
  const ACTIVITY = [
    { v: 1.2, l: 'Sedentaria', d: 'Trabajo sentado, sin ejercicio' },
    { v: 1.375, l: 'Ligera', d: 'Ejercicio 1-3 días/semana' },
    { v: 1.55, l: 'Moderada', d: 'Ejercicio 3-5 días/semana' },
    { v: 1.725, l: 'Alta', d: 'Ejercicio 6-7 días/semana' },
    { v: 1.9, l: 'Muy alta', d: 'Trabajo físico + entreno diario' },
  ];
  const GOALS = {
    perder: { l: 'Perder grasa', adj: -0.2, pkg: 2.0, cls: 'blue' },
    mantener: { l: 'Mantener', adj: 0, pkg: 1.6, cls: 'mute' },
    ganar: { l: 'Ganar músculo', adj: 0.1, pkg: 1.8, cls: 'amber' },
    recomp: { l: 'Recomposición', adj: -0.05, pkg: 2.2, cls: 'green' },
  };
  const STATUS = { activo: 'Activo', pausa: 'En pausa', alta: 'Alta' };
  const STATUS_PLURAL = { activo: 'Activos', pausa: 'En pausa', alta: 'De alta' };
  const METRICS = { weight: ['Peso', 'kg'], fat: ['% grasa', '%'], waist: ['Cintura', 'cm'], hip: ['Cadera', 'cm'], chest: ['Pecho', 'cm'], arm: ['Brazo', 'cm'], thigh: ['Muslo', 'cm'] };
  const MEAL_NAMES = ['Desayuno', 'Media mañana', 'Comida', 'Merienda', 'Cena', 'Recena'];
  const STYLES = ['Mediterránea', 'Alta en proteína', 'Vegetariana', 'Vegana', 'Sin gluten', 'Sin lactosa', 'Baja en hidratos', 'Ayuno intermitente 16:8', 'Económica'];

  const blank = () => ({ clients: [], measures: [], plans: [], foods: [], deleted: {}, settings: { theme: 'auto' } });
  let S = CLOUD ? blank() : load();
  const ui = { clientQuery: '', clientFilter: 'activo', foodQuery: '', foodCat: 'Todas', metric: 'weight', day: 0 };

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      return d ? migrate({ ...blank(), ...d, settings: { ...blank().settings, ...d.settings } }) : blank();
    } catch { return blank(); }
  }
  function migrate(d) {
    LISTS.forEach((k) => { if (!Array.isArray(d[k])) d[k] = []; });
    d.deleted ??= {};
    return d;
  }

  // Cada guardado marca con fecha lo que cambió y lo que se borró (para combinar entre dispositivos).
  const sig = (x) => JSON.stringify({ ...x, updatedAt: 0 });
  let snap = new Map();
  let ver = 0;
  function snapshot() { snap = new Map(LISTS.flatMap((k) => S[k].map((x) => [x.id, sig(x)]))); }
  function persist() {
    ver++;
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { toast('No se pudo guardar: el almacenamiento está lleno'); }
  }
  function save() {
    if (viewing) { toast('Modo solo lectura: los cambios no se guardan'); return; }
    const now = Date.now(), seen = new Set();
    for (const k of LISTS) for (const x of S[k]) { seen.add(x.id); if (snap.get(x.id) !== sig(x)) x.updatedAt = now; }
    for (const id of snap.keys()) if (!seen.has(id)) S.deleted[id] = now;
    for (const [id, t] of Object.entries(S.deleted)) if (t < now - 365 * 864e5) delete S.deleted[id];
    snapshot(); persist(); scheduleSync();
  }
  snapshot();

  let aiCfg = (() => { try { return JSON.parse(localStorage.getItem(AI_KEY)) || {}; } catch { return {}; } })();
  const saveAi = () => { try { localStorage.setItem(AI_KEY, JSON.stringify(aiCfg)); } catch { /* no-op */ } };

  // ================================================================ utilidades
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
  const has = (v) => v !== '' && v != null && isFinite(num(v)) && num(v) !== 0;
  const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00') - new Date(a + 'T12:00')) / 864e5);
  const fmt = (v, d = 1) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: d }).format(v);
  const fmtDate = (s, long = false) => {
    if (!s) return '—';
    const d = new Date(s + 'T12:00');
    return d.toLocaleDateString('es-ES', long ? { weekday: 'long', day: 'numeric', month: 'long' } : d.getFullYear() === new Date().getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: '2-digit' });
  };
  const relDay = (s) => {
    const n = daysBetween(today(), s);
    return n === 0 ? 'hoy' : n === 1 ? 'mañana' : n === -1 ? 'ayer' : n < 0 ? `hace ${-n} días` : n < 7 ? `en ${n} días` : fmtDate(s);
  };
  const ageOf = (birth) => {
    if (!birth) return 0;
    const b = new Date(birth + 'T12:00'), t = new Date();
    let a = t.getFullYear() - b.getFullYear();
    if (t < new Date(t.getFullYear(), b.getMonth(), b.getDate())) a--;
    return a > 0 && a < 120 ? a : 0;
  };
  const initials = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const hue = (s) => [...(s || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 140);
  const avatar = (c, lg = false) => { const h = hue(c.name); return `<div class="avatar${lg ? ' lg' : ''}" style="background:linear-gradient(135deg,hsl(${h} 70% 60%),hsl(${(h + 30) % 360} 62% 40%))">${esc(initials(c.name))}</div>`; };
  const fileSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  const opt = (pairs, v) => pairs.map(([val, label]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(label)}</option>`).join('');

  const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  const ICON = {
    back: svg('<path d="M15 18l-6-6 6-6"/>'), plus: svg('<path d="M12 5v14M5 12h14"/>'), close: svg('<path d="M18 6L6 18M6 6l12 12"/>'),
    check: svg('<path d="M20 6L9 17l-5-5"/>'), more: svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'), edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    trash: svg('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'), copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),
    share: svg('<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13"/>'), print: svg('<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'),
    ai: svg('<path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>'),
    users: svg('<circle cx="9" cy="8" r="4"/><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1"/>'), chart: svg('<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>'),
    plate: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/>'), calendar: svg('<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
    phone: svg('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>'),
    mail: svg('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>'), wa: svg('<path d="M3 21l1.7-5.1A9 9 0 1 1 8 19.3z"/><path d="M9 10c0 3 2 5 5 5l1-1.5-2-1-1 1c-1 0-2-1-2-2l1-1-1-2z"/>'),
    camera: svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
    leaf: svg('<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z"/><path d="M2 21c0-3 1.9-5.4 5.1-6"/>'),
    star: svg('<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>'),
  };

  function toast(msg) {
    $$('.toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  const haptic = () => { try { navigator.vibrate?.(8); } catch { /* no-op */ } };
  async function copyText(text, what = 'Copiado') {
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* no-op */ }
      ta.remove();
    }
    haptic(); toast(`${what} ✓`);
  }
  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ================================================================ citas → calendario del móvil
  // Archivo .ics (iPhone, Android, Outlook, Mac) o enlace a Google Calendar. La hora es «flotante»:
  // cada calendario la pone en la zona horaria del dispositivo.
  const DURATIONS = [[30, '30 min'], [45, '45 min'], [60, '1 hora'], [90, '1 h 30 min']];
  const apptWhen = (a) => `el ${fmtDate(a.date, true)}${a.time ? ' a las ' + a.time : ''}`;
  function apptEnd(a) {
    if (!a.time) return { date: addDays(a.date, 1) };
    const d = new Date(`${a.date}T${a.time}`); d.setMinutes(d.getMinutes() + (num(a.mins) || 45));
    const p = (n) => String(n).padStart(2, '0');
    return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` };
  }
  const icsStamp = (iso, time) => iso.replace(/-/g, '') + (time ? 'T' + time.replace(':', '') + '00' : '');
  const icsText = (s) => String(s ?? '').replace(/[\;,]/g, (c) => '\\' + c).replace(/\r?\n/g, '\\n');
  // Las líneas de más de 75 octetos se parten (RFC 5545); se corta por caracteres para no romper el UTF-8.
  const icsFold = (line) => { const out = []; let cur = '', bytes = 0;
    for (const ch of line) { const b = new TextEncoder().encode(ch).length; if (bytes + b > 73) { out.push(cur); cur = ' '; bytes = 1; } cur += ch; bytes += b; }
    out.push(cur); return out.join('\r\n'); };
  function icsFile(appts) {
    const now = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NutriLab//Citas//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    for (const a of appts) {
      const end = apptEnd(a);
      lines.push('BEGIN:VEVENT', `UID:${a.uid}@nutrilab`, `DTSTAMP:${now}`,
        a.time ? `DTSTART:${icsStamp(a.date, a.time)}` : `DTSTART;VALUE=DATE:${icsStamp(a.date)}`,
        a.time ? `DTEND:${icsStamp(end.date, end.time)}` : `DTEND;VALUE=DATE:${icsStamp(end.date)}`,
        `SUMMARY:${icsText(a.title)}`);
      if (a.place) lines.push(`LOCATION:${icsText(a.place)}`);
      if (a.details) lines.push(`DESCRIPTION:${icsText(a.details)}`);
      if (a.url) lines.push(`URL:${a.url}`);
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(a.title)}`, `TRIGGER:${a.time ? '-PT1H' : '-PT15H'}`, 'END:VALARM', 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(icsFold).join('\r\n') + '\r\n';
  }
  function googleCalUrl(a) {
    const end = apptEnd(a);
    const q = new URLSearchParams({ action: 'TEMPLATE', text: a.title, dates: `${icsStamp(a.date, a.time)}/${icsStamp(end.date, end.time)}` });
    if (a.details || a.url) q.set('details', [a.details, a.url].filter(Boolean).join('\n\n'));
    if (a.place) q.set('location', a.place);
    return 'https://calendar.google.com/calendar/render?' + q;
  }
  const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function openIcs(appts, name) {
    const ics = icsFile(appts);
    // En iPhone, Safari abre el .ics directamente con «Añadir al calendario»; en el resto se descarga y se abre.
    if (isIOS()) { location.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics); return; }
    download(name, new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  }
  // Cita de un cliente vista por el nutricionista
  function clientAppt(c) {
    if (!c?.nextReview) return null;
    const w = currentWeight(c);
    return { uid: `rev-${c.id}-${c.nextReview}`, date: c.nextReview, time: c.reviewTime || '', mins: c.reviewMins || 45, place: c.reviewPlace || '',
      title: `Revisión · ${c.name}`,
      details: [`Objetivo: ${(GOALS[c.goal] || GOALS.mantener).l}`, w ? `Último peso: ${fmt(w)} kg` : '', c.phone ? `Tel.: ${c.phone}` : '', c.allergies ? `Alergias: ${c.allergies}` : ''].filter(Boolean).join('\n'),
      url: `${location.origin}${location.pathname}#/c/${c.id}` };
  }
  function calendarSheet(a, { phone, name, who } = {}) {
    const tel = (phone || '').replace(/[^\d]/g, '').replace(/^(?=[67]\d{8}$)/, '34');
    const msg = `Hola ${(name || '').split(' ')[0]}, te recuerdo tu revisión ${apptWhen(a)}${a.place ? ` (${a.place})` : ''}. ¡Hasta entonces!${who ? ' ' + who : ''}`;
    sheet('Añadir al calendario', `
      <div class="appt"><div class="ico">${ICON.calendar}</div><div><b>${esc(a.title)}</b><div class="small muted" style="text-transform:none">${esc(fmtDate(a.date, true).replace(/^./, (x) => x.toUpperCase()))}${a.time ? ` · ${esc(a.time)}–${esc(apptEnd(a).time)}` : ''}${a.place ? ' · ' + esc(a.place) : ''}</div></div></div>
      <div class="menu">
        <button class="btn primary" id="calIcs">${ICON.calendar}${isIOS() ? 'Calendario del iPhone' : 'Calendario del móvil / PC (.ics)'}</button>
        <a class="btn" href="${esc(googleCalUrl(a))}" target="_blank" rel="noopener">${ICON.calendar}Google Calendar</a>
        ${tel ? `<a class="btn" href="https://wa.me/${tel}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">${ICON.wa}Recordárselo por WhatsApp</a>` : ''}
      </div>
      <p class="small muted">${a.time ? 'Incluye un aviso 1 hora antes.' : 'Sin hora: se añade como evento de todo el día, con aviso la tarde anterior.'}</p>`);
    $('#calIcs').onclick = () => { openIcs([a], `revision-${a.date}.ics`); haptic(); };
  }
  function reviewSheet(c) {
    const lastPlace = (() => { try { return localStorage.getItem('nutrilab-last-place') || ''; } catch { return ''; } })();
    sheet(`Cita · ${c.name}`, `<form id="rf">
      <div class="grid2"><label class="f"><span>Fecha</span><input type="date" name="d" required value="${esc(c.nextReview || addDays(today(), 14))}"></label>
        <label class="f"><span>Hora</span><input type="time" name="t" step="300" value="${esc(c.reviewTime || '')}"></label></div>
      <div class="grid2"><label class="f"><span>Duración</span><select name="m">${opt(DURATIONS, c.reviewMins || 45)}</select></label>
        <label class="f"><span>Lugar</span><input name="p" value="${esc(c.reviewPlace ?? lastPlace)}" placeholder="Consulta, online…" autocomplete="off"></label></div>
      <button class="btn primary block" name="cal" value="1">${ICON.calendar}Guardar y añadir al calendario</button>
      <button class="btn block" style="margin-top:8px">${ICON.check}Solo guardar</button>
      ${c.nextReview ? `<button type="button" class="btn ghost block" id="rfClear" style="margin-top:8px">Quitar cita</button>` : ''}</form>`);
    $('#rf').onsubmit = (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      Object.assign(c, { nextReview: f.get('d'), reviewTime: f.get('t'), reviewMins: num(f.get('m')) || 45, reviewPlace: f.get('p').trim() });
      try { if (c.reviewPlace) localStorage.setItem('nutrilab-last-place', c.reviewPlace); } catch { /* no-op */ }
      save(); render();
      if (ev.submitter?.name === 'cal') calendarSheet(clientAppt(c), { phone: c.phone, name: c.name });
      else { closeSheet(); toast('Cita guardada'); }
    };
    $('#rfClear')?.addEventListener('click', () => { Object.assign(c, { nextReview: '', reviewTime: '' }); save(); closeSheet(); render(); });
  }

  // ================================================================ cálculos (caché por versión)
  let cache = { ver: -1 };
  function idx() {
    if (cache.ver === ver) return cache;
    const client = new Map(S.clients.map((c) => [c.id, c]));
    const measBy = new Map(), plansBy = new Map();
    for (const m of S.measures) { if (!measBy.has(m.clientId)) measBy.set(m.clientId, []); measBy.get(m.clientId).push(m); }
    for (const l of measBy.values()) l.sort((a, b) => a.date.localeCompare(b.date));
    for (const p of S.plans) { if (!plansBy.has(p.clientId)) plansBy.set(p.clientId, []); plansBy.get(p.clientId).push(p); }
    for (const l of plansBy.values()) l.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const food = new Map([...FOODS, ...S.foods].map((f) => [f.id, f]));
    cache = { ver, client, measBy, plansBy, food };
    return cache;
  }
  const clientById = (id) => idx().client.get(id);
  const measuresOf = (id) => idx().measBy.get(id) || [];
  const plansOf = (id) => idx().plansBy.get(id) || [];
  const allFoods = () => [...S.foods, ...FOODS];

  function metricSeries(cid, key) { return measuresOf(cid).filter((m) => has(m[key])).map((m) => ({ date: m.date, v: num(m[key]) })); }
  const currentWeight = (c) => { const s = metricSeries(c.id, 'weight'); return s.length ? s[s.length - 1].v : 0; };

  // Mifflin-St Jeor × actividad, ajuste por objetivo; proteína por kg y grasa en % de las kcal.
  function targets(c) {
    const w = currentWeight(c), age = ageOf(c.birth), goal = GOALS[c.goal] || GOALS.mantener;
    const missing = [!w && 'peso', !num(c.height) && 'altura', !age && 'fecha de nacimiento', !c.sex && 'sexo'].filter(Boolean);
    let bmr = 0, tdee = 0, kcal = num(c.kcal);
    if (!missing.length) {
      bmr = 10 * w + 6.25 * num(c.height) - 5 * age + (c.sex === 'H' ? 5 : -161);
      tdee = bmr * (num(c.activity) || 1.55);
      if (!kcal) kcal = Math.round((tdee * (1 + goal.adj)) / 10) * 10;
    }
    if (!kcal || !w) return { missing, age, weight: w };
    const p = (num(c.pKg) || goal.pkg) * w;
    const f = (kcal * (num(c.fatPct) || 25)) / 100 / 9;
    const cb = Math.max(0, (kcal - p * 4 - f * 9) / 4);
    return { missing, age, weight: w, bmr, tdee, kcal, p, c: cb, f, custom: !!num(c.kcal) };
  }
  function bmi(c) {
    const w = currentWeight(c), h = num(c.height) / 100;
    if (!w || !h) return null;
    const v = w / (h * h);
    return { v, l: v < 18.5 ? 'Bajo peso' : v < 25 ? 'Normal' : v < 30 ? 'Sobrepeso' : 'Obesidad' };
  }

  const itemMacros = (it) => { const k = num(it.grams) / 100, p = it.per100 || {}; return { kcal: num(p.kcal) * k, p: num(p.p) * k, c: num(p.c) * k, f: num(p.f) * k }; };
  const sumMacros = (arr) => arr.reduce((t, x) => ({ kcal: t.kcal + x.kcal, p: t.p + x.p, c: t.c + x.c, f: t.f + x.f }), { kcal: 0, p: 0, c: 0, f: 0 });
  const mealMacros = (m) => sumMacros(m.items.map(itemMacros));
  const dayMacros = (d) => sumMacros(d.meals.map(mealMacros));
  const planAvg = (p) => { const t = sumMacros(p.days.map(dayMacros)); const n = p.days.length || 1; return { kcal: t.kcal / n, p: t.p / n, c: t.c / n, f: t.f / n }; };

  // ================================================================ enrutado (#/…)
  function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (parts[0] === 'clientes') return { view: 'clients' };
    if (parts[0] === 'c' && clientById(parts[1])) return { view: 'client', id: parts[1], sub: parts[2] || 'resumen' };
    if (parts[0] === 'd' && S.plans.some((p) => p.id === parts[1])) return { view: 'plan', id: parts[1] };
    if (parts[0] === 'alimentos') return { view: 'foods' };
    if (parts[0] === 'ajustes') return { view: 'settings' };
    if (parts[0] === 'admin' && isAdmin()) return { view: 'admin' };
    return { view: 'home' };
  }
  const go = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };
  window.addEventListener('hashchange', () => {
    const pm = CLOUD && location.hash.match(/^#\/p\/([\w-]{32,})/);
    if (pm) return openPortal(pm[1]);
    closeSheet(); render(); window.scrollTo(0, 0);
  });

  function render() {
    if (portal) return renderPortal();
    if (gate) return renderGate();
    document.body.classList.remove('gated');
    const r = route();
    const tabOf = { home: '#/', clients: '#/clientes', client: '#/clientes', plan: '#/clientes', foods: '#/alimentos', settings: '#/ajustes', admin: '#/ajustes' };
    $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.nav === tabOf[r.view]));
    let title = '', sub = '', back = null, fab = null, html = '';
    if (r.view === 'home') { title = 'Inicio'; sub = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }); html = renderHome(); fab = ['Cliente', () => clientSheet()]; }
    if (r.view === 'clients') { title = 'Clientes'; sub = `${S.clients.filter((c) => (c.status || 'activo') === 'activo').length} activos`; html = renderClients(); fab = ['Cliente', () => clientSheet()]; }
    if (r.view === 'client') { const c = clientById(r.id); title = 'Cliente'; sub = c.name; back = '#/clientes'; html = renderClient(c, r.sub); }
    if (r.view === 'plan') { const p = S.plans.find((x) => x.id === r.id); const c = clientById(p.clientId); title = p.name; sub = c ? c.name : ''; back = c ? `#/c/${c.id}/dietas` : '#/clientes'; html = renderPlan(p); }
    if (r.view === 'foods') { title = 'Alimentos'; sub = `${FOODS.length + S.foods.length} alimentos`; html = renderFoods(); fab = ['Alimento', () => foodSheet()]; }
    if (r.view === 'settings') { title = 'Ajustes'; sub = 'NutriLab by Javier Carbonell'; html = renderSettings(); }
    if (r.view === 'admin') { title = 'Administración'; sub = 'Nutricionistas y suscripciones'; back = '#/ajustes'; html = renderAdmin(); fab = null; }
    if (viewing) { fab = null; html = `<div class="note warn viewing"><span class="grow">👁 Viendo los datos de <b>${esc(viewing.name)}</b> · solo lectura</span><button class="btn sm" data-act="exit-view">Salir</button></div>` + html; }
    $('#topbar').firstElementChild.outerHTML = back ? `<button class="back" data-nav="${back}" aria-label="Atrás">${ICON.back}</button>` : '<img class="top-logo" src="icons/icon.svg" alt="" width="34" height="34">';
    $('#title').textContent = title;
    $('#subtitle').textContent = sub;
    $('#view').innerHTML = html;
    let f = $('.fab');
    if (fab) {
      if (!f) { f = document.createElement('button'); f.className = 'fab'; document.body.appendChild(f); }
      f.innerHTML = ICON.plus + fab[0]; f.onclick = fab[1];
    } else f?.remove();
    afterRender(r);
  }

  // ================================================================ INICIO
  function renderHome() {
    const h = new Date().getHours();
    const hello = h < 6 ? 'Buenas noches' : h < 14 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
    const active = S.clients.filter((c) => (c.status || 'activo') === 'activo');
    const week = addDays(today(), 7);
    const reviews = active.filter((c) => c.nextReview).sort((a, b) => a.nextReview.localeCompare(b.nextReview));
    const thisWeek = reviews.filter((c) => c.nextReview <= week);
    const hero = `
      <section class="hero">
        <div class="who"><img src="icons/icon.svg" alt="" width="46" height="46"><div><div class="brand">Nutri<span>Lab</span></div><div class="by">by Javier Carbonell</div></div></div>
        <div class="hello">${hello}, Javi 👋${thisWeek.length ? ` Tienes <b>${thisWeek.length}</b> revisi${thisWeek.length === 1 ? 'ón' : 'ones'} esta semana.` : S.clients.length ? ' Todo al día.' : ''}</div>
        ${S.clients.length ? `<div class="glass">
          <div><div class="v num">${active.length}</div><div class="l">Clientes activos</div></div>
          <div><div class="v num">${thisWeek.length}</div><div class="l">Revisiones 7 días</div></div>
          <div><div class="v num">${S.plans.length}</div><div class="l">Dietas creadas</div></div></div>` : ''}
        <span class="leaf">${ICON.leaf}</span>
      </section>`;
    const trialNote = CLOUD && acct?.profile && !acct.profile.is_admin && !viewing && !['active', 'trialing', 'past_due'].includes(acct.profile.subscription_status) && cloud.hasAccess(acct.profile)
      ? `<div class="note" style="display:flex;gap:10px;align-items:center"><span class="grow">Prueba gratis: te quedan <b>${daysLeft(acct.profile.trial_ends_at)} días</b>.</span><button class="btn sm primary" data-act="checkout">Suscribirme</button></div>` : '';
    if (!S.clients.length) return hero + trialNote + `
      <div class="empty"><div class="art">${ICON.users}</div><h3>Empieza con tu primer cliente</h3>
        <p>Guarda sus datos, calcula sus calorías y macros, crea dietas a mano o con IA y sigue su progreso con gráficas y fotos.</p>
        <div class="row" style="justify-content:center"><button class="btn primary" data-act="new-client">${ICON.plus}Añadir cliente</button><button class="btn" data-act="demo">Ver ejemplo</button></div></div>`;

    const recent = S.measures.filter((m) => clientById(m.clientId)).sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 5);
    return hero + trialNote + `
      <div class="card"><div class="card-head"><h3>Próximas citas</h3>${reviews.some((c) => c.nextReview >= today()) ? `<button class="btn sm ghost" data-act="cal-all">${ICON.calendar}Al calendario</button>` : `<button class="btn sm ghost" data-nav="#/clientes">Ver clientes</button>`}</div>
        ${reviews.length ? reviews.slice(0, 6).map((c) => `
          <div class="list-item" data-nav="#/c/${c.id}">${avatar(c)}
            <div class="body"><div class="t">${esc(c.name)}</div><div class="s">${esc((GOALS[c.goal] || GOALS.mantener).l)}${currentWeight(c) ? ' · ' + fmt(currentWeight(c)) + ' kg' : ''}</div></div>
            <span class="pill ${c.nextReview < today() ? 'red' : c.nextReview <= week ? 'amber' : 'mute'}">${esc(relDay(c.nextReview))}${c.reviewTime ? ' · ' + esc(c.reviewTime) : ''}</span></div>`).join('') : '<p class="small muted" style="margin:0">Programa la próxima cita desde la ficha de cada cliente y añádela al calendario del móvil.</p>'}
      </div>
      <div class="card"><h3>Últimas mediciones</h3>
        ${recent.length ? recent.map((m) => {
          const c = clientById(m.clientId), s = metricSeries(c.id, 'weight'), i = s.findIndex((x) => x.date === m.date);
          const d = i > 0 && has(m.weight) ? num(m.weight) - s[i - 1].v : null;
          return `<div class="list-item" data-nav="#/c/${c.id}/progreso">${avatar(c)}
            <div class="body"><div class="t">${esc(c.name)}</div><div class="s">${esc(fmtDate(m.date))}${has(m.waist) ? ' · cintura ' + fmt(num(m.waist)) + ' cm' : ''}</div></div>
            <div class="end"><b class="num">${has(m.weight) ? fmt(num(m.weight)) + ' kg' : '—'}</b>${d != null ? `<div class="small ${trendCls(c, d)}">${d > 0 ? '+' : ''}${fmt(d)} kg</div>` : ''}</div></div>`;
        }).join('') : '<p class="small muted" style="margin:0">Aún no hay mediciones.</p>'}
      </div>`;
  }
  // Verde si el cambio va en la dirección del objetivo del cliente.
  const trendCls = (c, d) => { if (!d) return 'muted'; const g = c.goal || 'mantener'; const good = g === 'ganar' ? d > 0 : g === 'mantener' ? Math.abs(d) < 0.5 : d < 0; return good ? 'pos' : 'neg'; };

  // ================================================================ CLIENTES
  function renderClients() {
    const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, S.clients.filter((c) => (c.status || 'activo') === k).length]));
    return `
      <div class="search-wrap">${ICON.search}<input class="search" id="clientSearch" type="search" placeholder="Buscar cliente…" value="${esc(ui.clientQuery)}" autocomplete="off"></div>
      <div class="chips">${Object.entries(STATUS_PLURAL).map(([k, l]) => `<button class="chip ${ui.clientFilter === k ? 'on' : ''}" data-cfilter="${k}">${l}<span class="n">${counts[k]}</span></button>`).join('')}<button class="chip ${ui.clientFilter === 'all' ? 'on' : ''}" data-cfilter="all">Todos<span class="n">${S.clients.length}</span></button></div>
      <div id="clientList">${clientList()}</div>`;
  }
  function clientList() {
    const q = ui.clientQuery.toLowerCase().trim();
    const list = S.clients.filter((c) => (ui.clientFilter === 'all' || (c.status || 'activo') === ui.clientFilter) && (!q || `${c.name} ${c.email} ${c.phone}`.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    if (!list.length) return S.clients.length ? `<div class="empty"><p>No hay clientes en este filtro.</p></div>`
      : `<div class="empty"><div class="art">${ICON.users}</div><h3>Sin clientes</h3><p>Añade tu primer cliente.</p><button class="btn primary" data-act="new-client">${ICON.plus}Añadir cliente</button></div>`;
    return list.map((c) => {
      const s = metricSeries(c.id, 'weight'), g = GOALS[c.goal] || GOALS.mantener;
      const d = s.length > 1 ? s[s.length - 1].v - s[0].v : null;
      return `<div class="client-card" data-nav="#/c/${c.id}">${avatar(c)}
        <div class="body"><div class="name">${esc(c.name)}</div>
          <div class="meta"><span class="pill ${g.cls}">${g.l}</span>${ageOf(c.birth) ? `<span>${ageOf(c.birth)} años</span>` : ''}${c.nextReview ? `<span>Revisión ${esc(relDay(c.nextReview))}</span>` : ''}</div></div>
        <div class="end" style="text-align:right">${s.length ? `<b class="num">${fmt(s[s.length - 1].v)} kg</b>` : ''}${d != null ? `<div class="small num ${trendCls(c, d)}">${d > 0 ? '+' : ''}${fmt(d)} kg</div>` : ''}</div></div>`;
    }).join('');
  }

  function renderClient(c, sub) {
    const tabs = [['resumen', 'Resumen'], ['progreso', 'Progreso'], ['dietas', 'Dietas'], ['ficha', 'Ficha']];
    const phone = (c.phone || '').replace(/[^\d+]/g, '');
    const waNum = phone.replace(/^\+/, '').replace(/^(?=[67]\d{8}$)/, '34');
    const head = `
      <div class="client-head">${avatar(c, true)}
        <div style="min-width:0"><h2>${esc(c.name)}</h2>
          <div class="meta">${[ageOf(c.birth) && ageOf(c.birth) + ' años', c.height && c.height + ' cm', c.sex === 'M' ? 'Mujer' : c.sex === 'H' ? 'Hombre' : ''].filter(Boolean).join(' · ')}</div>
          <div class="row" style="margin-top:6px"><span class="pill ${(GOALS[c.goal] || GOALS.mantener).cls}">${(GOALS[c.goal] || GOALS.mantener).l}</span>${(c.status || 'activo') !== 'activo' ? `<span class="pill mute">${STATUS[c.status]}</span>` : ''}</div></div>
      </div>
      ${phone || c.email ? `<div class="contact">
        ${phone ? `<a class="btn sm" href="https://wa.me/${esc(waNum)}" target="_blank" rel="noopener">${ICON.wa}WhatsApp</a><a class="btn sm" href="tel:${esc(phone)}">${ICON.phone}Llamar</a>` : ''}
        ${c.email ? `<a class="btn sm" href="mailto:${esc(c.email)}">${ICON.mail}Email</a>` : ''}</div>` : ''}
      <div class="seg">${tabs.map(([k, l]) => `<button class="${sub === k ? 'on' : ''}" data-nav="#/c/${c.id}/${k}">${l}</button>`).join('')}</div>`;
    if (sub === 'progreso') return head + renderProgress(c);
    if (sub === 'dietas') return head + renderClientPlans(c);
    if (sub === 'ficha') return head + renderFicha(c);
    return head + renderSummary(c);
  }

  // Anillo con el reparto de las kcal entre proteínas, hidratos y grasas.
  function macroRing(t) {
    const R = 58, C = 2 * Math.PI * R, gap = 6;
    const parts = [['p', t.p * 4], ['c', t.c * 4], ['f', t.f * 9]];
    const total = parts.reduce((s, [, v]) => s + v, 0) || 1;
    let off = 0;
    const arcs = parts.map(([k, v]) => {
      const len = Math.max(0, (v / total) * C - gap);
      const a = `<circle cx="68" cy="68" r="${R}" fill="none" stroke="var(--${k}-col)" stroke-width="14" stroke-linecap="round" stroke-dasharray="${len} ${C}" stroke-dashoffset="${-off - gap / 2}"/>`;
      off += (v / total) * C;
      return a;
    }).join('');
    const pct = (v) => Math.round((v / total) * 100);
    return `<div class="ring-wrap">
      <div class="ring"><svg viewBox="0 0 136 136"><circle cx="68" cy="68" r="${R}" fill="none" stroke="var(--surface-3)" stroke-width="14"/>${arcs}</svg>
        <div class="center"><b class="num">${fmt(t.kcal, 0)}</b><span>kcal / día</span></div></div>
      <div class="legend-list">
        <div class="it"><span class="sw" style="background:var(--p-col)"></span><span class="nm">Proteínas</span><span class="g num">${fmt(t.p, 0)} g<small>${pct(t.p * 4)}%</small></span></div>
        <div class="it"><span class="sw" style="background:var(--c-col)"></span><span class="nm">Hidratos</span><span class="g num">${fmt(t.c, 0)} g<small>${pct(t.c * 4)}%</small></span></div>
        <div class="it"><span class="sw" style="background:var(--f-col)"></span><span class="nm">Grasas</span><span class="g num">${fmt(t.f, 0)} g<small>${pct(t.f * 9)}%</small></span></div>
      </div></div>`;
  }

  function renderSummary(c) {
    const t = targets(c), b = bmi(c), s = metricSeries(c.id, 'weight');
    const start = s[0]?.v, now = s[s.length - 1]?.v, goalW = num(c.targetWeight);
    const toGo = goalW && now ? now - goalW : null;
    const progressPct = goalW && start && now && start !== goalW ? Math.max(0, Math.min(100, ((start - now) / (start - goalW)) * 100)) : null;
    const active = plansOf(c.id).find((p) => p.active) || plansOf(c.id)[0];
    return `
      ${t.kcal ? `<div class="card">
        <div class="card-head"><h3>Objetivo diario</h3>${t.custom ? '<span class="pill mute">manual</span>' : '<span class="pill green">calculado</span>'}</div>
        ${macroRing(t)}
        ${t.tdee ? `<div class="meta-line"><span class="pill mute">Basal ${fmt(t.bmr, 0)} kcal</span><span class="pill mute">Gasto total ${fmt(t.tdee, 0)} kcal</span><span class="pill ${t.kcal < t.tdee ? 'blue' : t.kcal > t.tdee ? 'amber' : 'mute'}">${t.kcal < t.tdee ? 'Déficit' : t.kcal > t.tdee ? 'Superávit' : 'Mantenimiento'} ${fmt(Math.abs(t.kcal - t.tdee), 0)} kcal</span></div>` : ''}
      </div>` : `<div class="note warn">Para calcular sus calorías y macros falta: <b>${t.missing.join(', ')}</b>. <a href="#" data-act="edit-client" data-id="${c.id}">Completar ficha</a>${!t.weight ? ' o <a href="#" data-act="new-measure" data-id="' + c.id + '">añadir una medición</a>' : ''}.</div>`}

      <div class="card"><div class="card-head"><h3>Peso</h3><button class="btn sm" data-act="new-measure" data-id="${c.id}">${ICON.plus}Medición</button></div>
        ${s.length ? `
          <div class="stats" style="margin-bottom:10px">
            <div class="stat"><div class="l">Actual</div><div class="v num">${fmt(now)} kg</div><div class="s">${esc(fmtDate(s[s.length - 1].date))}</div></div>
            <div class="stat"><div class="l">Cambio</div><div class="v num ${trendCls(c, now - start)}">${now - start > 0 ? '+' : ''}${fmt(now - start)} kg</div><div class="s">desde ${esc(fmtDate(s[0].date))}</div></div>
            <div class="stat"><div class="l">${goalW ? 'Objetivo' : 'IMC'}</div><div class="v num">${goalW ? fmt(goalW) + ' kg' : b ? fmt(b.v) : '—'}</div><div class="s">${goalW && toGo != null ? (Math.abs(toGo) < 0.05 ? '¡conseguido!' : `faltan ${fmt(Math.abs(toGo))} kg`) : b ? b.l : ''}</div></div>
          </div>
          ${progressPct != null ? `<div class="macro"><div class="top"><span>Progreso hacia el objetivo</span><b class="num">${fmt(progressPct, 0)}%</b></div><div class="bar"><i style="width:${progressPct}%"></i></div></div>` : ''}
          ${s.length > 1 ? lineChart(s, { target: goalW, unit: 'kg' }) : ''}
          ${b && goalW ? `<p class="small muted" style="margin:8px 0 0">IMC ${fmt(b.v)} · ${b.l}</p>` : ''}` : `<p class="small muted" style="margin:0">Sin mediciones todavía.</p>`}
      </div>

      <div class="stats two">
        <div class="stat" data-act="review" data-id="${c.id}" style="cursor:pointer"><div class="l">Próxima cita</div><div class="v">${c.nextReview ? esc(relDay(c.nextReview)) : '—'}</div><div class="s">${c.nextReview ? esc(fmtDate(c.nextReview, true)) + (c.reviewTime ? ' · ' + esc(c.reviewTime) : '') : 'toca para programar'}</div>${c.nextReview && !viewing ? `<button class="btn sm cal-btn" data-act="cal-client" data-id="${c.id}">${ICON.calendar}Al calendario</button>` : ''}</div>
        <div class="stat" ${active ? `data-nav="#/d/${active.id}" style="cursor:pointer"` : ''}><div class="l">Dieta ${active?.active ? 'activa' : 'más reciente'}</div><div class="v" style="font-size:15px">${active ? esc(active.name) : '—'}</div><div class="s">${active ? fmt(planAvg(active).kcal, 0) + ' kcal/día' : 'sin dietas'}</div></div>
      </div>
      ${c.allergies ? `<div class="note warn"><b>Alergias / intolerancias:</b> ${esc(c.allergies)}</div>` : ''}
      ${CLOUD && acct && !viewing ? `<div class="card" id="portalCard" data-client="${esc(c.id)}"><div class="card-head"><h3>Acceso del cliente</h3></div><p class="small muted" style="margin:0">Cargando…</p></div>` : ''}`;
  }

  // ---------------------------------------------------------------- enlace del cliente (lado del nutricionista)
  const portalUrl = (token) => `${location.origin}${location.pathname}#/p/${token}`;
  async function fillPortalCard() {
    const el = $('#portalCard'); if (!el) return;
    const c = clientById(el.dataset.client); if (!c) return;
    let link = null;
    try { link = await cloud.portalLink(acct.user.id, c.id); } catch (err) { el.querySelector('p').textContent = err.message; return; }
    if (!$('#portalCard')) return;
    const phone = (c.phone || '').replace(/[^\d]/g, '').replace(/^(?=[67]\d{8}$)/, '34');
    const first = c.name.split(' ')[0];
    const msg = (u) => encodeURIComponent(`Hola ${first} 👋 Aquí tienes tu plan de NutriLab: ${u}\nGuárdalo en la pantalla de inicio del móvil para tenerlo siempre a mano.`);
    el.innerHTML = link ? `<div class="card-head"><h3>Acceso del cliente</h3><span class="pill green">Activo</span></div>
        <p class="small muted" style="margin:0 0 10px">${esc(first)} ve su dieta, su progreso y su próxima revisión con este enlace privado, sin registrarse.${link.last_viewed_at ? ` Última visita: ${esc(new Date(link.last_viewed_at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }))}.` : ' Aún no lo ha abierto.'}</p>
        <div class="row">${phone ? `<a class="btn primary grow" href="https://wa.me/${phone}?text=${msg(portalUrl(link.token))}" target="_blank" rel="noopener">${ICON.wa}Enviar por WhatsApp</a>` : ''}
          <button class="btn grow" data-act="portal-copy" data-token="${esc(link.token)}">${ICON.copy}Copiar enlace</button>
          <button class="btn danger" data-act="portal-revoke" data-id="${esc(c.id)}">Anular</button></div>`
      : `<div class="card-head"><h3>Acceso del cliente</h3><span class="pill mute">Sin enlace</span></div>
        <p class="small muted" style="margin:0 0 10px">Crea un enlace privado para que ${esc(first)} vea su dieta y su progreso desde el móvil, sin registrarse. Puedes anularlo cuando quieras.</p>
        <button class="btn primary block" data-act="portal-create" data-id="${esc(c.id)}">Crear enlace para ${esc(first)}</button>`;
  }

  // ---------------------------------------------------------------- vista del cliente
  const PORTAL_LAST = 'nutrilab-portal-last';
  async function openPortal(token) {
    portal = { token, data: null, day: 0, error: '' };
    try { portal.data = JSON.parse(localStorage.getItem('nutrilab-portal:' + token) || 'null'); } catch { /* no-op */ }
    render();
    try {
      if (!cloud) { cloud = await import('./cloud.js'); cloud.init(CFG); }
      portal.data = await cloud.portalView(token);
      portal.error = '';
      try { localStorage.setItem('nutrilab-portal:' + token, JSON.stringify(portal.data)); localStorage.setItem(PORTAL_LAST, token); } catch { /* no-op */ }
    } catch (err) {
      portal.error = err.message;
      if (/no es válido/.test(err.message)) { localStorage.removeItem('nutrilab-portal:' + token); localStorage.removeItem(PORTAL_LAST); portal.data = null; }
    }
    render();
  }

  function renderPortal() {
    document.body.classList.add('gated');
    $$('.fab').forEach((f) => f.remove());
    const d = portal.data;
    const head = `<section class="hero gate-hero"><div class="who"><img src="icons/icon.svg" alt="" width="50" height="50"><div><div class="brand">Nutri<span>Lab</span></div><div class="by">Tu plan de alimentación</div></div></div>
      ${d ? `<div class="hello">Hola, <b>${esc((d.client.name || '').split(' ')[0])}</b> 👋${d.nutritionist?.name ? `<br><span style="opacity:.85;font-size:14px">Plan preparado por ${esc(d.nutritionist.name)}</span>` : ''}</div>` : ''}<span class="leaf">${ICON.leaf}</span></section>`;
    if (!d) {
      $('#view').innerHTML = head + (portal.error
        ? `<div class="empty"><div class="art">${ICON.plate}</div><h3>No se puede abrir</h3><p>${esc(portal.error)}</p><button class="btn" data-act="portal-exit">Ir a NutriLab</button></div>`
        : `<div class="ai-progress"><div class="spinner"></div><b>Cargando tu plan…</b></div>`);
      return;
    }
    const plan = d.plan, ms = (d.measures || []).filter((m) => has(m.weight)).map((m) => ({ date: m.date, v: num(m.weight) }));
    const last = ms[ms.length - 1], first = ms[0];
    portal.day = Math.min(portal.day, (plan?.days?.length || 1) - 1);
    const day = plan?.days?.[portal.day];
    $('#view').innerHTML = head + `
      ${portal.error ? `<div class="note warn">${esc(portal.error)} Mostramos la última versión guardada.</div>` : ''}
      <div class="stats two">
        <div class="stat"><div class="l">Próxima cita</div><div class="v" style="font-size:17px">${d.client.nextReview ? esc(relDay(d.client.nextReview)) : '—'}</div><div class="s">${d.client.nextReview ? esc(fmtDate(d.client.nextReview, true)) + (d.client.reviewTime ? ' · ' + esc(d.client.reviewTime) : '') : 'tu nutricionista te avisará'}</div>${d.client.nextReview >= today() ? `<button class="btn sm cal-btn" data-act="portal-cal">${ICON.calendar}A mi calendario</button>` : ''}</div>
        <div class="stat"><div class="l">Tu peso</div><div class="v num">${last ? fmt(last.v) + ' kg' : '—'}</div><div class="s ${first && last && last.v !== first.v ? trendCls({ goal: d.client.goal }, last.v - first.v) : ''}">${first && last && ms.length > 1 ? `${last.v - first.v > 0 ? '+' : ''}${fmt(last.v - first.v)} kg desde el inicio` : ''}</div></div>
      </div>
      ${plan ? `
        <div class="section-title"><span>${esc(plan.name)}</span><button class="btn sm" data-act="portal-print">${ICON.print}PDF</button></div>
        ${plan.days.length > 1 ? `<div class="day-tabs">${plan.days.map((x, i) => `<button class="chip ${i === portal.day ? 'on' : ''}" data-pday="${i}">${esc(x.name)}</button>`).join('')}</div>` : ''}
        ${plan.notes ? `<div class="note">${esc(plan.notes)}</div>` : ''}
        ${(day?.meals || []).filter((m) => m.items.length).map((m) => `<section class="meal">
          <div class="meal-head"><div class="name">${esc(m.name)}${m.time ? ` <span class="t">· ${esc(m.time)}</span>` : ''}</div><span class="k num">${fmt(mealMacros(m).kcal, 0)} kcal</span></div>
          ${m.items.map((it) => `<div class="item"><div class="body"><div class="t">${esc(it.name)}</div>${it.household ? `<div class="s">${esc(it.household)}</div>` : ''}</div><b class="num">${fmt(num(it.grams), 0)} g</b></div>`).join('')}
          ${m.recipe ? `<div class="recipe">${esc(m.recipe)}</div>` : ''}</section>`).join('')}
        ${d.client.allergies ? `<p class="small muted">Tu plan tiene en cuenta: ${esc(d.client.allergies)}.</p>` : ''}`
      : `<div class="empty"><div class="art">${ICON.plate}</div><h3>Tu plan está en preparación</h3><p>Tu nutricionista aún no ha publicado tu dieta. Vuelve a abrir este enlace más tarde.</p></div>`}
      ${ms.length > 1 ? `<div class="card"><h3>Tu progreso</h3>${lineChart(ms, { target: num(d.client.targetWeight), unit: 'kg' })}</div>` : ''}
      <div class="card"><h3>Tenlo siempre a mano</h3><p class="small muted" style="margin:0"><b>iPhone:</b> Safari → Compartir → «Añadir a pantalla de inicio».<br><b>Android:</b> Chrome → ⋮ → «Añadir a pantalla de inicio».</p>
        ${d.nutritionist?.email ? `<a class="btn block" style="margin-top:12px" href="mailto:${esc(d.nutritionist.email)}">${ICON.mail}Escribir a ${esc((d.nutritionist.name || 'tu nutricionista').split(' ')[0])}</a>` : ''}</div>
      <p class="small muted" style="text-align:center">NutriLab · by Javier Carbonell<br><a href="#" data-act="portal-exit">¿Eres nutricionista? Entra aquí</a></p>`;
  }

  // Gráfica de línea simple (SVG) con línea de objetivo opcional.
  function lineChart(series, { target = 0, unit = '' } = {}) {
    const W = 340, H = 160, L = 34, R = 10, T = 12, B = 24;
    const vals = series.map((p) => p.v).concat(target ? [target] : []);
    let min = Math.min(...vals), max = Math.max(...vals);
    const padV = (max - min) * 0.15 || 1; min -= padV; max += padV;
    const t0 = new Date(series[0].date).getTime(), t1 = new Date(series[series.length - 1].date).getTime() || t0 + 1;
    const x = (d) => L + ((new Date(d).getTime() - t0) / (t1 - t0 || 1)) * (W - L - R);
    const y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);
    const path = series.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)} ${y(p.v).toFixed(1)}`).join('');
    const ticks = [min + padV, (min + max) / 2, max - padV];
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución">
      <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--brand)" stop-opacity=".25"/><stop offset="1" stop-color="var(--brand)" stop-opacity="0"/></linearGradient></defs>
      ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(v) + 4}" font-size="10" fill="var(--muted)" text-anchor="end">${fmt(v)}</text>`).join('')}
      ${target ? `<line x1="${L}" x2="${W - R}" y1="${y(target)}" y2="${y(target)}" stroke="var(--accent)" stroke-dasharray="5 4" stroke-width="1.5"/><text x="${W - R}" y="${y(target) - 5}" font-size="10" fill="var(--accent)" text-anchor="end">objetivo ${fmt(target)} ${unit}</text>` : ''}
      <path d="${path}L${x(series[series.length - 1].date)} ${H - B}L${L} ${H - B}Z" fill="url(#lg)"/>
      <path d="${path}" fill="none" stroke="var(--brand)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${series.map((p) => `<circle cx="${x(p.date)}" cy="${y(p.v)}" r="3.5" fill="var(--surface)" stroke="var(--brand)" stroke-width="2"><title>${fmtDate(p.date)}: ${fmt(p.v)} ${unit}</title></circle>`).join('')}
      <text x="${L}" y="${H - 6}" font-size="10" fill="var(--muted)">${fmtDate(series[0].date)}</text>
      <text x="${W - R}" y="${H - 6}" font-size="10" fill="var(--muted)" text-anchor="end">${fmtDate(series[series.length - 1].date)}</text>
    </svg>`;
  }

  // ---------------------------------------------------------------- progreso
  function renderProgress(c) {
    const ms = measuresOf(c.id);
    if (!ms.length) return `<div class="empty"><div class="art">${ICON.chart}</div><h3>Sin mediciones</h3><p>Registra peso, perímetros, % de grasa y fotos en cada revisión.</p><button class="btn primary" data-act="new-measure" data-id="${c.id}">${ICON.plus}Añadir medición</button></div>`;
    const avail = Object.keys(METRICS).filter((k) => metricSeries(c.id, k).length);
    if (!avail.includes(ui.metric)) ui.metric = avail[0] || 'weight';
    const s = metricSeries(c.id, ui.metric), [label, unit] = METRICS[ui.metric];
    const first = s[0], last = s[s.length - 1];
    const withPhotos = ms.filter((m) => (m.photos || []).length);
    return `
      <button class="btn primary block" data-act="new-measure" data-id="${c.id}" style="margin-bottom:14px">${ICON.plus}Añadir medición</button>
      <div class="chips">${avail.map((k) => `<button class="chip ${ui.metric === k ? 'on' : ''}" data-metric="${k}">${METRICS[k][0]}</button>`).join('')}</div>
      <div class="card">
        <div class="card-head"><h3>${label}</h3>${s.length > 1 ? `<span class="pill ${ui.metric === 'weight' ? (trendCls(c, last.v - first.v) === 'pos' ? 'green' : 'red') : 'mute'} num">${last.v - first.v > 0 ? '+' : ''}${fmt(last.v - first.v)} ${unit}</span>` : ''}</div>
        ${s.length > 1 ? lineChart(s, { target: ui.metric === 'weight' ? num(c.targetWeight) : 0, unit }) : `<p class="small muted">Con dos mediciones verás la gráfica.</p>`}
        <div class="stats" style="margin:10px 0 0">
          <div class="stat"><div class="l">Inicio</div><div class="v num">${first ? fmt(first.v) : '—'}</div><div class="s">${first ? esc(fmtDate(first.date)) : ''}</div></div>
          <div class="stat"><div class="l">Actual</div><div class="v num">${last ? fmt(last.v) : '—'}</div><div class="s">${last ? esc(fmtDate(last.date)) : ''}</div></div>
          <div class="stat"><div class="l">Semanas</div><div class="v num">${first && last ? fmt(daysBetween(first.date, last.date) / 7, 0) : '—'}</div><div class="s">${s.length} registros</div></div>
        </div>
      </div>
      ${withPhotos.length ? `<div class="card"><div class="card-head"><h3>Fotos: antes y ahora</h3><span class="small muted">${withPhotos.length} revisiones con fotos</span></div>
        <div class="photos"><figure><img data-photo="${withPhotos[0].photos[0].id}" alt="Antes"><figcaption>${esc(fmtDate(withPhotos[0].date))}</figcaption></figure>
        ${withPhotos.length > 1 ? `<figure><img data-photo="${withPhotos[withPhotos.length - 1].photos[0].id}" alt="Ahora"><figcaption>${esc(fmtDate(withPhotos[withPhotos.length - 1].date))}</figcaption></figure>` : ''}</div></div>` : ''}
      <div class="card"><h3>Historial</h3>
        <table class="t"><thead><tr><th>Fecha</th><th class="r">Peso</th><th class="r">% grasa</th><th class="r">Cintura</th><th></th></tr></thead><tbody>
        ${ms.slice().reverse().map((m) => `<tr data-measure="${m.id}"><td>${esc(fmtDate(m.date))}</td><td class="r">${has(m.weight) ? fmt(num(m.weight)) : '—'}</td><td class="r">${has(m.fat) ? fmt(num(m.fat)) : '—'}</td><td class="r">${has(m.waist) ? fmt(num(m.waist)) : '—'}</td><td class="r">${(m.photos || []).length ? '📷' : ''}${m.notes ? '📝' : ''}</td></tr>`).join('')}
        </tbody></table></div>`;
  }

  let sheetUrls = [];
  function measureSheet(clientId, id) {
    const c = clientById(clientId);
    const m = id ? S.measures.find((x) => x.id === id) : { date: today(), photos: [] };
    let photos = [...(m.photos || [])];
    const field = (k) => `<label class="f"><span>${METRICS[k][0]} (${METRICS[k][1]})</span><input name="${k}" inputmode="decimal" value="${esc(m[k] ?? '')}"></label>`;
    sheet(id ? 'Editar medición' : `Medición · ${c.name}`, `
      <form id="measForm">
        <div class="grid2"><label class="f"><span>Fecha</span><input name="date" type="date" required value="${esc(m.date)}"></label>${field('weight')}</div>
        <div class="grid3">${field('fat')}${field('waist')}${field('hip')}${field('chest')}${field('arm')}${field('thigh')}</div>
        <label class="f"><span>Notas de la revisión</span><textarea name="notes" rows="2" placeholder="Sensaciones, adherencia, entrenamiento…">${esc(m.notes)}</textarea></label>
        <div class="form-sec">Fotos de progreso</div>
        <div class="attach-list" id="photoList"></div>
        <label class="attach-zone">${ICON.camera}<span>Añadir fotos</span><input type="file" id="photoInput" accept="image/*" multiple hidden></label>
        ${!id ? `<label class="f"><span>Próxima revisión</span><select name="next">${opt([['', 'No cambiar'], [addDays(today(), 7), 'En 1 semana'], [addDays(today(), 14), 'En 2 semanas'], [addDays(today(), 21), 'En 3 semanas'], [addDays(today(), 28), 'En 4 semanas']], c.nextReview && c.nextReview > today() ? '' : addDays(today(), 14))}</select></label>` : ''}
        <button class="btn primary block" type="submit">${ICON.check}Guardar medición</button>
      </form>
      ${id ? `<button class="btn danger block" id="delMeas" style="margin-top:10px">${ICON.trash}Eliminar medición</button>` : ''}`);
    const draw = async () => {
      const box = $('#photoList'); if (!box) return;
      box.innerHTML = photos.map((p) => `<div class="att" data-att="${p.id}"><button type="button" class="x" data-rm="${p.id}" aria-label="Quitar">×</button></div>`).join('');
      box.style.display = photos.length ? '' : 'none';
      for (const p of photos) { const u = await photoUrl(p); const el = box.querySelector(`[data-att="${p.id}"]`); if (u && el) el.insertAdjacentHTML('afterbegin', `<img src="${u}" alt="">`); }
    };
    draw();
    $('#photoList').onclick = (e) => {
      const rm = e.target.closest('[data-rm]');
      if (rm) { photos = photos.filter((p) => p.id !== rm.dataset.rm); draw(); return; }
      const a = e.target.closest('[data-att]'); if (a) viewPhoto(photos.find((p) => p.id === a.dataset.att));
    };
    $('#photoInput').onchange = async (e) => {
      const files = [...e.target.files]; e.target.value = '';
      for (const f of files) { try { photos.push(await Files.add(f, uid())); } catch (err) { toast(err.message); } }
      draw(); haptic();
    };
    $('#measForm').onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const next = f.next; delete f.next;
      const removed = (m.photos || []).filter((p) => !photos.some((x) => x.id === p.id));
      Object.assign(f, { photos });
      if (id) Object.assign(m, f); else S.measures.push({ id: uid(), clientId, ...f });
      if (next) c.nextReview = next;
      removed.forEach(dropPhoto);
      save(); closeSheet(); render(); haptic(); toast('Medición guardada');
    };
    $('#delMeas')?.addEventListener('click', () => {
      if (!confirm('¿Eliminar esta medición y sus fotos?')) return;
      (m.photos || []).forEach(dropPhoto);
      S.measures = S.measures.filter((x) => x.id !== id);
      save(); closeSheet(); render();
    });
  }

  async function photoUrl(meta) {
    let rec = await Files.get(meta.id).catch(() => null);
    if (!rec && meta.up && syncOn()) rec = await downloadFile(meta).catch(() => null);
    if (!rec) return '';
    const u = URL.createObjectURL(rec.blob); sheetUrls.push(u); return u;
  }
  function dropPhoto(meta) {
    Files.del(meta.id).catch(() => {});
    if (meta.up && syncOn()) { sync.delFiles = [...(sync.delFiles || []), meta.id]; saveSync(); }
  }
  async function viewPhoto(meta) {
    if (!meta) return;
    const u = await photoUrl(meta);
    if (!u) { toast('La foto está en otro dispositivo. Activa la sincronización para verla aquí.'); return; }
    const layer = document.createElement('div');
    layer.className = 'sheet-bg'; layer.style.zIndex = 50;
    layer.innerHTML = `<div class="sheet viewer"><div class="sheet-head"><h2>Foto</h2><button class="icon-btn" data-x aria-label="Cerrar">${ICON.close}</button></div><img src="${u}" alt=""></div>`;
    layer.addEventListener('click', (e) => { if (e.target === layer || e.target.closest('[data-x]')) layer.remove(); });
    document.body.appendChild(layer);
  }

  // ---------------------------------------------------------------- ficha
  function renderFicha(c) {
    const row = (l, v) => v ? `<tr><th style="width:42%">${l}</th><td>${esc(v)}</td></tr>` : '';
    const act = ACTIVITY.find((a) => a.v === num(c.activity));
    return `
      <div class="card"><div class="card-head"><h3>Datos</h3><button class="btn sm" data-act="edit-client" data-id="${c.id}">${ICON.edit}Editar</button></div>
        <table class="t"><tbody>
          ${row('Fecha de nacimiento', c.birth && `${fmtDate(c.birth)} (${ageOf(c.birth)} años)`)}${row('Altura', c.height && c.height + ' cm')}
          ${row('Actividad', act && `${act.l} · ${act.d}`)}${row('Objetivo', (GOALS[c.goal] || GOALS.mantener).l)}${row('Peso objetivo', c.targetWeight && c.targetWeight + ' kg')}
          ${row('Comidas al día', c.mealsPerDay)}${row('Alergias / intolerancias', c.allergies)}${row('No le gusta', c.dislikes)}${row('Preferencias', c.preferences)}
          ${row('Teléfono', c.phone)}${row('Email', c.email)}${row('Cliente desde', c.startDate && fmtDate(c.startDate))}${row('Estado', STATUS[c.status || 'activo'])}
          ${row('Kcal fijadas a mano', has(c.kcal) && c.kcal + ' kcal')}${row('Proteína', has(c.pKg) && c.pKg + ' g/kg')}${row('Grasa', has(c.fatPct) && c.fatPct + ' % de las kcal')}
        </tbody></table></div>
      ${c.notes ? `<div class="card"><h3>Notas</h3><p style="margin:0;white-space:pre-wrap">${esc(c.notes)}</p></div>` : ''}
      <button class="btn danger block" data-act="del-client" data-id="${c.id}">${ICON.trash}Eliminar cliente</button>`;
  }

  function clientSheet(id) {
    const c = id ? clientById(id) : { sex: '', activity: 1.55, goal: 'perder', mealsPerDay: 5, status: 'activo', startDate: today() };
    const fld = (n, l, extra = '', ph = '') => `<label class="f"><span>${l}</span><input name="${n}" value="${esc(c[n] ?? '')}" placeholder="${ph}" ${extra}></label>`;
    sheet(id ? 'Editar cliente' : 'Nuevo cliente', `
      <form id="clientForm">
        ${fld('name', 'Nombre y apellidos', 'required autocomplete="off"')}
        <div class="grid2">
          <label class="f"><span>Sexo</span><select name="sex">${opt([['', '—'], ['M', 'Mujer'], ['H', 'Hombre']], c.sex)}</select></label>
          ${fld('birth', 'Fecha de nacimiento', 'type="date"')}
          ${fld('height', 'Altura (cm)', 'inputmode="decimal"', '170')}
          ${id ? fld('targetWeight', 'Peso objetivo (kg)', 'inputmode="decimal"') : `<label class="f"><span>Peso actual (kg)</span><input name="weight0" inputmode="decimal" placeholder="70"></label>`}
        </div>
        ${id ? '' : fld('targetWeight', 'Peso objetivo (kg)', 'inputmode="decimal"')}
        <label class="f"><span>Actividad física</span><select name="activity">${opt(ACTIVITY.map((a) => [a.v, `${a.l} · ${a.d}`]), c.activity)}</select></label>
        <div class="grid2">
          <label class="f"><span>Objetivo</span><select name="goal">${opt(Object.entries(GOALS).map(([k, g]) => [k, g.l]), c.goal)}</select></label>
          <label class="f"><span>Comidas al día</span><select name="mealsPerDay">${opt([3, 4, 5, 6].map((n) => [n, n]), c.mealsPerDay)}</select></label>
        </div>
        <div class="form-sec">Alimentación</div>
        ${fld('allergies', 'Alergias / intolerancias', '', 'Lactosa, frutos secos…')}
        ${fld('dislikes', 'Alimentos que no le gustan')}
        <label class="f"><span>Preferencias y estilo de vida</span><textarea name="preferences" rows="2" placeholder="Horarios, entreno, cocina poco, come fuera…">${esc(c.preferences)}</textarea></label>
        <div class="form-sec">Contacto y seguimiento</div>
        <div class="grid2">${fld('phone', 'Teléfono', 'type="tel" inputmode="tel"')}${fld('email', 'Email', 'type="email"')}
          ${fld('nextReview', 'Próxima cita', 'type="date"')}${fld('reviewTime', 'Hora de la cita', 'type="time" step="300"')}<label class="f"><span>Estado</span><select name="status">${opt(Object.entries(STATUS), c.status || 'activo')}</select></label></div>
        <div class="form-sec">Ajustes de cálculo (opcional)</div>
        <div class="grid3">${fld('kcal', 'Kcal fijas', 'inputmode="decimal"', 'auto')}${fld('pKg', 'Proteína g/kg', 'inputmode="decimal"', 'auto')}${fld('fatPct', 'Grasa % kcal', 'inputmode="decimal"', '25')}</div>
        <label class="f"><span>Notas</span><textarea name="notes" rows="3">${esc(c.notes)}</textarea></label>
        <button class="btn primary block" type="submit">${ICON.check}Guardar</button>
      </form>`);
    $('#clientForm').onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const w0 = f.weight0; delete f.weight0;
      if (id) { Object.assign(c, f); save(); closeSheet(); render(); toast('Ficha guardada'); return; }
      const nc = { id: uid(), createdAt: Date.now(), startDate: today(), ...f };
      S.clients.push(nc);
      if (has(w0)) S.measures.push({ id: uid(), clientId: nc.id, date: today(), weight: w0, photos: [] });
      save(); closeSheet(); haptic(); toast('Cliente creado'); go(`#/c/${nc.id}`);
    };
  }

  // ================================================================ DIETAS
  function renderClientPlans(c) {
    const ps = plansOf(c.id), t = targets(c);
    return `
      <div class="row nowrap" style="margin-bottom:14px">
        <button class="btn ai grow" data-act="ai-plan" data-id="${c.id}">${ICON.ai}Crear con IA</button>
        <button class="btn grow" data-act="new-plan" data-id="${c.id}">${ICON.plus}Dieta manual</button>
      </div>
      ${t.kcal ? `<p class="small muted" style="margin:-4px 4px 14px">Objetivo: <b>${fmt(t.kcal, 0)} kcal</b> · P ${fmt(t.p, 0)} g · H ${fmt(t.c, 0)} g · G ${fmt(t.f, 0)} g</p>` : ''}
      ${ps.length ? ps.map((p) => {
        const a = planAvg(p), diff = t.kcal ? ((a.kcal - t.kcal) / t.kcal) * 100 : null;
        return `<div class="client-card" data-nav="#/d/${p.id}"><div class="ico${p.source === 'ia' ? ' ai' : ''}">${p.source === 'ia' ? ICON.ai : ICON.plate}</div>
          <div class="body"><div class="name">${esc(p.name)}</div>
            <div class="meta">${p.active ? '<span class="pill green">Activa</span>' : ''}<span>${p.days.length} día${p.days.length === 1 ? '' : 's'}</span><span>· ${fmt(a.kcal, 0)} kcal/día</span>${diff != null && Math.abs(diff) > 5 ? `<span class="pill amber">${diff > 0 ? '+' : ''}${fmt(diff, 0)}%</span>` : ''}</div></div>
          <span class="small muted">${esc(fmtDate(new Date(p.createdAt || Date.now()).toISOString().slice(0, 10)))}</span></div>`;
      }).join('') : `<div class="empty"><div class="art">${ICON.plate}</div><h3>Sin dietas</h3><p>Crea su primera dieta a mano con la base de alimentos o deja que la IA la prepare con sus datos y la revisas.</p></div>`}`;
  }

  function newPlan(clientId, data = {}) {
    const c = clientById(clientId);
    const n = num(c.mealsPerDay) || 5;
    const names = n === 3 ? ['Desayuno', 'Comida', 'Cena'] : n === 4 ? ['Desayuno', 'Comida', 'Merienda', 'Cena'] : n === 6 ? MEAL_NAMES : MEAL_NAMES.slice(0, 5);
    const times = { Desayuno: '08:00', 'Media mañana': '11:00', Comida: '14:00', Merienda: '17:30', Cena: '21:00', Recena: '23:00' };
    const p = {
      id: uid(), clientId, createdAt: Date.now(), source: 'manual', active: !plansOf(clientId).length,
      name: `Dieta ${fmtDate(today())}`, notes: '',
      days: [{ name: 'Día tipo', meals: names.map((name) => ({ name, time: times[name], recipe: '', items: [] })) }],
      ...data,
    };
    S.plans.push(p);
    return p;
  }

  function renderPlan(p) {
    const c = clientById(p.clientId), t = c ? targets(c) : {};
    if (ui.planId !== p.id) { ui.planId = p.id; ui.day = 0; }
    ui.day = Math.min(ui.day, p.days.length - 1);
    const d = p.days[ui.day], tot = dayMacros(d);
    const cell = (k, l) => `<div><div class="l">${l}</div><div class="v num">${fmt(tot[k], 0)}${t.kcal ? `<small>/${fmt(t[k], 0)}</small>` : ''}</div><div class="bar ${k}${t.kcal && tot[k] > t[k] * 1.08 ? ' over' : ''}"><i style="width:${t.kcal ? Math.min(100, (tot[k] / t[k]) * 100) : 0}%"></i></div></div>`;
    return `
      <div class="row nowrap" style="margin-bottom:12px">
        ${p.source === 'ia' ? `<span class="pill blue">${ICON.ai.replace('<svg', '<svg width="13" height="13"')}IA</span>` : ''}${p.active ? '<span class="pill green">Activa</span>' : ''}
        <span class="grow"></span>
        <button class="btn sm" data-act="print-plan" data-id="${p.id}">${ICON.print}PDF</button>
        <button class="btn sm" data-act="share-plan" data-id="${p.id}">${ICON.share}Enviar</button>
        <button class="btn icon" data-act="plan-menu" data-id="${p.id}" aria-label="Más">${ICON.more}</button>
      </div>
      <div class="day-tabs">${p.days.map((x, i) => `<button class="chip ${i === ui.day ? 'on' : ''}" data-day="${i}">${esc(x.name)}</button>`).join('')}<button class="chip" data-act="add-day" data-id="${p.id}">${ICON.plus.replace('<svg', '<svg width="14" height="14" style="vertical-align:-2px"')} Día</button></div>
      <div class="totals"><div class="grid">
        <div><div class="l">Kcal del día</div><div class="v num" style="font-size:20px">${fmt(tot.kcal, 0)}${t.kcal ? `<small> / ${fmt(t.kcal, 0)}</small>` : ''}</div><div class="bar${t.kcal && tot.kcal > t.kcal * 1.05 ? ' over' : ''}"><i style="width:${t.kcal ? Math.min(100, (tot.kcal / t.kcal) * 100) : 0}%"></i></div></div>
        ${cell('p', 'Proteína')}${cell('c', 'Hidratos')}${cell('f', 'Grasa')}
      </div></div>
      ${p.notes ? `<div class="note">${esc(p.notes)}</div>` : ''}
      ${d.meals.map((m, mi) => {
        const mm = mealMacros(m);
        return `<section class="meal">
          <div class="meal-head"><div class="name">${esc(m.name)}${m.time ? ` <span class="t">· ${esc(m.time)}</span>` : ''}</div><span class="k num">${fmt(mm.kcal, 0)} kcal</span>
            <button class="icon-btn plain" data-act="meal-menu" data-meal="${mi}" aria-label="Opciones de ${esc(m.name)}">${ICON.more}</button></div>
          ${m.items.map((it, ii) => { const x = itemMacros(it); return `<div class="item">
            <div class="body" data-item="${mi}:${ii}" style="cursor:pointer"><div class="t">${esc(it.name)}</div><div class="s num">${it.household ? esc(it.household) + ' · ' : ''}${fmt(x.kcal, 0)} kcal · P ${fmt(x.p)} · H ${fmt(x.c)} · G ${fmt(x.f)}</div></div>
            <input class="grams num" inputmode="decimal" value="${esc(it.grams)}" data-grams="${mi}:${ii}" aria-label="Gramos"><span class="small muted">g</span></div>`; }).join('')}
          ${m.recipe ? `<div class="recipe">${esc(m.recipe)}</div>` : ''}
          <div class="meal-foot"><button class="btn sm ghost" data-act="add-food" data-meal="${mi}">${ICON.plus}Añadir alimento</button></div>
        </section>`;
      }).join('')}
      <button class="btn block" data-act="add-meal" data-id="${p.id}">${ICON.plus}Añadir comida</button>`;
  }

  const curPlan = () => S.plans.find((x) => x.id === route().id);

  function foodPicker(onPick) {
    let q = '';
    sheet('Añadir alimento', `
      <div class="search-wrap">${ICON.search}<input class="search" id="pickSearch" type="search" placeholder="Buscar: pollo, arroz, yogur…" autocomplete="off"></div>
      <div id="pickList"></div>
      <button class="btn block" id="freeFood" style="margin-top:10px">${ICON.edit}Alimento libre (escribir valores)</button>`);
    const draw = () => {
      const qq = q.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
      const list = allFoods().filter((f) => !qq || f.name.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').includes(qq)).slice(0, 60);
      $('#pickList').innerHTML = list.map((f) => `<div class="list-item" data-pick="${f.id}"><div class="body"><div class="t">${esc(f.name)}${f.base ? '' : ' <span class="pill mute">mío</span>'}</div><div class="s num">${f.kcal} kcal · P ${f.p} · H ${f.c} · G ${f.f} <span class="muted">/100 g</span></div></div><span class="small muted">${f.portion || 100} g</span></div>`).join('') || '<p class="muted small">Sin resultados. Usa «Alimento libre» o añádelo en la pestaña Alimentos.</p>';
    };
    draw();
    setTimeout(() => $('#pickSearch')?.focus(), 250);
    $('#pickSearch').oninput = (e) => { q = e.target.value; draw(); };
    $('#pickList').onclick = (e) => {
      const el = e.target.closest('[data-pick]'); if (!el) return;
      const f = idx().food.get(el.dataset.pick);
      const g = prompt(`Gramos de ${f.name}`, f.portion || 100);
      if (g == null) return;
      onPick({ name: f.name, foodId: f.id, grams: num(g) || f.portion || 100, household: '', per100: { kcal: f.kcal, p: f.p, c: f.c, f: f.f } });
    };
    $('#freeFood').onclick = () => itemSheet(null, onPick);
  }

  function itemSheet(item, onSave, onDelete) {
    const it = item || { name: '', grams: 100, household: '', per100: { kcal: '', p: '', c: '', f: '' } };
    sheet(item ? 'Editar alimento' : 'Alimento libre', `
      <form id="itemForm">
        <label class="f"><span>Alimento</span><input name="name" required value="${esc(it.name)}"></label>
        <div class="grid2"><label class="f"><span>Cantidad (g)</span><input name="grams" inputmode="decimal" required value="${esc(it.grams)}"></label>
          <label class="f"><span>Medida casera</span><input name="household" value="${esc(it.household)}" placeholder="1 taza, 2 rebanadas…"></label></div>
        <div class="form-sec">Valores por 100 g</div>
        <div class="grid2"><label class="f"><span>Kcal</span><input name="kcal" inputmode="decimal" required value="${esc(it.per100.kcal)}"></label>
          <label class="f"><span>Proteínas (g)</span><input name="p" inputmode="decimal" value="${esc(it.per100.p)}"></label>
          <label class="f"><span>Hidratos (g)</span><input name="c" inputmode="decimal" value="${esc(it.per100.c)}"></label>
          <label class="f"><span>Grasas (g)</span><input name="f" inputmode="decimal" value="${esc(it.per100.f)}"></label></div>
        <button class="btn primary block" type="submit">${ICON.check}Guardar</button>
      </form>
      ${item ? `<div class="row nowrap" style="margin-top:10px"><button class="btn grow" id="swapItem">Cambiar alimento</button><button class="btn danger grow" id="delItem">${ICON.trash}Quitar</button></div>` : ''}`);
    $('#itemForm').onsubmit = (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      onSave({ ...it, name: f.name, grams: num(f.grams), household: f.household, per100: { kcal: num(f.kcal), p: num(f.p), c: num(f.c), f: num(f.f) } });
    };
    $('#delItem')?.addEventListener('click', onDelete);
    $('#swapItem')?.addEventListener('click', () => foodPicker((n) => onSave({ ...n, grams: n.grams })));
  }

  function planMenu(p) {
    sheet(p.name, `<div class="menu">
      <button class="btn" data-m="rename">${ICON.edit}Nombre y notas</button>
      <button class="btn" data-m="ai">${ICON.ai}Pedir cambios a la IA</button>
      ${p.active ? '' : `<button class="btn" data-m="active">${ICON.star}Marcar como dieta activa</button>`}
      <button class="btn" data-m="dupday">${ICON.copy}Duplicar «${esc(p.days[ui.day].name)}»</button>
      <button class="btn" data-m="renday">${ICON.calendar}Renombrar día</button>
      ${p.days.length > 1 ? `<button class="btn" data-m="delday">${ICON.trash}Eliminar «${esc(p.days[ui.day].name)}»</button>` : ''}
      <button class="btn" data-m="dup">${ICON.copy}Duplicar dieta</button>
      <button class="btn danger" data-m="del">${ICON.trash}Eliminar dieta</button></div>`);
    $$('.sheet [data-m]').forEach((b) => (b.onclick = () => {
      const m = b.dataset.m;
      if (m === 'rename') {
        sheet('Nombre y notas', `<form id="pf"><label class="f"><span>Nombre</span><input name="name" required value="${esc(p.name)}"></label>
          <label class="f"><span>Notas para el cliente</span><textarea name="notes" rows="5" placeholder="Agua, cocinado, sustituciones…">${esc(p.notes)}</textarea></label>
          <button class="btn primary block">${ICON.check}Guardar</button></form>`);
        $('#pf').onsubmit = (e) => { e.preventDefault(); Object.assign(p, Object.fromEntries(new FormData(e.target))); save(); closeSheet(); render(); };
        return;
      }
      if (m === 'ai') return aiReviseSheet(p);
      if (m === 'active') { plansOf(p.clientId).forEach((x) => { x.active = x.id === p.id; }); save(); closeSheet(); render(); toast('Dieta activa'); return; }
      if (m === 'dupday') { const nd = structuredClone(p.days[ui.day]); nd.name += ' (copia)'; p.days.splice(ui.day + 1, 0, nd); ui.day++; save(); closeSheet(); render(); return; }
      if (m === 'renday') { const n = prompt('Nombre del día', p.days[ui.day].name); if (n) { p.days[ui.day].name = n; save(); } closeSheet(); render(); return; }
      if (m === 'delday') { if (!confirm(`¿Eliminar «${p.days[ui.day].name}»?`)) return; p.days.splice(ui.day, 1); ui.day = Math.max(0, ui.day - 1); save(); closeSheet(); render(); return; }
      if (m === 'dup') { const np = newPlan(p.clientId, { ...structuredClone(p), id: uid(), name: p.name + ' (copia)', active: false, createdAt: Date.now() }); save(); closeSheet(); go(`#/d/${np.id}`); return; }
      if (m === 'del') { if (!confirm('¿Eliminar esta dieta?')) return; S.plans = S.plans.filter((x) => x.id !== p.id); save(); closeSheet(); go(`#/c/${p.clientId}/dietas`); }
    }));
  }

  function mealMenu(p, mi) {
    const m = p.days[ui.day].meals[mi];
    sheet(m.name, `<form id="mf">
      <div class="grid2"><label class="f"><span>Nombre</span><input name="name" list="mealNames" required value="${esc(m.name)}"></label>
        <label class="f"><span>Hora</span><input name="time" type="time" value="${esc(m.time)}"></label></div>
      <datalist id="mealNames">${MEAL_NAMES.map((n) => `<option value="${n}">`).join('')}</datalist>
      <label class="f"><span>Preparación / receta</span><textarea name="recipe" rows="3">${esc(m.recipe)}</textarea></label>
      <button class="btn primary block">${ICON.check}Guardar</button></form>
      <button class="btn danger block" id="delMeal" style="margin-top:10px">${ICON.trash}Eliminar comida</button>`);
    $('#mf').onsubmit = (e) => { e.preventDefault(); Object.assign(m, Object.fromEntries(new FormData(e.target))); save(); closeSheet(); render(); };
    $('#delMeal').onclick = () => { if (!confirm(`¿Eliminar ${m.name}?`)) return; p.days[ui.day].meals.splice(mi, 1); save(); closeSheet(); render(); };
  }

  // ---------------------------------------------------------------- PDF y envío
  function planText(p) {
    const c = clientById(p.clientId);
    const lines = [`🥗 ${p.name}${c ? ' · ' + c.name : ''}`, 'NutriLab · by Javier Carbonell', ''];
    for (const d of p.days) {
      if (p.days.length > 1) lines.push(`📅 ${d.name.toUpperCase()}`);
      for (const m of d.meals) {
        if (!m.items.length) continue;
        lines.push(`*${m.name}*${m.time ? ' (' + m.time + ')' : ''}`);
        for (const it of m.items) lines.push(`• ${it.name}: ${fmt(num(it.grams), 0)} g${it.household ? ' (' + it.household + ')' : ''}`);
        if (m.recipe) lines.push(`  ${m.recipe}`);
      }
      lines.push(`≈ ${fmt(dayMacros(d).kcal, 0)} kcal`, '');
    }
    if (p.notes) lines.push('📝 ' + p.notes);
    return lines.join('\n');
  }

  function printPlan(p, client, tgt) {
    const c = client || clientById(p.clientId), t = tgt || (c && !client ? targets(c) : {});
    const row = (cells, cls = '') => `<tr class="${cls}">${cells.map((x, i) => `<td class="${i ? 'r' : ''}">${x}</td>`).join('')}</tr>`;
    $('#print').innerHTML = `
      <div class="ph"><img src="icons/icon.svg" alt=""><div><div class="b">Nutri<span style="color:#65a30d">Lab</span></div><div>by Javier Carbonell</div></div>
        <div class="c"><b>${esc(c?.name || '')}</b><br>${esc(p.name)}<br>${esc(fmtDate(today(), true))}</div></div>
      ${t.kcal ? `<div class="notes">Objetivo diario: <b>${fmt(t.kcal, 0)} kcal</b> · proteínas ${fmt(t.p, 0)} g · hidratos ${fmt(t.c, 0)} g · grasas ${fmt(t.f, 0)} g</div>` : ''}
      ${p.notes ? `<div class="notes">${esc(p.notes)}</div>` : ''}
      ${p.days.map((d) => `<div class="day">${p.days.length > 1 ? `<h2>${esc(d.name)}</h2>` : ''}
        ${d.meals.filter((m) => m.items.length).map((m) => { const mm = mealMacros(m); return `<h3>${esc(m.name)}${m.time ? ` · ${esc(m.time)}` : ''}</h3>
          <table><thead><tr><th>Alimento</th><th class="r">Cantidad</th><th class="r">kcal</th><th class="r">P</th><th class="r">H</th><th class="r">G</th></tr></thead><tbody>
          ${m.items.map((it) => { const x = itemMacros(it); return row([esc(it.name) + (it.household ? ` <span style="color:#777">(${esc(it.household)})</span>` : ''), fmt(num(it.grams), 0) + ' g', fmt(x.kcal, 0), fmt(x.p, 0), fmt(x.c, 0), fmt(x.f, 0)]); }).join('')}
          ${row(['Total', '', fmt(mm.kcal, 0), fmt(mm.p, 0), fmt(mm.c, 0), fmt(mm.f, 0)], 'tot')}</tbody></table>
          ${m.recipe ? `<p style="font-size:10pt;color:#555;margin:4px 0 0"><i>${esc(m.recipe)}</i></p>` : ''}`; }).join('')}
        <p style="text-align:right;font-weight:700">Total del día: ${fmt(dayMacros(d).kcal, 0)} kcal</p></div>`).join('')}
      <div class="foot">NutriLab by Javier Carbonell · Plan personalizado. Consulta cualquier duda antes de hacer cambios.</div>`;
    setTimeout(() => window.print(), 50);
  }

  async function sharePlan(p) {
    const text = planText(p), c = clientById(p.clientId);
    const phone = (c?.phone || '').replace(/[^\d]/g, '').replace(/^(?=[67]\d{8}$)/, '34');
    sheet('Enviar dieta', `<div class="menu">
      ${phone ? `<a class="btn" href="https://wa.me/${phone}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${ICON.wa}WhatsApp a ${esc(c.name)}</a>` : ''}
      ${navigator.share ? `<button class="btn" id="nativeShare">${ICON.share}Compartir…</button>` : ''}
      <button class="btn" id="copyPlan">${ICON.copy}Copiar texto</button>
      <button class="btn" id="pdfPlan">${ICON.print}Guardar como PDF</button></div>
      <p class="small muted">Para enviar el PDF: «Guardar como PDF» y luego compártelo desde Archivos.</p>`);
    $('#nativeShare')?.addEventListener('click', () => navigator.share({ title: p.name, text }).catch(() => {}));
    $('#copyPlan').onclick = () => copyText(text, 'Dieta copiada');
    $('#pdfPlan').onclick = () => { closeSheet(); printPlan(p); };
  }

  // ---------------------------------------------------------------- IA
  let aiMod = null;
  const loadAi = async () => (aiMod ??= await import('./ai.js'));

  function needKey() {
    if (aiCfg.apiKey) return false;
    sheet('Configura la IA', `<div class="note ai">Para crear dietas con IA necesitas una <b>clave de API de Claude</b> (Anthropic). Se guarda solo en este dispositivo.</div>
      <ol class="steps"><li>Entra en <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>, crea una cuenta y añade saldo.</li><li>Crea una clave («Create key») y cópiala.</li><li>Pégala en Ajustes → Inteligencia artificial.</li></ol>
      <button class="btn primary block" data-nav="#/ajustes">Ir a Ajustes</button>`);
    return true;
  }

  function aiProgress(title, run) {
    const ctrl = new AbortController();
    sheet(title, `<div class="ai-progress"><div class="spinner"></div><b id="aiStatus">Preparando…</b>
      <p class="small muted" id="aiDetail">La IA está diseñando el plan con los datos del cliente. Suele tardar entre 30 segundos y 2 minutos.</p>
      <button class="btn" id="aiCancel">Cancelar</button></div>`);
    $('#aiCancel').onclick = () => ctrl.abort();
    const onProgress = (chars) => { const el = $('#aiStatus'); if (el) el.textContent = `Escribiendo el plan… ${fmt(chars / 1000, 1)}k caracteres`; };
    return run({ signal: ctrl.signal, onProgress }).finally(() => { if ($('#aiCancel')) closeSheet(); });
  }

  function aiPlanSheet(clientId) {
    if (needKey()) return;
    const c = clientById(clientId), t = targets(c);
    if (!t.kcal) { toast(`Completa la ficha: falta ${t.missing.join(', ')}`); return; }
    sheet('Crear dieta con IA', `
      <div class="note ai">${ICON.ai.replace('<svg', '<svg width="16" height="16" style="vertical-align:-3px"')} La IA usará la ficha de <b>${esc(c.name)}</b>: <b>${fmt(t.kcal, 0)} kcal</b> (P ${fmt(t.p, 0)} · H ${fmt(t.c, 0)} · G ${fmt(t.f, 0)} g), ${esc(c.mealsPerDay || 5)} comidas${c.allergies ? `, sin ${esc(c.allergies)}` : ''}. Revisa el resultado antes de entregarlo.</div>
      <form id="aiForm">
        <div class="grid2"><label class="f"><span>Días distintos</span><select name="days">${opt([[1, '1 · día tipo'], [3, '3 días'], [5, '5 días'], [7, '7 días (semana)']], 1)}</select></label>
          <label class="f"><span>Estilo</span><select name="style">${opt([['', 'Libre'], ...STYLES.map((s) => [s, s])], '')}</select></label></div>
        <label class="f"><span>Indicaciones (opcional)</span><textarea name="extra" rows="3" placeholder="Come en el trabajo de lunes a viernes, entrena por la tarde, quiere cenas rápidas…"></textarea></label>
        <button class="btn ai block" type="submit">${ICON.ai}Generar dieta</button>
      </form>`);
    $('#aiForm').onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try {
        const ai = await loadAi();
        const res = await aiProgress('Creando dieta…', (o) => ai.generateDiet({
          apiKey: aiCfg.apiKey, model: aiCfg.model || 'claude-opus-5-5', client: { ...c, goal: (GOALS[c.goal] || GOALS.mantener).l, activityLabel: ACTIVITY.find((a) => a.v === num(c.activity))?.l },
          targets: t, foods: allFoods(), days: num(f.days) || 1, style: f.style, extra: f.extra, ...o,
        }));
        const plan = ai.normalizePlan(res.plan, allFoods());
        const np = newPlan(clientId, { ...plan, source: 'ia', name: plan.name || 'Dieta IA' });
        save(); haptic(); toast('Dieta creada con IA ✓ Revísala'); go(`#/d/${np.id}`);
      } catch (err) { closeSheet(); toast(err.message); }
    };
  }

  function aiReviseSheet(p) {
    if (needKey()) return;
    const c = clientById(p.clientId), t = targets(c);
    sheet('Pedir cambios a la IA', `
      <form id="aiRev"><label class="f"><span>¿Qué quieres cambiar?</span><textarea name="request" rows="4" required placeholder="Quita el pescado de las cenas, sube la proteína del desayuno, añade un día más…"></textarea></label>
      <button class="btn ai block">${ICON.ai}Aplicar cambios</button></form>
      <p class="small muted">Se crea una copia nueva; la dieta actual no se toca.</p>`);
    $('#aiRev').onsubmit = async (e) => {
      e.preventDefault();
      const request = new FormData(e.target).get('request');
      const plain = { name: p.name, notes: p.notes, days: p.days.map((d) => ({ name: d.name, meals: d.meals.map((m) => ({ name: m.name, time: m.time, recipe: m.recipe, items: m.items.map((it) => { const x = itemMacros(it); return { food: it.name, grams: num(it.grams), household: it.household || '', kcal: Math.round(x.kcal), protein: Math.round(x.p), carbs: Math.round(x.c), fat: Math.round(x.f) }; }) })) })) };
      try {
        const ai = await loadAi();
        const res = await aiProgress('Aplicando cambios…', (o) => ai.reviseDiet({
          apiKey: aiCfg.apiKey, model: aiCfg.model || 'claude-opus-5-5', client: { ...c, goal: (GOALS[c.goal] || GOALS.mantener).l, activityLabel: ACTIVITY.find((a) => a.v === num(c.activity))?.l },
          targets: t, foods: allFoods(), plan: plain, request, ...o,
        }));
        const plan = ai.normalizePlan(res.plan, allFoods());
        const np = newPlan(p.clientId, { ...plan, source: 'ia', active: false, name: plan.name || p.name + ' (IA)' });
        save(); toast('Nueva versión creada ✓'); go(`#/d/${np.id}`);
      } catch (err) { closeSheet(); toast(err.message); }
    };
  }

  // ================================================================ ALIMENTOS
  function renderFoods() {
    const cats = ['Todas', 'Mis alimentos', ...new Set(FOODS.map((f) => f.cat))];
    return `
      <div class="search-wrap">${ICON.search}<input class="search" id="foodSearch" type="search" placeholder="Buscar alimento…" value="${esc(ui.foodQuery)}" autocomplete="off"></div>
      <div class="chips">${cats.map((c) => `<button class="chip ${ui.foodCat === c ? 'on' : ''}" data-fcat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
      <div class="card" id="foodList" style="padding:4px 14px">${foodList()}</div>
      <p class="small muted" style="text-align:center">Valores aproximados por 100 g. Puedes añadir tus propios alimentos y productos.</p>`;
  }
  function foodList() {
    const q = ui.foodQuery.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    const list = allFoods().filter((f) => (ui.foodCat === 'Todas' || (ui.foodCat === 'Mis alimentos' ? !f.base : f.cat === ui.foodCat)) && (!q || f.name.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').includes(q)));
    return list.map((f) => `<div class="list-item" ${f.base ? '' : `data-food="${f.id}"`}><div class="body"><div class="t">${esc(f.name)}</div><div class="s">${esc(f.cat || 'Mis alimentos')}</div></div>
      <div class="end small num"><b>${f.kcal}</b> kcal<div class="muted">P ${f.p} · H ${f.c} · G ${f.f}</div></div></div>`).join('') || '<p class="muted small">Sin resultados.</p>';
  }
  function foodSheet(id) {
    const f = id ? S.foods.find((x) => x.id === id) : { cat: 'Mis alimentos', portion: 100 };
    sheet(id ? 'Editar alimento' : 'Nuevo alimento', `
      <form id="foodForm"><label class="f"><span>Nombre</span><input name="name" required value="${esc(f.name)}" placeholder="Pan proteico Mercadona"></label>
        <div class="form-sec">Por 100 g</div>
        <div class="grid2"><label class="f"><span>Kcal</span><input name="kcal" inputmode="decimal" required value="${esc(f.kcal)}"></label>
          <label class="f"><span>Proteínas (g)</span><input name="p" inputmode="decimal" required value="${esc(f.p)}"></label>
          <label class="f"><span>Hidratos (g)</span><input name="c" inputmode="decimal" required value="${esc(f.c)}"></label>
          <label class="f"><span>Grasas (g)</span><input name="f" inputmode="decimal" required value="${esc(f.f)}"></label>
          <label class="f"><span>Ración habitual (g)</span><input name="portion" inputmode="decimal" value="${esc(f.portion)}"></label></div>
        <button class="btn primary block">${ICON.check}Guardar</button></form>
      ${id ? `<button class="btn danger block" id="delFood" style="margin-top:10px">${ICON.trash}Eliminar</button>` : ''}`);
    $('#foodForm').onsubmit = (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(e.target));
      const data = { name: v.name, cat: 'Mis alimentos', kcal: num(v.kcal), p: num(v.p), c: num(v.c), f: num(v.f), portion: num(v.portion) || 100 };
      if (id) Object.assign(f, data); else S.foods.push({ id: 'u' + uid(), ...data });
      save(); closeSheet(); render(); toast('Alimento guardado');
    };
    $('#delFood')?.addEventListener('click', () => { S.foods = S.foods.filter((x) => x.id !== id); save(); closeSheet(); render(); });
  }

  // ================================================================ AJUSTES
  function renderSettings() {
    return `
      ${CLOUD ? accountCard() : `<div class="card"><h3>☁ Sincronización (PC, móvil, tablet…)</h3>
        ${syncOn() ? `
          <p class="small"><span class="pill ${sync.error ? 'red' : 'green'}">${sync.error ? '⚠ ' + esc(sync.error) : '✓ Activada'}</span>${sync.last ? ` <span class="muted">· ${new Date(sync.last).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</span>` : ''}</p>
          <p class="small muted">Clientes, mediciones, fotos y dietas se suben cifrados a tu GitHub y llegan a tus otros dispositivos al abrir la app.</p>
          <div class="row"><button class="btn primary grow" data-act="sync-now">Sincronizar ahora</button><button class="btn grow" data-act="sync-off">Desconectar</button></div>` : `
          <p class="small muted">Hazlo una vez en cada dispositivo con el <b>mismo token</b> y la <b>misma contraseña</b>:</p>
          <ol class="steps"><li><a href="https://github.com/settings/tokens/new?scopes=gist&description=NutriLab" target="_blank" rel="noopener">Crea un token de GitHub</a> (permiso <b>gist</b> ya marcado, «No expiration»).</li><li>Pégalo aquí y elige una contraseña.</li></ol>
          <label class="f"><span>Token de GitHub</span><input id="syncToken" type="password" autocomplete="off" placeholder="ghp_…"></label>
          <label class="f"><span>Contraseña de sincronización</span><input id="syncPass" type="password" autocomplete="new-password" placeholder="Mínimo 6 caracteres"></label>
          <button class="btn primary block" data-act="sync-on">Activar sincronización</button>`}
      </div>`}

      <div class="card"><h3>${ICON.ai.replace('<svg', '<svg width="17" height="17" style="vertical-align:-3px"')} Inteligencia artificial</h3>
        <p class="small muted">Crea y modifica dietas con Claude (Anthropic). Necesitas una clave de API propia; cada dieta cuesta unos céntimos. La clave se guarda solo en este dispositivo.</p>
        <label class="f"><span>Clave de API</span><input id="aiKey" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(aiCfg.apiKey)}"></label>
        <label class="f"><span>Modelo</span><select id="aiModel">${opt([['claude-opus-5-5', 'Claude Opus 5.5 (recomendado)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (más rápido)'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (más económico)']], aiCfg.model || 'claude-opus-5-5')}</select></label>
        <div class="row"><button class="btn primary grow" data-act="ai-save">Guardar</button><a class="btn grow" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Conseguir clave</a></div>
      </div>


      <div class="card"><h3>Copia por archivo</h3>
        <p class="small muted">Sin nube: envía un archivo cifrado (WhatsApp, AirDrop, correo…) y ábrelo en el otro dispositivo con «Recibir». Se combina con lo que haya.</p>
        <label class="f"><span>Contraseña del archivo</span><input type="password" id="sharePass" autocomplete="new-password" placeholder="Mínimo 4 caracteres"></label>
        <div class="row nowrap"><button class="btn primary grow" data-act="share">${ICON.share}Compartir datos</button><label class="btn grow">Recibir datos<input type="file" id="restore" hidden></label></div>
      </div>

      <div class="card"><h3>Apariencia</h3>
        <div class="seg" style="margin:0">${[['auto', 'Automática'], ['light', 'Clara'], ['dark', 'Oscura']].map(([k, l]) => `<button class="${(S.settings.theme || 'auto') === k ? 'on' : ''}" data-settheme="${k}">${l}</button>`).join('')}</div>
      </div>

      <div class="card"><h3>Instalar la app</h3>
        <p class="small muted" style="margin:0"><b>iPhone:</b> Safari → Compartir → «Añadir a pantalla de inicio».<br><b>Android:</b> Chrome → ⋮ → «Instalar aplicación».<br><b>PC:</b> Chrome / Edge → icono de instalar en la barra de direcciones.</p>
        <p class="small muted" id="storageInfo" style="margin:10px 0 0">${S.clients.length} clientes · ${S.measures.length} mediciones · ${S.plans.length} dietas</p>
      </div>
      ${CLOUD ? '' : `<button class="btn danger block" data-act="wipe">${ICON.trash}Borrar todos los datos de este dispositivo</button>`}
      <p class="small muted" style="text-align:center;margin-top:18px">Nutri<b style="color:var(--brand-2)">Lab</b> · by Javier Carbonell</p>`;
  }

  // ================================================================ cifrado y compartir
  function b64(buf) { const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
  function unb64(str) { const bin = atob(str), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  const keyCache = new Map();
  let lastSalt = null;
  async function deriveKey(pass, salt) {
    const ck = pass + '|' + b64(salt);
    if (!keyCache.has(ck)) {
      const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
      keyCache.set(ck, await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
    }
    return keyCache.get(ck);
  }
  async function encryptBytes(bytes, pass) {
    const salt = lastSalt?.pass === pass ? lastSalt.salt : crypto.getRandomValues(new Uint8Array(16));
    lastSalt = { pass, salt };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(pass, salt), bytes);
    return { enc: 'AES-GCM', salt: b64(salt), iv: b64(iv), data: b64(ct) };
  }
  async function decryptBytes(p, pass) {
    const salt = unb64(p.salt);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(p.iv) }, await deriveKey(pass, salt), unb64(p.data));
    lastSalt = { pass, salt };
    return new Uint8Array(pt);
  }
  const encryptData = async (obj, pass) => ({ app: 'javinutricion', format: 1, ...(await encryptBytes(new TextEncoder().encode(JSON.stringify(obj)), pass)) });
  const decryptData = async (p, pass) => JSON.parse(new TextDecoder().decode(await decryptBytes(p, pass)));
  const shareable = () => { const { lastSync: _l, ...d } = S; return d; };
  const allPhotos = () => S.measures.flatMap((m) => m.photos || []);

  async function shareData() {
    const pass = $('#sharePass')?.value || '';
    if (pass && pass.length < 4) { toast('La contraseña debe tener al menos 4 caracteres'); return; }
    if (!pass && !confirm('Sin contraseña, el archivo lleva los datos de tus clientes legibles. ¿Compartir igualmente?')) return;
    toast('Preparando archivo…');
    const data = shareable();
    data.files = {};
    for (const ph of allPhotos()) { const rec = await Files.get(ph.id).catch(() => null); if (rec) data.files[ph.id] = { name: rec.name, type: rec.type, data: b64(await rec.blob.arrayBuffer()) }; }
    const payload = pass ? await encryptData(data, pass) : { app: 'javinutricion', format: 1, data };
    const name = `nutrilab-${today()}.json`;
    const file = new File([JSON.stringify(payload)], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Datos NutriLab' }); return; } catch (err) { if (err.name === 'AbortError') return; } }
    download(name, file);
  }
  async function receiveData(file) {
    let p;
    try { p = JSON.parse(await file.text()); } catch { toast('Archivo no válido'); return; }
    let d = p;
    if (p.enc) { const pass = prompt('Contraseña del archivo'); if (!pass) return; try { d = await decryptData(p, pass); } catch { toast('Contraseña incorrecta'); return; } } else if (p.app === 'javinutricion') d = p.data;
    if (!Array.isArray(d?.clients)) { toast('Archivo no válido'); return; }
    for (const [id, f] of Object.entries(d.files || {})) await Files.put(id, new Blob([unb64(f.data)], { type: f.type }), f.name, f.type);
    delete d.files;
    const r = mergeData(migrate({ ...blank(), ...d }));
    render(); toast(`Combinado: ${r.added} nuevo(s), ${r.updated} actualizado(s), ${r.removed} borrado(s)`);
  }
  function mergeData(remote) {
    const stamp = (x) => x.updatedAt || x.createdAt || 0;
    const deleted = { ...S.deleted };
    for (const [id, t] of Object.entries(remote.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, t);
    const isDel = (x) => deleted[x.id] && deleted[x.id] >= stamp(x);
    const r = { added: 0, updated: 0, removed: 0 };
    for (const k of LISTS) {
      const map = new Map(S[k].map((x) => [x.id, x]));
      for (const x of remote[k] || []) {
        const l = map.get(x.id);
        if (!l) { map.set(x.id, x); if (!isDel(x)) r.added++; } else if (stamp(x) > stamp(l)) { map.set(x.id, x); if (sig(x) !== sig(l)) r.updated++; }
      }
      r.removed += S[k].filter(isDel).length;
      S[k] = [...map.values()].filter((x) => !isDel(x));
    }
    S.deleted = deleted; S.lastSync = Date.now();
    snapshot(); persist();
    return r;
  }

  // ================================================================ sincronización (gist secreto cifrado)
  let SYNC_KEY = 'javinutricion-sync';
  const GIST_DESC = 'javinutricion-sync', GIST_FILE = 'javinutricion.json', FILES_DESC = 'javinutricion-files';
  let sync = (() => { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch { return {}; } })();
  let syncing = false, syncAgain = false, syncTimer = null;
  const saveSync = () => { try { localStorage.setItem(SYNC_KEY, JSON.stringify(sync)); } catch { /* no-op */ } };
  const syncOn = () => (CLOUD ? !!acct : !!(sync.token && sync.pass));
  const stateSig = (d) => JSON.stringify([LISTS.map((k) => (d[k] || []).map(sig).sort()), Object.keys(d.deleted || {}).sort()]);
  function scheduleSync() { if (!syncOn()) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(), 1500); }

  async function ghFetch(path, opts = {}, extra = {}) {
    const res = await fetch('https://api.github.com' + path, { ...opts, cache: 'no-store', headers: { Authorization: `Bearer ${sync.token}`, Accept: 'application/vnd.github+json', ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...extra } });
    if (res.status === 304) return res;
    if (res.status === 401) throw new Error('El token de GitHub no es válido');
    if (res.status === 403 || res.status === 404) throw new Error('El token no tiene permiso de gists');
    if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);
    return res;
  }
  const gh = async (path, opts) => { const r = await ghFetch(path, opts); return r.status === 204 ? null : r.json(); };
  async function findGist(desc, file) {
    for (let page = 1; page <= 5; page++) {
      const list = await gh(`/gists?per_page=100&page=${page}`);
      const g = list.find((x) => x.description === desc && (!file || x.files?.[file]));
      if (g) return g.id;
      if (list.length < 100) break;
    }
    return null;
  }
  async function syncNow(manual = false) {
    if (CLOUD) return cloudSync(manual);
    if (!syncOn()) return;
    if (syncing) { syncAgain = true; return; }
    if (!navigator.onLine) { sync.error = 'Sin conexión'; saveSync(); syncBadge(); return; }
    syncing = true; syncBadge();
    try {
      if (!sync.gistId) { sync.gistId = await findGist(GIST_DESC, GIST_FILE); sync.etag = ''; }
      let remote = null, unchanged = false;
      if (sync.gistId) {
        const res = await ghFetch(`/gists/${sync.gistId}`, {}, sync.etag ? { 'If-None-Match': sync.etag } : {});
        if (res.status === 304) unchanged = true;
        else {
          const g = await res.json();
          sync.etag = res.headers.get('ETag') || '';
          const f = g.files?.[GIST_FILE];
          const content = f?.truncated ? await (await fetch(f.raw_url)).text() : f?.content;
          if (content) { try { remote = await decryptData(JSON.parse(content), sync.pass); } catch { sync.etag = ''; throw new Error('La contraseña de sincronización no coincide'); } }
        }
      }
      let changed = false;
      if (remote) { const before = stateSig(S); mergeData(migrate({ ...blank(), ...remote })); changed = stateSig(S) !== before; }
      const mine = stateSig(S);
      if (unchanged ? mine !== sync.sig : !remote || stateSig(remote) !== mine) {
        const body = { description: GIST_DESC, files: { [GIST_FILE]: { content: JSON.stringify(await encryptData(shareable(), sync.pass)) } } };
        if (sync.gistId) await gh(`/gists/${sync.gistId}`, { method: 'PATCH', body: JSON.stringify(body) });
        else sync.gistId = (await gh('/gists', { method: 'POST', body: JSON.stringify({ ...body, public: false }) })).id;
        sync.etag = '';
      }
      sync.sig = mine;
      await syncFiles();
      sync.last = Date.now(); sync.error = ''; saveSync();
      if (changed || route().view === 'settings') render();
      if (manual) toast('Sincronizado ✓');
    } catch (err) {
      sync.error = err.message; saveSync();
      if (manual) toast(err.message);
    } finally {
      syncing = false; syncBadge();
      if (syncAgain) { syncAgain = false; syncNow(); }
    }
  }
  async function syncFiles() {
    const pending = allPhotos().filter((p) => !p.up);
    const dels = sync.delFiles || [];
    if (!pending.length && !dels.length) return;
    if (!sync.filesId) sync.filesId = await findGist(FILES_DESC);
    let flagged = false;
    for (const ph of pending) {
      const rec = await Files.get(ph.id).catch(() => null);
      if (!rec) continue;
      const files = { [`f-${ph.id}.json`]: { content: JSON.stringify({ name: rec.name, type: rec.type, ...(await encryptBytes(new Uint8Array(await rec.blob.arrayBuffer()), sync.pass)) }) } };
      if (sync.filesId) await gh(`/gists/${sync.filesId}`, { method: 'PATCH', body: JSON.stringify({ files }) });
      else sync.filesId = (await gh('/gists', { method: 'POST', body: JSON.stringify({ description: FILES_DESC, public: false, files }) })).id;
      ph.up = true; flagged = true; saveSync();
    }
    if (dels.length && sync.filesId) {
      try { await gh(`/gists/${sync.filesId}`, { method: 'PATCH', body: JSON.stringify({ files: Object.fromEntries(dels.map((id) => [`f-${id}.json`, null])) }) }); } catch { /* ya no existían */ }
      sync.delFiles = [];
    }
    if (flagged) save();
  }
  async function downloadFile(meta) {
    if (CLOUD && viewing) {
      const blob = await cloud.downloadPhoto(viewing.owner, meta.id); // sin guardar copia en este dispositivo
      return { blob, name: meta.name, type: meta.type };
    }
    if (CLOUD) {
      const blob = await cloud.downloadPhoto(acct.user.id, meta.id);
      await Files.put(meta.id, blob, meta.name, meta.type);
      return { blob, name: meta.name, type: meta.type };
    }
    if (!sync.filesId) sync.filesId = await findGist(FILES_DESC);
    if (!sync.filesId) throw new Error('No se encontró la foto en la nube');
    const g = await gh(`/gists/${sync.filesId}`);
    const f = g.files?.[`f-${meta.id}.json`];
    if (!f) throw new Error('La foto aún no se ha subido desde el otro dispositivo');
    const p = JSON.parse(f.truncated ? await (await fetch(f.raw_url)).text() : f.content);
    const blob = new Blob([await decryptBytes(p, sync.pass)], { type: p.type });
    await Files.put(meta.id, blob, p.name, p.type);
    return { blob, name: p.name, type: p.type };
  }
  function syncBadge() {
    const el = $('#headerActions'); if (!el) return;
    if (!syncOn()) { el.innerHTML = ''; return; }
    const [cls, label] = syncing ? ['busy', 'Sincronizando'] : sync.error ? ['err', 'Error'] : ['', 'Sincronizado'];
    el.innerHTML = `<button class="sync-chip ${cls}" data-act="sync-now" title="${esc(sync.error || label)}"><i></i>${label}</button>`;
  }
  async function enableSync() {
    const token = $('#syncToken').value.trim(), pass = $('#syncPass').value;
    if (!token || pass.length < 6) { toast('Pega el token y una contraseña de al menos 6 caracteres'); return; }
    sync = { token, pass }; saveSync(); toast('Conectando…');
    await syncNow(true);
    if (sync.error) { sync = {}; saveSync(); syncBadge(); render(); }
  }

  // ================================================================ nube: cuenta, suscripción y sincronización
  const daysLeft = (iso) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 864e5));
  const canWrite = () => !!acct && cloud.hasAccess(acct.profile);

  function useAccount(user) {
    KEY = `${BASE_KEY}:${user.id}`;
    SYNC_KEY = `javinutricion-sync:${user.id}`;
    S = load(); snapshot(); ver++;
    sync = (() => { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch { return {}; } })();
  }

  async function refreshProfile() {
    try { acct.profile = await cloud.profile(acct.user.id); sync.profile = acct.profile; saveSync(); } catch { acct.profile = sync.profile || acct.profile; }
    return acct.profile;
  }

  async function enter(user) {
    if (acct?.user.id === user.id) return;
    acct = { user, profile: null };
    useAccount(user);
    acct.profile = sync.profile || null;
    gate = recovering ? 'newpass' : acct.profile ? (cloud.hasAccess(acct.profile) ? null : 'paywall') : 'loading';
    render();
    await refreshProfile();
    gate = recovering ? 'newpass' : cloud.hasAccess(acct.profile) ? null : 'paywall';
    render(); syncBadge();
    await cloudSync();
    if (!recovering) offerLegacyImport();
  }

  // Datos guardados en este dispositivo antes de tener cuenta: se ofrecen una vez para subirlos a la cuenta.
  function offerLegacyImport() {
    let legacy = null;
    try { legacy = JSON.parse(localStorage.getItem(BASE_KEY) || 'null'); } catch { /* no-op */ }
    if (!legacy?.clients?.length || sync.legacyAsked) return;
    sync.legacyAsked = true; saveSync();
    if (!confirm(`Hay ${legacy.clients.length} cliente(s) guardados en este dispositivo de antes de crear tu cuenta. ¿Añadirlos a tu cuenta?`)) return;
    mergeData(migrate({ ...blank(), ...legacy }));
    localStorage.removeItem(BASE_KEY);
    render(); scheduleSync(); toast('Datos añadidos a tu cuenta');
  }

  async function cloudSync(manual = false) {
    if (!acct || viewing) return;
    if (syncing) { syncAgain = true; return; }
    if (!navigator.onLine) { sync.error = 'Sin conexión'; saveSync(); syncBadge(); return; }
    syncing = true; syncBadge();
    try {
      const uid = acct.user.id;
      let changed = false;
      const stamp = await cloud.stamp(uid);
      let remoteSig = null;
      if (stamp && stamp !== sync.cloudStamp) {
        const row = await cloud.pull(uid);
        const remote = migrate({ ...blank(), ...(row?.data || {}) });
        remoteSig = stateSig(remote);
        const before = stateSig(S); mergeData(remote); changed = stateSig(S) !== before;
        sync.cloudStamp = row?.updated_at || stamp;
      }
      const mine = stateSig(S);
      const dirty = remoteSig != null ? remoteSig !== mine : !stamp || mine !== sync.cloudSig;
      if (dirty && canWrite()) { sync.cloudStamp = await cloud.push(uid, shareable()); }
      if (!dirty || canWrite()) sync.cloudSig = mine;
      if (canWrite()) await cloudFiles(uid);
      sync.last = Date.now(); sync.error = canWrite() || !dirty ? '' : 'Suscripción inactiva: cambios solo en este dispositivo'; saveSync();
      if (changed || route().view === 'settings') render();
      if (manual) toast(sync.error || 'Sincronizado ✓');
    } catch (err) {
      sync.error = err.message; saveSync();
      if (manual) toast(err.message);
    } finally {
      syncing = false; syncBadge();
      if (syncAgain) { syncAgain = false; cloudSync(); }
    }
  }

  async function cloudFiles(uid) {
    let flagged = false;
    for (const ph of allPhotos().filter((p) => !p.up)) {
      const rec = await Files.get(ph.id).catch(() => null);
      if (!rec) continue; // está en otro dispositivo: se subirá desde allí
      await cloud.uploadPhoto(uid, ph.id, rec.blob, rec.type);
      ph.up = true; flagged = true;
    }
    if (sync.delFiles?.length) { await cloud.removePhotos(uid, sync.delFiles).catch(() => {}); sync.delFiles = []; }
    if (flagged) save();
  }

  async function goPay(fn) {
    toast('Abriendo la página segura de Stripe…');
    try { const { url } = await cloud.callFunction(fn); location.href = url; } catch (err) { toast(err.message); }
  }

  // Al volver de Stripe: esperar a que llegue el aviso del pago y activar la cuenta.
  async function afterPayment() {
    toast('¡Gracias! Activando tu suscripción…');
    for (let i = 0; i < 10; i++) {
      await refreshProfile();
      if (['active', 'trialing'].includes(acct.profile?.subscription_status)) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    gate = cloud.hasAccess(acct.profile) ? null : 'paywall';
    render();
    toast(['active', 'trialing'].includes(acct.profile?.subscription_status) ? 'Suscripción activa ✓' : 'Aún no hemos recibido el pago. Pulsa «Ya he pagado» en un momento.');
    if (canWrite()) cloudSync();
  }

  async function logout() {
    if (viewing) { S = viewing.prev; viewing = null; ver++; snapshot(); }
    if (!confirm('¿Cerrar sesión? Tus datos siguen guardados en tu cuenta y se borrarán de este dispositivo.')) return;
    await cloudSync().catch(() => {});
    if (sync.error && canWrite() && !confirm(`No se pudieron guardar los últimos cambios (${sync.error}). ¿Cerrar sesión igualmente?`)) return;
    await cloud.signOut().catch(() => {});
    localStorage.removeItem(KEY); localStorage.removeItem(SYNC_KEY);
    Files.gc([]).catch(() => {});
    acct = null; KEY = BASE_KEY; SYNC_KEY = 'javinutricion-sync'; sync = {}; S = blank(); snapshot(); ver++;
    gate = 'auth'; ui.authMode = 'login'; render(); syncBadge();
  }

  function accountCard() {
    const p = acct?.profile || {};
    const st = p.subscription_status;
    let pill = '', info = '';
    if (p.is_admin) {
      return `<div class="card"><div class="card-head"><h3>Tu cuenta</h3><span class="pill green">Administrador · gratis</span></div>
        <p style="margin:0 0 4px;font-weight:700">${esc(p.full_name || acct?.user.email || '')}</p>
        <p class="small muted" style="margin:0 0 12px">${esc(acct?.user.email || '')} · Acceso completo sin suscripción.</p>
        <div class="row nowrap"><button class="btn primary grow" data-nav="#/admin">Panel de administración</button><button class="btn" data-act="logout">Cerrar sesión</button></div>
        <p class="small muted" style="margin:12px 0 0">☁ ${sync.error ? '⚠ ' + esc(sync.error) : 'Tus datos se guardan en tu cuenta y en todos tus dispositivos.'}</p></div>`;
    }
    if (st === 'active' || st === 'trialing') {
      pill = p.cancel_at_period_end ? '<span class="pill amber">Se cancela</span>' : '<span class="pill green">Suscripción activa</span>';
      info = p.current_period_end ? `${p.cancel_at_period_end ? 'Acceso hasta' : 'Se renueva el'} ${esc(fmtDate(p.current_period_end.slice(0, 10), true))}` : '';
    } else if (st === 'past_due') { pill = '<span class="pill red">Pago pendiente</span>'; info = 'Actualiza tu tarjeta para no perder el acceso.'; }
    else if (cloud.hasAccess(p)) { pill = '<span class="pill blue">Prueba gratis</span>'; info = `Te quedan ${daysLeft(p.trial_ends_at)} días de prueba.`; }
    else { pill = '<span class="pill red">Sin suscripción</span>'; info = 'Suscríbete para seguir trabajando.'; }
    const paying = ['active', 'trialing', 'past_due'].includes(st);
    return `<div class="card"><div class="card-head"><h3>Tu cuenta</h3>${pill}</div>
      <p style="margin:0 0 4px;font-weight:700">${esc(p.full_name || acct?.user.email || '')}</p>
      <p class="small muted" style="margin:0 0 12px">${esc(acct?.user.email || '')}${info ? ' · ' + info : ''}</p>
      <div class="row nowrap">
        ${paying ? `<button class="btn grow" data-act="billing">Gestionar suscripción</button>` : `<button class="btn primary grow" data-act="checkout">Suscribirme · ${esc(CFG.price || '')}</button>`}
        <button class="btn" data-act="logout">Cerrar sesión</button>
      </div>
      <p class="small muted" style="margin:12px 0 0">☁ ${sync.error ? '⚠ ' + esc(sync.error) : 'Tus clientes, mediciones, fotos y dietas se guardan en tu cuenta y en todos tus dispositivos.'}${sync.last ? ` · ${new Date(sync.last).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}` : ''}</p>
      <div id="accessLog"></div>
    </div>`;
  }

  // ---------------------------------------------------------------- administración
  const isAdmin = () => !!acct?.profile?.is_admin;
  let adminRows = null;

  function subState(r) {
    if (r.is_admin) return ['Administrador', 'green'];
    if (['active', 'trialing'].includes(r.subscription_status)) return [r.cancel_at_period_end ? 'Se cancela' : 'Activa', r.cancel_at_period_end ? 'amber' : 'green'];
    if (r.subscription_status === 'past_due') return ['Impago', 'red'];
    if (Date.parse(r.trial_ends_at) > Date.now()) return [`Prueba · ${daysLeft(r.trial_ends_at)} días`, 'blue'];
    return ['Sin suscripción', 'mute'];
  }

  function renderAdmin() {
    if (!adminRows) {
      cloud.adminList().then((rows) => { adminRows = rows; if (route().view === 'admin') render(); }).catch((err) => toast(err.message));
      return `<div class="ai-progress"><div class="spinner"></div><b>Cargando…</b></div>`;
    }
    const others = adminRows.filter((r) => !r.is_admin);
    const paying = others.filter((r) => ['active', 'trialing'].includes(r.subscription_status));
    const trial = others.filter((r) => !['active', 'trialing', 'past_due'].includes(r.subscription_status) && Date.parse(r.trial_ends_at) > Date.now());
    const due = others.filter((r) => r.subscription_status === 'past_due');
    const mrr = paying.filter((r) => !r.cancel_at_period_end).length * (num(CFG.priceAmount) || 0);
    return `
      <div class="stats two">
        <div class="stat"><div class="l">Suscriptores activos</div><div class="v num">${paying.length}</div><div class="s">${others.length} registrado${others.length === 1 ? '' : 's'}</div></div>
        <div class="stat"><div class="l">Ingresos al mes</div><div class="v num">${mrr ? fmt(mrr, 2) + ' €' : '—'}</div><div class="s">estimado, antes de comisiones</div></div>
        <div class="stat"><div class="l">En prueba</div><div class="v num">${trial.length}</div></div>
        <div class="stat"><div class="l">Impagos</div><div class="v num ${due.length ? 'neg' : ''}">${due.length}</div></div>
      </div>
      <div class="row between" style="margin:0 4px 10px"><span class="section-title" style="margin:0">Nutricionistas</span><button class="btn sm ghost" data-act="admin-reload">Actualizar</button></div>
      ${others.length ? others.map((r) => { const [label, cls] = subState(r); return `
        <div class="client-card" data-adminrow="${esc(r.id)}">${avatar({ name: r.full_name || r.email })}
          <div class="body"><div class="name">${esc(r.full_name || r.email)}</div>
            <div class="meta"><span class="pill ${cls}">${esc(label)}</span><span>${r.clients} cliente${r.clients === 1 ? '' : 's'}</span><span>· desde ${esc(fmtDate(String(r.created_at).slice(0, 10)))}</span></div></div></div>`; }).join('')
        : `<div class="empty"><div class="art">${ICON.users}</div><h3>Aún no hay nutricionistas</h3><p>Cuando alguien se registre aparecerá aquí.</p></div>`}
      <p class="small muted" style="text-align:center">Los cobros, facturas y reembolsos se gestionan en el panel de Stripe.</p>`;
  }

  function adminSheet(id) {
    const r = adminRows.find((x) => x.id === id);
    const [label, cls] = subState(r);
    sheet(r.full_name || r.email, `
      <div class="row" style="margin-bottom:12px"><span class="pill ${cls}">${esc(label)}</span></div>
      <table class="t"><tbody>
        <tr><th>Email</th><td>${esc(r.email)}</td></tr>
        <tr><th>Registro</th><td>${esc(fmtDate(String(r.created_at).slice(0, 10), true))}</td></tr>
        ${r.current_period_end ? `<tr><th>${r.cancel_at_period_end ? 'Acceso hasta' : 'Renueva'}</th><td>${esc(fmtDate(String(r.current_period_end).slice(0, 10), true))}</td></tr>` : ''}
        <tr><th>Clientes</th><td>${r.clients}</td></tr><tr><th>Dietas</th><td>${r.plans}</td></tr>
        <tr><th>Última actividad</th><td>${r.data_updated_at ? esc(new Date(r.data_updated_at).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })) : '—'}</td></tr>
      </tbody></table>
      <div class="menu" style="margin-top:14px">
        <a class="btn" href="mailto:${esc(r.email)}">${ICON.mail}Escribirle un email</a>
        <button class="btn" id="viewData">${ICON.users}Ver sus datos (solo lectura)</button>
      </div>
      <p class="small muted">Son datos de salud de sus clientes: entra solo por un motivo justificado (soporte, incidencia). Cada acceso queda registrado y el nutricionista lo verá en su app.</p>`);
    $('#viewData').onclick = () => {
      sheet('Motivo del acceso', `<form id="whyForm"><label class="f"><span>¿Por qué necesitas ver sus datos?</span><textarea name="reason" rows="3" required minlength="5" placeholder="Soporte: me ha escrito porque no le aparecen sus dietas"></textarea></label>
        <button class="btn primary block">Ver en solo lectura</button></form>`);
      $('#whyForm').onsubmit = async (e) => {
        e.preventDefault();
        try {
          const data = await cloud.adminView(r.id, new FormData(e.target).get('reason'));
          viewing = { owner: r.id, name: r.full_name || r.email, prev: S };
          S = migrate({ ...blank(), ...data, settings: S.settings }); ver++;
          closeSheet(); go('#/'); toast(`Viendo los datos de ${viewing.name}`);
        } catch (err) { toast(err.message); }
      };
    };
  }

  function exitViewing() {
    S = viewing.prev; viewing = null; ver++; snapshot();
    go('#/admin'); toast('Has salido del modo solo lectura');
  }

  async function showAccessLog() {
    const el = $('#accessLog');
    if (!el || isAdmin()) return;
    const log = await cloud.accessLog(acct.user.id);
    if (log.length && $('#accessLog')) el.innerHTML = `<div class="form-sec">Accesos del soporte a tu cuenta</div>${log.map((l) => `<p class="small muted" style="margin:0 0 4px">${esc(new Date(l.at).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }))} · ${esc(l.reason)}</p>`).join('')}`;
  }

  // ---------------------------------------------------------------- pantallas previas: entrar, suscribirse
  const BRAND_HERO = `<section class="hero gate-hero"><div class="who"><img src="icons/icon.svg" alt="" width="50" height="50"><div><div class="brand">Nutri<span>Lab</span></div><div class="by">by Javier Carbonell</div></div></div>
    <div class="hello">La app para nutricionistas: clientes, dietas con IA y seguimiento del progreso.</div><span class="leaf">${ICON.leaf}</span></section>`;

  function renderGate() {
    document.body.classList.add('gated');
    $$('.fab').forEach((f) => f.remove());
    let html = BRAND_HERO;
    if (gate === 'loading') html += `<div class="ai-progress"><div class="spinner"></div><b>Cargando tu cuenta…</b></div>`;
    if (gate === 'auth') {
      const m = ui.authMode || 'login';
      html += `<div class="card">
        ${m === 'reset' ? `<h3>Recuperar contraseña</h3><p class="small muted">Te enviaremos un enlace para crear una nueva.</p>` : `<div class="seg"><button class="${m === 'login' ? 'on' : ''}" data-auth="login">Entrar</button><button class="${m === 'signup' ? 'on' : ''}" data-auth="signup">Crear cuenta</button></div>`}
        <form id="authForm">
          ${m === 'signup' ? `<label class="f"><span>Nombre y apellidos</span><input name="name" required autocomplete="name"></label>` : ''}
          <label class="f"><span>Email</span><input name="email" type="email" required autocomplete="email" inputmode="email"></label>
          ${m !== 'reset' ? `<label class="f"><span>Contraseña</span><input name="password" type="password" required ${m === 'signup' ? 'minlength="8"' : ''} autocomplete="${m === 'signup' ? 'new-password' : 'current-password'}" placeholder="${m === 'signup' ? 'Mínimo 8 caracteres' : ''}"></label>` : ''}
          ${m === 'signup' ? `<label class="check small" style="margin:4px 0 14px"><input type="checkbox" required> Acepto las ${CFG.termsUrl ? `<a href="${esc(CFG.termsUrl)}" target="_blank" rel="noopener">condiciones del servicio</a>` : 'condiciones del servicio'} y la ${CFG.privacyUrl ? `<a href="${esc(CFG.privacyUrl)}" target="_blank" rel="noopener">política de privacidad</a>` : 'política de privacidad'}</label>` : ''}
          <button class="btn primary block" type="submit">${m === 'login' ? 'Entrar' : m === 'signup' ? `Empezar ${esc(CFG.trialDays || 14)} días gratis` : 'Enviar enlace'}</button>
        </form>
        <p class="small" style="text-align:center;margin:14px 0 0">${m === 'login' ? '<a href="#" data-auth="reset">¿Has olvidado tu contraseña?</a>' : m === 'reset' ? '<a href="#" data-auth="login">Volver</a>' : `Después, ${esc(CFG.price || '')}. Cancela cuando quieras.`}</p>
      </div>`;
    }
    if (gate === 'newpass') html += `<div class="card"><h3>Nueva contraseña</h3><form id="newPassForm"><label class="f"><span>Contraseña nueva</span><input name="password" type="password" required minlength="8" autocomplete="new-password"></label><button class="btn primary block">Guardar</button></form></div>`;
    if (gate === 'paywall') {
      const p = acct?.profile || {};
      const why = p.subscription_status === 'past_due' ? 'No se pudo cobrar tu última cuota.' : ['canceled', 'unpaid', 'incomplete_expired'].includes(p.subscription_status) ? 'Tu suscripción ha terminado.' : 'Tu prueba gratuita ha terminado.';
      html += `<div class="card" style="text-align:center">
        <h3 style="font-size:20px">${why}</h3>
        <p class="muted" style="margin:0 0 6px">Suscríbete para seguir trabajando con tus clientes. Tus datos están a salvo.</p>
        <div class="kcal-big" style="margin:14px 0 4px">${esc(CFG.price || '')}</div>
        <ul class="steps" style="text-align:left;max-width:320px;margin:14px auto">
          <li>Clientes, mediciones y fotos ilimitados</li><li>Dietas manuales y con IA, en PDF con tu marca</li><li>Todo sincronizado en tu móvil, tablet y PC</li><li>Pago con tarjeta, Apple Pay, Google Pay o PayPal. Cancela cuando quieras</li></ul>
        <button class="btn primary block" data-act="${p.subscription_status === 'past_due' ? 'billing' : 'checkout'}">${p.subscription_status === 'past_due' ? 'Actualizar forma de pago' : 'Suscribirme'}</button>
        <div class="row nowrap" style="margin-top:10px"><button class="btn grow" data-act="recheck">Ya he pagado</button><button class="btn grow" data-act="export">Exportar mis datos</button></div>
        <button class="btn ghost block" data-act="logout" style="margin-top:6px">Cerrar sesión</button>
      </div>`;
    }
    $('#view').innerHTML = html;
    bindGate();
  }

  function bindGate() {
    $('#authForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target)), m = ui.authMode || 'login', btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        if (m === 'login') await enter(await cloud.signIn(f.email.trim(), f.password));
        else if (m === 'signup') {
          const r = await cloud.signUp(f.name.trim(), f.email.trim(), f.password);
          if (r.needsConfirm) { ui.authMode = 'login'; render(); toast('Te hemos enviado un email para confirmar tu cuenta'); } else await enter(r.user);
        } else { await cloud.resetPassword(f.email.trim()); ui.authMode = 'login'; render(); toast('Revisa tu email para crear una contraseña nueva'); }
      } catch (err) { toast(err.message); btn.disabled = false; }
    });
    $('#newPassForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await cloud.updatePassword(new FormData(e.target).get('password'));
        recovering = false; toast('Contraseña cambiada ✓');
        gate = acct ? (cloud.hasAccess(acct.profile) ? null : 'paywall') : 'auth'; render(); syncBadge();
      } catch (err) { toast(err.message); }
    });
  }

  async function bootCloud() {
    const pm = location.hash.match(/^#\/p\/([\w-]{32,})/);
    if (pm) return openPortal(pm[1]);
    render();
    try {
      cloud = await import('./cloud.js');
      cloud.init(CFG);
    } catch { $('#view').innerHTML = BRAND_HERO + '<div class="note warn">No se pudo cargar NutriLab. Revisa tu conexión y vuelve a abrir la app.</div>'; return; }
    cloud.onAuthChange((event, user) => {
      if (event === 'PASSWORD_RECOVERY') { recovering = true; gate = 'newpass'; render(); if (user && !acct) enter(user); }
      else if (event === 'SIGNED_IN' && user && !acct) enter(user);
    });
    const user = await cloud.currentUser().catch(() => null);
    const lastPortal = localStorage.getItem(PORTAL_LAST);
    if (!user && lastPortal) return openPortal(lastPortal); // cliente que abre la app desde su pantalla de inicio
    if (user) await enter(user); else { gate = 'auth'; render(); }
    if (/[?&]pago=ok/.test(location.hash) && acct) { history.replaceState(null, '', location.pathname + '#/ajustes'); afterPayment(); }
    else if (/[?&]pago=/.test(location.hash)) history.replaceState(null, '', location.pathname + '#/ajustes');
  }

  // ================================================================ ejemplo
  function loadDemo() {
    const mk = (o) => ({ id: uid(), createdAt: Date.now(), status: 'activo', mealsPerDay: 5, ...o });
    const ana = mk({ name: 'Ana López', sex: 'M', birth: '1992-04-12', height: 165, activity: 1.55, goal: 'perder', targetWeight: 62, allergies: 'Lactosa', dislikes: 'Coliflor', preferences: 'Entrena por la tarde. Come en la oficina.', phone: '612345678', email: 'ana@example.com', nextReview: addDays(today(), 2), startDate: addDays(today(), -70) });
    const marcos = mk({ name: 'Marcos Ruiz', sex: 'H', birth: '1988-09-30', height: 180, activity: 1.725, goal: 'ganar', targetWeight: 80, preferences: 'Gimnasio 5 días. Desayuna fuerte.', phone: '623456789', nextReview: addDays(today(), 6), startDate: addDays(today(), -56), mealsPerDay: 6 });
    const lucia = mk({ name: 'Lucía Fernández', sex: 'M', birth: '1979-01-20', height: 160, activity: 1.375, goal: 'recomp', targetWeight: 58, allergies: 'Frutos secos', nextReview: addDays(today(), -1), startDate: addDays(today(), -42), mealsPerDay: 4 });
    S.clients.push(ana, marcos, lucia);
    const series = (c, start, step, waist0, wstep, n, fat0, fstep) => { for (let i = 0; i < n; i++) S.measures.push({ id: uid(), clientId: c.id, date: addDays(today(), -7 * (n - 1 - i)), weight: (start + step * i + (i % 3 === 1 ? 0.3 : 0)).toFixed(1), waist: (waist0 + wstep * i).toFixed(1), fat: fat0 ? (fat0 + fstep * i).toFixed(1) : '', photos: [] }); };
    series(ana, 71.5, -0.55, 82, -0.7, 10, 31, -0.4);
    series(marcos, 74, 0.35, 81, 0.1, 8, 15, 0.05);
    series(lucia, 63, -0.25, 76, -0.6, 6, 30, -0.5);
    const F = (n) => FOODS.find((f) => f.name === n);
    const it = (n, g, h = '') => { const f = F(n); return { name: f.name, foodId: f.id, grams: g, household: h, per100: { kcal: f.kcal, p: f.p, c: f.c, f: f.f } }; };
    const p = newPlan(ana.id, { name: 'Definición · semana 10', notes: 'Bebe 2 L de agua al día. Cocina a la plancha, al horno o al vapor. Usa la leche sin lactosa.', days: [{ name: 'Día tipo', meals: [
      { name: 'Desayuno', time: '07:30', recipe: '', items: [it('Copos de avena', 50, '5 cucharadas'), it('Bebida de soja sin azúcar', 250, '1 vaso'), it('Arándanos', 80), it('Proteína whey (polvo)', 20)] },
      { name: 'Media mañana', time: '11:00', recipe: '', items: [it('Manzana', 180, '1 unidad'), it('Pan integral', 40), it('Fiambre de pavo', 50)] },
      { name: 'Comida', time: '14:00', recipe: 'Arroz con el pollo salteado y las verduras, con el aceite en crudo.', items: [it('Arroz integral (crudo)', 60), it('Pechuga de pollo', 150), it('Verduras para wok (mezcla)', 200), it('Aceite de oliva virgen extra', 10, '1 cucharada')] },
      { name: 'Merienda', time: '17:30', recipe: '', items: [it('Yogur proteico / skyr', 150), it('Fresas', 120)] },
      { name: 'Cena', time: '21:00', recipe: 'Merluza al horno con patata en láminas.', items: [it('Merluza', 180), it('Patata', 150), it('Lechuga', 80), it('Tomate', 120), it('Aceite de oliva virgen extra', 10, '1 cucharada')] },
    ] }] });
    p.active = true;
    save(); render(); toast('Datos de ejemplo cargados');
  }

  // ================================================================ hojas
  function sheet(title, html) {
    closeSheet();
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Cerrar">${ICON.close}</button></div>${html}</div>`;
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) closeSheet(); });
    document.body.appendChild(bg);
    document.body.style.overflow = 'hidden';
  }
  function closeSheet() {
    $$('.sheet-bg').forEach((x) => x.remove());
    document.body.style.overflow = '';
    sheetUrls.forEach((u) => URL.revokeObjectURL(u)); sheetUrls = [];
  }
  document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; const l = $$('.sheet-bg'); if (l.length > 1) l.pop().remove(); else closeSheet(); });

  // ================================================================ eventos
  let tmr;
  function afterRender(r) {
    if (viewing) $$('#view input:not([type=search]), #view select, #view textarea').forEach((el) => { el.disabled = true; });
    $('#clientSearch')?.addEventListener('input', (e) => { clearTimeout(tmr); tmr = setTimeout(() => { ui.clientQuery = e.target.value; $('#clientList').innerHTML = clientList(); }, 120); });
    $('#foodSearch')?.addEventListener('input', (e) => { clearTimeout(tmr); tmr = setTimeout(() => { ui.foodQuery = e.target.value; $('#foodList').innerHTML = foodList(); }, 120); });
    $('#restore')?.addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) receiveData(f); });
    $$('[data-grams]').forEach((el) => el.addEventListener('change', () => {
      const p = curPlan(), [mi, ii] = el.dataset.grams.split(':').map(Number);
      p.days[ui.day].meals[mi].items[ii].grams = num(el.value); save(); render();
    }));
    $$('img[data-photo]').forEach(async (img) => { const meta = allPhotos().find((x) => x.id === img.dataset.photo); const u = meta && await photoUrl(meta); if (u) img.src = u; img.onclick = () => viewPhoto(meta); });
    if (r.view === 'settings' && CLOUD && acct) showAccessLog();
    if (r.view === 'client' && r.sub === 'resumen' && CLOUD && acct && !viewing) fillPortalCard();
    if (r.view === 'settings' && navigator.storage?.estimate) navigator.storage.estimate().then(({ usage }) => { const el = $('#storageInfo'); if (el && usage) el.insertAdjacentText('beforeend', ` · ${fileSize(usage)} usados`); });
  }

  document.addEventListener('click', (e) => {
    if (portal) {
      const pt = e.target.closest('[data-pday], [data-act]');
      if (!pt) return;
      if (pt.dataset.pday) { portal.day = num(pt.dataset.pday); return render(); }
      if (pt.dataset.act === 'portal-cal') {
        const d = portal.data, cl = d.client, nut = d.nutritionist?.name || 'tu nutricionista';
        return calendarSheet({ uid: `cita-${cl.nextReview}-${hue(location.hash)}`, date: cl.nextReview, time: cl.reviewTime || '', mins: cl.reviewMins || 45, place: cl.reviewPlace || '',
          title: `Revisión con ${nut}`, details: 'Si puedes, pésate esa mañana en ayunas y trae tus dudas.', url: location.href });
      }
      if (pt.dataset.act === 'portal-print') { const d = portal.data; return printPlan(d.plan, { name: d.client.name }, {}); }
      if (pt.dataset.act === 'portal-exit') {
        e.preventDefault(); localStorage.removeItem(PORTAL_LAST); portal = null;
        history.replaceState(null, '', location.pathname + '#/'); document.body.classList.remove('gated');
        if (CLOUD) { gate = acct ? null : 'auth'; if (!acct) ui.authMode = 'login'; }
        return render();
      }
      return;
    }
    const t = e.target.closest('[data-nav], [data-act], [data-cfilter], [data-fcat], [data-metric], [data-measure], [data-day], [data-item], [data-food], [data-settheme], [data-auth], [data-adminrow]');
    if (!t || t.closest('.att')) return;
    const d = t.dataset;
    if (d.auth) { e.preventDefault(); ui.authMode = d.auth; return render(); }
    if (d.adminrow) return adminSheet(d.adminrow);
    // Solo lectura: se puede navegar, filtrar, imprimir y enviar, pero no abrir nada que modifique datos.
    if (viewing && (d.measure || d.item || d.food || (d.act && !['exit-view', 'print-plan', 'share-plan', 'logout'].includes(d.act)))) {
      e.preventDefault(); return toast('Modo solo lectura');
    }
    if (gate && !['checkout', 'billing', 'recheck', 'logout', 'export'].includes(d.act)) return;
    if (t.tagName === 'A' && !d.act) return;
    if (d.nav) { e.preventDefault(); closeSheet(); return go(d.nav); }
    if (d.cfilter) { ui.clientFilter = d.cfilter; return render(); }
    if (d.fcat) { ui.foodCat = d.fcat; return render(); }
    if (d.metric) { ui.metric = d.metric; return render(); }
    if (d.measure) return measureSheet(route().id, d.measure);
    if (d.day) { ui.day = num(d.day); return render(); }
    if (d.food) return foodSheet(d.food);
    if (d.settheme) { S.settings.theme = d.settheme; if (d.settheme === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = d.settheme; save(); return render(); }
    if (d.item) {
      const p = curPlan(), [mi, ii] = d.item.split(':').map(Number), items = p.days[ui.day].meals[mi].items;
      return itemSheet(items[ii], (n) => { items[ii] = n; save(); closeSheet(); render(); }, () => { items.splice(ii, 1); save(); closeSheet(); render(); });
    }
    e.preventDefault();
    const p = d.act && ['print-plan', 'share-plan', 'plan-menu', 'add-day', 'add-meal'].includes(d.act) ? S.plans.find((x) => x.id === d.id) : null;
    switch (d.act) {
      case 'new-client': return clientSheet();
      case 'edit-client': return clientSheet(d.id);
      case 'del-client': {
        const c = clientById(d.id);
        if (!confirm(`¿Eliminar a ${c.name} con todas sus mediciones, fotos y dietas?`)) return;
        S.measures.filter((m) => m.clientId === c.id).forEach((m) => (m.photos || []).forEach(dropPhoto));
        S.clients = S.clients.filter((x) => x.id !== c.id);
        S.measures = S.measures.filter((x) => x.clientId !== c.id);
        S.plans = S.plans.filter((x) => x.clientId !== c.id);
        save(); toast('Cliente eliminado'); return go('#/clientes');
      }
      case 'new-measure': return measureSheet(d.id);
      case 'review': return reviewSheet(clientById(d.id));
      case 'cal-client': { const c = clientById(d.id); return calendarSheet(clientAppt(c), { phone: c.phone, name: c.name }); }
      case 'cal-all': {
        const list = S.clients.filter((c) => (c.status || 'activo') === 'activo' && c.nextReview >= today()).map(clientAppt);
        if (!list.length) return toast('No hay citas próximas');
        openIcs(list, 'citas-nutrilab.ics'); return toast(`${list.length} cita${list.length === 1 ? '' : 's'} exportada${list.length === 1 ? '' : 's'}`);
      }
      case 'new-plan': { const np = newPlan(d.id); save(); return go(`#/d/${np.id}`); }
      case 'ai-plan': return aiPlanSheet(d.id);
      case 'print-plan': return printPlan(p);
      case 'share-plan': return sharePlan(p);
      case 'plan-menu': return planMenu(p);
      case 'add-day': { p.days.push({ name: `Día ${p.days.length + 1}`, meals: structuredClone(p.days[ui.day].meals).map((m) => ({ ...m, items: [] })) }); ui.day = p.days.length - 1; save(); return render(); }
      case 'add-meal': { const n = prompt('Nombre de la comida', 'Merienda'); if (!n) return; p.days[ui.day].meals.push({ name: n, time: '', recipe: '', items: [] }); save(); return render(); }
      case 'add-food': { const cp = curPlan(), mi = num(d.meal); return foodPicker((it) => { cp.days[ui.day].meals[mi].items.push(it); save(); closeSheet(); render(); haptic(); }); }
      case 'meal-menu': return mealMenu(curPlan(), num(d.meal));
      case 'demo': return loadDemo();
      case 'ai-save': aiCfg = { apiKey: $('#aiKey').value.trim(), model: $('#aiModel').value }; saveAi(); return toast(aiCfg.apiKey ? 'IA configurada ✓' : 'Clave eliminada');
      case 'share': return shareData();
      case 'checkout': return goPay('create-checkout');
      case 'billing': return goPay('billing-portal');
      case 'recheck': return afterPayment();
      case 'logout': return logout();
      case 'exit-view': return exitViewing();
      case 'portal-create': return cloud.createPortalLink(acct.user.id, d.id).then(() => { toast('Enlace creado ✓'); fillPortalCard(); }).catch((err) => toast(err.message));
      case 'portal-copy': return copyText(portalUrl(d.token), 'Enlace copiado');
      case 'portal-revoke':
        if (!confirm('¿Anular el enlace? El cliente dejará de ver su plan hasta que crees uno nuevo.')) return;
        return cloud.revokePortalLink(acct.user.id, d.id).then(() => { toast('Enlace anulado'); fillPortalCard(); }).catch((err) => toast(err.message));
      case 'admin-reload': adminRows = null; return render();
      case 'export': return download(`nutrilab-${today()}.json`, new Blob([JSON.stringify(shareable(), null, 1)], { type: 'application/json' }));
      case 'sync-on': return enableSync();
      case 'sync-now': return syncNow(true);
      case 'sync-off': if (confirm('¿Desconectar la sincronización en este dispositivo? Los datos se quedan aquí.')) { sync = {}; saveSync(); syncBadge(); render(); } return;
      case 'wipe':
        if (confirm('¿Borrar TODOS los clientes, mediciones, fotos y dietas de este dispositivo?')) { sync = {}; saveSync(); syncBadge(); S = blank(); snapshot(); persist(); Files.gc([]).catch(() => {}); render(); toast('Datos borrados'); }
    }
  });

  // ================================================================ arranque
  const top = $('header.top');
  window.addEventListener('scroll', () => top.classList.toggle('scrolled', window.scrollY > 4), { passive: true });
  if (CLOUD) bootCloud(); else { render(); syncBadge(); syncNow(); }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  window.addEventListener('online', () => syncNow());
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
  navigator.storage?.persist?.().catch(() => {});
  if (!CLOUD) Files.gc(allPhotos().map((p) => p.id)).catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
