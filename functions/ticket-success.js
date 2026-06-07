import QRCode from 'qrcode';

export async function onRequestGet(context) {
  const { searchParams } = new URL(context.request.url);
  const sessionId = searchParams.get('session_id');

  if (!sessionId) {
    return new Response('Missing session ID', { status: 400 });
  }

  const STRIPE_SECRET_KEY = context.env.STRIPE_SECRET_KEY;
  const SITE_URL = context.env.SITE_URL ?? 'https://mixtapewrestling.com';

  // Fetch the Stripe session
  const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });

  const session = await stripeRes.json();

  if (!stripeRes.ok || session.payment_status !== 'paid') {
    return new Response('Payment not found or not completed', { status: 404 });
  }

  const meta = session.metadata;
  const customerEmail = meta.customer_email;
  const customerName = meta.customer_name;
  const tierName = meta.tier_name;
  const tierId = parseInt(meta.tier_id);
  const quantity = parseInt(meta.quantity);
  const db = context.env.DB;

  // Generate tickets
  const tickets = [];
  for (let i = 0; i < quantity; i++) {
    const uid = crypto.randomUUID();
    await db.prepare(
      "INSERT OR IGNORE INTO tickets (event_id, ticket_type_id, ticket_uid, customer_name, customer_email, stripe_payment_id) VALUES (1, ?, ?, ?, ?, ?)"
    ).bind(tierId, uid, customerName, customerEmail, sessionId).run();
    tickets.push(uid);
  }

  // Generate QR codes
  const qrCodes = await Promise.all(
    tickets.map(uid =>
      QRCode.toDataURL(`${SITE_URL}/verify/${uid}`, {
        width: 300,
        margin: 2,
        color: { dark: '#00d4ff', light: '#0a0a0c' },
      })
    )
  );

  const ticketCards = tickets.map((uid, i) => `
    <div class="ticket-card">
      <div class="ticket-header">
        <div class="ticket-event">Vol. 1 — Press Play</div>
        <div class="ticket-tier">${tierName}</div>
      </div>
      <div class="ticket-qr">
        <img src="${qrCodes[i]}" alt="Ticket QR Code" />
      </div>
      <div class="ticket-footer">
        <div class="ticket-id">TICKET ${i + 1} OF ${quantity}</div>
        <div class="ticket-uid">${uid.substring(0, 8).toUpperCase()}</div>
      </div>
    </div>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Tickets — miXtape Wrestling</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@400;600;700&family=Barlow:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --black:#0a0a0c;--charcoal:#111116;--surface:#17171e;--border:#2a2a38;
      --cyan:#00d4ff;--teal:#00f5d4;--white:#f0f0f8;--muted:#8888aa;
      --font-display:'Bebas Neue',sans-serif;
      --font-ui:'Barlow Condensed',sans-serif;
      --font-body:'Barlow',sans-serif;
    }
    body { background:var(--black);color:var(--white);font-family:var(--font-body);min-height:100vh;overflow-x:hidden; }
    body::before {
      content:'';position:fixed;inset:0;
      background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E");
      pointer-events:none;z-index:9999;opacity:0.35;
    }
    .holo-text {
      background:linear-gradient(135deg,#00d4ff,#9b59ff,#ff6ec7,#00f5d4,#00d4ff);
      background-size:300% 300%;-webkit-background-clip:text;-webkit-text-fill-color:transparent;
      background-clip:text;animation:holo-shift 4s ease infinite;
    }
    @keyframes holo-shift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
    nav {
      position:fixed;top:0;left:0;right:0;z-index:100;
      display:flex;align-items:center;justify-content:space-between;
      padding:0 2.5rem;height:64px;
      background:rgba(10,10,12,0.88);backdrop-filter:blur(12px);
      border-bottom:1px solid var(--border);
    }
    .nav-logo{font-family:var(--font-display);font-size:1.6rem;letter-spacing:0.05em;text-decoration:none;line-height:1;}
    .page-wrap { padding: 6rem 2rem 4rem; max-width: 800px; margin: 0 auto; }
    .success-header { text-align: center; margin-bottom: 3rem; }
    .success-eyebrow { font-family:var(--font-ui);font-size:0.8rem;font-weight:700;letter-spacing:0.35em;text-transform:uppercase;color:var(--teal);margin-bottom:0.75rem; }
    .success-title { font-family:var(--font-display);font-size:clamp(2.5rem,8vw,5rem);line-height:0.9;margin-bottom:1rem; }
    .success-sub { font-family:var(--font-ui);font-size:1rem;font-weight:600;letter-spacing:0.1em;color:var(--muted); }
    .tickets-wrap { display:flex;flex-direction:column;gap:2rem; }
    .ticket-card {
      background:var(--surface);
      border:1px solid var(--border);
      clip-path:polygon(0 0,calc(100% - 24px) 0,100% 24px,100% 100%,24px 100%,0 calc(100% - 24px));
      overflow:hidden;
    }
    .ticket-header {
      background:linear-gradient(135deg,rgba(155,89,255,0.2),rgba(0,212,255,0.1));
      border-bottom:1px solid var(--border);
      padding:1.5rem 2rem;
      display:flex;justify-content:space-between;align-items:center;
    }
    .ticket-event { font-family:var(--font-display);font-size:1.8rem;letter-spacing:0.05em; }
    .ticket-tier {
      font-family:var(--font-ui);font-size:0.75rem;font-weight:700;
      letter-spacing:0.3em;text-transform:uppercase;
      color:var(--black);background:var(--cyan);
      padding:0.4rem 1rem;
      clip-path:polygon(6px 0%,100% 0%,calc(100% - 6px) 100%,0% 100%);
    }
    .ticket-qr {
      display:flex;justify-content:center;
      padding:2rem;background:var(--charcoal);
      border-bottom:1px solid var(--border);
    }
    .ticket-qr img { width:200px;height:200px;display:block; }
    .ticket-footer {
      padding:1rem 2rem;
      display:flex;justify-content:space-between;align-items:center;
    }
    .ticket-id { font-family:var(--font-ui);font-size:0.7rem;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:var(--muted); }
    .ticket-uid { font-family:var(--font-display);font-size:1.4rem;letter-spacing:0.1em;color:var(--cyan); }
    .actions { margin-top:2rem;text-align:center;display:flex;gap:1rem;justify-content:center;flex-wrap:wrap; }
    .btn-primary {
      font-family:var(--font-ui);font-size:0.9rem;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;
      color:var(--black);background:linear-gradient(135deg,var(--cyan),var(--teal));
      padding:0.9rem 2.5rem;text-decoration:none;
      clip-path:polygon(12px 0%,100% 0%,calc(100% - 12px) 100%,0% 100%);
      transition:transform 0.2s,box-shadow 0.2s;box-shadow:0 0 20px rgba(0,212,255,0.3);
    }
    .btn-primary:hover{transform:translateY(-2px);box-shadow:0 0 35px rgba(0,212,255,0.5);}
    .btn-secondary {
      font-family:var(--font-ui);font-size:0.9rem;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;
      color:var(--cyan);background:transparent;border:1px solid var(--cyan);
      padding:0.9rem 2.5rem;text-decoration:none;
      clip-path:polygon(12px 0%,100% 0%,calc(100% - 12px) 100%,0% 100%);
      transition:background 0.2s,transform 0.2s;
    }
    .btn-secondary:hover{background:rgba(0,212,255,0.1);transform:translateY(-2px);}
    .email-note { margin-top:1.5rem;font-family:var(--font-ui);font-size:0.8rem;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);text-align:center; }
    @media print {
      nav, .actions, .email-note { display:none; }
      body::before { display:none; }
      .ticket-card { break-inside:avoid; }
    }
  </style>
</head>
<body>
  <nav>
    <a href="/" class="nav-logo"><span class="holo-text">miX</span><span style="color:var(--white)">tape</span></a>
  </nav>
  <div class="page-wrap">
    <div class="success-header">
      <p class="success-eyebrow">Payment Confirmed</p>
      <h1 class="success-title"><span class="holo-text">You're In!</span></h1>
      <p class="success-sub">Welcome, ${customerName} — your ticket${quantity > 1 ? 's are' : ' is'} below</p>
    </div>
    <div class="tickets-wrap">
      ${ticketCards}
    </div>
    <div class="actions">
      <a href="javascript:window.print()" class="btn-primary">Print Tickets</a>
      <a href="/" class="btn-secondary">Back to Home</a>
    </div>
    <p class="email-note">📧 A copy has also been sent to ${customerEmail}</p>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}
