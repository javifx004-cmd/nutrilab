/*
 * Dietas con IA (Claude). Se carga solo al usarla.
 * La llamada va directamente del navegador a la API de Anthropic con la clave que pones en Ajustes;
 * la clave se guarda solo en este dispositivo.
 */
const SDK_URL = './vendor/anthropic-sdk-0.131.0.mjs';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (recomendado)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (más rápido)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (más económico)' },
];

// Respaldo automático en servidor si el modelo rechaza la petición (solo Opus 5.5 / Sonnet 5.5).
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

const ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['food', 'grams', 'household', 'kcal', 'protein', 'carbs', 'fat'],
  properties: {
    food: { type: 'string', description: 'Nombre del alimento; si está en la lista de alimentos, exactamente como aparece allí' },
    grams: { type: 'number', description: 'Cantidad en gramos (o ml)' },
    household: { type: 'string', description: 'Medida casera orientativa, p. ej. "1 taza", "2 rebanadas"; vacío si no aplica' },
    kcal: { type: 'number' },
    protein: { type: 'number', description: 'Proteínas en gramos para esa cantidad' },
    carbs: { type: 'number', description: 'Hidratos en gramos para esa cantidad' },
    fat: { type: 'number', description: 'Grasas en gramos para esa cantidad' },
  },
};

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'notes', 'days'],
  properties: {
    name: { type: 'string', description: 'Nombre corto del plan' },
    notes: { type: 'string', description: 'Indicaciones generales para el cliente: hidratación, cocinado, sustituciones. Breve.' },
    days: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'meals'],
        properties: {
          name: { type: 'string', description: 'Nombre del día, p. ej. "Lunes" o "Día tipo"' },
          meals: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'time', 'items', 'recipe'],
              properties: {
                name: { type: 'string', description: 'Desayuno, Media mañana, Comida, Merienda, Cena…' },
                time: { type: 'string', description: 'Hora orientativa HH:MM' },
                items: { type: 'array', items: ITEM },
                recipe: { type: 'string', description: 'Preparación en una o dos frases; vacío si es obvia' },
              },
            },
          },
        },
      },
    },
  },
};

const SYSTEM = `Eres el asistente de un nutricionista profesional (Javi) en España. Diseñas planes de alimentación para sus clientes, que él revisa antes de entregarlos.

Criterios:
- Ajusta cada día a las calorías y macros objetivo (±5 %). Calcula las cantidades en gramos para que cuadren.
- Respeta sin excepción las alergias e intolerancias del cliente y evita los alimentos que no le gustan.
- Usa alimentos habituales en España, fáciles de comprar y cocinar, con variedad entre comidas y días.
- Siempre que puedas, usa los alimentos de la lista proporcionada con su nombre exacto; sus valores son por 100 g.
- Indica si el peso es en crudo o cocinado cuando importe (arroz, pasta, legumbres, carnes) usando el nombre de la lista.
- Los valores de cada alimento (kcal, proteínas, hidratos, grasas) corresponden a la cantidad indicada, no a 100 g.
- Escribe en español de España, en tono cercano y profesional.`;

const r1 = (n) => Math.round(n * 10) / 10;

