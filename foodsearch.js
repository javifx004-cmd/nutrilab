/*
 * Búsqueda de productos de supermercado en Open Food Facts (base de datos abierta y gratuita).
 * Devuelve los valores por 100 g que declara la etiqueta. Se carga solo al usarla.
 */
const FIELDS = 'code,product_name,product_name_es,brands,nutriments,serving_quantity';
const r1 = (v) => Math.round(v * 10) / 10;
const val = (n, k) => { const v = Number(n?.[k]); return Number.isFinite(v) ? v : null; };

// Convierte un producto de Open Food Facts al formato de NutriLab (o null si no trae los datos básicos).
export function fromOFF(p) {
  if (!p) return null;
  const n = p.nutriments || {};
  let kcal = val(n, 'energy-kcal_100g');
  if (kcal == null && val(n, 'energy_100g') != null) kcal = val(n, 'energy_100g') / 4.184; // viene en kJ
  const name = String(p.product_name_es || p.product_name || '').trim();
  if (!name || kcal == null) return null;
  const brand = String(p.brands || '').split(',')[0].trim();
  const serving = Number(p.serving_quantity);
  return {
    name: brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${name} (${brand})` : name,
    kcal: r1(kcal), p: r1(val(n, 'proteins_100g') ?? 0), c: r1(val(n, 'carbohydrates_100g') ?? 0), f: r1(val(n, 'fat_100g') ?? 0),
    portion: serving > 0 && serving <= 1000 ? Math.round(serving) : 100,
    code: p.code || '', source: 'off',
  };
}

async function get(url, signal) {
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Open Food Facts respondió ${res.status}`);
  return res.json();
}

// Busca por nombre, dando prioridad a productos vendidos en España.
export async function searchProducts(q, { signal } = {}) {
  const u = new URL('https://es.openfoodfacts.org/cgi/search.pl');
  Object.entries({ search_terms: q, search_simple: 1, action: 'process', json: 1, page_size: 24, fields: FIELDS, app_name: 'NutriLab' })
    .forEach(([k, v]) => u.searchParams.set(k, v));
  const data = await get(u, signal);
  const seen = new Set();
  return (data.products || []).map(fromOFF).filter((x) => x && !seen.has(x.name.toLowerCase()) && seen.add(x.name.toLowerCase())).slice(0, 12);
}

// Busca un producto por su código de barras (EAN).
export async function productByCode(code, { signal } = {}) {
  const clean = String(code).replace(/\D/g, '');
  if (clean.length < 8) throw new Error('El código de barras debe tener al menos 8 números');
  const data = await get(`https://world.openfoodfacts.org/api/v2/product/${clean}.json?fields=${FIELDS}&app_name=NutriLab`, signal);
  const item = data.status === 1 ? fromOFF(data.product) : null;
  if (!item) throw new Error('No hemos encontrado ese producto. Prueba a buscarlo por nombre.');
  return item;
}
