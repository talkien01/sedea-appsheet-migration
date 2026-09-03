// E60: traspaso celular -> PC para el escaneo de la Constancia CURP.
//
// El equipo de ventanilla es un escritorio sin camara util. El capturista abre
// una sesion, la pantalla la pinta como QR, el capturista la abre con su
// celular y escanea ahi la Constancia. El celular manda el texto crudo del QR;
// este modulo lo parsea con el MISMO parser que usa la PWA (@sedea/shared) y lo
// deja en el buzon para que el escritorio lo recoja sondeando.
//
// Modelo de confianza: el celular NO se autentica. El token de la sesion es la
// credencial, y por eso:
//   - lo genera el servidor con 24 bytes aleatorios (no es adivinable),
//   - vive 10 minutos (se puede cerrar antes desde el escritorio),
//   - solo el usuario que la creo puede sondearla o cerrarla.
// Lo peor que puede hacer quien robe un token es meter una o varias CURP en
// la pantalla de otro capturista, que las ve antes de guardar cada una. No da
// acceso a nada mas.
//
// Multi-lectura (E60-v2): antes la sesion se cerraba sola al primer escaneo
// ("de un solo uso") y el celular se quedaba sin nada que hacer — se sentia
// como que "se trababa" y habia que volver a vincular desde cero para la
// siguiente persona. Ahora la MISMA sesion admite varios escaneos seguidos
// mientras siga vigente: cada uno actualiza `datos` y sube `version`; el
// escritorio se entera del ultimo por sondeo comparando `version`. Solo se
// cierra si el capturista lo hace a proposito (E60.4) o si vence el tiempo.
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  MINUTOS_VIGENCIA_ESCANEO,
  parsearQrCurp,
  type DatosCurpQr,
  type EstadoSesionEscaneoRespuesta,
  type SesionEscaneoCreada
} from '@sedea/shared';
import { consultarUna } from '../db/pool.js';
import { ErrorApi } from '../plugins/errores.js';

/** Mismos roles que pueden capturar una solicitud en ventanilla. */
const ROLES_VENTANILLA = ['ventanilla', 'capturista', 'admin'] as const;

interface FilaSesion {
  id: number;
  token: string;
  creada_por: number;
  estado: 'pendiente' | 'completada';
  datos: DatosCurpQr | null;
  expira_en: string;
  version: number;
}

/** Token opaco de 24 bytes en base64url: 192 bits, no adivinable. */
function generarToken(): string {
  return randomBytes(24).toString('base64url');
}

function estaVencida(fila: FilaSesion): boolean {
  return new Date(fila.expira_en).getTime() <= Date.now();
}

