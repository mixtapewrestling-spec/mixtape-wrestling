export const prerender = false;

import type { APIContext } from 'astro';

export async function POST({ request, locals }: APIContext) {
  const env = (locals as any).runtime?.env;

  const STRIPE_SECRET_KEY: string = env?.STRIPE_SECRET_KEY ?? '';
  const SITE_URL: string = env?.SITE_URL ?? 'https://mixtapewrestling.com';

  if (!STRIPE_SECRET_KEY) {
    return new Response(JSON.stringify({ error: 'Stripe not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { stripePriceId, tierName, tierId, quantity, customerName, customerEmail } = body;

  if (!stripePriceId || !customerEmail || !quantity) {
    return new Response(JSON.stringify({ error: 'Missing required fields' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      'payment_method_types[]':  'card',
      'mode':                    'payment',
      'customer_email':           customerEmail,
      'line_items[0][price]':     stripePriceId,
      'line_items[0][quantity]':  String(quantity),
      'success_url':             `${SITE_URL}/ticket-success?session_id={CHECKOUT_SESSION_ID}`,
      'cancel_url':              `${SITE_URL}/events`,
      'metadata[customer_name]':  customerName,
      'metadata[customer_email]': customerEmail,
      'metadata[tier_name]':      tierName,
      'metadata[tier_id]':       String(tierId ?? ''),
      'metadata[quantity]':      String(quantity),
    }).toString(),
  });

  const session = await stripeRes.json() as any;

  if (!stripeRes.ok) {
    return new Response(JSON.stringify({ error: session.error?.message ?? 'Stripe error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ url: session.url }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
