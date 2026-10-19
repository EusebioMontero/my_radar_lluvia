// Proxy de la composición nacional de radar de AEMET para my_radar_lluvia.
// Descarga el archivo de "datos georeferenciados" (tar.gz con GeoTIFF cada 10 min), añade CORS y lo cachea 5 minutos.
// No necesita API key.

const SOURCE = 'https://www.aemet.es/es/api-eltiempo/radar/download/compo';
const CACHE_SECONDS = 300;
const VERSION = 'v4';
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
  return new Response(JSON.stringify({ ...body, worker: VERSION }), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...cors }
  });
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return json(405, { error: 'Método no permitido' }, cors);

    const url = new URL(request.url);
    if (url.pathname !== '/radar/compo') return json(404, { error: 'Ruta desconocida', rutas: ['/radar/compo'] }, cors);

    // La caché guarda la respuesta sin cabeceras CORS; se añaden al devolverla.
    const cache = caches.default;
    const cacheKey = new Request(url.origin + url.pathname, { method: 'GET' });
    let base = await cache.match(cacheKey);

    if (!base) {
      const up = await fetch(SOURCE, { headers: { 'User-Agent': UA, Accept: '*/*' } });
      if (!up.ok) return json(502, { error: 'AEMET respondió con error', status: up.status }, cors);
      base = new Response(up.body, {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
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
