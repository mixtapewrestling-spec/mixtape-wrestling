export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    const settings = (await db.prepare("SELECT * FROM settings").all()).results ?? [];
    const map = {};
    settings.forEach(s => { map[s.key] = s.value; });
    return new Response(JSON.stringify(map), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
