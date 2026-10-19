# my_radar_lluvia

Radar de lluvia con datos de [RainViewer](https://www.rainviewer.com): animación de las últimas ~2 horas y una previsión experimental de +30 min calculada en el navegador a partir del movimiento de la lluvia.

Es una página estática (`index.html`), sin dependencias que instalar. Ábrela en el navegador o publícala con GitHub Pages.

Datos meteorológicos: Rain Viewer (uso personal/educativo, atribución obligatoria). Mapa base: OpenStreetMap.

## Fuentes

- **RainViewer** (por defecto): animación de ~2 h y previsión experimental de +30 min.
- **AEMET nacional** (animación): composición de radares de la península y Baleares, 24 imágenes GeoTIFF (≈4 h, una cada 10 min) en EPSG:4326, así que se colocan sin calibrar. Se descargan de `https://www.aemet.es/es/api-eltiempo/radar/download/compo` (un `.tar.gz` que contiene un `.tar` con los TIFF), se descomprimen en el navegador (gzip → tar → TIFF con paleta) y se animan con los mismos controles. La capa se dibuja en un canvas propio a la resolución de la pantalla: para cada punto se mira los 4 píxeles de radar vecinos (≈3 km) y se pinta la clase dominante con interpolación suave, así los contornos salen redondeados a cualquier zoom. No añade información que el dato no tenga: la resolución real sigue siendo la de la composición. Ojo: la paleta de cada TIFF es distinta (los índices se reordenan entre imágenes), así que cualquier leyenda hay que asociarla por color RGB, no por índice. No necesita API key. Si el navegador no puede pedir el archivo directamente (CORS), lo pide por el Worker de Cloudflare (`/radar/compo`, carpeta `worker/`). Sin previsión.
- **AEMET regional** (opcional): radar regional (por defecto Cáceres, código `cc`), pedido directamente desde el navegador. La API key se escribe en el botón **Clave** y se guarda solo en el `localStorage` del navegador; no está en el repo. Muestra solo la última imagen, sin previsión. Producto: PPI (Z) de cada radar regional, GIF, una imagen cada 10 min. La posición de la imagen en el mapa es provisional: el botón **Ajustar** permite alinearla (se guarda en el navegador) y los valores por defecto están en `CAL_DEFAULT`.
- © AEMET (uso autorizado citándola). El endpoint de API `/red/radar/nacional` devolvía 404 el 19/10/2026 (también en la web de AEMET), por eso la composición nacional se toma del archivo de descarga.

`worker/` es un proxy de Cloudflare que solo añade CORS y caché al archivo de la composición nacional (ver `worker/README.md`).
