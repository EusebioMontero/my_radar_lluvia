# my_radar_lluvia

Radar de lluvia con los **radares individuales de AEMET** (un píxel ≈ 500 m, alcance 240 km), como hace la app «Alarma de Lluvia», más una **previsión a 2 h** calculada con pySTEPS.

Es una página estática (`index.html`), sin dependencias que instalar: se publica con GitHub Pages. Los datos los prepara un workflow de GitHub Actions (ver más abajo).

## Qué hace la página

- Dibuja a la vez los radares que cubren lo que se ve en pantalla (hasta 8, los más cercanos al centro; en cada punto gana la intensidad más alta). La capa se dibuja en un canvas propio a la resolución de la pantalla: para cada punto se miran los 4 píxeles de radar vecinos y se pinta la clase dominante con interpolación suave, así los contornos salen redondeados. Zoom hasta 14; con mucho zoom se distinguen las celdas de 500 m, que es la resolución real del dato.
- Línea de tiempo común (imágenes de ~2 h, una cada 10 min) con ▶ para animarla. Al abrir muestra el instante más cercano a «ahora».
- Botón **Cobertura**: radares a menos de 240 km de la zona elegida, con su distancia y la antigüedad de su última imagen. Solo están verificados por nombre Cáceres (SFT), Sevilla (CLG) y Salamanca (GRM) (`NOMBRES` en `procesado/procesar.mjs`); el resto aparece como «Radar CÓDIGO».
- Leyenda en mm/h: AEMET calcula la lluvia desde la reflectividad con Z = 200·R^1,6 (Marshall-Palmer), así que cada tramo de 6 dBZ de su escala equivale a un tramo de mm/h.
- Se refresca solo cada 5 minutos; si falla la carga, reintenta cada 30 s y lo explica en el estado.

### Previsión

La calcula el workflow con **[pySTEPS](https://pysteps.github.io)** (`procesado/prever.py`), la librería abierta de *nowcasting* por radar que usan varios servicios meteorológicos:

1. Compone todos los radares de la península y Baleares en una rejilla de 0,01° (≈1 km) para los tres últimos instantes de 10 min (las Canarias quedan fuera).
2. Estima un **campo de movimiento por zonas** con Lucas-Kanade (cada zona puede moverse con su dirección y velocidad).
3. Extrapola con **S-PROG**: desplaza la lluvia siguiendo ese campo y descompone la imagen por escalas; las estructuras pequeñas, que viven poco, se van suavizando con el tiempo y las grandes se mantienen.
4. Publica 12 imágenes (de 10 en 10 min, **2 h desde la última imagen**) en `prevision/` de la rama `datos` y las anota en `manifest.json` (`prevision`). Tarda unos 25 s y usa ~1,5 GB de RAM en el runner.

La página muestra esos instantes después de los observados, con la etiqueta «previsión» y **un marco naranja alrededor del mapa**. Como AEMET publica con retraso (la imagen más reciente suele tener 15-40 min), al abrir se muestra el instante más cercano a «ahora», que ya puede ser una estimación.

Si el workflow no pudo calcular la previsión (no hay tres imágenes seguidas, o falla pySTEPS), la página usa un cálculo sencillo propio: un movimiento uniforme estimado en la zona que se ve (correlación por bloques entre la imagen de hace ~20 min y la última) y la última imagen desplazada hasta 30 min después de «ahora». El texto de estado dice cuál se está usando.

Limitaciones: no prevé lluvia nueva que se forme ni la que entre desde fuera de la cobertura de los radares, y a 1-2 h la previsión es una orientación (más suave y menos precisa).

## Datos de los radares (workflow y rama `datos`)

El navegador no puede pedir el archivo de AEMET directamente (pesa ~30 MB, 300 TIFF). `.github/workflows/radar.yml` («Datos de radar AEMET») se ejecuta cada 10 minutos (y a mano) en GitHub Actions:

1. Descarga `https://www.aemet.es/es/api-eltiempo/radar/download/PPI` (un `.tar.gz` con los TIFF RGBA de todos los radares, últimos 30 min).
2. `procesado/procesar.mjs` (Node) localiza el círculo de datos de cada radar, lo recorta y convierte cada imagen a un PNG de paleta con **una clase por píxel** (color → tramo de la escala de AEMET; 0 = sin eco o fuera de cobertura). Los 15 radares ocupan ~0,5 MB en total por tres imágenes. Conserva las últimas 12 imágenes de cada radar, sin pasar de ~2 h respecto a la última (las anteriores vienen de la ejecución previa, porque AEMET solo da 30 min), y borra los radares que llevan más de 60 min sin datos. La respuesta de AEMET pasa por una caché intermedia (CloudFront) que ignora los parámetros de la URL; el log del workflow muestra sus cabeceras y la edad de la última imagen.
3. `procesado/prever.py` (Python 3.11, dependencias fijadas en `procesado/requirements.txt`) calcula la previsión (ver arriba).
4. Publica el resultado como un único commit huérfano (sin historial, no crece) en la rama **`datos`**: `manifest.json` (geometría y horas de cada radar, escala de colores) y `<RADAR>/<AAAAMMDDHHMM>.png` (hora UTC). La página los lee de `raw.githubusercontent.com` (caché de ~5 min).

No usa ningún secreto: la descarga por radar de AEMET no necesita API key y el workflow solo usa el `GITHUB_TOKEN` automático (permiso `contents: write` declarado en el propio workflow; si el repositorio lo restringe, actívalo en *Settings → Actions → General → Workflow permissions*).

Para probarlo la primera vez: pestaña **Actions** → «Datos de radar AEMET» → **Run workflow**. Cuando acabe, `https://raw.githubusercontent.com/EusebioMontero/my_radar_lluvia/datos/manifest.json` debe mostrar el manifiesto.

Limitaciones: GitHub puede retrasar los workflows programados 5-20 min, y los desactiva si el repositorio pasa 60 días sin actividad (hay que reactivarlos en Actions; no cuentes con que los commits automáticos de la rama `datos` evitan ese plazo).

Uso local del procesado (necesita Node 20+ y Python 3.11): `cd procesado && npm ci && pip install -r requirements.txt && node procesar.mjs ../salida [archivo.tar.gz] && python prever.py ../salida`; sin archivo, lo descarga de AEMET.

## Créditos

Información elaborada utilizando, entre otras, la obtenida de la Agencia Estatal de Meteorología (AEMET). Mapa base: © OpenStreetMap.