export default async function rutasEscaneoCurp(app: FastifyInstance): Promise<void> {
  const protegida = {
    preHandler: [app.autenticar, app.requiereRol(...ROLES_VENTANILLA)]
  };

  // --- E60.1 Abrir la sesion (escritorio, autenticado) ----------------------
  app.post('/api/escaneo-curp/sesiones', protegida, async (peticion) => {
    const usuarioId = peticion.usuario!.id;
    const expiraEn = new Date(Date.now() + MINUTOS_VIGENCIA_ESCANEO * 60_000);

    const fila = await consultarUna<{ token: string; expira_en: string }>(
      `INSERT INTO sesiones_escaneo_curp (token, creada_por, expira_en)
       VALUES ($1, $2, $3)
       RETURNING token, expira_en`,
      [generarToken(), usuarioId, expiraEn]
    );

    const respuesta: SesionEscaneoCreada = {
      token: fila!.token,
      expira_en: new Date(fila!.expira_en).toISOString()
    };
    return respuesta;
  });

  // --- E60.2 Sondear la sesion (escritorio, autenticado) --------------------
  app.get('/api/escaneo-curp/sesiones/:token', protegida, async (peticion) => {
    const { token } = peticion.params as { token: string };
    const fila = await consultarUna<FilaSesion>(
      `SELECT id, token, creada_por, estado, datos, expira_en, version
         FROM sesiones_escaneo_curp
        WHERE token = $1`,
      [token]
    );

    // Un token inexistente y un token ajeno responden igual a proposito: quien
    // sondea a ciegas no puede distinguir "no existe" de "no es tuyo".
    if (!fila || fila.creada_por !== peticion.usuario!.id) {
      throw new ErrorApi(404, 'no_encontrado', 'Sesión de escaneo no encontrada.');
    }

    const vencida = fila.estado !== 'completada' && estaVencida(fila);
    // `datos`/`version` viajan siempre (multi-lectura): el escritorio decide
    // si es nuevo comparando `version` contra la ultima que ya proceso.
    const respuesta: EstadoSesionEscaneoRespuesta = {
      estado: vencida ? 'expirada' : fila.estado,
      expira_en: new Date(fila.expira_en).toISOString(),
      datos: fila.datos,
      version: fila.version
    };
    return respuesta;
  });

  // --- E60.3 Entregar un resultado (celular, PUBLICO) ------------------------
  // Sin `autenticar`: el celular no tiene sesion. El token es la credencial.
  // Se puede llamar VARIAS veces mientras la sesion siga 'pendiente' y
  // vigente (multi-lectura): cada llamada es un escaneo mas, no la ultima.
  app.post('/api/escaneo-curp/sesiones/:token/resultado', async (peticion) => {
    const { token } = peticion.params as { token: string };
    const cuerpo = peticion.body as { texto_qr?: unknown } | undefined;
    const texto = typeof cuerpo?.texto_qr === 'string' ? cuerpo.texto_qr : '';

    if (!texto) {
      throw new ErrorApi(422, 'validacion', 'Falta el texto del código QR.');
    }

    const fila = await consultarUna<FilaSesion>(
      `SELECT id, token, creada_por, estado, datos, expira_en, version
         FROM sesiones_escaneo_curp
        WHERE token = $1`,
      [token]
    );
    if (!fila) {
      throw new ErrorApi(404, 'no_encontrado', 'Sesión de escaneo no encontrada.');
    }
    if (fila.estado === 'completada') {
      throw new ErrorApi(
        409,
        'sesion_cerrada',
        'Esta vinculación ya se cerró desde la computadora. Genera un código nuevo para seguir escaneando.'
      );
    }
    if (estaVencida(fila)) {
      throw new ErrorApi(410, 'sesion_expirada', 'La sesión de escaneo expiró. Vuelve a generar el código en la computadora.');
    }

    // El celular manda texto crudo; el criterio de validez es el del parser
    // compartido, igual que en el escaneo directo desde la PWA.
    const datos = parsearQrCurp(texto);
    if (!datos) {
      throw new ErrorApi(
        422,
        'qr_invalido',
        'No se pudo leer el CURP, intenta de nuevo o captura los datos manualmente'
      );
    }

    // El WHERE repite estado/expiracion para que dos envios simultaneos no se
    // pisen entre si: cada uno sube `version` en 1, nunca se pierde ninguno.
    const guardado = await consultarUna<{ version: number }>(
      `UPDATE sesiones_escaneo_curp
          SET datos = $2, version = version + 1
        WHERE id = $1 AND estado = 'pendiente' AND expira_en > now()
        RETURNING version`,
      [fila.id, JSON.stringify(datos)]
    );
    if (!guardado) {
      // Se cerro o vencio justo entre el SELECT y el UPDATE (carrera rara).
      throw new ErrorApi(409, 'sesion_cerrada', 'Esta vinculación ya no acepta escaneos.');
    }

    return { ok: true as const, datos };
  });

  // --- E60.4 Cerrar la sesion a proposito (escritorio, autenticado) ---------
  // "Terminar vinculación": deja de aceptar escaneos nuevos de inmediato, sin
  // esperar los 10 minutos de vigencia. Idempotente: cerrar una sesion ya
  // cerrada o vencida no es error.
  app.post('/api/escaneo-curp/sesiones/:token/cerrar', protegida, async (peticion) => {
    const { token } = peticion.params as { token: string };
    const fila = await consultarUna<{ id: number; creada_por: number }>(
      `SELECT id, creada_por FROM sesiones_escaneo_curp WHERE token = $1`,
      [token]
    );
    if (!fila || fila.creada_por !== peticion.usuario!.id) {
      throw new ErrorApi(404, 'no_encontrado', 'Sesión de escaneo no encontrada.');
    }
    await consultarUna(
      `UPDATE sesiones_escaneo_curp
          SET estado = 'completada', completada_en = now()
        WHERE id = $1 AND estado = 'pendiente'`,
      [fila.id]
    );
    return { ok: true as const };
  });
}
