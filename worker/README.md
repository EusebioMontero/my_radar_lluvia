# Proxy de AEMET (composición nacional)

Cloudflare Worker que descarga `https://www.aemet.es/es/api-eltiempo/radar/download/compo`
(un archivo con 24 imágenes GeoTIFF, una cada 10 min), añade CORS y lo cachea 5 minutos.
No usa API key.

## Despliegue

Está conectado al repositorio con Cloudflare Workers Builds (Root directory: `worker`),
así que cada push a `main` lo redespliega. Para desplegarlo a mano:

```
cd worker
npx wrangler deploy
```

Si publicas la página en otro dominio, añádelo a `ALLOWED_ORIGINS` en `wrangler.toml`.

## Ruta

- `GET /radar/compo` → el archivo tar (o tar.gz) con los GeoTIFF.
