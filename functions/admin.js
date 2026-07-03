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
    const plId = url.searchParams.get('pl') || '';

    const eventsRes = await db.prepare("SELECT * FROM events ORDER BY CASE WHEN date IS NULL OR date = '' OR date = 'TBA' THEN 1 ELSE 0 END, date ASC, id DESC").all();
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

    const allTickets = (await db.prepare("SELECT t.*, tt.price_cents, e.name as event_name FROM tickets t JOIN ticket_types tt ON t.ticket_type_id = tt.id JOIN events e ON t.event_id = e.id").all()).results ?? [];
    const ticketRevenue = allTickets.reduce((sum, t) => sum + (t.price_cents || 0), 0);
    const productRevenue = 0;

    const allPL = (await db.prepare("SELECT * FROM show_pl ORDER BY created_at DESC").all()).results ?? [];
    let currentPL = null;
    if (plId) {
      currentPL = allPL.find(p => p.id == plId) || null;
    } else if (section === 'pl' && eid) {
      currentPL = allPL.find(p => p.event_id == eid) || null;
    }

    let plTicketTypes = [];
    if (currentPL && currentPL.event_id) {
      plTicketTypes = (await db.prepare("SELECT * FROM ticket_types WHERE event_id = ?").bind(currentPL.event_id).all()).results ?? [];
    } else if (section === 'pl') {
      plTicketTypes = ticketTypes;
    }

    return new Response(adminPage(section, events, currentEvent, ticketTypes, tickets, salesByTier, products, settingsMap, ticketRevenue, productRevenue, allTickets, allPL, currentPL, plTicketTypes), {
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
      await db.prepare("UPDATE show_pl SET show_name=?,show_date=? WHERE event_id=?")
        .bind(name, date, id).run();
      return new Response('', { status: 302, headers: { 'Location': '/admin?s=events&event=' + id } });
    }

    if (action === 'add-event') {
      const name = body.get('name');
      const date = body.get('date') || 'TBA';
      const venue = body.get('venue') || 'TBA';
      const result = await db.prepare("INSERT INTO events (name, date, venue, active) VALUES (?, ?, ?, 0)").bind(name, date, venue).run();
      const newId = result.meta?.last_row_id || 1;
      await db.prepare("INSERT INTO show_pl (show_name, show_date, event_id, data_json, net_profit, total_revenue, total_expenses, attendance) VALUES (?,?,?,?,0,0,0,0)")
        .bind(name, date, newId, '{}').run();
      return new Response('', { status: 302, headers: { 'Location': '/admin?s=events&event=' + newId } });
    }

    if (action === 'delete-event') {
      const id = body.get('id');
      await db.prepare("DELETE FROM tickets WHERE event_id=?").bind(id).run();
      await db.prepare("DELETE FROM ticket_types WHERE event_id=?").bind(id).run();
      await db.prepare("DELETE FROM show_pl WHERE event_id=?").bind(id).run();
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

    if (action === 'add-tier') {
      const eventId = body.get('event_id');
      const name = body.get('name') || 'New Tier';
      const price = Math.round(parseFloat(body.get('price') || '0') * 100);
      const capacity = parseInt(body.get('capacity') || '50');
      await db.prepare("INSERT INTO ticket_types (event_id, name, price_cents, capacity) VALUES (?,?,?,?)")
        .bind(eventId, name, price, capacity).run();
      return new Response('', { status: 302, headers: { 'Location': '/admin?s=events&event=' + eventId } });
    }

    if (action === 'delete-tier') {
      const id = body.get('id');
      const eventId = body.get('event_id');
      await db.prepare("DELETE FROM ticket_types WHERE id=?").bind(id).run();
      return new Response('', { status: 302, headers: { 'Location': '/admin?s=events&event=' + eventId } });
    }

    if (action === 'add-product') {
      const name = body.get('name');
      const description = body.get('description') || '';
      const price = Math.round(parseFloat(body.get('price')) * 100);
      const stripe_price_id = body.get('stripe_price_id') || '';
      const image_url = body.get('image_url') || '';
      const category = body.get('category') || 'merch';
      const featured_a = body.get('featured') === '1' ? 1 : 0;
      const stock_qty_a = parseInt(body.get('stock_quantity') || '-1');
      await db.prepare("INSERT INTO products (name,description,price_cents,stripe_price_id,image_url,category,in_stock,featured,stock_quantity) VALUES (?,?,?,?,?,?,1,?,?)")
        .bind(name, description, price, stripe_price_id, image_url, category, featured_a, stock_qty_a).run();
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
      const featured_u = body.get('featured') === '1' ? 1 : 0;
      const stock_qty_u = parseInt(body.get('stock_quantity') || '-1');
      await db.prepare("UPDATE products SET name=?,description=?,price_cents=?,stripe_price_id=?,image_url=?,in_stock=?,featured=?,stock_quantity=? WHERE id=?")
        .bind(name, description, price, stripe_price_id, image_url, in_stock, featured_u, stock_qty_u, id).run();
      return new Response('', { status: 302, headers: { 'Location': '/admin?s=store' } });
    }

    if (action === 'delete-product') {
      const id = body.get('id');
      await db.prepare("DELETE FROM products WHERE id=?").bind(id).run();
      return new Response('', { status: 302, headers: { 'Location': '/admin?s=store' } });
    }

    if (action === 'save-settings') {
      const keys = ['instagram','twitter','tiktok','contact_email','announcement_text','announcement_active','highlight_video'];
      for (const key of keys) {
        const val = body.get(key) || '';
        await db.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").bind(key, val).run();
      }
      return new Response('', { status: 302, headers: { 'Location': '/admin?s=settings' } });
    }

    if (action === 'save-pl') {
      const id = body.get('id') || '';
      const show_name = body.get('show_name') || '';
      const show_date = body.get('show_date') || '';
      const event_id = body.get('event_id') || null;
      const data_json = body.get('data_json') || '{}';
      const net_profit = parseInt(body.get('net_profit') || '0');
      const total_revenue = parseInt(body.get('total_revenue') || '0');
      const total_expenses = parseInt(body.get('total_expenses') || '0');
      const attendance = parseInt(body.get('attendance') || '0');

      if (id) {
        await db.prepare("UPDATE show_pl SET show_name=?,show_date=?,data_json=?,net_profit=?,total_revenue=?,total_expenses=?,attendance=? WHERE id=?")
          .bind(show_name, show_date, data_json, net_profit, total_revenue, total_expenses, attendance, id).run();
        return new Response('', { status: 302, headers: { 'Location': '/admin?s=pl&pl=' + id } });
      } else {
        const result = await db.prepare("INSERT INTO show_pl (show_name,show_date,event_id,data_json,net_profit,total_revenue,total_expenses,attendance) VALUES (?,?,?,?,?,?,?,?)")
          .bind(show_name, show_date, event_id, data_json, net_profit, total_revenue, total_expenses, attendance).run();
        const newId = result.meta?.last_row_id || '';
        return new Response('', { status: 302, headers: { 'Location': '/admin?s=pl&pl=' + newId } });
      }
    }

    if (action === 'delete-pl') {
      const id = body.get('id');
      await db.prepare("DELETE FROM show_pl WHERE id=?").bind(id).run();
      return new Response('', { status: 302, headers: { 'Location': '/admin?s=pl' } });
    }

    return new Response('Unknown action', { status: 400 });
  } catch(err) {
    return new Response('Error: ' + err.message, { status: 500 });
  }
}function loginPage(error) {
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

function plEditorHTML(pl, plTicketTypes) {
  const d = pl ? JSON.parse(pl.data_json || '{}') : {};
  const v = (key, def) => d[key] !== undefined ? d[key] : def;

  const ticketRows = plTicketTypes.map((tt) => {
    const key = 'tt_' + tt.id;
    const qKey = key + '_sold';
    const pKey = key + '_price';
    const defaultPrice = (tt.price_cents / 100).toFixed(2);
    return `<div class="pl-row" data-tier-id="${tt.id}">
      <label>${tt.name}</label>
      <input type="number" id="${qKey}" value="${v(qKey, 0)}" onchange="plCalc()" placeholder="Sold" />
      <input type="number" id="${pKey}" value="${v(pKey, defaultPrice)}" onchange="plCalc()" placeholder="Price" />
      <div class="pl-computed" id="${key}_rev">$0</div>
    </div>`;
  }).join('');

  const tierIdsJson = JSON.stringify(plTicketTypes.map(tt => ({ id: tt.id, name: tt.name, defaultPrice: (tt.price_cents/100).toFixed(2) })));

  return `
  <form method="POST" action="/admin?action=save-pl" id="plForm">
    <input type="hidden" name="id" value="${pl ? pl.id : ''}" />
    <input type="hidden" name="event_id" value="${pl ? (pl.event_id || '') : ''}" />
    <input type="hidden" name="data_json" id="plDataJson" value="" />
    <input type="hidden" name="net_profit" id="plNetProfit" value="0" />
    <input type="hidden" name="total_revenue" id="plTotalRevenue" value="0" />
    <input type="hidden" name="total_expenses" id="plTotalExpenses" value="0" />
    <input type="hidden" name="attendance" id="plAttendance" value="0" />
    <input type="hidden" id="plTierIds" value='${tierIdsJson}' />

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem">
      <div class="form-group">
        <label>Show Name</label>
        <input type="text" name="show_name" value="${pl ? pl.show_name : ''}" placeholder="Vol. 1" required />
      </div>
      <div class="form-group">
        <label>Show Date</label>
        <input type="text" name="show_date" value="${pl ? pl.show_date : ''}" placeholder="e.g. Sat Sep 20, 2026" />
      </div>
    </div>

    <div class="pl-summary-grid">
      <div class="pl-card pl-card-blue"><div class="pl-card-label">Total Revenue</div><div class="pl-card-val" id="s-revenue">$0</div></div>
      <div class="pl-card pl-card-amber"><div class="pl-card-label">Total Expenses</div><div class="pl-card-val" id="s-expenses">$0</div></div>
      <div class="pl-card pl-card-green"><div class="pl-card-label">Net Profit / Loss</div><div class="pl-card-val" id="s-net">$0</div></div>
      <div class="pl-card pl-card-blue"><div class="pl-card-label">Attendance</div><div class="pl-card-val" id="s-attendance">0</div></div>
    </div>

    <div class="pl-toggle-row">
      <label class="pl-toggle"><input type="checkbox" id="alcoholToggle" onchange="plCalc()" ${v('alcohol_on', false) ? 'checked' : ''} /><span class="pl-slider"></span></label>
      <span style="font-family:var(--font-ui);font-size:.85rem;color:var(--muted)">Include alcohol revenue & costs</span>
    </div>

    <div class="pl-section">
      <div class="pl-section-title">🎟 Ticket Revenue</div>
      <div class="pl-row-head"><span>Tier</span><span>Sold</span><span>Price</span><span>Revenue</span></div>
      ${ticketRows || '<p style="color:var(--muted);font-size:.8rem">No ticket tiers set up yet. Add tiers in Events & Tiers first.</p>'}
      <div class="pl-total-row"><span>Ticket Total</span><div class="pl-total" id="ticket-total">$0</div></div>
    </div>

    <div class="pl-section">
      <div class="pl-section-title">👕 Merch</div>
      <div class="pl-row-head"><span>Item</span><span>Produced / Sold</span><span>Sell / Cost</span><span>Net</span></div>
      <div class="pl-row">
        <label>T-Shirts</label>
        <div style="display:flex;gap:4px">
          <input type="number" id="sh-produced" value="${v('sh_produced',60)}" onchange="plCalc()" placeholder="Made" />
          <input type="number" id="sh-sold" value="${v('sh_sold',30)}" onchange="plCalc()" placeholder="Sold" />
        </div>
        <div style="display:flex;gap:4px">
          <input type="number" id="sh-sell" value="${v('sh_sell',30)}" onchange="plCalc()" placeholder="Sell $" />
          <input type="number" id="sh-cost" value="${v('sh_cost',10)}" onchange="plCalc()" placeholder="Cost $" />
        </div>
        <div class="pl-computed" id="sh-net">$0</div>
      </div>
      <div style="font-family:var(--font-ui);font-size:.65rem;color:var(--muted);margin-bottom:.75rem;letter-spacing:.1em">Revenue on sold units minus total production cost (all units produced)</div>
      <div class="pl-row">
        <label>Event Cassette</label>
        <div style="display:flex;gap:4px">
          <input type="number" id="ce-produced" value="${v('ce_produced',20)}" onchange="plCalc()" placeholder="Made" />
          <input type="number" id="ce-sold" value="${v('ce_sold',20)}" onchange="plCalc()" placeholder="Sold" />
        </div>
        <div style="display:flex;gap:4px">
          <input type="number" id="ce-sell" value="${v('ce_sell',8)}" onchange="plCalc()" placeholder="Sell $" />
          <input type="number" id="ce-cost" value="${v('ce_cost',2)}" onchange="plCalc()" placeholder="Cost $" />
        </div>
        <div class="pl-computed" id="ce-net">$0</div>
      </div>
      <div class="pl-row">
        <label>Regular Cassette</label>
        <div style="display:flex;gap:4px">
          <input type="number" id="cr-produced" value="${v('cr_produced',20)}" onchange="plCalc()" placeholder="Made" />
          <input type="number" id="cr-sold" value="${v('cr_sold',20)}" onchange="plCalc()" placeholder="Sold" />
        </div>
        <div style="display:flex;gap:4px">
          <input type="number" id="cr-sell" value="${v('cr_sell',5)}" onchange="plCalc()" placeholder="Sell $" />
          <input type="number" id="cr-cost" value="${v('cr_cost',1.10)}" onchange="plCalc()" placeholder="Cost $" />
        </div>
        <div class="pl-computed" id="cr-net">$0</div>
      </div>
      <div class="pl-row">
        <label>Bundled Cassette</label>
        <div style="display:flex;gap:4px">
          <input type="number" id="cb-produced" value="${v('cb_produced',22)}" onchange="plCalc()" placeholder="Qty" />
          <input type="number" style="visibility:hidden" />
        </div>
        <div style="display:flex;gap:4px">
          <input type="number" style="visibility:hidden" />
          <input type="number" id="cb-cost" value="${v('cb_cost',1.10)}" onchange="plCalc()" placeholder="Cost $" />
        </div>
        <div class="pl-computed pl-neg" id="cb-net">$0</div>
      </div>
      <div class="pl-total-row"><span>Merch Net</span><div class="pl-total" id="merch-total">$0</div></div>
    </div>

    <div class="pl-section" id="alcoholSection" style="display:none">
      <div class="pl-section-title">🍺 Alcohol</div>
      <div class="pl-row-head"><span>Item</span><span>Bought / Sold</span><span>Sell / Cost</span><span>Net</span></div>
      <div class="pl-row">
        <label>Beer</label>
        <div style="display:flex;gap:4px">
          <input type="number" id="b-bought" value="${v('b_bought',200)}" onchange="plCalc()" placeholder="Bought" />
          <input type="number" id="b-sold" value="${v('b_sold',150)}" onchange="plCalc()" placeholder="Sold" />
        </div>
        <div style="display:flex;gap:4px">
          <input type="number" id="b-sell" value="${v('b_sell',8)}" onchange="plCalc()" placeholder="Sell $" />
          <input type="number" id="b-cost" value="${v('b_cost',1.83)}" onchange="plCalc()" placeholder="Cost $" />
        </div>
        <div class="pl-computed" id="b-net">$0</div>
      </div>
      <div style="font-family:var(--font-ui);font-size:.65rem;color:var(--muted);margin-bottom:.75rem;letter-spacing:.1em">Revenue on sold units minus cost of ALL units bought</div>
      <div class="pl-row">
        <label>SOP Permit</label>
        <div style="display:flex;gap:4px"><input style="visibility:hidden" /><input style="visibility:hidden" /></div>
        <div style="display:flex;gap:4px">
          <input style="visibility:hidden" />
          <input type="number" id="sop-cost" value="${v('sop_cost',100)}" onchange="plCalc()" placeholder="Cost $" />
        </div>
        <div class="pl-computed pl-neg" id="sop-net">$0</div>
      </div>
      <div class="pl-total-row"><span>Alcohol Net</span><div class="pl-total" id="alcohol-total">$0</div></div>
    </div>

    <div class="pl-section">
      <div class="pl-section-title">📋 Expenses</div>
      <div class="pl-exp-grid">
        <div class="form-group"><label>Venue</label><input type="number" id="ex-venue" value="${v('ex_venue',2400)}" onchange="plCalc()" /></div>
        <div class="form-group"><label>Talent</label><input type="number" id="ex-talent" value="${v('ex_talent',1500)}" onchange="plCalc()" /></div>
        <div class="form-group"><label>Truck Rental</label><input type="number" id="ex-truck" value="${v('ex_truck',200)}" onchange="plCalc()" /></div>
        <div class="form-group"><label>Production</label><input type="number" id="ex-prod" value="${v('ex_prod',700)}" onchange="plCalc()" /></div>
        <div class="form-group"><label>Staff</label><input type="number" id="ex-staff" value="${v('ex_staff',500)}" onchange="plCalc()" /></div>
        <div class="form-group"><label>Graphics</label><input type="number" id="ex-graphics" value="${v('ex_graphics',200)}" onchange="plCalc()" /></div>
        <div class="form-group"><label>Ring Rental</label><input type="number" id="ex-ring" value="${v('ex_ring',0)}" onchange="plCalc()" /></div>
        <div class="form-group"><label>Chair Rental</label><input type="number" id="ex-chairs" value="${v('ex_chairs',0)}" onchange="plCalc()" /></div>
        <div class="form-group"><label>Lighting</label><input type="number" id="ex-lighting" value="${v('ex_lighting',0)}" onchange="plCalc()" /></div>
        <div class="form-group"><label>Audio</label><input type="number" id="ex-audio" value="${v('ex_audio',0)}" onchange="plCalc()" /></div>
        <div class="form-group"><label>Pipe & Drape</label><input type="number" id="ex-drape" value="${v('ex_drape',0)}" onchange="plCalc()" /></div>
        <div class="form-group"><label>Other</label><input type="number" id="ex-other" value="${v('ex_other',0)}" onchange="plCalc()" /></div>
      </div>
      <div class="pl-total-row"><span>Total Expenses</span><div class="pl-total pl-neg" id="exp-total">$0</div></div>
    </div>

    <div style="border-top:2px solid var(--cyan);margin-top:1rem;padding-top:1rem;display:flex;justify-content:space-between;align-items:center">
      <span style="font-family:var(--font-display);font-size:2rem;letter-spacing:.05em">NET PROFIT / LOSS</span>
      <div class="pl-total" id="net-total" style="font-size:1.5rem">$0</div>
    </div>

    <div style="margin-top:1.5rem;display:flex;gap:1rem;align-items:center">
      <button type="submit" class="save-btn" onclick="prepPLSubmit()">💾 Save P&L</button>
    </div>
  </form>`;
}function adminPage(section, events, currentEvent, ticketTypes, tickets, salesByTier, products, settings, ticketRevenue, productRevenue, allTickets, allPL, currentPL, plTicketTypes) {
  const eid = currentEvent?.id || '';
  const eventOptions = events.map(e => `<option value="${e.id}" ${e.id==eid?'selected':''}>${e.name}</option>`).join('');
  const totalRevenue = ticketRevenue + productRevenue;
  const totalSold = salesByTier.reduce((s,t) => s+(t.sold||0), 0);

  const revenueByEvent = {};
  allTickets.forEach(t => {
    if (!revenueByEvent[t.event_name]) revenueByEvent[t.event_name] = 0;
    revenueByEvent[t.event_name] += t.price_cents || 0;
  });

  const plYearRevenue = allPL.reduce((s,p) => s + (p.total_revenue||0), 0);
  const plYearExpenses = allPL.reduce((s,p) => s + (p.total_expenses||0), 0);
  const plYearNet = allPL.reduce((s,p) => s + (p.net_profit||0), 0);
  const plYearAttendance = allPL.reduce((s,p) => s + (p.attendance||0), 0);

  const salesCards = salesByTier.map(t => {
    const sold = t.sold||0;
    const remaining = t.capacity-sold;
    const pct = t.capacity > 0 ? Math.round((sold/t.capacity)*100) : 0;
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
        <form method="POST" action="/admin?action=delete-tier" style="display:inline" onsubmit="return confirm('Delete ${t.name} tier?')">
          <input type="hidden" name="id" value="${t.id}" />
          <input type="hidden" name="event_id" value="${t.event_id}" />
          <button type="submit" class="danger-btn" style="margin-left:0">✕</button>
        </form>
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

  const plHistoryRows = allPL.map(p => {
    const net = p.net_profit || 0;
    const netFmt = (net >= 0 ? '+$' : '-$') + Math.abs(net/100).toFixed(0);
    const netColor = net >= 0 ? 'var(--teal)' : '#ff6b6b';
    return `<tr>
      <td><a href="/admin?s=pl&pl=${p.id}" style="color:var(--cyan);text-decoration:none;font-weight:600">${p.show_name}</a></td>
      <td style="color:var(--muted)">${p.show_date||'—'}</td>
      <td>$${((p.total_revenue||0)/100).toFixed(0)}</td>
      <td>$${((p.total_expenses||0)/100).toFixed(0)}</td>
      <td style="color:${netColor};font-weight:700">${netFmt}</td>
      <td>${p.attendance||0}</td>
    </tr>`;
  }).join('');

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
    .form-group{display:flex;flex-direction:column;gap:.35rem}
    .form-group label{font-family:var(--font-ui);font-size:.65rem;font-weight:700;letter-spacing:.25em;text-transform:uppercase;color:var(--muted)}
    .form-group input,.form-group select,.form-group textarea{background:var(--charcoal);border:1px solid var(--border);color:var(--white);font-family:var(--font-body);font-size:.95rem;padding:.6rem .85rem;outline:none;border-radius:0;transition:border-color .2s;-webkit-appearance:none}
    .form-group input:focus,.form-group select:focus,.form-group textarea:focus{border-color:var(--cyan)}
    .form-group textarea{resize:vertical;min-height:80px}
    .save-btn{font-family:var(--font-ui);font-size:.8rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--black);background:var(--cyan);border:none;cursor:pointer;padding:.6rem 1.25rem;clip-path:polygon(6px 0%,100% 0%,calc(100% - 6px) 100%,0% 100%);transition:background .2s;white-space:nowrap}
    .save-btn:hover{background:var(--teal)}
    .danger-btn{font-family:var(--font-ui);font-size:.8rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#ff6b6b;background:transparent;border:1px solid rgba(255,107,107,.3);cursor:pointer;padding:.6rem 1.25rem;transition:all .2s;margin-left:.5rem}
    .danger-btn:hover{background:#ff6b6b;color:var(--black)}
    .primary-btn{font-family:var(--font-ui);font-size:.85rem;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--black);background:var(--cyan);border:none;cursor:pointer;padding:.75rem 1.5rem;clip-path:polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%);margin-bottom:1.5rem;display:inline-block;text-decoration:none}
    .tier-form{margin-bottom:.75rem;background:var(--charcoal);border:1px solid var(--border);padding:1rem}
    .tier-form-row{display:grid;grid-template-columns:140px 100px 100px 1fr auto auto;align-items:end;gap:.75rem}
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
    .revenue-header{font-family:var(--font-display);font-size:1.2rem;letter-spacing:.05em;color:var(--cyan);margin-bottom:.75rem;padding-bottom:.5rem;border-bottom:1px solid var(--border)}
    .modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:200;align-items:center;justify-content:center}
    .modal.open{display:flex}
    .modal-box{background:var(--surface);border:1px solid var(--border);padding:2rem;width:100%;max-width:600px;max-height:90vh;overflow-y:auto}
    .modal-title{font-family:var(--font-display);font-size:1.8rem;letter-spacing:.05em;margin-bottom:1.5rem}
    .modal-close{float:right;background:none;border:none;color:var(--muted);font-size:1.2rem;cursor:pointer}
    .pl-summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:1.5rem}
    .pl-card{padding:1rem;border-radius:4px;border:1px solid var(--border)}
    .pl-card-blue{background:rgba(0,212,255,.08);border-color:rgba(0,212,255,.2)}
    .pl-card-amber{background:rgba(251,191,36,.08);border-color:rgba(251,191,36,.2)}
    .pl-card-green{background:rgba(74,222,128,.08);border-color:rgba(74,222,128,.2)}
    .pl-card-label{font-family:var(--font-ui);font-size:.65rem;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);margin-bottom:.35rem}
    .pl-card-val{font-family:var(--font-display);font-size:1.8rem;letter-spacing:.05em;color:var(--cyan)}
    .pl-card-amber .pl-card-val{color:#fbbf24}
    .pl-card-green .pl-card-val{color:#4ade80}
    .pl-toggle-row{display:flex;align-items:center;gap:.75rem;margin-bottom:1.5rem}
    .pl-toggle{position:relative;width:40px;height:22px;display:inline-block}
    .pl-toggle input{opacity:0;width:0;height:0}
    .pl-slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:#2a2a38;border-radius:22px;transition:.3s}
    .pl-slider:before{position:absolute;content:"";height:16px;width:16px;left:3px;bottom:3px;background:#666;border-radius:50%;transition:.3s}
    .pl-toggle input:checked+.pl-slider{background:#166534}
    .pl-toggle input:checked+.pl-slider:before{transform:translateX(18px);background:#4ade80}
    .pl-section{background:var(--surface);border:1px solid var(--border);padding:1.25rem;margin-bottom:1rem}
    .pl-section-title{font-family:var(--font-ui);font-size:.7rem;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:var(--muted);margin-bottom:1rem;padding-bottom:.5rem;border-bottom:1px solid var(--border)}
    .pl-row-head{display:grid;grid-template-columns:1fr 140px 160px 100px;gap:.5rem;margin-bottom:.5rem}
    .pl-row-head span{font-family:var(--font-ui);font-size:.6rem;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#444}
    .pl-row{display:grid;grid-template-columns:1fr 140px 160px 100px;gap:.5rem;align-items:center;margin-bottom:.5rem}
    .pl-row label{font-family:var(--font-ui);font-size:.8rem;font-weight:600;color:var(--muted)}
    .pl-row input{background:var(--charcoal);border:1px solid var(--border);color:var(--white);font-family:var(--font-body);font-size:.85rem;padding:.4rem .6rem;outline:none;width:100%}
    .pl-row input:focus{border-color:var(--cyan)}
    .pl-computed{background:var(--charcoal);border:1px solid var(--border);padding:.4rem .6rem;font-family:var(--font-ui);font-size:.9rem;font-weight:600;color:var(--teal);text-align:right}
    .pl-neg{color:#f87171 !important}
    .pl-total-row{display:flex;justify-content:space-between;align-items:center;margin-top:.75rem;padding-top:.75rem;border-top:1px solid var(--border)}
    .pl-total-row span{font-family:var(--font-ui);font-size:.75rem;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--white)}
    .pl-total{font-family:var(--font-display);font-size:1.4rem;letter-spacing:.05em;color:var(--teal)}
    .pl-exp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.75rem;margin-bottom:1rem}
    .add-tier-form{background:var(--charcoal);border:1px dashed var(--border);padding:1rem;margin-top:1rem}
    .add-tier-row{display:grid;grid-template-columns:1fr 100px 100px auto;align-items:end;gap:.75rem}
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
      <p class="nav-section">Finance</p>
      <a href="/admin?s=pl&event=${eid}" class="nav-link ${section==='pl'?'active':''}">P&L Tracker</a>
      <p class="nav-section">Store</p>
      <a href="/admin?s=store" class="nav-link ${section==='store'?'active':''}">Products</a>
      <p class="nav-section">Site</p>
      <a href="/admin?s=settings" class="nav-link ${section==='settings'?'active':''}">Settings</a>
    </nav>
    <main class="main">

      ${['dashboard','tickets','doorlist','events','pl'].includes(section) ? `
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
        ${allPL.length > 0 ? `
        <div class="card">
          <p class="section-title">P&L Year-to-Date</p>
          <div class="stats-grid">
            <div class="stat-card highlight">
              <div class="stat-label">Total Revenue</div>
              <div class="stat-num">$${(plYearRevenue/100).toFixed(0)}</div>
              <div class="stat-sub">across ${allPL.length} show${allPL.length!==1?'s':''}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Net Profit</div>
              <div class="stat-num" style="color:${plYearNet>=0?'var(--teal)':'#f87171'}">${plYearNet>=0?'+':'-'}$${Math.abs(plYearNet/100).toFixed(0)}</div>
              <div class="stat-sub">after all expenses</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Total Attendance</div>
              <div class="stat-num">${plYearAttendance}</div>
              <div class="stat-sub">across all shows</div>
            </div>
          </div>
        </div>` : ''}
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
                <label class="upload-btn" style="cursor:pointer">Upload Image<input type="file" accept="image/*" style="display:none" onchange="uploadFile(this,'posterUrl','posterStatus')" /></label>
              </div>
              <div class="upload-status" id="posterStatus"></div>
              ${currentEvent.poster_url ? `<img src="${currentEvent.poster_url}" style="width:80px;height:120px;object-fit:cover;border:1px solid var(--border);margin-top:.5rem" />` : ''}
            </div>
            <button type="submit" class="save-btn">Save Event</button>
          </form>
          <form method="POST" action="/admin?action=delete-event" style="margin-top:1rem" onsubmit="return confirm('Delete this event and ALL its tickets and P&L?')">
            <input type="hidden" name="id" value="${currentEvent.id}" />
            <button type="submit" class="danger-btn">Delete Event</button>
          </form>
        </div>
        <div class="card">
          <p class="section-title">Ticket Tiers</p>
          ${tierForms || '<p style="color:var(--muted);font-size:.85rem;margin-bottom:1rem">No tiers yet — add one below.</p>'}
          <div class="add-tier-form">
            <p style="font-family:var(--font-ui);font-size:.65rem;font-weight:700;letter-spacing:.25em;text-transform:uppercase;color:var(--muted);margin-bottom:.75rem">Add New Tier</p>
            <form method="POST" action="/admin?action=add-tier">
              <input type="hidden" name="event_id" value="${eid}" />
              <div class="add-tier-row">
                <div class="form-group"><label>Tier Name</label><input type="text" name="name" placeholder="e.g. Balcony VIP" required /></div>
                <div class="form-group"><label>Price ($)</label><input type="number" name="price" step="0.50" min="0" placeholder="35.00" /></div>
                <div class="form-group"><label>Capacity</label><input type="number" name="capacity" min="1" placeholder="50" /></div>
                <button type="submit" class="save-btn" style="align-self:end">+ Add</button>
              </div>
            </form>
          </div>
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

      ${section==='pl' ? `
        <h1 class="page-title">P&L Tracker</h1>
        <p class="page-sub">${currentEvent?.name||''} · projected & actual financials</p>
        ${allPL.length > 0 ? `
        <div class="card" style="margin-bottom:1.5rem">
          <p class="section-title">Year-to-Date Summary</p>
          <div class="stats-grid" style="margin-bottom:1rem">
            <div class="stat-card highlight">
              <div class="stat-label">Total Revenue</div>
              <div class="stat-num">$${(plYearRevenue/100).toFixed(0)}</div>
              <div class="stat-sub">${allPL.length} show${allPL.length!==1?'s':''}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Total Expenses</div>
              <div class="stat-num" style="color:#fbbf24">$${(plYearExpenses/100).toFixed(0)}</div>
              <div class="stat-sub">all shows combined</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Net Profit</div>
              <div class="stat-num" style="color:${plYearNet>=0?'var(--teal)':'#f87171'}">${plYearNet>=0?'+':'-'}$${Math.abs(plYearNet/100).toFixed(0)}</div>
              <div class="stat-sub">after all expenses</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Total Attendance</div>
              <div class="stat-num">${plYearAttendance}</div>
              <div class="stat-sub">across all shows</div>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Show</th><th>Date</th><th>Revenue</th><th>Expenses</th><th>Net</th><th>Attendance</th></tr></thead>
              <tbody>${plHistoryRows}</tbody>
            </table>
          </div>
        </div>` : ''}
        <div class="card">
          <p class="section-title">${currentPL ? currentPL.show_name + ' — P&L' : 'No P&L yet'}</p>
          ${currentPL ? plEditorHTML(currentPL, plTicketTypes) : `<p style="color:var(--muted);font-family:var(--font-ui);font-size:.85rem">No P&L for this event yet. Create a new event to auto-generate one.</p>`}
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
              <tbody>${productRows||'<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:2rem">No products yet</td></tr>'}</tbody>
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
            <p class="section-title" style="margin-top:1.5rem">Homepage Video</p>
            <div class="form-group" style="margin-bottom:1.5rem">
              <label>Highlight Reel URL</label>
              <input type="text" name="highlight_video" value="${settings.highlight_video||''}" placeholder="YouTube or Vimeo URL" />
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
  </div><div class="modal" id="addEventModal">
    <div class="modal-box">
      <button class="modal-close" onclick="document.getElementById('addEventModal').classList.remove('open')">✕</button>
      <div class="modal-title">Add New Event</div>
      <form method="POST" action="/admin?action=add-event">
        <div class="form-group" style="margin-bottom:1rem"><label>Event Name</label><input type="text" name="name" placeholder="miXtape Wrestling Vol. 1" required /></div>
        <div class="form-row">
          <div class="form-group"><label>Date</label><input type="text" name="date" placeholder="TBA" /></div>
          <div class="form-group"><label>Venue</label><input type="text" name="venue" placeholder="TBA" /></div>
        </div>
        <p style="font-family:var(--font-ui);font-size:.7rem;color:var(--muted);margin-bottom:1rem;letter-spacing:.1em">A P&L will be automatically created and linked to this event. Add your ticket tiers after creating the event.</p>
        <button type="submit" class="save-btn">Create Event + P&L</button>
      </form>
    </div>
  </div>

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
            <label class="upload-btn" style="cursor:pointer">Upload<input type="file" accept="image/*" style="display:none" onchange="uploadFile(this,'productImageUrl','productImageStatus')" /></label>
          </div>
          <div class="upload-status" id="productImageStatus"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Stripe Price ID</label><input type="text" name="stripe_price_id" id="productStripe" placeholder="price_..." /></div>
          <div class="form-group"><label>Stock Status</label>
            <select name="in_stock" id="productStock"><option value="1">In Stock</option><option value="0">Out of Stock</option></select>
          </div>
          <div class="form-group"><label>Featured</label>
            <select name="featured" id="productFeatured"><option value="0">No</option><option value="1">Yes</option></select>
          </div>
          <div class="form-group"><label>Stock Qty (-1 = unlimited)</label>
            <input type="number" name="stock_quantity" id="productStock_qty" value="-1" min="-1" />
          </div>
        </div>
        <button type="submit" class="save-btn">Save Product</button>
      </form>
    </div>
  </div>

  <script>
    function g(id) { return parseFloat(document.getElementById(id)?.value) || 0; }
    function fmt(n) {
      const abs = Math.abs(n);
      const s = '$' + abs.toLocaleString('en-CA', {minimumFractionDigits:0,maximumFractionDigits:0});
      return n < 0 ? '-' + s : s;
    }
    function setEl(id, val, isNeg) {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = val;
      if (isNeg !== undefined) {
        if (isNeg) el.classList.add('pl-neg'); else el.classList.remove('pl-neg');
      }
    }

    function plCalc() {
      const tierData = JSON.parse(document.getElementById('plTierIds')?.value || '[]');
      let ticketTotal = 0;
      let attendance = 0;
      tierData.forEach(tt => {
        const sold = g('tt_' + tt.id + '_sold');
        const price = g('tt_' + tt.id + '_price');
        const rev = sold * price;
        ticketTotal += rev;
        attendance += sold;
        setEl('tt_' + tt.id + '_rev', fmt(rev));
      });
      setEl('ticket-total', fmt(ticketTotal));
      setEl('s-attendance', attendance);

      const calcMerch = (pfx) => {
        const produced = g(pfx+'-produced');
        const sold = g(pfx+'-sold');
        const sell = g(pfx+'-sell');
        const cost = g(pfx+'-cost');
        return (sold * sell) - (produced * cost);
      };
      const shNet = calcMerch('sh');
      const ceNet = calcMerch('ce');
      const crNet = calcMerch('cr');
      const cbNet = -(g('cb-produced') * g('cb-cost'));
      setEl('sh-net', fmt(shNet), shNet < 0);
      setEl('ce-net', fmt(ceNet), ceNet < 0);
      setEl('cr-net', fmt(crNet), crNet < 0);
      setEl('cb-net', fmt(cbNet));
      const merchTotal = shNet + ceNet + crNet + cbNet;
      setEl('merch-total', fmt(merchTotal), merchTotal < 0);

      const alcoholOn = document.getElementById('alcoholToggle')?.checked;
      const alcoholSec = document.getElementById('alcoholSection');
      if (alcoholSec) alcoholSec.style.display = alcoholOn ? 'block' : 'none';
      let alcoholNet = 0;
      if (alcoholOn) {
        const bBought = g('b-bought');
        const bSold = g('b-sold');
        const bSell = g('b-sell');
        const bCost = g('b-cost');
        const bNet = (bSold * bSell) - (bBought * bCost);
        const sopNet = -g('sop-cost');
        setEl('b-net', fmt(bNet), bNet < 0);
        setEl('sop-net', fmt(sopNet));
        alcoholNet = bNet + sopNet;
        setEl('alcohol-total', fmt(alcoholNet), alcoholNet < 0);
      }

      const expenses = g('ex-venue')+g('ex-talent')+g('ex-truck')+g('ex-prod')+g('ex-staff')+g('ex-graphics')+g('ex-ring')+g('ex-chairs')+g('ex-lighting')+g('ex-audio')+g('ex-drape')+g('ex-other');
      setEl('exp-total', fmt(-expenses));

      const totalRevenue = ticketTotal + merchTotal + alcoholNet;
      const net = totalRevenue - expenses;

      setEl('s-revenue', fmt(totalRevenue));
      setEl('s-expenses', fmt(expenses));

      const netEl = document.getElementById('s-net');
      const netTotal = document.getElementById('net-total');
      if (netEl) { netEl.textContent = fmt(net); netEl.style.color = net >= 0 ? '#4ade80' : '#f87171'; }
      if (netTotal) { netTotal.textContent = fmt(net); netTotal.style.color = net >= 0 ? 'var(--teal)' : '#f87171'; }

      const setHidden = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
      setHidden('plNetProfit', Math.round(net * 100));
      setHidden('plTotalRevenue', Math.round(totalRevenue * 100));
      setHidden('plTotalExpenses', Math.round(expenses * 100));
      setHidden('plAttendance', attendance);
    }

    function prepPLSubmit() {
      const tierData = JSON.parse(document.getElementById('plTierIds')?.value || '[]');
      const data = { alcohol_on: document.getElementById('alcoholToggle')?.checked || false };
      tierData.forEach(tt => {
        data['tt_' + tt.id + '_sold'] = g('tt_' + tt.id + '_sold');
        data['tt_' + tt.id + '_price'] = g('tt_' + tt.id + '_price');
      });
      const fields = ['sh-produced','sh-sold','sh-sell','sh-cost','ce-produced','ce-sold','ce-sell','ce-cost','cr-produced','cr-sold','cr-sell','cr-cost','cb-produced','cb-cost','b-bought','b-sold','b-sell','b-cost','sop-cost','ex-venue','ex-talent','ex-truck','ex-prod','ex-staff','ex-graphics','ex-ring','ex-chairs','ex-lighting','ex-audio','ex-drape','ex-other'];
      fields.forEach(k => {
        const el = document.getElementById(k);
        if (el) data[k.replace(/-/g,'_')] = parseFloat(el.value) || 0;
      });
      const jsonEl = document.getElementById('plDataJson');
      if (jsonEl) jsonEl.value = JSON.stringify(data);
    }

    if (document.getElementById('plTierIds')) { plCalc(); }

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
      ['productId','productName','productDesc','productPrice','productStripe','productImageUrl'].forEach(id => { document.getElementById(id).value = ''; });
    }

    document.querySelectorAll('.modal').forEach(function(m) {
      m.addEventListener('click', function(e) { if (e.target === m) m.classList.remove('open'); });
    });
  </script>
</body>
</html>`;
}
