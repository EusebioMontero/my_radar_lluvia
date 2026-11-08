// Procesa el archivo de radares de AEMET para my_radar_lluvia.
//
// AEMET publica en https://www.aemet.es/es/api-eltiempo/radar/download/PPI un .tar.gz (~30 MB) con GeoTIFF de los
// radares regionales: cada imagen es un JPEG RGBA de 3580×3271 píxeles (0,005° ≈ 500 m) de los que solo importa un
// círculo de 240 km. Este script se queda con los radares activos, recorta ese círculo, convierte los colores a
// clases de la escala dBZ y escribe PNG con paleta (unas decenas de KB) más un manifest.json.
//
// Uso:  node procesar.mjs <carpeta_salida> [archivo.tar.gz]     (sin archivo, lo descarga de AEMET)
// Si la carpeta de salida ya tiene un manifest.json de una ejecución anterior, solo procesa las imágenes nuevas
// y conserva las últimas GUARDAR de cada radar.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { gunzipSync, deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { fromArrayBuffer } from 'geotiff';

const URL_PPI = process.env.URL_PPI || 'https://www.aemet.es/es/api-eltiempo/radar/download/PPI';
const UA = 'my_radar_lluvia (GitHub Actions; https://github.com/EusebioMontero/my_radar_lluvia)';
const GUARDAR = 12;        // imágenes que se conservan por radar (2 h a una cada 10 min)
const MAX_EDAD_MIN = 130;  // las imágenes más de ~2 h anteriores a la última de su radar se descartan
const ACTIVO_MIN = 60;     // un radar está activo si su última imagen es de hace menos de 60 min respecto a la más reciente
const MARGEN = 4;          // píxeles de margen alrededor del círculo
const RADIO_KM = 240;
const REDUCCION = 10;      // la localización del círculo se hace sobre la imagen reducida 1/10

