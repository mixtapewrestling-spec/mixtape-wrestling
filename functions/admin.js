const ADMIN_PIN = 'MIXTAPE_ADMIN_2026';

export async function onRequestGet(context) {
  try {
    const cookie = context.request.headers.get('cookie') || '';
    const authed = cookie.includes('mx_admin=true');

    if (!authed) {
      return new Response(loginPage(), { headers: { 'Content-Type': 'text/html' } });
    }

    const db = context.env.DB;
    const url = new URL(context.request.url);
    const section = url.searchParams.get('s') || 'dashboard';
    const eventId = url.searchParams.get('event') || '1';

    // Fetch data
    const events = await db.prepare("SELECT * FROM events ORDER BY id DESC").all();
    const ticketTypes = await db.prepare("SELECT * FROM ticket_types WHERE event_id = ?").bind(eventId).all();
    const tickets = await db.prepare("SELECT t.*, tt.name as tier_name FROM tickets t JOIN ticket_types tt ON t.ticket_type_id = tt.id WHERE t.event_id = ? ORDER BY tt.name, t.customer_name").bind(eventId).all();
    const salesByTier = await db.prepare("SELECT tt.name, COUNT(t.id) as sold, tt.capacity, tt.price_cents FROM ticket_types tt LEFT JOIN tickets t ON tt.id = t.ticket_type_id WHERE tt.event_id = ? GROUP BY tt.id").bind(eventId).all();
    const currentEvent = events.results.find(e => e.id == eventId) || events.results[0];

    return new Response(adminPage(section, events.results, currentEvent, ticketTypes.results, tickets.results, salesByTier.results), {
      headers: { 'Content-Type': 'text/html' }
    });

  } catch(err) {
    return new Response('Error: ' + err.message, { status: 500 });
  }
}

export async function onRequestPost(context) {
  try {
    const cookie = context.request.headers.get('cookie') || '';
    const url = new URL(context.request.url);
    const action = url.searchParams.get('action') || '';

    // Handle login
    if (action === 'login') {
      const body = await context.request.formData();
      const pin = body.get('pin') || '';
      if (pin === ADMIN_PIN) {
        return new Response('', {
          status: 302,
          headers: {
            'Location': '/admin',
            'Set-Cookie': 'mx_admin=true; path=/admin; max-age=86400; SameSite=Lax'
          }
        });
      }
      return new Response(loginPage('Invalid PIN'), { headers: { 'Content-Type': 'text/html' } });
    }

    const authed = cookie.includes('mx_admin=true');
    if (!authed) return new Response('Unauthorized', { status: 401 });

    const db = context.env.DB;
    const body = await context.request.formData();

    if (action === 'update-event') {
      const id = body.get('id');
      const name = body.get('name');
      const date = body.get('date');
      const venue = body.get('venue');
      const active = body.get('active') === '1' ? 1 : 0;
      await db.prepare("UPDATE events SET name = ?, date = ?, venue = ?, active = ? WHERE id = ?")
        .bind(name, date, venue, active, id).run();
      return new Response('', { status: 302, headers: { 'Location': '/admin?s=events&event=' + id } });
    }

    if (action === 'update-tier') {
      const id = body.get('id');
      const eventId = body.get('event_id');
      const price = Math.round(parseFloat(body.get('price')) * 100);
      const capacity = parseInt(body.get('capacity'));
      await db.prepare("UPDATE ticket_types SET price_cents = ?, capacity = ? WHERE id = ?")
        .bind(price, capacity, id).run();
      return new Response('', { status: 302, headers: { 'Location': '/admin?s=events&event=' + eventId } });
    }

    return new Response('Unknown action', { status: 400 });

  } catch(err) {
    return new Response('Error: ' + err.message, { status: 500 });
  }
}

