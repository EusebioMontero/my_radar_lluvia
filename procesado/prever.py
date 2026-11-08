"""Previsión a muy corto plazo (nowcasting) con pySTEPS para my_radar_lluvia.

Lee lo que deja procesar.mjs en la carpeta de datos (manifest.json + PNG con una clase por píxel de cada radar),
compone los radares de la península y Baleares en una rejilla común de 0,01° (≈1 km), estima un campo de
movimiento por zonas (Lucas-Kanade) y extrapola con S-PROG (la lluvia se desplaza siguiendo ese campo y las
estructuras pequeñas, que duran menos, se van suavizando con el tiempo). Escribe PASOS imágenes de 10 min en
<datos>/prevision/ y añade la entrada "prevision" al manifest.

Uso:  python prever.py <carpeta_datos>
"""
import json
import os
import sys
import time
import zlib
import struct
from datetime import datetime, timedelta, timezone

import numpy as np
from PIL import Image

PASOS = 12            # 12 x 10 min = 2 h desde la última imagen
PASO_MIN = 10
FACTOR = 2            # 0,005° (dato) -> 0,01° (previsión)
LON_MIN = -12.0       # se dejan fuera las Canarias (otro dominio)
UMBRAL_MMH = 0.1      # por debajo, sin lluvia
DB_CERO = -15.0       # valor en dB para "sin lluvia"
MIN_RADARES = 0.5     # fracción de radares de la península con imagen para usar un instante


def clase_a_mmh(escala):
    """Intensidad representativa (mm/h) de cada clase: centro del tramo de dBZ y Z = 200·R^1,6."""
    tabla = np.zeros(len(escala) + 1, dtype=np.float32)
    for k, e in enumerate(escala):
        dbz = e['min'] + 3.0
        tabla[k + 1] = (10 ** (dbz / 10) / 200) ** (1 / 1.6)
    return tabla


def mmh_a_clase(r, escala):
    dbz = np.full(r.shape, -99.0, dtype=np.float32)
    ok = r >= UMBRAL_MMH
    dbz[ok] = 10 * np.log10(200 * r[ok] ** 1.6)
    cls = np.zeros(r.shape, dtype=np.uint8)
    for k, e in enumerate(escala):
        cls[dbz >= e['min']] = k + 1
    return cls


def trozo(tipo, datos):
    return struct.pack('>I', len(datos)) + tipo + datos + struct.pack('>I', zlib.crc32(tipo + datos) & 0xFFFFFFFF)


def png(cls, escala):
    """PNG de paleta igual que los de procesar.mjs: índice = clase, el 0 transparente."""
    h, w = cls.shape
    plte = bytearray(3 * (len(escala) + 1))
    for k, e in enumerate(escala):
        plte[3 * (k + 1):3 * (k + 2)] = bytes(e['rgb'])
    raw = b''.join(b'\x00' + cls[y].tobytes() for y in range(h))
    return (b'\x89PNG\r\n\x1a\n' + trozo(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 3, 0, 0, 0)) + trozo(b'PLTE', bytes(plte))
            + trozo(b'tRNS', b'\x00') + trozo(b'IDAT', zlib.compress(raw, 9)) + trozo(b'IEND', b''))


def hora(t):
    return datetime.strptime(t, '%Y%m%d%H%M').replace(tzinfo=timezone.utc)


