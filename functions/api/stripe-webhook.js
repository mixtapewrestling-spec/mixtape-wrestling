export async function onRequestPost(context) {
  try {
    const STRIPE_SECRET_KEY = context.env.STRIPE_SECRET_KEY;
    const WEBHOOK_SECRET = context.env.STRIPE_WEBHOOK_SECRET;
    const RESEND_API_KEY = context.env.RESEND_API_KEY;
    const SITE_URL = context.env.SITE_URL ?? 'https://www.mixtapewrestling.com';
    const db = context.env.DB;

    const payload = await context.request.text();
    const signature = context.request.headers.get('stripe-signature');

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

      const ticketUids = [];
      const ticketTiers = [];
      const merchItems = [];

      if (cartData && db) {
        for (const item of cartData) {
          if (item.tierId) {
            for (let i = 0; i < item.qty; i++) {
              const uid = crypto.randomUUID();
              await db.prepare(
                "INSERT OR IGNORE INTO tickets (event_id, ticket_type_id, ticket_uid, customer_name, customer_email, stripe_payment_id) VALUES (1, ?, ?, ?, ?, ?)"
              ).bind(item.tierId, uid, customerName, customerEmail, session.id).run();
              ticketUids.push(uid);
              ticketTiers.push(item.name);
            }
          } else if (item.stripePrice) {
            await db.prepare(
              "UPDATE products SET stock_quantity = MAX(-1, stock_quantity - ?) WHERE stripe_price_id = ? AND stock_quantity > 0"
            ).bind(item.qty, item.stripePrice).run();
            merchItems.push(item);
          }
        }
      }

      // Send confirmation email
      if (customerEmail && RESEND_API_KEY) {
        const ticketCards = ticketUids.map((uid, i) => `
          <div style="background:#17171e;border:1px solid #2a2a38;padding:24px;margin-bottom:16px;border-radius:4px">
            <p style="font-family:sans-serif;font-size:11px;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:#8888aa;margin:0 0 8px">Section</p>
            <p style="font-family:sans-serif;font-size:24px;font-weight:700;color:#00d4ff;margin:0 0 16px">${ticketTiers[i] || 'General Admission'}</p>
            <p style="font-family:sans-serif;font-size:11px;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:#8888aa;margin:0 0 8px">Ticket ID</p>
            <p style="font-family:sans-serif;font-size:20px;font-weight:700;color:#f0f0f8;margin:0 0 16px">${uid.substring(0,8).toUpperCase()}</p>
            <a href="${SITE_URL}/ticket-success?session_id=${session.id}" style="display:inline-block;font-family:sans-serif;font-size:12px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#0a0a0c;background:#00d4ff;padding:12px 24px;text-decoration:none;border-radius:2px">View Full Ticket & QR Code</a>
          </div>`).join('');

        const merchRows = merchItems.map(m =>
          `<tr><td style="padding:8px 0;font-family:sans-serif;font-size:14px;color:#f0f0f8">${m.name} x${m.qty}</td><td style="padding:8px 0;font-family:sans-serif;font-size:14px;color:#00d4ff;text-align:right">$${((m.priceCents * m.qty)/100).toFixed(2)}</td></tr>`
        ).join('');

        const hasTickets = ticketUids.length > 0;
        const hasMerch = merchItems.length > 0;

        const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="background:#0a0a0c;margin:0;padding:40px 20px;font-family:sans-serif">
  <div style="max-width:600px;margin:0 auto">
    <div style="text-align:center;margin-bottom:32px">
      <h1 style="font-family:sans-serif;font-size:48px;font-weight:900;color:#f0f0f8;margin:0;letter-spacing:-1px">
        mi<span style="color:#00d4ff">X</span>tape
      </h1>
      <p style="font-family:sans-serif;font-size:11px;font-weight:700;letter-spacing:0.4em;text-transform:uppercase;color:#8888aa;margin:8px 0 0">Wrestling</p>
    </div>

    <div style="background:#17171e;border:1px solid #2a2a38;padding:32px;margin-bottom:24px;border-radius:4px">
      <p style="font-family:sans-serif;font-size:11px;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:#00d4ff;margin:0 0 8px">Order Confirmed</p>
      <h2 style="font-family:sans-serif;font-size:28px;font-weight:700;color:#f0f0f8;margin:0 0 16px">You're in, ${customerName}!</h2>
      <p style="font-family:sans-serif;font-size:15px;color:#8888aa;margin:0;line-height:1.6">
        ${hasTickets ? 'Your tickets are below. Show the QR code at the door for entry.' : ''}
        ${hasMerch ? 'Your merch order has been received and will be available for pickup or shipping.' : ''}
      </p>
    </div>

    ${hasTickets ? `
    <h3 style="font-family:sans-serif;font-size:11px;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:#8888aa;margin:0 0 16px">Your Tickets</h3>
    ${ticketCards}` : ''}

    ${hasMerch ? `
    <div style="background:#17171e;border:1px solid #2a2a38;padding:24px;margin-bottom:24px;border-radius:4px">
      <h3 style="font-family:sans-serif;font-size:11px;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:#8888aa;margin:0 0 16px">Merch Order</h3>
      <table style="width:100%;border-collapse:collapse">
        ${merchRows}
      </table>
    </div>` : ''}

    <div style="text-align:center;margin-top:40px">
      <p style="font-family:sans-serif;font-size:12px;color:#2a2a38;text-transform:uppercase;letter-spacing:0.2em">© 2026 miXtape Wrestling</p>
    </div>
  </div>
</body>
</html>`;

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + RESEND_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'miXtape Wrestling <onboarding@resend.dev>',
            to: customerEmail,
            subject: hasTickets ? `Your tickets for ${ticketTiers[0] ? 'Vol. 1 — Press Play' : 'miXtape Wrestling'}` : 'Your miXtape Wrestling order',
            html: emailHtml,
          }),
        });
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
