/* ============================================================
   Cloudflare Pages Function — Gemini proxy

   Keno: site ta public URL e. Key browser e pathale je keu devtools khule
   niye nite parto. Tai key ekhane, Cloudflare secret e thake — browser
   shudhu nijer domain e `/api/gemini/...` call kore.

   Cloudflare dashboard → Pages project → Settings → Environment variables
   e ei duita **secret** lagbe:
     GEMINI_KEY   — aistudio.google.com er API key
     PERSONA_PASS — nijer banano passphrase (app er settings e ei tai dite hobe)

   Request e `x-persona-pass` header na mille 401. Response (SSE soho)
   hubohu stream kore ferot jay.
   ============================================================ */

const UPSTREAM = 'https://generativelanguage.googleapis.com/v1beta';

/** Length-leak ba early-exit na kore compare kore. */
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Google er error shape-i use kori jate app er error handler ekhane-o khate. */
const fail = (status, message) => new Response(JSON.stringify({ error: { message } }), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

export async function onRequest({ request, env, params }) {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return fail(405, 'GET ba POST chara kichu allowed na.');
  }
  if (!env.GEMINI_KEY) {
    return fail(500, 'Server e GEMINI_KEY set kora nei. Pages → Settings → Environment variables dekho.');
  }
  if (!env.PERSONA_PASS) {
    return fail(500, 'Server e PERSONA_PASS set kora nei. Pages → Settings → Environment variables dekho.');
  }
  if (!sameSecret(request.headers.get('x-persona-pass') || '', env.PERSONA_PASS)) {
    return fail(401, 'Passphrase ta thik nei. Chat settings e "Cloud access" e thik ta dao.');
  }

  /* [[path]] catch-all — "models" ba "models/gemini-3.6-flash:streamGenerateContent" */
  const path = (Array.isArray(params.path) ? params.path : [params.path])
    .filter(Boolean).map(encodeURIComponent).join('/')
    .replace(/%3A/gi, ':');            // "model:streamGenerateContent" er colon ta rakhte hobe
  if (!path.startsWith('models')) return fail(404, 'Ei path ta proxy kora hoy na.');

  /* client er query rakhi (alt=sse, pageSize...) kintu key ta server theke boshai */
  const url = new URL(`${UPSTREAM}/${path}`);
  new URL(request.url).searchParams.forEach((v, k) => { if (k !== 'key') url.searchParams.set(k, v); });
  url.searchParams.set('key', env.GEMINI_KEY);

  let upstream;
  try {
    upstream = await fetch(url, {
      method: request.method,
      headers: { 'content-type': 'application/json' },
      body: request.method === 'POST' ? request.body : undefined,
    });
  } catch (e) {
    return fail(502, 'Google er kachhe pouchano gelo na: ' + e.message);
  }

  /* body ta stream kore-i pathai — na hole SSE er word-by-word ta noshto hoye jabe */
  const headers = new Headers();
  headers.set('content-type', upstream.headers.get('content-type') || 'application/json');
  headers.set('cache-control', 'no-store');
  return new Response(upstream.body, { status: upstream.status, headers });
}
