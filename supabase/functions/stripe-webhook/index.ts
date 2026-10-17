// Recibe los avisos de Stripe (alta, renovación, impago, cancelación) y actualiza el acceso del nutricionista.
// Se despliega SIN verificación de JWT: la autenticidad la garantiza la firma de Stripe.
// Variables: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (las de Supabase las pone Supabase).
import Stripe from 'npm:stripe@22.6.2';
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { httpClient: Stripe.createFetchHttpClient() });
const cryptoProvider = Stripe.createSubtleCryptoProvider();
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

// Se lee la suscripción actual de Stripe en vez de fiarse del evento: los avisos pueden llegar desordenados.
async function syncSubscription(subscriptionId: string, userId?: string | null) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  // En esta versión de la API la fecha de renovación está en cada elemento de la suscripción.
  const end = Math.max(0, ...sub.items.data.map((i) => i.current_period_end ?? 0));
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const row = {
    stripe_customer_id: customer,
    stripe_subscription_id: sub.id,
    subscription_status: sub.status,
    current_period_end: end ? new Date(end * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end || !!sub.cancel_at,
  };
  const uid = userId || sub.metadata?.user_id;
  const query = uid ? admin.from('profiles').update(row).eq('id', uid) : admin.from('profiles').update(row).eq('stripe_customer_id', customer);
  const { error } = await query;
  if (error) throw error;
}

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature ?? '', Deno.env.get('STRIPE_WEBHOOK_SECRET')!, undefined, cryptoProvider);
  } catch {
    return new Response('Firma no válida', { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        if (s.mode === 'subscription' && s.subscription) {
          await syncSubscription(typeof s.subscription === 'string' ? s.subscription : s.subscription.id, s.client_reference_id);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed':
        await syncSubscription(event.data.object.id);
        break;
    }
    return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error(err);
    // 500 para que Stripe vuelva a intentarlo
    return new Response('Error', { status: 500 });
  }
});
