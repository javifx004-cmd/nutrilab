// Crea la página de pago de Stripe para suscribirse a NutriLab.
// Variables: STRIPE_SECRET_KEY, STRIPE_PRICE_ID, APP_URL (SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY las pone Supabase).
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
    if (!user) return json({ error: 'Inicia sesión para suscribirte' }, 401);

    const { data: profile, error } = await admin.from('profiles').select('*').eq('id', user.id).single();
    if (error) throw error;
    if (['active', 'trialing', 'past_due'].includes(profile.subscription_status)) {
      return json({ error: 'Ya tienes una suscripción. Gestiónala desde Ajustes.' }, 409);
    }

    let customer = profile.stripe_customer_id as string | null;
    if (!customer) {
      const c = await stripe.customers.create({ email: user.email, name: profile.full_name || undefined, metadata: { user_id: user.id } });
      customer = c.id;
      await admin.from('profiles').update({ stripe_customer_id: customer }).eq('id', user.id);
    }

    // Sin payment_method_types: Checkout ofrece los métodos activados en el panel de Stripe (tarjeta, Apple Pay, Google Pay, PayPal…).
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer,
      line_items: [{ price: Deno.env.get('STRIPE_PRICE_ID')!, quantity: 1 }],
      client_reference_id: user.id,
      subscription_data: { metadata: { user_id: user.id } },
      allow_promotion_codes: true,
      locale: 'es',
      success_url: `${APP_URL}#/ajustes?pago=ok`,
      cancel_url: `${APP_URL}#/ajustes?pago=cancelado`,
    });
    return json({ url: session.url });
  } catch (err) {
    console.error(err);
    return json({ error: 'No se pudo iniciar el pago. Inténtalo de nuevo.' }, 500);
  }
});
