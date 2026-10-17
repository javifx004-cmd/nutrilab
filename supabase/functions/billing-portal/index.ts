// Abre el portal de Stripe para cambiar la tarjeta, ver facturas o cancelar la suscripción.
// Variables: STRIPE_SECRET_KEY, APP_URL (las de Supabase las pone Supabase).
import Stripe from 'npm:stripe@22.6.2';
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const APP_URL = Deno.env.get('APP_URL')!;
const cors = {
  'Access-Control-Allow-Origin': new URL(APP_URL).origin,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { httpClient: Stripe.createFetchHttpClient() });
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    });
    const { data: { user } } = await auth.auth.getUser();
    if (!user) return json({ error: 'Inicia sesión' }, 401);

    const { data: profile } = await admin.from('profiles').select('stripe_customer_id').eq('id', user.id).single();
    if (!profile?.stripe_customer_id) return json({ error: 'Todavía no tienes ninguna suscripción' }, 404);

    const session = await stripe.billingPortal.sessions.create({ customer: profile.stripe_customer_id, return_url: `${APP_URL}#/ajustes`, locale: 'es' });
    return json({ url: session.url });
  } catch (err) {
    console.error(err);
    return json({ error: 'No se pudo abrir la gestión de la suscripción.' }, 500);
  }
});
