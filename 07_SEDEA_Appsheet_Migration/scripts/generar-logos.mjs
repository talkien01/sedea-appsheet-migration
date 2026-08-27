// Genera los recortes de los logos oficiales a partir de los originales que
// entrego la Secretaria (assets/logos/*.png), y los deja en las dos carpetas
// que consumen los binarios:
//
//   pwa/public/logos/     -> servidos por nginx en /logos/... (igual que /fuentes/)
//   backend/assets/logos/ -> leidos por PDFKit en tiempo de ejecucion
//
// Se commitean TANTO los originales como los derivados: el build de Docker no
// ejecuta este script (no hay sharp en la imagen de la PWA), solo copia
// archivos. Reejecutar solo si cambian los originales:
//
//   node scripts/generar-logos.mjs
//
// Los recortes salen de medir el alpha de los originales, no a ojo:
//   heraldica  944x308  escudo x 28..259, y 13..232; leyenda hasta y 296
//   gobierno  2359x444  bloque izq. x 51..989 | separador 1108..1113 |
//                       bloque der. x 1222..2297
// Del logo de Gobierno se usa SOLO el bloque derecho: el izquierdo repite el
// mismo escudo que ya trae el logo de SEDEA y saldria dos veces en la hoja.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '..');
const origen = path.join(raiz, 'assets', 'logos');

const destinos = [
  path.join(raiz, 'pwa', 'public', 'logos'),
  path.join(raiz, 'backend', 'assets', 'logos')
];
for (const d of destinos) fs.mkdirSync(d, { recursive: true });

const heraldica = path.join(origen, 'heraldica-azul-footer.png');
const gobierno = path.join(origen, 'layout_set_logo.png');

/** Escribe el mismo buffer en las dos carpetas destino. */
async function emitir(nombre, buffer) {
  for (const d of destinos) fs.writeFileSync(path.join(d, nombre), buffer);
  const { width, height } = await sharp(buffer).metadata();
  console.log(`  ${nombre.padEnd(24)} ${width}x${height}  ${(buffer.length / 1024).toFixed(1)} KB`);
}

console.log('Generando logos derivados...');

// 1. Lockup completo de SEDEA (escudo + "SECRETARIA DE DESARROLLO
//    AGROPECUARIO"). Es el logo PRINCIPAL: header, login y encabezado de PDF.
await emitir(
  'sedea-horizontal.png',
  await sharp(heraldica).extract({ left: 28, top: 13, width: 888, height: 284 }).png().toBuffer()
);

// 2. Solo el escudo, sin la leyenda inferior: es el glifo del sidebar en modo
//    rail (72 px) y de la barra movil, donde el lockup completo no cabe.
await emitir(
  'sedea-escudo.png',
  await sharp(heraldica).extract({ left: 28, top: 13, width: 232, height: 220 }).png().toBuffer()
);

// 3. Bloque derecho del logo de Gobierno del Estado (Q + "QUERETARO GOBIERNO
//    DEL ESTADO" + "Juntos, Adelante."). Logo SECUNDARIO.
//    El recorte vertical (y 71..374) va medido y NO con .trim(): sobre un PNG
//    con fondo transparente, trim() toma el color de la esquina —transparente—
//    como fondo a recortar y colapsa el area entera ("bad extract area").
await emitir(
  'qro-gobierno.png',
  await sharp(gobierno).extract({ left: 1222, top: 71, width: 1076, height: 304 }).png().toBuffer()
);

console.log('Listo.');
