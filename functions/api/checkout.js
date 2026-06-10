export async function onRequestPost(context) {
  const STRIPE_SECRET_KEY = context.env.STRIPE_SECRET_KEY ?? '';
  const SITE_URL = context.env.SITE_URL ?? 'https://www.mixtapewrestling.com';

  if (!STRIPE_SECRET_KEY) {
    return new Response(JSON.stringify({ error: 'No Stripe key' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await context.request.json();
  } catch(e) {
    return new Response(JSON.stringify({ error: 'JSON parse failed', detail: e.message }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const cart = body.cart;
  const customerName = body.customerName || '';
  const customerEmail = body.customerEmail || '';

  if (!cart || !Array.isArray(cart) || cart.length === 0 || !customerEmail) {
    return new Response(JSON.stringify({ 
      error: 'Missing fields',
      hasCart: !!cart,
      cartLength: cart ? cart.length : 0,
      hasEmail: !!customerEmail
    }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  const lineItems = [];
  cart.forEach(function(item, i) {
    lineItems.push(['line_items[' + i + '][price]', item.stripePrice]);
    lineItems.push(['line_items[' + i + '][quantity]', String(item.qty)]);
  });

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
    return new Response(JSON.stringify({ error: session.error?.message ?? 'Stripe error', stripeStatus: stripeRes.status }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ url: session.url }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}