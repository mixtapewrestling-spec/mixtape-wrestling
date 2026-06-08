const ADMIN_PIN = 'MIXTAPE_ADMIN_2026';
const R2_PUBLIC = 'https://pub-d279b52b4fc34ba29a6b18826682953e.r2.dev';

export async function onRequestGet(context) {
  try {
    const cookie = context.request.headers.get('cookie') || '';
    const authed = cookie.includes('mx_admin=true');
    if (!authed) return new Response(loginPage(), { headers: { 'Content-Type': 'text/html' } });

    const db = context.env.DB;
    const url = new URL(context.request.url);
    const section = url.searchParams.get('s') || 'dashboard';
    const eventId = url.searchParams.get('event') || '';

    const eventsRes = await db.prepare("SELECT * FROM events ORDER BY id DESC").all();
    const events = eventsRes.results ?? [];
    const currentEvent = events.find(e => e.id == eventId) || events[0];
    const eid = currentEvent?.id || 1;

    const ticketTypes = (await db.prepare("SELECT * FROM ticket_types WHERE event_id = ?").bind(eid).all()).results ?? [];
    const tickets = (await db.prepare("SELECT t.*, tt.name as tier_name FROM tickets t JOIN ticket_types tt ON t.ticket_type_id = tt.id WHERE t.event_id = ? ORDER BY tt.name, t.customer_name").bind(eid).all()).results ?? [];
    const salesByTier = (await db.prepare("SELECT tt.name, COUNT(t.id) as sold, tt.capacity, tt.price_cents FROM ticket_types tt LEFT JOIN tickets t ON tt.id = t.ticket_type_id WHERE tt.event_id = ? GROUP BY tt.id").bind(eid).all()).results ?? [];
    const products = (await db.prepare("SELECT * FROM products ORDER BY display_order ASC, id DESC").all()).results ?? [];
    const settings = (await db.prepare("SELECT * FROM settings").all()).results ?? [];
    const settingsMap = {};
    settings.forEach(s => { settingsMap[s.key] = s.value; });

    // Revenue data
    const allTickets = (await db.prepare("SELECT t.*, tt.price_cents, e.name as event_name FROM tickets t JOIN ticket_types tt ON t.ticket_type_id = tt.id JOIN events e ON t.event_id = e.id").all()).results ?? [];
    const ticketRevenue = allTickets.reduce((sum, t) => sum + (t.price_cents || 0), 0);
    const productRevenue = 0; // Will come from Stripe later

    return new Response(adminPage(section, events, currentEvent, ticketTypes, tickets, salesByTier, products, settingsMap, ticketRevenue, productRevenue, allTickets), {
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

    if (action === 'login') {
      const body = await context.request.formData();
      const pin = body.get('pin') || '';
      if (pin === ADMIN_PIN) {
        return new Response('', {
          status: 302,
          headers: { 'Location': '/admin', 'Set-Cookie': 'mx_admin=true; path=/; max-age=86400; SameSite=Lax' }
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
      const poster_url = body.get('poster_url') || '';
      const video_url = body.get('video_url') || '';
      await db.prepare("UPDATE events SET name=?,date=?,venue=?,active=?,poster_url=?,video_url=? WHERE id=?")
        .bind(name, date, venue, active, poster_url, video_url, id).run();
      return new Response('', { status: 302, headers: { 'Location': '/admin?s=events&event=' + id } });
    }

    if (action === 'add-event') {
      const name = body.get('name');
      const date = body.get('date') || 'TBA';
      const venue = body.get('venue') || 'TBA';
      const result = await db.prepare("INSERT INTO events (name, date, venue, active) VALUES (?, ?, ?, 0)").bind(name, date, venue).run();
      const newId = result.meta?.last_row_id || 1;
      // Add default ticket tiers
      await db.prepare("INSERT INTO ticket_types (event_id, name, price_cents, capacity) VALUES (?,?,?,?),(?,?,?,?),(?,?,?,?),(?,?,?,?)")
        .bind(newId,'Ringside',3500,40, newId,'Row 2',3500,40, newId,'Row 3',3500,40, newId,'General Admission',2750,150).run();
      return new Response('', { status: 302, headers: { 'Location': '/admin?s=events&event=' + newId } });
    }

    if (action === 'delete-event') {
      const id = body.get('id');
      await db.prepare("DELETE FROM tickets WHERE event_id=?").bind(id).run();
      await db.prepare("DELETE FROM ticket_types WHERE event_id=?").bind(id).run();
      await db.prepare("DELETE FROM events WHERE id=?").bind(id).run();
      return new Response('', { status: 302, headers: { 'Location': '/admin?s=events' } });
    }

    if (action === 'update-tier') {
      const id = body.get('id');
      const eventId = body.get('event_id');
      const price = Math.round(parseFloat(body.get('price')) * 100);
      const capacity = parseInt(body.get('capacity'));
      const stripe_price_id = body.get('stripe_price_id') || '';
      await db.prepare("UPDATE ticket_types SET price_cents=?,capacity=?,stripe_price_id=? WHERE id=?")
        .bind(price, capacity, stripe_price_id, id).run();
      return new Response('', { status: 302, headers: { 'Location': '/admin?s=events&event=' + eventId } });
    }

    if (action === 'add-product') {
      const name = body.get('name');
      const description = body.get('description') || '';
      const price = Math.round(parseFloat(body.get('price')) * 100);
      const stripe_price_id = body.get('stripe_price_id') || '';
      const image_url = body.get('image_url') || '';
      const category = body.get('category') || 'merch';
      await db.prepare("INSERT INTO products (name,description,price_cents,stripe_price_id,image_url,category,in_stock) VALUES (?,?,?,?,?,?,1)")
        .bind(name, description, price, stripe_price_id, image_url, category).run();
      return new Response('', { status: 302, headers: { 'Location': '/admin?s=store' } });
    }

    if (action === 'update-product') {
      const id = body.get('id');
      const name = body.get('name');
      const description = body.get('description') || '';
      const price = Math.round(parseFloat(body.get('price')) * 100);
      const stripe_price_id = body.get('stripe_price_id') || '';
      const image_url = body.get('image_url') || '';
      const in_stock = body.get('in_stock') === '1' ? 1 : 0;
      await db.prepare("UPDATE products SET name=?,description=?,price_cents=?,stripe_price_id=?,image_url=?,in_stock=? WHERE id=?")
        .bind(name, description, price, stripe_price_id, image_url, in_stock, id).run();
      return new Response('', { status: 302, headers: { 'Location': '/admin?s=store' } });
    }

    if (action === 'delete-product') {
      const id = body.get('id');
      await db.prepare("DELETE FROM products WHERE id=?").bind(id).run();
      return new Response('', { status: 302, headers: { 'Location': '/admin?s=store' } });
    }

    if (action === 'save-settings') {
      const keys = ['instagram','twitter','tiktok','contact_email','announcement_text','announcement_active'];
      for (const key of keys) {
        const val = body.get(key) || '';
        await db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").bind(key, val).run();
      }
      return new Response('', { status: 302, headers: { 'Location': '/admin?s=settings' } });
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
  <meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Admin — miXtape Wrestling</title>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    :root{--black:#0a0a0c;--charcoal:#111116;--surface:#17171e;--border:#2a2a38;--cyan:#00d4ff;--teal:#00f5d4;--white:#f0f0f8;--muted:#8888aa;--font-display:'Bebas Neue',sans-serif;--font-ui:'Barlow Condensed',sans-serif}
    body{background:var(--black);color:var(--white);font-family:var(--font-ui);min-height:100vh;display:flex;align-items:center;justify-content:center}
    .wrap{width:100%;max-width:400px;padding:2rem;text-align:center}
    .logo{font-family:var(--font-display);font-size:3rem;letter-spacing:.05em;margin-bottom:.25rem}
    .sub{font-size:.7rem;font-weight:700;letter-spacing:.4em;text-transform:uppercase;color:var(--muted);margin-bottom:2.5rem}
    .box{background:var(--surface);border:1px solid var(--border);padding:2rem;clip-path:polygon(0 0,calc(100% - 16px) 0,100% 16px,100% 100%,16px 100%,0 calc(100% - 16px))}
    .label{font-size:.7rem;font-weight:700;letter-spacing:.35em;text-transform:uppercase;color:var(--cyan);margin-bottom:1.25rem}
    input{width:100%;background:var(--charcoal);border:1px solid var(--border);color:var(--white);font-family:var(--font-display);font-size:2rem;letter-spacing:.1em;text-align:center;text-transform:uppercase;padding:.75rem 1rem;outline:none;border-radius:0;margin-bottom:1rem;-webkit-appearance:none}
    input:focus{border-color:var(--cyan)}
    button{width:100%;font-family:var(--font-ui);font-size:1rem;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--black);background:linear-gradient(135deg,var(--cyan),var(--teal));border:none;cursor:pointer;padding:1rem;clip-path:polygon(12px 0%,100% 0%,calc(100% - 12px) 100%,0% 100%)}
    .err{font-size:.8rem;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#ff6b6b;margin-top:.75rem}
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

function adminPage(section, events, currentEvent, ticketTypes, tickets, salesByTier, products, settings, ticketRevenue, productRevenue, allTickets) {
  const eid = currentEvent?.id || '';
  const eventOptions = events.map(e => `<option value="${e.id}" ${e.id==eid?'selected':''}>${e.name}</option>`).join('');
  const totalRevenue = ticketRevenue + productRevenue;
  const totalSold = salesByTier.reduce((s,t) => s+(t.sold||0), 0);

  const revenueByEvent = {};
  allTickets.forEach(t => {
    if (!revenueByEvent[t.event_name]) revenueByEvent[t.event_name] = 0;
    revenueByEvent[t.event_name] += t.price_cents || 0;
  });

  const salesCards = salesByTier.map(t => {
    const sold = t.sold||0;
    const remaining = t.capacity-sold;
    const pct = t.capacity > 0 ? Math.round((sold/t.capacity)*100) : 0;
    const price = (t.price_cents/100).toFixed(2);
    const revenue = ((t.price_cents*sold)/100).toFixed(2);
    return `<div class="stat-card">
      <div class="stat-label">${t.name}</div>
      <div class="stat-num">${sold}<span>/${t.capacity}</span></div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="stat-sub">$${revenue} revenue · ${remaining} remaining</div>
    </div>`;
  }).join('');

  const tierForms = ticketTypes.map(t => `
    <form method="POST" action="/admin?action=update-tier&event=${eid}" class="tier-form">
      <input type="hidden" name="id" value="${t.id}" />
      <input type="hidden" name="event_id" value="${t.event_id}" />
      <div class="tier-form-row">
        <div class="tier-form-name">${t.name}</div>
        <div class="form-group"><label>Price ($)</label><input type="number" name="price" value="${(t.price_cents/100).toFixed(2)}" step="0.50" min="0" /></div>
        <div class="form-group"><label>Capacity</label><input type="number" name="capacity" value="${t.capacity}" min="0" /></div>
        <div class="form-group"><label>Stripe Price ID</label><input type="text" name="stripe_price_id" value="${t.stripe_price_id||''}" placeholder="price_..." /></div>
        <button type="submit" class="save-btn">Save</button>
      </div>
    </form>`).join('');

  const ticketRows = tickets.map((t,i) => `
    <tr>
      <td>${i+1}</td>
      <td>${t.customer_name||'—'}</td>
      <td>${t.customer_email}</td>
      <td><span class="tier-badge">${t.tier_name}</span></td>
      <td>${t.ticket_uid.substring(0,8).toUpperCase()}</td>
      <td>${t.used?'<span class="checked-in">✓ In</span>':'<span class="not-in">—</span>'}</td>
    </tr>`).join('');

  const printRows = tickets.map((t,i) => `
    <tr>
      <td>${i+1}</td>
      <td>${t.customer_name||'—'}</td>
      <td>${t.tier_name}</td>
      <td>${t.ticket_uid.substring(0,8).toUpperCase()}</td>
      <td>□</td>
    </tr>`).join('');

  const productRows = products.map(p => `
    <tr>
      <td>${p.image_url ? `<img src="${p.image_url}" style="width:40px;height:40px;object-fit:cover;border:1px solid #2a2a38" />` : '—'}</td>
      <td><strong>${p.name}</strong><br><small style="color:#8888aa">${p.description||''}</small></td>
      <td>$${(p.price_cents/100).toFixed(2)}</td>
      <td>${p.in_stock ? '<span class="checked-in">In Stock</span>' : '<span class="not-in">Out</span>'}</td>
      <td>
        <button onclick="editProduct(${p.id},'${p.name.replace(/'/g,"\\'")}','${(p.description||'').replace(/'/g,"\\'")}',${p.price_cents},'${p.stripe_price_id||''}','${p.image_url||''}',${p.in_stock})" class="save-btn">Edit</button>
        <form method="POST" action="/admin?action=delete-product" style="display:inline" onsubmit="return confirm('Delete ${p.name}?')">
          <input type="hidden" name="id" value="${p.id}" />
          <button type="submit" class="danger-btn">Delete</button>
        </form>
      </td>
    </tr>`).join('');

  const revenueEventRows = Object.entries(revenueByEvent).map(([name, rev]) =>
    `<tr><td>${name}</td><td>$${(rev/100).toFixed(2)}</td></tr>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Admin — miXtape Wrestling</title>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@400;600;700&family=Barlow:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    :root{--black:#0a0a0c;--charcoal:#111116;--surface:#17171e;--border:#2a2a38;--cyan:#00d4ff;--teal:#00f5d4;--purple:#9b59ff;--white:#f0f0f8;--muted:#8888aa;--font-display:'Bebas Neue',sans-serif;--font-ui:'Barlow Condensed',sans-serif;--font-body:'Barlow',sans-serif}
    body{background:var(--black);color:var(--white);font-family:var(--font-body);min-height:100vh}
    header{padding:1rem 2rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;background:rgba(10,10,12,.9);position:sticky;top:0;z-index:50}
    .logo{font-family:var(--font-display);font-size:1.6rem;letter-spacing:.05em}
    .admin-badge{font-family:var(--font-ui);font-size:.65rem;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:var(--black);background:var(--purple);padding:.3rem .75rem}
    .layout{display:grid;grid-template-columns:220px 1fr;min-height:calc(100vh - 65px)}
    .sidebar{border-right:1px solid var(--border);padding:1.5rem 0;background:var(--charcoal)}
    .nav-section{font-family:var(--font-ui);font-size:.6rem;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:var(--muted);padding:0 1.5rem;margin-bottom:.5rem;margin-top:1.5rem}
    .nav-section:first-child{margin-top:0}
    .nav-link{display:block;font-family:var(--font-ui);font-size:.9rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);text-decoration:none;padding:.6rem 1.5rem;transition:all .2s}
    .nav-link:hover,.nav-link.active{color:var(--cyan);background:rgba(0,212,255,.05);border-left:2px solid var(--cyan)}
    .main{padding:2rem;overflow-y:auto}
    .page-title{font-family:var(--font-display);font-size:2.5rem;letter-spacing:.05em;margin-bottom:.25rem}
    .page-sub{font-family:var(--font-ui);font-size:.75rem;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);margin-bottom:2rem}
    .event-selector{display:flex;align-items:center;gap:1rem;margin-bottom:2rem;padding:1rem 1.5rem;background:var(--surface);border:1px solid var(--border)}
    .event-selector label{font-family:var(--font-ui);font-size:.7rem;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:var(--muted);white-space:nowrap}
    .event-selector select{flex:1;background:var(--charcoal);border:1px solid var(--border);color:var(--white);font-family:var(--font-ui);font-size:1rem;font-weight:600;padding:.5rem .75rem;outline:none;cursor:pointer}
    .stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem;margin-bottom:2rem}
    .stat-card{background:var(--surface);border:1px solid var(--border);padding:1.25rem;clip-path:polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,0 100%)}
    .stat-card.highlight{border-color:var(--cyan)}
    .stat-label{font-family:var(--font-ui);font-size:.7rem;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:var(--muted);margin-bottom:.5rem}
    .stat-num{font-family:var(--font-display);font-size:2.5rem;letter-spacing:.05em;color:var(--cyan);line-height:1}
    .stat-num span{font-size:1.2rem;color:var(--muted)}
    .progress-bar{height:4px;background:var(--border);margin:.5rem 0;border-radius:2px}
    .progress-fill{height:100%;background:linear-gradient(90deg,var(--cyan),var(--teal));border-radius:2px}
    .stat-sub{font-family:var(--font-ui);font-size:.7rem;font-weight:600;letter-spacing:.1em;color:var(--muted)}
    .section-title{font-family:var(--font-display);font-size:1.5rem;letter-spacing:.05em;margin-bottom:1rem;padding-bottom:.5rem;border-bottom:1px solid var(--border)}
    .card{background:var(--surface);border:1px solid var(--border);padding:1.5rem;margin-bottom:1.5rem}
    .form-row{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem}
    .form-row-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1rem;margin-bottom:1rem}
    .form-group{display:flex;flex-direction:column;gap:.35rem}
    .form-group label{font-family:var(--font-ui);font-size:.65rem;font-weight:700;letter-spacing:.25em;text-transform:uppercase;color:var(--muted)}
    .form-group input,.form-group select,.form-group textarea{background:var(--charcoal);border:1px solid var(--border);color:var(--white);font-family:var(--font-body);font-size:.95rem;padding:.6rem .85rem;outline:none;border-radius:0;transition:border-color .2s;-webkit-appearance:none}
    .form-group input:focus,.form-group select:focus,.form-group textarea:focus{border-color:var(--cyan)}
    .form-group textarea{resize:vertical;min-height:80px}
    .save-btn{font-family:var(--font-ui);font-size:.8rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--black);background:var(--cyan);border:none;cursor:pointer;padding:.6rem 1.25rem;clip-path:polygon(6px 0%,100% 0%,calc(100% - 6px) 100%,0% 100%);transition:background .2s;white-space:nowrap}
    .save-btn:hover{background:var(--teal)}
    .danger-btn{font-family:var(--font-ui);font-size:.8rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#ff6b6b;background:transparent;border:1px solid rgba(255,107,107,.3);cursor:pointer;padding:.6rem 1.25rem;transition:all .2s;margin-left:.5rem}
    .danger-btn:hover{background:#ff6b6b;color:var(--black)}
    .primary-btn{font-family:var(--font-ui);font-size:.85rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--black);background:var(--cyan);border:none;cursor:pointer;padding:.75rem 1.5rem;clip-path:polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%);margin-bottom:1.5rem;display:inline-block}
    .tier-form{margin-bottom:.75rem;background:var(--charcoal);border:1px solid var(--border);padding:1rem}
    .tier-form-row{display:grid;grid-template-columns:140px 100px 100px 1fr auto;align-items:end;gap:1rem}
    .tier-form-name{font-family:var(--font-display);font-size:1.3rem;letter-spacing:.05em;align-self:end;padding-bottom:.4rem}
    .table-wrap{overflow-x:auto}
    table{width:100%;border-collapse:collapse;font-family:var(--font-ui);font-size:.85rem}
    th{font-size:.65rem;font-weight:700;letter-spacing:.25em;text-transform:uppercase;color:var(--muted);padding:.75rem 1rem;text-align:left;border-bottom:1px solid var(--border);background:var(--charcoal)}
    td{padding:.75rem 1rem;border-bottom:1px solid var(--border);color:var(--white)}
    tr:last-child td{border-bottom:none}
    tr:hover td{background:rgba(0,212,255,.03)}
    .tier-badge{font-family:var(--font-ui);font-size:.65rem;font-weight:700;letter-spacing:.2em;text-transform:uppercase;background:rgba(155,89,255,.2);color:#c77dff;padding:.2rem .6rem}
    .checked-in{color:var(--teal);font-weight:700}
    .not-in{color:var(--muted)}
    .print-btn{font-family:var(--font-ui);font-size:.85rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--black);background:var(--cyan);border:none;cursor:pointer;padding:.65rem 1.5rem;clip-path:polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%);margin-bottom:1.5rem}
    .upload-row{display:flex;gap:.75rem;align-items:end}
    .upload-btn{font-family:var(--font-ui);font-size:.75rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--black);background:var(--purple);border:none;cursor:pointer;padding:.6rem 1rem;white-space:nowrap}
    .upload-status{font-family:var(--font-ui);font-size:.7rem;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:var(--muted);margin-top:.35rem}
    .revenue-section{margin-bottom:1.5rem}
    .revenue-header{font-family:var(--font-display);font-size:1.2rem;letter-spacing:.05em;color:var(--cyan);margin-bottom:.75rem;padding-bottom:.5rem;border-bottom:1px solid var(--border)}
    .modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:200;align-items:center;justify-content:center}
    .modal.open{display:flex}
    .modal-box{background:var(--surface);border:1px solid var(--border);padding:2rem;width:100%;max-width:600px;max-height:90vh;overflow-y:auto}
    .modal-title{font-family:var(--font-display);font-size:1.8rem;letter-spacing:.05em;margin-bottom:1.5rem}
    .modal-close{float:right;background:none;border:none;color:var(--muted);font-size:1.2rem;cursor:pointer}
    @media print{header,.sidebar,.no-print{display:none!important}.layout{grid-template-columns:1fr}.print-area{display:block!important}.screen-only{display:none!important}body{background:white;color:black}table{font-size:12px}th,td{border:1px solid #ccc;padding:6px}}
    .print-area{display:none}
  </style>
</head>
<body>
  <header>
    <div class="logo">miXtape <span style="color:var(--muted);font-size:1rem">Admin</span></div>
    <div style="display:flex;align-items:center;gap:1rem">
      <a href="/" style="font-family:var(--font-ui);font-size:.75rem;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);text-decoration:none">← View Site</a>
      <div class="admin-badge">Admin Panel</div>
    </div>
  </header>
  <div class="layout">
    <nav class="sidebar">
      <p class="nav-section">Overview</p>
      <a href="/admin?s=dashboard&event=${eid}" class="nav-link ${section==='dashboard'?'active':''}">Dashboard</a>
      <a href="/admin?s=reports&event=${eid}" class="nav-link ${section==='reports'?'active':''}">Reports</a>
      <p class="nav-section">Shows</p>
      <a href="/admin?s=events&event=${eid}" class="nav-link ${section==='events'?'active':''}">Events & Tiers</a>
      <a href="/admin?s=tickets&event=${eid}" class="nav-link ${section==='tickets'?'active':''}">Ticket Sales</a>
      <a href="/admin?s=doorlist&event=${eid}" class="nav-link ${section==='doorlist'?'active':''}">Door List</a>
      <p class="nav-section">Store</p>
      <a href="/admin?s=store" class="nav-link ${section==='store'?'active':''}">Products</a>
      <p class="nav-section">Site</p>
      <a href="/admin?s=settings" class="nav-link ${section==='settings'?'active':''}">Settings</a>
    </nav>
    <main class="main">

      ${['dashboard','tickets','doorlist','events'].includes(section) ? `
      <div class="event-selector no-print">
        <label>Viewing Event:</label>
        <select onchange="window.location.href='/admin?s=${section}&event='+this.value">
          ${eventOptions}
        </select>
      </div>` : ''}

      ${section==='dashboard' ? `
        <h1 class="page-title">Dashboard</h1>
        <p class="page-sub">${currentEvent?.name||'No event'} · ${totalSold} tickets sold</p>
        <div class="stats-grid">
          <div class="stat-card highlight">
            <div class="stat-label">Total Revenue</div>
            <div class="stat-num">$${(totalRevenue/100).toFixed(2)}</div>
            <div class="stat-sub">all events combined</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Tickets Sold</div>
            <div class="stat-num">${totalSold}</div>
            <div class="stat-sub">this event</div>
          </div>
          ${salesCards}
        </div>
      ` : ''}

      ${section==='reports' ? `
        <h1 class="page-title">Reports</h1>
        <p class="page-sub">Revenue breakdown across all events</p>
        <div class="stats-grid">
          <div class="stat-card highlight">
            <div class="stat-label">Total Revenue</div>
            <div class="stat-num">$${(totalRevenue/100).toFixed(2)}</div>
            <div class="stat-sub">all sources combined</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Ticket Revenue</div>
            <div class="stat-num">$${(ticketRevenue/100).toFixed(2)}</div>
            <div class="stat-sub">from ticket sales</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Merch Revenue</div>
            <div class="stat-num">$0.00</div>
            <div class="stat-sub">coming soon</div>
          </div>
        </div>
        <div class="card">
          <div class="revenue-header">Tickets by Event</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Event</th><th>Revenue</th></tr></thead>
              <tbody>${revenueEventRows||'<tr><td colspan="2" style="color:var(--muted)">No sales yet</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      ` : ''}

      ${section==='events' ? `
        <h1 class="page-title">Events & Tiers</h1>
        <p class="page-sub">Manage show details, posters, and ticket pricing</p>

        <button class="primary-btn no-print" onclick="document.getElementById('addEventModal').classList.add('open')">+ Add New Event</button>

        ${currentEvent ? `
        <div class="card">
          <p class="section-title">Event Details</p>
          <form method="POST" action="/admin?action=update-event">
            <input type="hidden" name="id" value="${currentEvent.id}" />
            <div class="form-row">
              <div class="form-group"><label>Event Name</label><input type="text" name="name" value="${currentEvent.name}" /></div>
              <div class="form-group"><label>Date</label><input type="text" name="date" value="${currentEvent.date||''}" placeholder="e.g. Sat Aug 16, 2026" /></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>Venue</label><input type="text" name="venue" value="${currentEvent.venue||''}" placeholder="Venue name and city" /></div>
              <div class="form-group"><label>Status</label>
                <select name="active">
                  <option value="1" ${currentEvent.active?'selected':''}>Active — Live on site</option>
                  <option value="0" ${!currentEvent.active?'selected':''}>Inactive — Hidden</option>
                </select>
              </div>
            </div>
            <div class="form-group" style="margin-bottom:1rem">
              <label>Show Poster</label>
              <div class="upload-row">
                <input type="text" name="poster_url" id="posterUrl" value="${currentEvent.poster_url||''}" placeholder="Paste URL or upload below" style="flex:1" />
                <label class="upload-btn" style="cursor:pointer">
                  Upload Image
                  <input type="file" accept="image/*" style="display:none" onchange="uploadFile(this,'posterUrl','posterStatus')" />
                </label>
              </div>
              <div class="upload-status" id="posterStatus"></div>
              ${currentEvent.poster_url ? `<img src="${currentEvent.poster_url}" style="width:80px;height:120px;object-fit:cover;border:1px solid var(--border);margin-top:.5rem" />` : ''}
            </div>
            <div class="form-group" style="margin-bottom:1.25rem">
              <label>Highlight Reel Video URL</label>
              <input type="text" name="video_url" value="${currentEvent.video_url||''}" placeholder="YouTube or Vimeo URL" />
              <div class="upload-status">Paste a YouTube or Vimeo URL — it will embed on the homepage</div>
            </div>
            <div style="display:flex;gap:1rem;align-items:center">
              <button type="submit" class="save-btn">Save Event</button>
              <form method="POST" action="/admin?action=delete-event" style="display:inline" onsubmit="return confirm('Delete this event and ALL its tickets? This cannot be undone.')">
                <input type="hidden" name="id" value="${currentEvent.id}" />
                <button type="submit" class="danger-btn">Delete Event</button>
              </form>
            </div>
          </form>
        </div>
        <div class="card">
          <p class="section-title">Ticket Tiers</p>
          ${tierForms}
        </div>` : '<p style="color:var(--muted)">No events found. Add one above!</p>'}
      ` : ''}

      ${section==='tickets' ? `
        <h1 class="page-title">Ticket Sales</h1>
        <p class="page-sub">${tickets.length} tickets · ${currentEvent?.name||''}</p>
        <div class="card screen-only">
          <div class="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Name</th><th>Email</th><th>Section</th><th>Ticket ID</th><th>Status</th></tr></thead>
              <tbody>${ticketRows||'<tr><td colspan="6" style="color:var(--muted)">No tickets sold yet</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      ` : ''}

      ${section==='doorlist' ? `
        <h1 class="page-title">Door List</h1>
        <p class="page-sub">${currentEvent?.name||''} · ${tickets.length} tickets</p>
        <button class="print-btn no-print" onclick="window.print()">🖨 Print Door List</button>
        <div class="card screen-only">
          <div class="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Name</th><th>Section</th><th>Ticket ID</th><th>✓</th></tr></thead>
              <tbody>${printRows||'<tr><td colspan="5" style="color:var(--muted)">No tickets sold yet</td></tr>'}</tbody>
            </table>
          </div>
        </div>
        <div class="print-area">
          <h2 style="font-family:serif;margin-bottom:.5rem">${currentEvent?.name||''} — Door List</h2>
          <p style="font-size:12px;margin-bottom:1rem;color:#666">${tickets.length} tickets · Printed ${new Date().toLocaleDateString()}</p>
          <table>
            <thead><tr><th>#</th><th>Name</th><th>Section</th><th>Ticket ID</th><th>✓ Check In</th></tr></thead>
            <tbody>${printRows}</tbody>
          </table>
        </div>
      ` : ''}

      ${section==='store' ? `
        <h1 class="page-title">Products</h1>
        <p class="page-sub">Manage your merch store</p>
        <button class="primary-btn" onclick="document.getElementById('addProductModal').classList.add('open')">+ Add Product</button>
        <div class="card">
          <div class="table-wrap">
            <table>
              <thead><tr><th>Image</th><th>Product</th><th>Price</th><th>Stock</th><th>Actions</th></tr></thead>
              <tbody>${productRows||'<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:2rem">No products yet — add your first one!</td></tr>'}</tbody>
            </table>
          </div>
        </div>
      ` : ''}

      ${section==='settings' ? `
        <h1 class="page-title">Site Settings</h1>
        <p class="page-sub">Social links, contact info, and announcements</p>
        <div class="card">
          <form method="POST" action="/admin?action=save-settings">
            <p class="section-title">Social Media</p>
            <div class="form-row">
              <div class="form-group"><label>Instagram URL</label><input type="text" name="instagram" value="${settings.instagram||''}" placeholder="https://instagram.com/..." /></div>
              <div class="form-group"><label>Twitter / X URL</label><input type="text" name="twitter" value="${settings.twitter||''}" placeholder="https://x.com/..." /></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label>TikTok URL</label><input type="text" name="tiktok" value="${settings.tiktok||''}" placeholder="https://tiktok.com/..." /></div>
              <div class="form-group"><label>Contact Email</label><input type="text" name="contact_email" value="${settings.contact_email||''}" placeholder="info@mixtapewrestling.com" /></div>
            </div>
            <p class="section-title" style="margin-top:1.5rem">Announcement Banner</p>
            <div class="form-row">
              <div class="form-group"><label>Banner Text</label><input type="text" name="announcement_text" value="${settings.announcement_text||''}" placeholder="e.g. Tickets on sale now!" /></div>
              <div class="form-group"><label>Banner Active</label>
                <select name="announcement_active">
                  <option value="1" ${settings.announcement_active==='1'?'selected':''}>Showing on site</option>
                  <option value="0" ${settings.announcement_active!=='1'?'selected':''}>Hidden</option>
                </select>
              </div>
            </div>
            <button type="submit" class="save-btn">Save Settings</button>
          </form>
        </div>
      ` : ''}

    </main>
  </div>

  <!-- Add Event Modal -->
  <div class="modal" id="addEventModal">
    <div class="modal-box">
      <button class="modal-close" onclick="document.getElementById('addEventModal').classList.remove('open')">✕</button>
      <div class="modal-title">Add New Event</div>
      <form method="POST" action="/admin?action=add-event">
        <div class="form-group" style="margin-bottom:1rem"><label>Event Name</label><input type="text" name="name" placeholder="Vol. 2 — ..." required /></div>
        <div class="form-row">
          <div class="form-group"><label>Date</label><input type="text" name="date" placeholder="TBA" /></div>
          <div class="form-group"><label>Venue</label><input type="text" name="venue" placeholder="TBA" /></div>
        </div>
        <p style="font-family:var(--font-ui);font-size:.7rem;color:var(--muted);margin-bottom:1rem;letter-spacing:.1em">Default ticket tiers will be created automatically. You can edit prices and capacities after.</p>
        <button type="submit" class="save-btn">Create Event</button>
      </form>
    </div>
  </div>

  <!-- Add/Edit Product Modal -->
  <div class="modal" id="addProductModal">
    <div class="modal-box">
      <button class="modal-close" onclick="closeProductModal()">✕</button>
      <div class="modal-title" id="productModalTitle">Add Product</div>
      <form method="POST" id="productForm" action="/admin?action=add-product">
        <input type="hidden" name="id" id="productId" />
        <div class="form-row">
          <div class="form-group"><label>Product Name</label><input type="text" name="name" id="productName" placeholder="miXtape Classic Tee" required /></div>
          <div class="form-group"><label>Price ($)</label><input type="number" name="price" id="productPrice" step="0.50" min="0" placeholder="30.00" required /></div>
        </div>
        <div class="form-group" style="margin-bottom:1rem"><label>Description</label><textarea name="description" id="productDesc" placeholder="Short product description"></textarea></div>
        <div class="form-group" style="margin-bottom:1rem">
          <label>Product Image</label>
          <div class="upload-row">
            <input type="text" name="image_url" id="productImageUrl" placeholder="Paste URL or upload" style="flex:1" />
            <label class="upload-btn" style="cursor:pointer">
              Upload
              <input type="file" accept="image/*" style="display:none" onchange="uploadFile(this,'productImageUrl','productImageStatus')" />
            </label>
          </div>
          <div class="upload-status" id="productImageStatus"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Stripe Price ID</label><input type="text" name="stripe_price_id" id="productStripe" placeholder="price_..." /></div>
          <div class="form-group"><label>Stock Status</label>
            <select name="in_stock" id="productStock">
              <option value="1">In Stock</option>
              <option value="0">Out of Stock</option>
            </select>
          </div>
        </div>
        <button type="submit" class="save-btn">Save Product</button>
      </form>
    </div>
  </div>

  <script>
    async function uploadFile(input, urlFieldId, statusId) {
      var file = input.files[0];
      if (!file) return;
      var status = document.getElementById(statusId);
      status.textContent = 'Uploading...';
      var form = new FormData();
      form.append('file', file);
      try {
        var res = await fetch('/api/upload', { method: 'POST', body: form });
        var data = await res.json();
        if (data.url) {
          document.getElementById(urlFieldId).value = data.url;
          status.textContent = 'Uploaded!';
          status.style.color = 'var(--teal)';
        } else {
          status.textContent = 'Upload failed: ' + (data.error||'Unknown error');
          status.style.color = '#ff6b6b';
        }
      } catch(err) {
        status.textContent = 'Upload failed';
        status.style.color = '#ff6b6b';
      }
    }

    function editProduct(id, name, desc, priceCents, stripe, image, inStock) {
      document.getElementById('productModalTitle').textContent = 'Edit Product';
      document.getElementById('productForm').action = '/admin?action=update-product';
      document.getElementById('productId').value = id;
      document.getElementById('productName').value = name;
      document.getElementById('productDesc').value = desc;
      document.getElementById('productPrice').value = (priceCents/100).toFixed(2);
      document.getElementById('productStripe').value = stripe;
      document.getElementById('productImageUrl').value = image;
      document.getElementById('productStock').value = inStock;
      document.getElementById('addProductModal').classList.add('open');
    }

    function closeProductModal() {
      document.getElementById('addProductModal').classList.remove('open');
      document.getElementById('productModalTitle').textContent = 'Add Product';
      document.getElementById('productForm').action = '/admin?action=add-product';
      document.getElementById('productId').value = '';
      document.getElementById('productName').value = '';
      document.getElementById('productDesc').value = '';
      document.getElementById('productPrice').value = '';
      document.getElementById('productStripe').value = '';
      document.getElementById('productImageUrl').value = '';
    }

    document.querySelectorAll('.modal').forEach(function(m) {
      m.addEventListener('click', function(e) {
        if (e.target === m) m.classList.remove('open');
      });
    });
  </script>
</body>
</html>`;
}
