export async function onRequestPost(context) {
  const env = context.env;
  const STRIPE_SECRET_KEY = env?.STRIPE_SECRET_KEY ?? '';
  const SITE_URL = env?.SITE_URL ?? 'https://mixtapewrestling.com';

  if (!STRIPE_SECRET_KEY) {
    return new Response(JSON.stringify({ error: 'Stripe not configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try { body = await context.request.json(); }
  catch {
    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { cart, customerName, customerEmail } = body;

  console.log('Checkout request:', JSON.stringify({ cart, customerName, customerEmail }));
  if (!cart || cart.length === 0 || !customerEmail) {
    return new Response(JSON.stringify({ error: 'Missing required fields', debug: { cart, customerName, customerEmail } }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const lineItems = cart.map(function(item, i) {
    return [
      ['line_items[' + i + '][price]', item.stripePrice],
      ['line_items[' + i + '][quantity]', String(item.qty)],
    ];
  }).flat();

  const cartMeta = JSON.stringify(cart.map(function(i) {
    return { name: i.name, qty: i.qty, tierId: i.tierId || '' };
  }));

  const params = new URLSearchParams([
    ['payment_method_types[]', 'card'],
    ['mode', 'payment'],
    ['customer_email', customerEmail],
    ['success_url', SITE_URL + '/ticket-success?session_id={CHECKOUT_SESSION_ID}'],
    ['cancel_url', SITE_URL + '/events'],
    ['metadata[customer_name]', customerName],
    ['metadata[customer_email]', customerEmail],
    ['metadata[cart]', cartMeta],
    ...lineItems,
  ]);

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + STRIPE_SECRET_KEY,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const session = await stripeRes.json();

  if (!stripeRes.ok) {
    return new Response(JSON.stringify({ error: session.error?.message ?? 'Stripe error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ url: session.url }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
