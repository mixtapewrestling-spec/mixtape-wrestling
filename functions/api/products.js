export async function onRequestGet(context) {
  try {
    const db = context.env.DB;
    const products = await db.prepare("SELECT * FROM products ORDER BY display_order ASC, id DESC").all();
    return new Response(JSON.stringify(products.results ?? []), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
