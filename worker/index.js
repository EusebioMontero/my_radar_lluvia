// Proxy de AEMET OpenData para my_radar_lluvia.
// Guarda la API key como secreto (AEMET_KEY), añade CORS y cachea 5 minutos.
// AEMET responde en dos pasos: 1) JSON con la URL de los datos, 2) la imagen en esa URL.

const API = 'https://opendata.aemet.es/opendata/api';
const ROUTES = { '/radar/nacional': '/red/radar/nacional' };
const CACHE_SECONDS = 300;
const VERSION = 'v3';
const UA = 'Mozilla/5.0 (compatible; my_radar_lluvia-proxy/1.0; +https://github.com/EusebioMontero/my_radar_lluvia)';

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const h = { 'Vary': 'Origin' };
  if (allowed.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
  }
  return h;
}

function json(status, body, cors) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors }
  });
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json(405, { error: 'Método no permitido' }, cors);

    const url = new URL(request.url);
    const route = ROUTES[url.pathname];
    if (!route) return json(404, { error: 'Ruta desconocida', rutas: Object.keys(ROUTES) }, cors);
    if (!env.AEMET_KEY) return json(500, { error: 'Falta el secreto AEMET_KEY en el Worker' }, cors);

    // La caché guarda la respuesta sin cabeceras CORS; se añaden al devolverla.
    const cache = caches.default;
    const cacheKey = new Request(url.origin + url.pathname, { method: 'GET' });
    let base = await cache.match(cacheKey);

    if (!base) {
      // AEMET falla a veces de forma puntual: hasta 3 intentos si responde con error.
      let info = null, lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await new Promise(r => setTimeout(r, 800));
        const meta = await fetch(`${API}${route}?api_key=${encodeURIComponent(env.AEMET_KEY.trim())}`, {
          headers: { api_key: env.AEMET_KEY.trim(), Accept: 'application/json', 'User-Agent': UA, 'Cache-Control': 'no-cache' }
        });
        if (!meta.ok) { lastErr = { error: 'AEMET respondió con error', status: meta.status }; continue; }
        const raw = await meta.text();
        let j;
        try { j = JSON.parse(raw); } catch { lastErr = { error: 'Respuesta de AEMET no válida', http: meta.status, tipo: meta.headers.get('content-type'), inicio: raw.slice(0, 200) }; continue; }
        if (j.estado !== 200 || !j.datos) { lastErr = { error: 'AEMET no devolvió datos', estado: j.estado, descripcion: j.descripcion, http: meta.status, ruta: route }; if (j.estado === 401) break; continue; }
        info = j; break;
      }
      if (!info) return json(502, { ...lastErr, intentos: 3, worker: VERSION }, cors);
      const img = await fetch(info.datos, { headers: { 'User-Agent': UA } });
      if (!img.ok) return json(502, { error: 'No se pudo descargar la imagen de AEMET', status: img.status }, cors);

      base = new Response(img.body, {
        status: 200,
        headers: {
          'Content-Type': img.headers.get('Content-Type') || 'application/octet-stream',
          'Cache-Control': `public, max-age=${CACHE_SECONDS}`
        }
      });
      ctx.waitUntil(cache.put(cacheKey, base.clone()));
    }

    const headers = new Headers(base.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(base.body, { status: base.status, headers });
  }
};