def main(carpeta):
    t0 = time.time()
    ruta_man = os.path.join(carpeta, 'manifest.json')
    man = json.load(open(ruta_man, encoding='utf-8'))
    escala, d = man['escala'], man['pixel_grados']
    radares = {c: r for c, r in man['radares'].items() if r['lon'] >= LON_MIN}
    if not radares:
        print('Previsión: no hay radares de la península')
        return

    # Instante base: el más reciente que tienen al menos la mitad de los radares, y los dos anteriores (10 y 20 min antes)
    cuenta = {}
    for r in radares.values():
        for im in r['imagenes']:
            cuenta[im['t']] = cuenta.get(im['t'], 0) + 1
    validos = sorted(t for t, n in cuenta.items() if n >= MIN_RADARES * len(radares))
    base = next((t for t in reversed(validos)
                 if all((hora(t) - timedelta(minutes=PASO_MIN * k)).strftime('%Y%m%d%H%M') in cuenta for k in (1, 2))), None)
    if not base:
        print('Previsión: faltan tres imágenes seguidas de 10 min; no se calcula')
        man.pop('prevision', None)
        json.dump(man, open(ruta_man, 'w', encoding='utf-8'), separators=(',', ':'))
        return
    tiempos = [(hora(base) - timedelta(minutes=PASO_MIN * k)).strftime('%Y%m%d%H%M') for k in (2, 1, 0)]

    dir_prev = os.path.join(carpeta, 'prevision')
    info_prev = os.path.join(dir_prev, 'info.json')
    if os.path.exists(info_prev):
        anterior = json.load(open(info_prev, encoding='utf-8'))
        if anterior.get('base') == base and all(os.path.exists(os.path.join(carpeta, im['f'])) for im in anterior['imagenes']):
            man['prevision'] = anterior
            json.dump(man, open(ruta_man, 'w', encoding='utf-8'), separators=(',', ':'))
            print(f'Previsión: sin imágenes nuevas (base {base}), se reutiliza')
            return

    # Rejilla común en índices del dato (todos los radares comparten la rejilla de 0,005°)
    oeste = min(r['oeste'] for r in radares.values())
    norte = max(r['norte'] for r in radares.values())
    gx = {c: round((r['oeste'] - oeste) / d) for c, r in radares.items()}
    gy = {c: round((norte - r['norte']) / d) for c, r in radares.items()}
    W = max(gx[c] + r['ancho'] for c, r in radares.items())
    H = max(gy[c] + r['alto'] for c, r in radares.items())
    W -= W % FACTOR
    H -= H % FACTOR
    a_mmh = clase_a_mmh(escala)

    campos = []
    for t in tiempos:
        R = np.zeros((H, W), dtype=np.float32)
        for c, r in radares.items():
            im = next((i for i in r['imagenes'] if i['t'] == t), None)
            if not im:
                continue
            cls = np.asarray(Image.open(os.path.join(carpeta, im['f'])))
            if cls.shape != (r['alto'], r['ancho']):
                continue
            x0, y0 = gx[c], gy[c]
            h, w = min(cls.shape[0], H - y0), min(cls.shape[1], W - x0)
            np.maximum(R[y0:y0 + h, x0:x0 + w], a_mmh[cls[:h, :w]], out=R[y0:y0 + h, x0:x0 + w])
        # reducción 2x2 por la media de la intensidad
        campos.append(R.reshape(H // FACTOR, FACTOR, W // FACTOR, FACTOR).mean(axis=(1, 3)))
    R = np.stack(campos)
    lluvia = float((R[-1] >= UMBRAL_MMH).mean())
    print(f'Previsión: base {base}, rejilla {R.shape[2]}x{R.shape[1]} a {d * FACTOR}°, lluvia en el {lluvia:.1%} del área')

    os.makedirs(dir_prev, exist_ok=True)
    for f in os.listdir(dir_prev):
        os.remove(os.path.join(dir_prev, f))

    if lluvia < 0.001:
        previstos = np.zeros((PASOS,) + R.shape[1:], dtype=np.float32)
        metodo = 'sin lluvia'
    else:
        from pysteps import motion, nowcasts
        from pysteps.utils import transformation
        R_db, _ = transformation.dB_transform(R, threshold=UMBRAL_MMH, zerovalue=DB_CERO)
        V = motion.get_method('LK')(R_db)
        umbral_db = 10 * np.log10(UMBRAL_MMH)
        f = nowcasts.get_method('sprog')(R_db, V, PASOS, precip_thr=umbral_db, n_cascade_levels=6,
                                         ar_order=2, probmatching_method='mean')
        previstos, _ = transformation.dB_transform(np.nan_to_num(f, nan=DB_CERO), threshold=umbral_db, inverse=True)
        vel = np.hypot(V[0], V[1]) * d * FACTOR * 111.19 * 6       # píxeles por 10 min -> km/h (aprox.)
        en_lluvia = vel[R[-1] >= UMBRAL_MMH]
        print(f'Previsión: velocidad mediana de la lluvia ≈ {np.median(en_lluvia):.0f} km/h')
        metodo = 'pySTEPS S-PROG + Lucas-Kanade'

    imagenes = []
    for k in range(PASOS):
        t = (hora(base) + timedelta(minutes=PASO_MIN * (k + 1))).strftime('%Y%m%d%H%M')
        cls = mmh_a_clase(np.asarray(previstos[k]), escala)
        fichero = f'prevision/{t}.png'
        open(os.path.join(carpeta, fichero), 'wb').write(png(cls, escala))
        imagenes.append({'t': t, 'f': fichero})

    prev = {'base': base, 'metodo': metodo, 'oeste': oeste, 'norte': norte, 'ancho': W // FACTOR, 'alto': H // FACTOR,
            'pixel_grados': d * FACTOR, 'imagenes': imagenes}
    json.dump(prev, open(info_prev, 'w', encoding='utf-8'), separators=(',', ':'))
    man['prevision'] = prev
    json.dump(man, open(ruta_man, 'w', encoding='utf-8'), separators=(',', ':'))
    tam = sum(os.path.getsize(os.path.join(carpeta, i['f'])) for i in imagenes)
    print(f'Previsión: {PASOS} imágenes ({tam / 1024:.0f} KB) hasta {imagenes[-1]["t"]} en {time.time() - t0:.1f} s')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('Uso: python prever.py <carpeta_datos>')
    main(sys.argv[1])
