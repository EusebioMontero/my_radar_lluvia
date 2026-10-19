# my_radar_lluvia

Radar de lluvia con datos de [RainViewer](https://www.rainviewer.com): animación de las últimas ~2 horas y una previsión experimental de +30 min calculada en el navegador a partir del movimiento de la lluvia.

Es una página estática (`index.html`), sin dependencias que instalar. Ábrela en el navegador o publícala con GitHub Pages.

Datos meteorológicos: Rain Viewer (uso personal/educativo, atribución obligatoria). Mapa base: OpenStreetMap.

## Fuentes

- **RainViewer** (por defecto): animación de ~2 h y previsión experimental de +30 min.
- **AEMET** (opcional): composición nacional de radares, a través del Worker de `worker/`. Configura `AEMET_WORKER` en `index.html` para activarla. Muestra solo la última imagen y no tiene previsión.
