# Proxy de AEMET

Cloudflare Worker que guarda la API key de AEMET OpenData, añade CORS y cachea 5 minutos.

## Despliegue

```
cd worker
npx wrangler login
npx wrangler secret put AEMET_KEY     # pega aquí la key de AEMET
npx wrangler deploy
```

Wrangler imprime la URL del Worker (`https://radar-aemet-proxy.<tu-subdominio>.workers.dev`).
Pégala en `AEMET_WORKER` al principio del script de `index.html`.

Si publicas la página en otro dominio, añádelo a `ALLOWED_ORIGINS` en `wrangler.toml`.

## Rutas

- `GET /radar/nacional` → imagen de la composición nacional de radares.
