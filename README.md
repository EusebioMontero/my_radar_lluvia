# my_radar_lluvia

Radar de lluvia con los **radares individuales de AEMET** (un píxel ≈ 500 m, alcance 240 km), como hace la app «Alarma de Lluvia», más una **previsión experimental** hasta 30 minutos después de «ahora» calculada en el navegador.

Es una página estática (`index.html`), sin dependencias que instalar: se publica con GitHub Pages. Los datos los prepara un workflow de GitHub Actions (ver más abajo).

## Qué hace la página

- Dibuja a la vez los radares que cubren lo que se ve en pantalla (hasta 8, los más cercanos al centro; en cada punto gana la intensidad más alta). La capa se dibuja en un canvas propio a la resolución de la pantalla: para cada punto se miran los 4 píxeles de radar vecinos y se pinta la clase dominante con interpolación suave, así los contornos salen redondeados. Zoom hasta 14; con mucho zoom se distinguen las celdas de 500 m, que es la resolución real del dato.
- Línea de tiempo común (imágenes de ~2 h, una cada 10 min) con ▶ para animarla. Al abrir muestra el instante más cercano a «ahora».
- Botón **Cobertura**: radares a menos de 240 km de la zona elegida, con su distancia y la antigüedad de su última imagen. Solo están verificados por nombre Cáceres (SFT), Sevilla (CLG) y Salamanca (GRM) (`NOMBRES` en `procesado/procesar.mjs`); el resto aparece como «Radar CÓDIGO».
- Leyenda en mm/h: AEMET calcula la lluvia desde la reflectividad con Z = 200·R^1,6 (Marshall-Palmer), así que cada tramo de 6 dBZ de su escala equivale a un tramo de mm/h.
- Se refresca solo cada 5 minutos; si falla la carga, reintenta cada 30 s y lo explica en el estado.

### Previsión

Se estima un **movimiento uniforme** de la lluvia en la zona que se ve (con margen, entre 3°×2,2° y 7°×5° alrededor del centro del mapa): se compone un campo de celdas de ≈4 km con todos los radares, se busca el desplazamiento que mejor lleva la imagen de hace ~20 min a la más reciente (diferencia media absoluta, con refinado de subcelda, solo en celdas cubiertas por radar en ambos instantes) y se desplaza la última imagen de cada radar en pasos de 10 min. Se recalcula al mover el mapa. Limitaciones: no modela que la lluvia crezca, se deshaga o cambie de dirección, y la lluvia que entra desde fuera de la cobertura no se conoce.

AEMET publica con retraso (la imagen más reciente suele tener 15-40 min), así que la previsión avanza hasta 30 min después de «ahora»: los instantes entre la última imagen y «ahora» ya son una estimación y están marcados como «previsión». Si la última imagen tiene más de 90 min no se calcula.

## Datos de los radares (workflow y rama `datos`)

El navegador no puede pedir el archivo de AEMET directamente (pesa ~30 MB, 300 TIFF). `.github/workflows/radar.yml` («Datos de radar AEMET») se ejecuta cada 10 minutos (y a mano) en GitHub Actions:

1. Descarga `https://www.aemet.es/es/api-eltiempo/radar/download/PPI` (un `.tar.gz` con los TIFF RGBA de todos los radares, últimos 30 min).
2. `procesado/procesar.mjs` localiza el círculo de datos de cada radar, lo recorta y convierte cada imagen a un PNG de paleta con **una clase por píxel** (color → tramo de la escala de AEMET; 0 = sin eco o fuera de cobertura). Los 15 radares ocupan ~0,5 MB en total por tres imágenes. Conserva las últimas 12 imágenes de cada radar, sin pasar de ~2 h respecto a la última (las anteriores vienen de la ejecución previa, porque AEMET solo da 30 min), y borra los radares que llevan más de 60 min sin datos. La respuesta de AEMET pasa por una caché intermedia (CloudFront) que ignora los parámetros de la URL; el log del workflow muestra sus cabeceras y la edad de la última imagen.
3. Publica el resultado como un único commit huérfano (sin historial, no crece) en la rama **`datos`**: `manifest.json` (geometría y horas de cada radar, escala de colores) y `<RADAR>/<AAAAMMDDHHMM>.png` (hora UTC). La página los lee de `raw.githubusercontent.com` (caché de ~5 min).

No usa ningún secreto: la descarga por radar de AEMET no necesita API key y el workflow solo usa el `GITHUB_TOKEN` automático (permiso `contents: write` declarado en el propio workflow; si el repositorio lo restringe, actívalo en *Settings → Actions → General → Workflow permissions*).

Para probarlo la primera vez: pestaña **Actions** → «Datos de radar AEMET» → **Run workflow**. Cuando acabe, `https://raw.githubusercontent.com/EusebioMontero/my_radar_lluvia/datos/manifest.json` debe mostrar el manifiesto.

Limitaciones: GitHub puede retrasar los workflows programados 5-20 min, y los desactiva si el repositorio pasa 60 días sin actividad (hay que reactivarlos en Actions; no cuentes con que los commits automáticos de la rama `datos` evitan ese plazo).

Uso local del procesado (necesita Node 20+): `cd procesado && npm ci && node procesar.mjs ../salida [archivo.tar.gz]`; sin archivo, lo descarga de AEMET.

## Créditos

Información elaborada utilizando, entre otras, la obtenida de la Agencia Estatal de Meteorología (AEMET). Mapa base: © OpenStreetMap.
