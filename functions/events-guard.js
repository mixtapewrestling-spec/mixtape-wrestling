export async function onRequestGet(context) {
  const cookie = context.request.headers.get('cookie') || '';
  const unlocked = cookie.includes('mx_unlocked=true');

  if (unlocked) {
    return context.next();
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>miXtape Wrestling</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow+Condensed:wght@400;600;700&family=Barlow:wght@400;500&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --black:#0a0a0c;--charcoal:#111116;--surface:#17171e;--border:#2a2a38;
      --cyan:#00d4ff;--teal:#00f5d4;--purple:#9b59ff;--white:#f0f0f8;--muted:#8888aa;
      --font-display:'Bebas Neue',sans-serif;
      --font-ui:'Barlow Condensed',sans-serif;
      --font-body:'Barlow',sans-serif;
    }
    body {
      background:var(--black);color:var(--white);font-family:var(--font-body);
      min-height:100vh;display:flex;align-items:center;justify-content:center;
      overflow:hidden;
    }
    body::before {
      content:'';position:fixed;inset:0;
      background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E");
      pointer-events:none;z-index:9999;opacity:0.35;
    }
    .glow {
      position:fixed;width:600px;height:600px;border-radius:50%;
      background:radial-gradient(circle,rgba(155,89,255,0.15) 0%,rgba(0,212,255,0.08) 40%,transparent 70%);
      top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none;
      animation:pulse 6s ease-in-out infinite;
    }
    @keyframes pulse{0%,100%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-50%,-50%) scale(1.1)}}
    .grid {
      position:fixed;inset:0;
      background-image:linear-gradient(rgba(0,212,255,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(0,212,255,0.04) 1px,transparent 1px);
      background-size:60px 60px;
      mask-image:radial-gradient(ellipse 80% 80% at 50% 50%,black 30%,transparent 100%);
      pointer-events:none;
    }
    .holo-text {
      background:linear-gradient(135deg,#00d4ff,#9b59ff,#ff6ec7,#00f5d4,#00d4ff);
      background-size:300% 300%;-webkit-background-clip:text;-webkit-text-fill-color:transparent;
      background-clip:text;animation:holo-shift 4s ease infinite;
    }
    @keyframes holo-shift{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
    .wrap {
      position:relative;z-index:1;
      text-align:center;padding:2rem;
      max-width:480px;width:100%;
    }
    .logo {
      font-family:var(--font-display);
      font-size:clamp(3rem,12vw,6rem);
      line-height:0.9;letter-spacing:0.02em;
      margin-bottom:0.5rem;
    }
    .tagline {
      font-family:var(--font-ui);font-size:0.75rem;font-weight:700;
      letter-spacing:0.4em;text-transform:uppercase;
      color:var(--muted);margin-bottom:3rem;
    }
    .lock-box {
      background:var(--surface);
      border:1px solid var(--border);
      clip-path:polygon(0 0,calc(100% - 20px) 0,100% 20px,100% 100%,20px 100%,0 calc(100% - 20px));
      padding:2rem;
    }
    .lock-label {
      font-family:var(--font-ui);font-size:0.7rem;font-weight:700;
      letter-spacing:0.35em;text-transform:uppercase;
      color:var(--cyan);margin-bottom:1.25rem;
    }
    .lock-input {
      width:100%;
      background:var(--charcoal);
      border:1px solid var(--border);
      color:var(--white);
      font-family:var(--font-display);
      font-size:1.8rem;
      letter-spacing:0.1em;
      text-align:center;
      text-transform:uppercase;
      padding:0.75rem 1rem;
      outline:none;
      border-radius:0;
      transition:border-color 0.2s;
      margin-bottom:1rem;
      -webkit-appearance:none;
    }
    .lock-input:focus { border-color:var(--cyan); }
    .lock-input::placeholder { color:var(--border);font-size:1.2rem;letter-spacing:0.05em; }
    .lock-btn {
      width:100%;
      font-family:var(--font-ui);font-size:1rem;font-weight:700;
      letter-spacing:0.2em;text-transform:uppercase;
      color:var(--black);
      background:linear-gradient(135deg,var(--cyan),var(--teal));
      border:none;cursor:pointer;
      padding:1rem 2rem;
      clip-path:polygon(12px 0%,100% 0%,calc(100% - 12px) 100%,0% 100%);
      transition:transform 0.2s,box-shadow 0.2s;
      box-shadow:0 0 20px rgba(0,212,255,0.3);
    }
    .lock-btn:hover{transform:translateY(-2px);box-shadow:0 0 35px rgba(0,212,255,0.5);}
    .error-msg {
      font-family:var(--font-ui);font-size:0.8rem;font-weight:700;
      letter-spacing:0.2em;text-transform:uppercase;
      color:#ff6b6b;margin-top:0.75rem;
      display:none;
    }
    .error-msg.visible { display:block; }
  </style>
</head>
<body>
  <div class="glow"></div>
  <div class="grid"></div>
  <div class="wrap">
    <div class="logo">
      <span class="holo-text">miX</span><span style="color:var(--white)">tape</span>
    </div>
    <p class="tagline">Independent Pro Wrestling</p>
    <div class="lock-box">
      <p class="lock-label">Early Access — Enter Code</p>
      <input class="lock-input" type="password" id="codeInput" placeholder="Enter code" autocomplete="off" />
      <button class="lock-btn" id="submitBtn">Unlock</button>
      <p class="error-msg" id="errorMsg">Invalid code — try again</p>
    </div>
  </div>
  <script>
    document.getElementById('submitBtn').addEventListener('click', checkCode);
    document.getElementById('codeInput').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') checkCode();
    });
    function checkCode() {
      var input = document.getElementById('codeInput').value.trim().toUpperCase();
      if (input === 'DXGUNSHORNS') {
        document.cookie = 'mx_unlocked=true; path=/; max-age=86400';
        window.location.reload();
      } else {
        document.getElementById('errorMsg').classList.add('visible');
        document.getElementById('codeInput').value = '';
        document.getElementById('codeInput').focus();
      }
    }
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}