// ---------- descarga y tar ----------
async function descargar(url = URL_PPI) {
  let ultimo;
  for (let i = 1; i <= 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const cab = ['date', 'last-modified', 'age', 'cache-control', 'etag', 'x-cache', 'server'].map(h => [h, r.headers.get(h)]).filter(x => x[1]).map(x => `${x[0]}=${x[1]}`).join('; ');
      console.log(`Descarga ${url.replace(URL_PPI, 'PPI')}: HTTP ${r.status}; ${cab || '(sin cabeceras de caché)'}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) { ultimo = e; console.warn(`Intento ${i} fallido: ${e.message}`); await new Promise(r => setTimeout(r, 4000 * i)); }
  }
  throw new Error(`No se pudo descargar el archivo de AEMET: ${ultimo.message}`);
}

function untar(buf) {
  const out = [];
  let off = 0;
  while (off + 512 <= buf.length) {
    const head = buf.subarray(off, off + 512);
    if (head.every(b => b === 0)) break;
    const name = head.toString('latin1', 0, 100).replace(/\0.*$/s, '');
    const size = parseInt(head.toString('latin1', 124, 136), 8) || 0;
    const type = String.fromCharCode(head[156]);
    off += 512;
    if ((type === '0' || type === '\0') && size > 0) out.push({ name, data: buf.subarray(off, off + size) });
    off += Math.ceil(size / 512) * 512;
  }
  return out;
}

// ---------- imagen ----------
const abrir = async data => (await fromArrayBuffer(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))).getImage();

// La escala viene dentro del TIFF como un diccionario estilo Python: {'Producto': 'PPI', 'Lista RGBA': [...]}
function leerEscala(img) {
  const xml = img.fileDirectory.GDAL_METADATA || '';
  const m = /<Item name="ESCALA">([\s\S]*?)<\/Item>/.exec(xml);
  if (!m) throw new Error('el TIFF no trae la escala (ESCALA)');
  const lista = JSON.parse(m[1].replace(/'/g, '"'))['Lista RGBA'];
  return lista
    .map(e => ({ min: Number(e.Valores[0]), max: e.Valores[1] === '' ? null : Number(e.Valores[1]), rgb: e.RGBA.slice(0, 3).map(Number) }))
    .sort((a, b) => a.min - b.min);
}

// Fuera del círculo de cobertura el TIFF pinta un gris azulado semitransparente (alpha ≈ 179); dentro, "sin eco" es
// alpha 0 y los ecos son opacos (alpha 255).
const esFuera = a => a >= 150 && a <= 215;

// Caja (en píxeles) del círculo de cobertura. Se cuenta por filas/columnas para que el ruido del JPEG no la ensanche.
function cajaCirculo(rgba, w, h, minCuenta) {
  const filas = new Uint32Array(h), cols = new Uint32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!esFuera(rgba[(y * w + x) * 4 + 3])) { filas[y]++; cols[x]++; }
  const ext = (v) => { let a = 0, b = v.length - 1; while (a < v.length && v[a] < minCuenta) a++; while (b >= 0 && v[b] < minCuenta) b--; return [a, b]; };
  const [x0, x1] = ext(cols), [y0, y1] = ext(filas);
  return { x0, x1, y0, y1 };
}

async function localizar(img) {
  const W = img.getWidth(), H = img.getHeight();
  const w = Math.floor(W / REDUCCION), h = Math.floor(H / REDUCCION);
  const r = await img.readRasters({ width: w, height: h, resampleMethod: 'nearest', interleave: true });
  const c = cajaCirculo(r, w, h, 3);
  if (c.x1 <= c.x0 || c.y1 <= c.y0) throw new Error('no se encuentra el círculo de cobertura');
  // ventana a resolución completa algo mayor, para medir con exactitud
  const m = 3 * REDUCCION;
  const v = [Math.max(0, c.x0 * REDUCCION - m), Math.max(0, c.y0 * REDUCCION - m), Math.min(W, (c.x1 + 1) * REDUCCION + m), Math.min(H, (c.y1 + 1) * REDUCCION + m)];
  const vw = v[2] - v[0], vh = v[3] - v[1];
  const full = await img.readRasters({ window: v, interleave: true });
  const e = cajaCirculo(full, vw, vh, 8);
  const x0 = v[0] + e.x0, x1 = v[0] + e.x1, y0 = v[1] + e.y0, y1 = v[1] + e.y1;
  return { x0: x0 - MARGEN, y0: y0 - MARGEN, w: x1 - x0 + 1 + 2 * MARGEN, h: y1 - y0 + 1 + 2 * MARGEN,
           cx: (x0 + x1 + 1) / 2, cy: (y0 + y1 + 1) / 2, rx: (x1 - x0 + 1) / 2, ry: (y1 - y0 + 1) / 2 };
}

// RGBA → clase (0 = sin eco o fuera del círculo; 1..N = tramo de la escala, de menor a mayor dBZ)
function clasificar(rgba, win, escala) {
  const { w, h } = win, cls = new Uint8Array(w * h);
  const cx = win.cx - win.x0, cy = win.cy - win.y0;
  const pal = escala.map(e => e.rgb);
  let ruido = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x + 0.5 - cx) / win.rx, ny = (y + 0.5 - cy) / win.ry;
      if (nx * nx + ny * ny > 1.0004) continue;           // fuera del radio de 240 km
      const o = (y * w + x) * 4;
      if (rgba[o + 3] < 220) continue;                     // sin eco (alpha 0) o zona semitransparente
      let mejor = 0, dm = 1e9;
      for (let k = 0; k < pal.length; k++) {
        const dr = rgba[o] - pal[k][0], dg = rgba[o + 1] - pal[k][1], db = rgba[o + 2] - pal[k][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < dm) { dm = d; mejor = k; }
      }
      if (dm > 6400) { ruido++; continue; }                // color que no es de la escala (artefacto del JPEG)
      cls[y * w + x] = mejor + 1;
    }
  }
  return { cls, ruido };
}

// ---------- PNG con paleta (sin dependencias) ----------
const TABLA_CRC = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = TABLA_CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function trozo(tipo, datos) {
  const len = Buffer.alloc(4); len.writeUInt32BE(datos.length);
  const td = Buffer.concat([Buffer.from(tipo, 'latin1'), datos]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(cls, w, h, escala) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 3;
  const plte = Buffer.alloc((escala.length + 1) * 3); escala.forEach((e, k) => { plte[(k + 1) * 3] = e.rgb[0]; plte[(k + 1) * 3 + 1] = e.rgb[1]; plte[(k + 1) * 3 + 2] = e.rgb[2]; });
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(cls.buffer, cls.byteOffset + y * w, w).copy(raw, y * (w + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), trozo('PLTE', plte), trozo('tRNS', Buffer.from([0])),
    trozo('IDAT', deflateSync(raw, { level: 9 })), trozo('IEND', Buffer.alloc(0))]);
}

// ---------- principal ----------
const NOMBRES = {   // solo los verificados por distancia con la app de referencia
  SFT: 'Cáceres · Sierra de Fuentes',
  CLG: 'Sevilla · El Castillo de las Guardas',
  GRM: 'Salamanca · Guadramiro'
};

const [salida, archivoLocal] = process.argv.slice(2);
if (!salida) { console.error('Uso: node procesar.mjs <carpeta_salida> [archivo.tar.gz]'); process.exit(2); }

const abrirArchivo = b => untar(b.subarray(0, 2).equals(Buffer.from([0x1f, 0x8b])) ? gunzipSync(b) : b);
// minutos desde la imagen PPI más reciente del archivo (las horas de los nombres son UTC)
const edadMin = ents => {
  const t = ents.map(e => /down_[A-Z]{3}(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\d{2}\.PPI\./.exec(e.name)).filter(Boolean)
    .map(m => Date.UTC(2000 + +m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000);
  return t.length ? Date.now() / 60000 - Math.max(...t) : Infinity;
};

const t0 = Date.now();
let buf, entradas;
if (archivoLocal) { buf = readFileSync(archivoLocal); entradas = abrirArchivo(buf); }
else {
  buf = await descargar();
  entradas = abrirArchivo(buf);
  const edad = edadMin(entradas);
  console.log(`Imagen más reciente del archivo: hace ${Math.round(edad)} min`);
  // Si el archivo parece atrasado (caché intermedia), se pide otra vez con un parámetro distinto y se usa el más nuevo.
  if (edad > 25) {
    try {
      const buf2 = await descargar(`${URL_PPI}?_=${Date.now()}`), ent2 = abrirArchivo(buf2), edad2 = edadMin(ent2);
      console.log(`Segunda descarga: imagen más reciente hace ${Math.round(edad2)} min`);
      if (edad2 < edad) { buf = buf2; entradas = ent2; }
    } catch (e) { console.warn(`Segunda descarga fallida: ${e.message}`); }
  }
}
console.log(`Archivo: ${(buf.length / 1e6).toFixed(1)} MB, ${entradas.length} ficheros`);

// agrupar los PPI por radar
const porRadar = {};
for (const e of entradas) {
  const m = /down_([A-Z]{3})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\d{2}\.PPI\.Z_005_240\.tif$/.exec(e.name);
  if (!m) continue;
  (porRadar[m[1]] ||= []).push({ t: `20${m[2]}${m[3]}${m[4]}${m[5]}${m[6]}`, data: e.data });
}
const aMin = t => Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8), +t.slice(8, 10), +t.slice(10, 12)) / 60000;
const masReciente = Math.max(...Object.values(porRadar).flat().map(f => aMin(f.t)));

mkdirSync(salida, { recursive: true });
const rutaManifest = join(salida, 'manifest.json');
const previo = existsSync(rutaManifest) ? JSON.parse(readFileSync(rutaManifest, 'utf8')) : { radares: {} };
const manifest = { generado: new Date().toISOString(), producto: 'PPI', pixel_grados: 0.005, radio_km: RADIO_KM, escala: null, radares: {} };

for (const codigo of Object.keys(porRadar).sort()) {
  const frames = porRadar[codigo].sort((a, b) => a.t.localeCompare(b.t));
  if (masReciente - aMin(frames.at(-1).t) > ACTIVO_MIN) continue;      // radar sin imágenes recientes
  const ant = previo.radares?.[codigo];
  const dir = join(salida, codigo);
  mkdirSync(dir, { recursive: true });
  let geo = ant ? { ...ant.ventana, w: ant.ancho, h: ant.alto, oeste: ant.oeste, norte: ant.norte, lat: ant.lat, lon: ant.lon } : null, escala = previo.escala;
  const imagenes = (ant?.imagenes || []).filter(i => existsSync(join(salida, i.f)));
  const nuevas = frames.filter(f => !imagenes.some(i => i.t === f.t));
  for (const f of nuevas) {
    const img = await abrir(f.data);
    escala = leerEscala(img);
    if (!geo) {
      const win = await localizar(img);
      const bb = img.getBoundingBox(), px = (bb[2] - bb[0]) / img.getWidth(), py = (bb[3] - bb[1]) / img.getHeight();
      geo = { ...win, oeste: +(bb[0] + win.x0 * px).toFixed(5), norte: +(bb[3] - win.y0 * py).toFixed(5),
              lon: +(bb[0] + win.cx * px).toFixed(4), lat: +(bb[3] - win.cy * py).toFixed(4) };
    }
    const rgba = await img.readRasters({ window: [geo.x0, geo.y0, geo.x0 + geo.w, geo.y0 + geo.h], interleave: true });
    const { cls, ruido } = clasificar(rgba, geo, escala);
    const fichero = `${codigo}/${f.t}.png`;
    const bytes = png(cls, geo.w, geo.h, escala);
    writeFileSync(join(salida, fichero), bytes);
    imagenes.push({ t: f.t, f: fichero });
    const ecos = cls.reduce((n, v) => n + (v ? 1 : 0), 0);
    console.log(`  ${codigo} ${f.t}: ${(bytes.length / 1024).toFixed(0)} KB, ${ecos} px con eco, ${ruido} descartados`);
  }
  imagenes.sort((a, b) => a.t.localeCompare(b.t));
  // fuera las que sobran y las que quedan muy atrás respecto a la más reciente (huecos tras una caída de AEMET)
  const corte = aMin(imagenes.at(-1).t) - MAX_EDAD_MIN;
  const sobran = imagenes.filter((im, k) => k < imagenes.length - GUARDAR || aMin(im.t) < corte);
  for (const viejo of sobran) rmSync(join(salida, viejo.f), { force: true });
  imagenes.splice(0, imagenes.length, ...imagenes.filter(im => !sobran.includes(im)));
  if (escala && !manifest.escala) manifest.escala = escala;
  manifest.radares[codigo] = { nombre: NOMBRES[codigo] || null, lat: geo.lat, lon: geo.lon, oeste: geo.oeste, norte: geo.norte, ancho: geo.w, alto: geo.h,
    ventana: { x0: geo.x0, y0: geo.y0, cx: geo.cx, cy: geo.cy, rx: geo.rx, ry: geo.ry }, imagenes };
}
// radares que ya no están activos: se borran sus ficheros
for (const codigo of Object.keys(previo.radares || {})) if (!manifest.radares[codigo]) rmSync(join(salida, codigo), { recursive: true, force: true });

writeFileSync(rutaManifest, JSON.stringify(manifest));
console.log(`Listo: ${Object.keys(manifest.radares).length} radares activos en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
