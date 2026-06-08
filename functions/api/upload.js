export async function onRequestPost(context) {
  try {
    const cookie = context.request.headers.get('cookie') || '';
    if (!cookie.includes('mx_admin=true')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' }
      });
    }

    const formData = await context.request.formData();
    const file = formData.get('file');

    if (!file) {
      return new Response(JSON.stringify({ error: 'No file provided' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    const ext = file.name.split('.').pop().toLowerCase();
    const allowed = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
    if (!allowed.includes(ext)) {
      return new Response(JSON.stringify({ error: 'File type not allowed' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      });
    }

    const filename = Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9.-]/g, '-');
    const buffer = await file.arrayBuffer();

    await context.env.MEDIA.put(filename, buffer, {
      httpMetadata: { contentType: file.type }
    });

    const url = 'https://pub-d279b52b4fc34ba29a6b18826682953e.r2.dev/' + filename;

    return new Response(JSON.stringify({ url }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });

  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}
