# my_radar_lluvia

Radar de lluvia con datos de [RainViewer](https://www.rainviewer.com): animación de las últimas ~2 horas y una previsión experimental de +30 min calculada en el navegador a partir del movimiento de la lluvia.

Es una página estática (`index.html`), sin dependencias que instalar. Ábrela en el navegador o publícala con GitHub Pages.

Datos meteorológicos: Rain Viewer (uso personal/educativo, atribución obligatoria). Mapa base: OpenStreetMap.

## Fuentes

- **RainViewer** (por defecto): animación de ~2 h y previsión experimental de +30 min.
- **AEMET radares (500 m)**: los radares individuales de AEMET (PPI de reflectividad, un píxel ≈ 500 m, alcance 240 km), como hace la app «Alarma de Lluvia». El navegador no puede pedir el archivo de AEMET directamente (pesa ~30 MB, 300 TIFF), así que lo procesa un workflow de GitHub Actions (ver más abajo) y publica unos PNG diminutos en la rama `datos`; la página solo lee esos PNG. Dibuja a la vez los radares que cubren lo que se ve en pantalla (hasta 8, los más cercanos al centro; en cada punto gana la intensidad más alta), con la misma capa suavizada de la composición nacional, con línea de tiempo común (imágenes de ~2 h, una cada 10 min) y el botón **Cobertura**, que lista los radares a menos de 240 km de la zona elegida con su distancia y la antigüedad de su última imagen. La leyenda está en mm/h: AEMET calcula la lluvia desde la reflectividad con Z = 200·R^1,6 (Marshall-Palmer), así que cada tramo de 6 dBZ de su escala equivale a un tramo de mm/h. Si todavía no hay datos publicados, vuelve solo a RainViewer y lo explica en el estado. Sin API key. Atribución: «Información elaborada utilizando, entre otras, la obtenida de la Agencia Estatal de Meteorología».
- **AEMET nacional (3 km)** (animación): composición de radares de la península y Baleares, 24 imágenes GeoTIFF (≈4 h, una cada 10 min) en EPSG:4326, así que se colocan sin calibrar. Se descargan de `https://www.aemet.es/es/api-eltiempo/radar/download/compo` (un `.tar.gz` que contiene un `.tar` con los TIFF), se descomprimen en el navegador (gzip → tar → TIFF con paleta) y se animan con los mismos controles. La capa se dibuja en un canvas propio a la resolución de la pantalla: para cada punto se mira los 4 píxeles de radar vecinos (≈3 km) y se pinta la clase dominante con interpolación suave, así los contornos salen redondeados a cualquier zoom. No añade información que el dato no tenga: la resolución real sigue siendo la de la composición. Ojo: la paleta de cada TIFF es distinta (los índices se reordenan entre imágenes), así que cualquier leyenda hay que asociarla por color RGB, no por índice. No necesita API key. Si el navegador no puede pedir el archivo directamente (CORS), lo pide por el Worker de Cloudflare (`/radar/compo`, carpeta `worker/`). Sin previsión.
- **AEMET regional** (opcional): radar regional (por defecto Cáceres, código `cc`), pedido directamente desde el navegador. La API key se escribe en el botón **Clave** y se guarda solo en el `localStorage` del navegador; no está en el repo. Se envía en la cabecera `api_key` (así no queda en la URL ni en el historial); si el navegador bloquea esa cabecera por CORS o AEMET la rechaza, se repite la petición con la clave como parámetro `?api_key=`. En la consola del navegador aparece cuál de las dos se usó. Muestra solo la última imagen, sin previsión. Producto: PPI (Z) de cada radar regional, GIF, una imagen cada 10 min. La posición de la imagen en el mapa es provisional: el botón **Ajustar** permite alinearla (se guarda en el navegador) y los valores por defecto están en `CAL_DEFAULT`.
- © AEMET (uso autorizado citándola). El endpoint de API `/red/radar/nacional` devolvía 404 el 19/10/2026 (también en la web de AEMET), por eso la composición nacional se toma del archivo de descarga.

## Datos de los radares individuales (workflow y rama `datos`)

`.github/workflows/radar.yml` («Datos de radar AEMET») se ejecuta cada 10 minutos (y a mano) en GitHub Actions:

1. Descarga `https://www.aemet.es/es/api-eltiempo/radar/download/PPI` (un `.tar.gz` con los TIFF RGBA de todos los radares, últimas 30 min).
2. `procesado/procesar.mjs` localiza el círculo de datos de cada radar, lo recorta y convierte cada imagen a un PNG de paleta con **una clase por píxel** (color → tramo de la escala de AEMET; 0 = sin eco o fuera de cobertura). Los 15 radares ocupan ~0,5 MB en total por tres imágenes. Conserva las últimas 12 imágenes de cada radar (las anteriores vienen de la ejecución previa, porque AEMET solo da 30 min) y borra los radares que llevan más de 60 min sin datos.
3. Publica el resultado como un único commit huérfano (sin historial, no crece) en la rama **`datos`**: `manifest.json` (geometría y horas de cada radar, escala de colores) y `<RADAR>/<AAAAMMDDHHMM>.png` (hora UTC). La página los lee de `raw.githubusercontent.com` (caché de ~5 min).

No usa ningún secreto: la descarga por radar de AEMET no necesita API key y el workflow solo usa el `GITHUB_TOKEN` automático (permiso `contents: write` declarado en el propio workflow; si el repositorio lo restringe, actívalo en *Settings → Actions → General → Workflow permissions*).

Para probarlo la primera vez: pestaña **Actions** → «Datos de radar AEMET» → **Run workflow**. Cuando acabe, `https://raw.githubusercontent.com/EusebioMontero/my_radar_lluvia/datos/manifest.json` debe mostrar el manifiesto.

Limitaciones: GitHub puede retrasar los workflows programados 5-20 min, y los desactiva si el repositorio pasa 60 días sin actividad (hay que reactivarlos en Actions; no cuentes con que los commits automáticos de la rama `datos` evitan ese plazo). No se pueden saber de antemano los nombres de todos los radares: solo están verificados Cáceres (SFT), Sevilla (CLG) y Salamanca (GRM) en `NOMBRES` de `procesar.mjs`; el resto aparece como «Radar CÓDIGO».

Uso local (necesita Node 20+): `cd procesado && npm ci && node procesar.mjs ../salida [archivo.tar.gz]`; sin archivo, lo descarga de AEMET.

`worker/` es un proxy de Cloudflare que solo añade CORS y caché al archivo de la composición nacional (ver `worker/README.md`).