function clientBrief(c, t) {
  const lines = [
    `Cliente: ${c.name}${c.sex ? `, ${c.sex === 'M' ? 'mujer' : 'hombre'}` : ''}${t.age ? `, ${t.age} años` : ''}`,
    t.weight ? `Peso actual: ${t.weight} kg${c.height ? ` · altura ${c.height} cm` : ''}${c.targetWeight ? ` · peso objetivo ${c.targetWeight} kg` : ''}` : '',
    `Objetivo: ${c.goal || 'mantener'} · actividad: ${c.activityLabel || 'moderada'}`,
    `Objetivo diario: ${Math.round(t.kcal)} kcal · proteínas ${Math.round(t.p)} g · hidratos ${Math.round(t.c)} g · grasas ${Math.round(t.f)} g`,
    `Comidas al día: ${c.mealsPerDay || 5}`,
    c.allergies ? `ALERGIAS / INTOLERANCIAS (evitar siempre): ${c.allergies}` : 'Sin alergias conocidas.',
    c.dislikes ? `No le gusta: ${c.dislikes}` : '',
    c.preferences ? `Preferencias / estilo de vida: ${c.preferences}` : '',
    c.notes ? `Notas del nutricionista: ${c.notes}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

function foodList(foods) {
  return foods.map((f) => `${f.name} | ${f.kcal} kcal | P ${f.p} | H ${f.c} | G ${f.f}`).join('\n');
}

async function sdk() {
  const mod = await import(SDK_URL);
  return mod.default;
}

function explain(Anthropic, err) {
  if (err instanceof Anthropic.AuthenticationError) return 'La clave de API no es válida. Revísala en Ajustes.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'La clave no tiene permiso para usar este modelo.';
  if (err instanceof Anthropic.RateLimitError) return 'Demasiadas peticiones seguidas. Espera un minuto y vuelve a probar.';
  if (err instanceof Anthropic.APIConnectionError) return 'No hay conexión con la IA. Revisa tu internet.';
  if (err instanceof Anthropic.BadRequestError) return 'La petición no es válida: ' + (err.message || '');
  if (err instanceof Anthropic.APIError) return `Error de la IA (${err.status ?? '?'}): ${err.message || ''}`;
  return err?.message || String(err);
}

async function run({ apiKey, model, user, onProgress, signal }) {
  const Anthropic = await sdk();
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const params = {
    model,
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: PLAN_SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
  };
  if (FALLBACK_MODELS.has(model)) Object.assign(params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  try {
    const stream = client.beta.messages.stream(params, { signal });
    let chars = 0;
    stream.on('text', (delta) => { chars += delta.length; onProgress?.(chars); });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new Error('La IA no ha podido generar este plan. Prueba a reformular las indicaciones.');
    if (msg.stop_reason === 'max_tokens') throw new Error('El plan era demasiado largo y se cortó. Prueba con menos días.');
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { plan: JSON.parse(text), usage: msg.usage, model: msg.model };
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) throw new Error('Generación cancelada');
    if (err instanceof SyntaxError) throw new Error('La respuesta de la IA no se pudo leer. Vuelve a intentarlo.');
    throw new Error(explain(Anthropic, err));
  }
}

// Recalcula cada alimento con la base de datos cuando coincide el nombre (más fiable que la estimación).
export function normalizePlan(plan, foods) {
  const byName = new Map(foods.map((f) => [f.name.toLowerCase(), f]));
  return {
    name: plan.name,
    notes: plan.notes,
    days: plan.days.map((d) => ({
      name: d.name,
      meals: d.meals.map((m) => ({
        name: m.name, time: m.time, recipe: m.recipe,
        items: m.items.map((it) => {
          const f = byName.get(String(it.food).toLowerCase());
          const g = Math.max(0, Number(it.grams) || 0);
          if (f) return { name: f.name, foodId: f.id, grams: g, household: it.household, per100: { kcal: f.kcal, p: f.p, c: f.c, f: f.f } };
          const k = g ? 100 / g : 0;
          return { name: it.food, grams: g, household: it.household, per100: { kcal: r1(it.kcal * k), p: r1(it.protein * k), c: r1(it.carbs * k), f: r1(it.fat * k) } };
        }),
      })),
    })),
  };
}

export async function generateDiet({ apiKey, model, client, targets, foods, days, style, extra, onProgress, signal }) {
  const user = `${clientBrief(client, targets)}

Prepara un plan de ${days} día${days > 1 ? 's' : ''} distinto${days > 1 ? 's' : ''}${style ? `, estilo ${style}` : ''}.
${extra ? `Indicaciones adicionales de Javi: ${extra}` : ''}

Lista de alimentos disponibles (valores por 100 g):
${foodList(foods)}`;
  return run({ apiKey, model, user, onProgress, signal });
}

export async function reviseDiet({ apiKey, model, client, targets, foods, plan, request, onProgress, signal }) {
  const user = `${clientBrief(client, targets)}

Plan actual (JSON):
${JSON.stringify(plan)}

Cambios que pide Javi: ${request}

Devuelve el plan completo con los cambios aplicados, manteniendo lo demás.

Lista de alimentos disponibles (valores por 100 g):
${foodList(foods)}`;
  return run({ apiKey, model, user, onProgress, signal });
}

// ---------------------------------------------------------------- valores de un alimento
const FOOD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'kcal', 'protein', 'carbs', 'fat', 'portion'],
  properties: {
    name: { type: 'string', description: 'Nombre claro del alimento en español, con su estado (crudo, cocido…) si importa' },
    kcal: { type: 'number', description: 'Kilocalorías por 100 g' },
    protein: { type: 'number', description: 'Proteínas en gramos por 100 g' },
    carbs: { type: 'number', description: 'Hidratos de carbono en gramos por 100 g' },
    fat: { type: 'number', description: 'Grasas en gramos por 100 g' },
    portion: { type: 'number', description: 'Ración habitual en gramos' },
  },
};

// Estima los valores por 100 g de un alimento o plato a partir de su nombre (rápido y económico: Haiku).
export async function estimateFood({ apiKey, name, signal }) {
  const Anthropic = await sdk();
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-5-5',
      max_tokens: 4000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: FOOD_SCHEMA } },
      system: 'Eres experto en composición de alimentos. Das valores medios por 100 g de porción comestible, como en las tablas BEDCA o USDA, '
        + 'para el alimento tal como se nombra (si no dice cocinado, crudo; si es un plato, la receta casera típica en España; si es un producto de marca, sus valores de etiqueta habituales). '
        + 'Las kcal deben cuadrar con 4·proteínas + 4·hidratos + 9·grasas (salvo bebidas alcohólicas).',
      messages: [{ role: 'user', content: `Alimento: ${name}` }],
    }, { signal });
    if (msg.stop_reason === 'refusal') throw new Error('La IA no ha podido calcular este alimento.');
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const v = JSON.parse(text);
    const r1 = (x) => Math.round(Math.max(0, Number(x) || 0) * 10) / 10;
    return { name: String(v.name || name).trim(), kcal: r1(v.kcal), p: r1(v.protein), c: r1(v.carbs), f: r1(v.fat), portion: Math.round(r1(v.portion)) || 100, source: 'ia' };
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) throw new Error('Cancelado');
    if (err instanceof SyntaxError) throw new Error('La respuesta de la IA no se pudo leer. Vuelve a intentarlo.');
    throw new Error(explain(Anthropic, err));
  }
}
