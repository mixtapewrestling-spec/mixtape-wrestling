export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    const events = await db.prepare("SELECT * FROM events WHERE active = 1 ORDER BY CASE WHEN date IS NULL OR date = "" OR date = "TBA" THEN 1 ELSE 0 END, date ASC, id DESC").all();
    const result = [];
    for (const event of events.results) {
      const types = await db.prepare("SELECT * FROM ticket_types WHERE event_id = ?").bind(event.id).all();
      const sold = await db.prepare("SELECT ticket_type_id, COUNT(*) as cnt FROM tickets WHERE event_id = ? GROUP BY ticket_type_id").bind(event.id).all();
      const soldMap = {};
      sold.results.forEach(s => { soldMap[s.ticket_type_id] = s.cnt; });
      result.push({
        ...event,
        ticketTypes: types.results.map(t => ({
          ...t,
          sold: soldMap[t.id] || 0,
          remaining: t.capacity - (soldMap[t.id] || 0),
        }))
      });
    }
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
