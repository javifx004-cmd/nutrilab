// Suscripciones de PayPal: confirmar la suscripción al volver de PayPal, cancelarla y recibir los avisos (webhooks) de PayPal.
// Se despliega SIN «Verify JWT»: los avisos llegan de PayPal (se comprueban con su firma) y las peticiones de la app
// se comprueban aquí con la sesión del usuario.
// Variables: PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_PLAN_ID, PAYPAL_WEBHOOK_ID, PAYPAL_ENV (sandbox | live), APP_URL
// (SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY las pone Supabase).
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const env = (k: string) => Deno.env.get(k) ?? '';
const API = env('PAYPAL_ENV') === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
const APP_URL = env('APP_URL');
const cors = {
  'Access-Control-Allow-Origin': new URL(APP_URL).origin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

// ---------------------------------------------------------------- API de PayPal
let token: { value: string; exp: number } | null = null;
async function accessToken() {
  if (token && token.exp > Date.now()) return token.value;
  const res = await fetch(`${API}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa(`${env('PAYPAL_CLIENT_ID')}:${env('PAYPAL_SECRET')}`), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error('PayPal: no se pudo autenticar (' + res.status + ')');
  const d = await res.json();
  token = { value: d.access_token, exp: Date.now() + (d.expires_in - 60) * 1000 };
  return token.value;
}
async function pp(method: string, path: string, body?: unknown) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: 'Bearer ' + (await accessToken()), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`PayPal ${res.status}: ${data.message || data.name || ''}`);
  return data;
}

// ---------------------------------------------------------------- estado de la suscripción → acceso
const STATUS: Record<string, string> = { ACTIVE: 'active', SUSPENDED: 'past_due', CANCELLED: 'canceled', EXPIRED: 'canceled', APPROVAL_PENDING: 'incomplete', APPROVED: 'incomplete' };
const plusMonth = (iso: string) => { const d = new Date(iso); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString(); };

// Se lee la suscripción en PayPal en vez de fiarse del aviso: los avisos pueden llegar desordenados o repetidos.
async function sync(subscriptionId: string, expectUser?: string) {
  const sub = await pp('GET', `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`);
  if (sub.plan_id !== env('PAYPAL_PLAN_ID')) throw new HttpError(400, 'Esta suscripción no es de NutriLab');
  const uid = sub.custom_id as string | undefined;
  if (!uid || (expectUser && uid !== expectUser)) throw new HttpError(403, 'Esta suscripción no es de tu cuenta');
  const { data: profile, error } = await admin.from('profiles').select('paypal_subscription_id, paid_until').eq('id', uid).single();
  if (error) throw error;
  const status = STATUS[sub.status] ?? 'incomplete';
  const last = sub.billing_info?.last_payment?.time as string | undefined;
  const next = sub.billing_info?.next_billing_time as string | undefined;
  const row: Record<string, unknown> = {};
  // Una suscripción antigua (cancelada) no pisa a la nueva
  if (!profile.paypal_subscription_id || profile.paypal_subscription_id === sub.id || status === 'active') {
    Object.assign(row, { paypal_subscription_id: sub.id, subscription_status: status, current_period_end: next || (last ? plusMonth(last) : null), cancel_at_period_end: false });
  }
  // Al cancelar, se mantiene el acceso hasta el final del mes ya pagado
  if (status === 'canceled' && last) {
    const end = plusMonth(last);
    if (!profile.paid_until || profile.paid_until < end) row.paid_until = end;
  }
  if (Object.keys(row).length) {
    const { error: e2 } = await admin.from('profiles').update(row).eq('id', uid);
    if (e2) throw e2;
  }
  return status;
}

// ---------------------------------------------------------------- avisos de PayPal
async function webhook(req: Request, body: string) {
  const h = (k: string) => req.headers.get(k) ?? '';
  const event = JSON.parse(body);
  const check = await pp('POST', '/v1/notifications/verify-webhook-signature', {
    auth_algo: h('paypal-auth-algo'), cert_url: h('paypal-cert-url'), transmission_id: h('paypal-transmission-id'),
    transmission_sig: h('paypal-transmission-sig'), transmission_time: h('paypal-transmission-time'),
    webhook_id: env('PAYPAL_WEBHOOK_ID'), webhook_event: event,
  });
  if (check.verification_status !== 'SUCCESS') return new Response('Firma no válida', { status: 400 });
  const r = event.resource || {};
  const id = event.resource_type === 'subscription' ? r.id : r.billing_agreement_id;
  if (id && /^(BILLING\.SUBSCRIPTION\.|PAYMENT\.SALE\.)/.test(event.event_type)) await sync(id);
  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const body = await req.text();
  try {
    if (req.headers.get('paypal-transmission-id')) return await webhook(req, body);

    // Peticiones de la app: siempre con la sesión del usuario
    const auth = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: { user } } = await auth.auth.getUser();
    if (!user) return json({ error: 'Inicia sesión para continuar' }, 401);
    const { action, subscriptionId } = JSON.parse(body || '{}');

    if (action === 'confirm') {
      if (typeof subscriptionId !== 'string' || !/^I-[A-Z0-9]+$/.test(subscriptionId)) return json({ error: 'Suscripción no válida' }, 400);
      return json({ status: await sync(subscriptionId, user.id) });
    }
    if (action === 'cancel') {
      const { data: p } = await admin.from('profiles').select('paypal_subscription_id').eq('id', user.id).single();
      if (!p?.paypal_subscription_id) return json({ error: 'No tienes ninguna suscripción de PayPal' }, 404);
      await pp('POST', `/v1/billing/subscriptions/${encodeURIComponent(p.paypal_subscription_id)}/cancel`, { reason: 'Cancelada por el usuario desde NutriLab' });
      return json({ status: await sync(p.paypal_subscription_id, user.id) });
    }
    return json({ error: 'Acción no válida' }, 400);
  } catch (err) {
    console.error(err);
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    // 500 para que PayPal vuelva a enviar el aviso
    return json({ error: 'No se pudo completar. Inténtalo de nuevo.' }, 500);
  }
});
