/*
 * Fotos de progreso adjuntas (IndexedDB).
 * localStorage solo admite ~5 MB, así que los archivos van en IndexedDB y en los datos
 * de la app solo se guarda su descripción: { id, name, type, size }.
 */
const Files = (() => {
  'use strict';

  const DB = 'javinutricion-files', STORE = 'files';
  const MAX_IMAGE_SIDE = 1800;
  const MAX_BYTES = 8 * 1024 * 1024;
  let dbp = null;

  function db() {
    dbp ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  async function tx(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(r?.result);
      t.onerror = () => reject(t.error);
    });
  }

  // Las fotos se reducen a JPEG para que ocupen poco y se sincronicen rápido.
  async function compress(file) {
    if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 350 * 1024) return file;
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, MAX_IMAGE_SIDE / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close?.();
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82));
      return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
    } catch { return file; }
  }

  async function add(file, id) {
    const f = await compress(file);
    if (f.size > MAX_BYTES) throw new Error(`«${file.name}» supera 8 MB`);
    const rec = { id, name: f.name || 'foto', type: f.type || 'application/octet-stream', blob: f };
    await tx('readwrite', (s) => s.put(rec));
    return { id, name: rec.name, type: rec.type, size: f.size };
  }

  const put = (id, blob, name, type) => tx('readwrite', (s) => s.put({ id, blob, name, type }));
  const get = (id) => tx('readonly', (s) => s.get(id));
  const del = (id) => tx('readwrite', (s) => s.delete(id));
  const keys = () => tx('readonly', (s) => s.getAllKeys());

  // Borra del dispositivo las fotos que ya no pertenecen a ninguna medición.
  async function gc(validIds) {
    const valid = new Set(validIds);
    for (const k of (await keys()) || []) if (!valid.has(k)) await del(k);
  }

  return { add, put, get, del, keys, gc };
})();
