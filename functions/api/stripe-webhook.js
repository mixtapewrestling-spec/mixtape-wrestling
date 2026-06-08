export async function onRequestPost(context) {
  try {
    const STRIPE_SECRET_KEY = context.env.STRIPE_SECRET_KEY;
    const WEBHOOK_SECRET = context.env.STRIPE_WEBHOOK_SECRET;
    const db = context.env.DB;

    const payload = await context.request.text();
    const signature = context.request.headers.get('stripe-signature');

    // Verify webhook signature
    const isValid = await verifyStripeSignature(payload, signature, WEBHOOK_SECRET);
    if (!isValid) {
      return new Response('Invalid signature', { status: 400 });
    }

    const event = JSON.parse(payload);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const meta = session.metadata || {};
      const customerName = meta.customer_name || 'Guest';
      const customerEmail = session.customer_email || meta.customer_email;
      const cartData = meta.cart ? JSON.parse(meta.cart) : null;

      if (cartData && db) {
        for (const item of cartData) {
          if (item.tierId) {
            // It's a ticket
            for (let i = 0; i < item.qty; i++) {
              const uid = crypto.randomUUID();
              await db.prepare(
                "INSERT OR IGNORE INTO tickets (event_id, ticket_type_id, ticket_uid, customer_name, customer_email, stripe_payment_id) VALUES (1, ?, ?, ?, ?, ?)"
              ).bind(item.tierId, uid, customerName, customerEmail, session.id).run();
            }
          } else if (item.stripePrice) {
            // It's merch — deduct stock
            await db.prepare(
              "UPDATE products SET stock_quantity = MAX(-1, stock_quantity - ?) WHERE stripe_price_id = ? AND stock_quantity > 0"
            ).bind(item.qty, item.stripePrice).run();
          }
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch(err) {
    return new Response('Webhook error: ' + err.message, { status: 500 });
  }
}

async function verifyStripeSignature(payload, signature, secret) {
  try {
    const parts = signature.split(',');
    const timestamp = parts.find(p => p.startsWith('t=')).split('=')[1];
    const sigParts = parts.filter(p => p.startsWith('v1=')).map(p => p.split('=')[1]);

    const signedPayload = timestamp + '.' + payload;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
    const computedSig = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

    return sigParts.includes(computedSig);
  } catch(err) {
    return false;
  }
}
