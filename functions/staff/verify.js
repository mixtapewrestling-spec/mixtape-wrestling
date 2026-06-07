export async function onRequestGet(context) {
  const cookie = context.request.headers.get('cookie') || '';
  const authed = cookie.includes('mx_staff=true');

  if (!authed) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Staff Access — miXtape Wrestling</title>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --black:#0a0a0c;--charcoal:#111116;--surface:#17171e;--border:#2a2a38;
      --cyan:#00d4ff;--teal:#00f5d4;--white:#f0f0f8;--muted:#8888aa;
      --font-display:'Bebas Neue',sans-serif;
      --font-ui:'Barlow Condensed',sans-serif;
    }
    body { background:var(--black);color:var(--white);font-family:var(--font-ui);min-height:100vh;display:flex;align-items:center;justify-content:center; }
    .wrap { width:100%;max-width:400px;padding:2rem;text-align:center; }
    .logo { font-family:var(--font-display);font-size:3rem;letter-spacing:0.05em;margin-bottom:0.25rem; }
    .sub { font-size:0.7rem;font-weight:700;letter-spacing:0.4em;text-transform:uppercase;color:var(--muted);margin-bottom:2.5rem; }
    .box { background:var(--surface);border:1px solid var(--border);padding:2rem;clip-path:polygon(0 0,calc(100% - 16px) 0,100% 16px,100% 100%,16px 100%,0 calc(100% - 16px)); }
    .label { font-size:0.7rem;font-weight:700;letter-spacing:0.35em;text-transform:uppercase;color:var(--cyan);margin-bottom:1.25rem; }
    input { width:100%;background:var(--charcoal);border:1px solid var(--border);color:var(--white);font-family:var(--font-display);font-size:2rem;letter-spacing:0.1em;text-align:center;text-transform:uppercase;padding:0.75rem 1rem;outline:none;border-radius:0;margin-bottom:1rem;-webkit-appearance:none; }
    input:focus { border-color:var(--cyan); }
    button { width:100%;font-family:var(--font-ui);font-size:1rem;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--black);background:linear-gradient(135deg,var(--cyan),var(--teal));border:none;cursor:pointer;padding:1rem;clip-path:polygon(12px 0%,100% 0%,calc(100% - 12px) 100%,0% 100%); }
    .err { font-size:0.8rem;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#ff6b6b;margin-top:0.75rem;display:none; }
    .err.show { display:block; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="logo">miXtape</div>
    <p class="sub">Staff Access Only</p>
    <div class="box">
      <p class="label">Enter Staff PIN</p>
      <input type="password" id="pin" placeholder="PIN" autocomplete="off" />
      <button onclick="check()">Enter</button>
      <p class="err" id="err">Invalid PIN</p>
    </div>
  </div>
  <script>
    document.getElementById('pin').addEventListener('keydown', function(e) { if (e.key === 'Enter') check(); });
    function check() {
      var val = document.getElementById('pin').value.trim();
      if (val === 'MIXTAPE2026') {
        document.cookie = 'mx_staff=true; path=/staff; max-age=43200';
        window.location.reload();
      } else {
        document.getElementById('err').classList.add('show');
        document.getElementById('pin').value = '';
      }
    }
  </script>
</body>
</html>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  }

  const url = new URL(context.request.url);
  const ticketUid = url.searchParams.get('t') || '';
  const db = context.env.DB;

  let result = null;
  let ticket = null;

  if (ticketUid) {
    ticket = await db
      .prepare("SELECT t.*, tt.name as tier_name, e.name as event_name FROM tickets t JOIN ticket_types tt ON t.ticket_type_id = tt.id JOIN events e ON t.event_id = e.id WHERE t.ticket_uid = ?")
      .bind(ticketUid)
      .first();

    if (!ticket) {
      result = 'invalid';
    } else if (ticket.used) {
      result = 'used';
    } else {
      await db.prepare("UPDATE tickets SET used = 1 WHERE ticket_uid = ?").bind(ticketUid).run();
      result = 'valid';
    }
  }

  const statusHTML = result === 'valid' ? `
    <div class="status valid">
      <div class="status-icon">✓</div>
      <div class="status-title">Valid — Check In</div>
      <div class="status-tier">${ticket.tier_name}</div>
      <div class="status-name">${ticket.customer_name}</div>
      <div class="status-event">${ticket.event_name}</div>
    </div>` :
    result === 'used' ? `
    <div class="status used">
      <div class="status-icon">✕</div>
      <div class="status-title">Already Scanned</div>
      <div class="status-tier">${ticket.tier_name}</div>
      <div class="status-name">${ticket.customer_name}</div>
    </div>` :
    result === 'invalid' ? `
    <div class="status invalid">
      <div class="status-icon">?</div>
      <div class="status-title">Invalid Ticket</div>
      <div class="status-sub">This ticket does not exist</div>
    </div>` : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Door Verify — miXtape Wrestling</title>
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
    body { background:var(--black);color:var(--white);font-family:var(--font-body);min-height:100vh; }
    header { padding:1rem 1.5rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between; }
    .logo { font-family:var(--font-display);font-size:1.6rem;letter-spacing:0.05em; }
    .staff-badge { font-family:var(--font-ui);font-size:0.65rem;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:var(--black);background:var(--cyan);padding:0.3rem 0.75rem; }
    .wrap { max-width:500px;margin:0 auto;padding:2rem 1.5rem; }
    .scan-box { background:var(--surface);border:1px solid var(--border);padding:1.5rem;margin-bottom:1.5rem;clip-path:polygon(0 0,calc(100% - 16px) 0,100% 16px,100% 100%,16px 100%,0 calc(100% - 16px)); }
    .scan-label { font-family:var(--font-ui);font-size:0.7rem;font-weight:700;letter-spacing:0.35em;text-transform:uppercase;color:var(--cyan);margin-bottom:0.75rem; }
    .scan-input-row { display:flex;gap:0.75rem; }
    input { flex:1;background:var(--charcoal);border:1px solid var(--border);color:var(--white);font-family:var(--font-ui);font-size:1rem;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;padding:0.75rem 1rem;outline:none;border-radius:0;-webkit-appearance:none; }
    input:focus { border-color:var(--cyan); }
    .scan-btn { font-family:var(--font-ui);font-size:0.8rem;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:var(--black);background:var(--cyan);border:none;cursor:pointer;padding:0.75rem 1.25rem;clip-path:polygon(6px 0%,100% 0%,calc(100% - 6px) 100%,0% 100%);white-space:nowrap; }
    .status { padding:2rem;text-align:center;clip-path:polygon(0 0,calc(100% - 20px) 0,100% 20px,100% 100%,20px 100%,0 calc(100% - 20px)); }
    .status.valid { background:rgba(0,245,212,0.15);border:1px solid var(--teal); }
    .status.used { background:rgba(255,107,107,0.15);border:1px solid #ff6b6b; }
    .status.invalid { background:rgba(136,136,170,0.1);border:1px solid var(--muted); }
    .status-icon { font-size:4rem;margin-bottom:0.5rem; }
    .status.valid .status-icon { color:var(--teal); }
    .status.used .status-icon { color:#ff6b6b; }
    .status.invalid .status-icon { color:var(--muted); }
    .status-title { font-family:var(--font-display);font-size:2.5rem;letter-spacing:0.05em;margin-bottom:0.5rem; }
    .status.valid .status-title { color:var(--teal); }
    .status.used .status-title { color:#ff6b6b; }
    .status.invalid .status-title { color:var(--muted); }
    .status-tier { font-family:var(--font-ui);font-size:0.75rem;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:var(--black);background:var(--cyan);display:inline-block;padding:0.3rem 0.75rem;margin-bottom:0.75rem; }
    .status-name { font-family:var(--font-display);font-size:1.8rem;letter-spacing:0.05em;margin-bottom:0.25rem; }
    .status-event { font-family:var(--font-ui);font-size:0.8rem;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted); }
    .status-sub { font-family:var(--font-ui);font-size:0.9rem;font-weight:600;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted); }
    .clear-btn { display:block;width:100%;margin-top:1.5rem;font-family:var(--font-ui);font-size:0.85rem;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted);background:transparent;border:1px solid var(--border);cursor:pointer;padding:0.75rem;text-align:center;text-decoration:none; }
    .clear-btn:hover { color:var(--cyan);border-color:var(--cyan); }
  </style>
</head>
<body>
  <header>
    <div class="logo">miXtape</div>
    <div class="staff-badge">Door Staff</div>
  </header>
  <div class="wrap">
    <div class="scan-box">
      <p class="scan-label">Scan or Enter Ticket ID</p>
      <div class="scan-input-row">
        <input type="text" id="ticketInput" placeholder="Ticket ID" autocomplete="off" autocorrect="off" autocapitalize="characters" />
        <button class="scan-btn" onclick="verify()">Verify</button>
      </div>
    </div>
    ${statusHTML}
    ${result ? '<a href="/staff/verify" class="clear-btn">← Scan Next Ticket</a>' : ''}
  </div>
  <script>
    document.getElementById('ticketInput').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') verify();
    });
    function verify() {
      var val = document.getElementById('ticketInput').value.trim();
      if (!val) return;
      window.location.href = '/staff/verify?t=' + encodeURIComponent(val);
    }
    ${!result ? "document.getElementById('ticketInput').focus();" : ''}
  </script>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html' } });
}
