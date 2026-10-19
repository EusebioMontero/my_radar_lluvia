# my_radar_lluvia

Radar de lluvia con datos de [RainViewer](https://www.rainviewer.com): animación de las últimas ~2 horas y una previsión experimental de +30 min calculada en el navegador a partir del movimiento de la lluvia.

Es una página estática (`index.html`), sin dependencias que instalar. Ábrela en el navegador o publícala con GitHub Pages.

Datos meteorológicos: Rain Viewer (uso personal/educativo, atribución obligatoria). Mapa base: OpenStreetMap.

## Fuentes

- **RainViewer** (por defecto): animación de ~2 h y previsión experimental de +30 min.
- **AEMET** (opcional): radar regional (por defecto Cáceres, código `cc`), pedido directamente desde el navegador. La API key se escribe en el botón **Clave** y se guarda solo en el `localStorage` del navegador; no está en el repo. Muestra solo la última imagen, sin previsión. Producto: PPI (Z) de cada radar regional, GIF, una imagen cada 10 min. © AEMET (uso autorizado citándola). La posición de la imagen en el mapa es provisional: el botón **Ajustar** permite alinearla (se guarda en el navegador) y los valores por defecto están en `CAL_DEFAULT`.
- La composición nacional de AEMET devolvía error 404 en su propia web el 19/10/2026, por eso no se usa.

La carpeta `worker/` (proxy de Cloudflare) no se usa ahora: AEMET admite llamadas directas desde el navegador.