function loginPage(error) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Admin — miXtape Wrestling</title>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --black:#0a0a0c;--charcoal:#111116;--surface:#17171e;--border:#2a2a38;--cyan:#00d4ff;--teal:#00f5d4;--white:#f0f0f8;--muted:#8888aa;--font-display:'Bebas Neue',sans-serif;--font-ui:'Barlow Condensed',sans-serif; }
    body { background:var(--black);color:var(--white);font-family:var(--font-ui);min-height:100vh;display:flex;align-items:center;justify-content:center; }
    .wrap { width:100%;max-width:400px;padding:2rem;text-align:center; }
    .logo { font-family:var(--font-display);font-size:3rem;letter-spacing:0.05em;margin-bottom:0.25rem; }
    .sub { font-size:0.7rem;font-weight:700;letter-spacing:0.4em;text-transform:uppercase;color:var(--muted);margin-bottom:2.5rem; }
    .box { background:var(--surface);border:1px solid var(--border);padding:2rem;clip-path:polygon(0 0,calc(100% - 16px) 0,100% 16px,100% 100%,16px 100%,0 calc(100% - 16px)); }
    .label { font-size:0.7rem;font-weight:700;letter-spacing:0.35em;text-transform:uppercase;color:var(--cyan);margin-bottom:1.25rem; }
    input { width:100%;background:var(--charcoal);border:1px solid var(--border);color:var(--white);font-family:var(--font-display);font-size:2rem;letter-spacing:0.1em;text-align:center;text-transform:uppercase;padding:0.75rem 1rem;outline:none;border-radius:0;margin-bottom:1rem;-webkit-appearance:none; }
    input:focus { border-color:var(--cyan); }
    button { width:100%;font-family:var(--font-ui);font-size:1rem;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:var(--black);background:linear-gradient(135deg,var(--cyan),var(--teal));border:none;cursor:pointer;padding:1rem;clip-path:polygon(12px 0%,100% 0%,calc(100% - 12px) 100%,0% 100%); }
    .err { font-size:0.8rem;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#ff6b6b;margin-top:0.75rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="logo">miXtape</div>
    <p class="sub">Admin Access</p>
    <div class="box">
      <p class="label">Enter Admin PIN</p>
      <form method="POST" action="/admin?action=login">
        <input type="password" name="pin" placeholder="PIN" autocomplete="off" autofocus />
        <button type="submit">Enter</button>
      </form>
      ${error ? `<p class="err">${error}</p>` : ''}
    </div>
  </div>
</body>
</html>`;
}

function adminPage(section, events, currentEvent, ticketTypes, tickets, salesByTier) {
  const eventOptions = events.map(e => `<option value="${e.id}" ${e.id == currentEvent?.id ? 'selected' : ''}>${e.name}</option>`).join('');
  const totalSold = salesByTier.reduce((sum, t) => sum + (t.sold || 0), 0);
  const totalRevenue = tickets.reduce((sum, t) => sum + 0, 0);

  const salesCards = salesByTier.map(t => {
    const sold = t.sold || 0;
    const remaining = t.capacity - sold;
    const pct = Math.round((sold / t.capacity) * 100);
    const price = (t.price_cents / 100).toFixed(2);
    const revenue = ((t.price_cents * sold) / 100).toFixed(2);
    return `
    <div class="stat-card">
      <div class="stat-label">${t.name}</div>
      <div class="stat-num">${sold}<span>/${t.capacity}</span></div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="stat-sub">$${revenue} · $${price} each · ${remaining} left</div>
    </div>`;
  }).join('');

  const tierForms = ticketTypes.map(t => `
    <form method="POST" action="/admin?action=update-tier&event=${currentEvent?.id}" class="tier-form">
      <input type="hidden" name="id" value="${t.id}" />
      <input type="hidden" name="event_id" value="${t.event_id}" />
      <div class="tier-form-row">
        <div class="tier-form-name">${t.name}</div>
        <div class="form-group">
          <label>Price ($)</label>
          <input type="number" name="price" value="${(t.price_cents/100).toFixed(2)}" step="0.50" min="0" />
        </div>
        <div class="form-group">
          <label>Capacity</label>
          <input type="number" name="capacity" value="${t.capacity}" min="0" />
        </div>
        <button type="submit" class="save-btn">Save</button>
      </div>
    </form>`).join('');

  const ticketRows = tickets.map((t, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${t.customer_name || '—'}</td>
      <td>${t.customer_email}</td>
      <td><span class="tier-badge">${t.tier_name}</span></td>
      <td>${t.ticket_uid.substring(0,8).toUpperCase()}</td>
      <td>${t.used ? '<span class="checked-in">✓ In</span>' : '<span class="not-in">—</span>'}</td>
    </tr>`).join('');

  const printRows = tickets.map((t, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${t.customer_name || '—'}</td>
      <td>${t.tier_name}</td>
      <td>${t.ticket_uid.substring(0,8).toUpperCase()}</td>
      <td>□</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Admin — miXtape Wrestling</title>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@400;600;700&family=Barlow:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --black:#0a0a0c;--charcoal:#111116;--surface:#17171e;--border:#2a2a38;--cyan:#00d4ff;--teal:#00f5d4;--purple:#9b59ff;--white:#f0f0f8;--muted:#8888aa;--font-display:'Bebas Neue',sans-serif;--font-ui:'Barlow Condensed',sans-serif;--font-body:'Barlow',sans-serif; }
    body { background:var(--black);color:var(--white);font-family:var(--font-body);min-height:100vh; }
    header { padding:1rem 2rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;background:rgba(10,10,12,0.9); }
    .logo { font-family:var(--font-display);font-size:1.6rem;letter-spacing:0.05em; }
    .admin-badge { font-family:var(--font-ui);font-size:0.65rem;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:var(--black);background:var(--purple);padding:0.3rem 0.75rem; }
    .layout { display:grid;grid-template-columns:220px 1fr;min-height:calc(100vh - 65px); }
    .sidebar { border-right:1px solid var(--border);padding:1.5rem 0;background:var(--charcoal); }
    .nav-section { font-family:var(--font-ui);font-size:0.6rem;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:var(--muted);padding:0 1.5rem;margin-bottom:0.5rem;margin-top:1.5rem; }
    .nav-section:first-child { margin-top:0; }
    .nav-link { display:block;font-family:var(--font-ui);font-size:0.9rem;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);text-decoration:none;padding:0.6rem 1.5rem;transition:all 0.2s; }
    .nav-link:hover,.nav-link.active { color:var(--cyan);background:rgba(0,212,255,0.05);border-left:2px solid var(--cyan); }
    .main { padding:2rem; }
    .page-title { font-family:var(--font-display);font-size:2.5rem;letter-spacing:0.05em;margin-bottom:0.25rem; }
    .page-sub { font-family:var(--font-ui);font-size:0.75rem;font-weight:600;letter-spacing:0.2em;text-transform:uppercase;color:var(--muted);margin-bottom:2rem; }
    .event-selector { display:flex;align-items:center;gap:1rem;margin-bottom:2rem;padding:1rem 1.5rem;background:var(--surface);border:1px solid var(--border); }
    .event-selector label { font-family:var(--font-ui);font-size:0.7rem;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:var(--muted);white-space:nowrap; }
    .event-selector select { flex:1;background:var(--charcoal);border:1px solid var(--border);color:var(--white);font-family:var(--font-ui);font-size:1rem;font-weight:600;padding:0.5rem 0.75rem;outline:none;cursor:pointer; }
    .stats-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem;margin-bottom:2rem; }
    .stat-card { background:var(--surface);border:1px solid var(--border);padding:1.25rem;clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%); }
    .stat-label { font-family:var(--font-ui);font-size:0.7rem;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;color:var(--muted);margin-bottom:0.5rem; }
    .stat-num { font-family:var(--font-display);font-size:2.5rem;letter-spacing:0.05em;color:var(--cyan);line-height:1; }
    .stat-num span { font-size:1.2rem;color:var(--muted); }
    .progress-bar { height:4px;background:var(--border);margin:0.5rem 0;border-radius:2px; }
    .progress-fill { height:100%;background:linear-gradient(90deg,var(--cyan),var(--teal));border-radius:2px; }
    .stat-sub { font-family:var(--font-ui);font-size:0.7rem;font-weight:600;letter-spacing:0.1em;color:var(--muted); }
    .section-title { font-family:var(--font-display);font-size:1.5rem;letter-spacing:0.05em;margin-bottom:1rem;padding-bottom:0.5rem;border-bottom:1px solid var(--border); }
    .card { background:var(--surface);border:1px solid var(--border);padding:1.5rem;margin-bottom:1.5rem; }
    .form-row { display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem; }
    .form-group { display:flex;flex-direction:column;gap:0.35rem; }
    .form-group label { font-family:var(--font-ui);font-size:0.65rem;font-weight:700;letter-spacing:0.25em;text-transform:uppercase;color:var(--muted); }
    .form-group input,.form-group select { background:var(--charcoal);border:1px solid var(--border);color:var(--white);font-family:var(--font-body);font-size:0.95rem;padding:0.6rem 0.85rem;outline:none;border-radius:0;transition:border-color 0.2s;-webkit-appearance:none; }
    .form-group input:focus { border-color:var(--cyan); }
    .save-btn { font-family:var(--font-ui);font-size:0.8rem;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:var(--black);background:var(--cyan);border:none;cursor:pointer;padding:0.6rem 1.25rem;clip-path:polygon(6px 0%,100% 0%,calc(100% - 6px) 100%,0% 100%);transition:background 0.2s;white-space:nowrap; }
    .save-btn:hover { background:var(--teal); }
    .danger-btn { font-family:var(--font-ui);font-size:0.8rem;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:var(--white);background:transparent;border:1px solid #ff6b6b;cursor:pointer;padding:0.6rem 1.25rem;transition:all 0.2s; }
    .danger-btn:hover { background:#ff6b6b;color:var(--black); }
    .tier-form { margin-bottom:0.75rem;background:var(--charcoal);border:1px solid var(--border);padding:1rem; }
    .tier-form-row { display:grid;grid-template-columns:1fr 120px 120px auto;align-items:end;gap:1rem; }
    .tier-form-name { font-family:var(--font-display);font-size:1.3rem;letter-spacing:0.05em; }
    .active-toggle { display:flex;align-items:center;gap:0.75rem; }
    .active-toggle label { font-family:var(--font-ui);font-size:0.8rem;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:var(--muted); }
    .active-toggle select { background:var(--charcoal);border:1px solid var(--border);color:var(--white);font-family:var(--font-ui);font-size:0.9rem;font-weight:600;padding:0.5rem 0.75rem;outline:none; }
    .table-wrap { overflow-x:auto; }
    table { width:100%;border-collapse:collapse;font-family:var(--font-ui);font-size:0.85rem; }
    th { font-size:0.65rem;font-weight:700;letter-spacing:0.25em;text-transform:uppercase;color:var(--muted);padding:0.75rem 1rem;text-align:left;border-bottom:1px solid var(--border);background:var(--charcoal); }
    td { padding:0.75rem 1rem;border-bottom:1px solid var(--border);color:var(--white); }
    tr:last-child td { border-bottom:none; }
    tr:hover td { background:rgba(0,212,255,0.03); }
    .tier-badge { font-family:var(--font-ui);font-size:0.65rem;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;background:rgba(155,89,255,0.2);color:var(--violet,#c77dff);padding:0.2rem 0.6rem; }
    .checked-in { color:var(--teal);font-weight:700; }
    .not-in { color:var(--muted); }
    .print-btn { font-family:var(--font-ui);font-size:0.85rem;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:var(--black);background:var(--cyan);border:none;cursor:pointer;padding:0.65rem 1.5rem;clip-path:polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%);margin-bottom:1.5rem; }
    .print-area { display:none; }
    @media print {
      header,.sidebar,.no-print { display:none !important; }
      .layout { grid-template-columns:1fr; }
      .print-area { display:block !important; }
      .screen-only { display:none !important; }
      body { background:white;color:black; }
      table { font-size:12px; }
      th,td { border:1px solid #ccc;padding:6px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="logo">miXtape <span style="color:var(--muted);font-size:1rem">Admin</span></div>
    <div class="admin-badge">Admin Panel</div>
  </header>
  <div class="layout">
    <nav class="sidebar">
      <p class="nav-section">Overview</p>
      <a href="/admin?s=dashboard&event=${currentEvent?.id}" class="nav-link ${section==='dashboard'?'active':''}">Dashboard</a>
      <p class="nav-section">Management</p>
      <a href="/admin?s=events&event=${currentEvent?.id}" class="nav-link ${section==='events'?'active':''}">Events & Tiers</a>
      <a href="/admin?s=tickets&event=${currentEvent?.id}" class="nav-link ${section==='tickets'?'active':''}">Ticket Sales</a>
      <a href="/admin?s=doorlist&event=${currentEvent?.id}" class="nav-link ${section==='doorlist'?'active':''}">Door List</a>
    </nav>
    <main class="main">

      <div class="event-selector">
        <label>Viewing Event:</label>
        <select onchange="window.location.href='/admin?s=${section}&event='+this.value">
          ${eventOptions}
        </select>
      </div>

      ${section === 'dashboard' ? `
        <h1 class="page-title">Dashboard</h1>
        <p class="page-sub">${currentEvent?.name || 'No event selected'}</p>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Total Sold</div>
            <div class="stat-num">${totalSold}</div>
            <div class="stat-sub">tickets across all sections</div>
          </div>
          ${salesCards}
        </div>
      ` : ''}

      ${section === 'events' ? `
        <h1 class="page-title">Events & Tiers</h1>
        <p class="page-sub">Update event details and ticket pricing</p>
        ${currentEvent ? `
        <div class="card">
          <p class="section-title">Event Details</p>
          <form method="POST" action="/admin?action=update-event">
            <input type="hidden" name="id" value="${currentEvent.id}" />
            <div class="form-row">
              <div class="form-group">
                <label>Event Name</label>
                <input type="text" name="name" value="${currentEvent.name}" />
              </div>
              <div class="form-group">
                <label>Date</label>
                <input type="text" name="date" value="${currentEvent.date || ''}" placeholder="e.g. Sat Aug 16, 2026" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Venue</label>
                <input type="text" name="venue" value="${currentEvent.venue || ''}" placeholder="Venue name and city" />
              </div>
              <div class="form-group">
                <label>Status</label>
                <select name="active">
                  <option value="1" ${currentEvent.active ? 'selected' : ''}>Active — Live on site</option>
                  <option value="0" ${!currentEvent.active ? 'selected' : ''}>Inactive — Hidden</option>
                </select>
              </div>
            </div>
            <button type="submit" class="save-btn">Save Event</button>
          </form>
        </div>
        <div class="card">
          <p class="section-title">Ticket Tiers</p>
          ${tierForms}
        </div>` : '<p>No event found.</p>'}
      ` : ''}

      ${section === 'tickets' ? `
        <h1 class="page-title">Ticket Sales</h1>
        <p class="page-sub">${tickets.length} tickets sold for ${currentEvent?.name}</p>
        <div class="card screen-only">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Section</th>
                  <th>Ticket ID</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>${ticketRows}</tbody>
            </table>
          </div>
        </div>
      ` : ''}

      ${section === 'doorlist' ? `
        <h1 class="page-title">Door List</h1>
        <p class="page-sub">${currentEvent?.name} · ${tickets.length} tickets</p>
        <button class="print-btn no-print" onclick="window.print()">🖨 Print Door List</button>
        <div class="card screen-only">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Section</th>
                  <th>Ticket ID</th>
                  <th>✓</th>
                </tr>
              </thead>
              <tbody>${printRows}</tbody>
            </table>
          </div>
        </div>
        <div class="print-area">
          <h2 style="font-family:serif;margin-bottom:0.5rem">${currentEvent?.name} — Door List</h2>
          <p style="font-size:12px;margin-bottom:1rem;color:#666">${tickets.length} total tickets · Printed ${new Date().toLocaleDateString()}</p>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Section</th>
                <th>Ticket ID</th>
                <th>✓ Check In</th>
              </tr>
            </thead>
            <tbody>${printRows}</tbody>
          </table>
        </div>
      ` : ''}

    </main>
  </div>
</body>
</html>`;
}
