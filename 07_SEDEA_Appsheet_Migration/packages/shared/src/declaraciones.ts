// Texto legal fijo de las declaraciones de la Solicitud de Apoyo (12.9).
// Se renderiza integro en el paso 6 del formulario y se reproduce en el
// detalle de la solicitud. La version se guarda en
// solicitudes.declaracion_version para saber que texto acepto el solicitante.

export const DECLARACIONES_VERSION = 'v1-2026';

export const DECLARACIONES_ENCABEZADO = 'Declaro bajo protesta de decir verdad que:';

/** Los 7 incisos, en orden. No editables por el usuario. */
export const DECLARACIONES_INCISOS: ReadonlyArray<{ inciso: string; texto: string }> = [
  {
    inciso: 'a)',
    texto: 'No realizo actividades ilícitas ni relacionadas con recursos de procedencia ilícita.'
  },
  {
    inciso: 'b)',
    texto:
      'No tengo procesos, adeudos ni asuntos pendientes de resolver con la Secretaría de Desarrollo Agropecuario.'
  },
  {
    inciso: 'c)',
    texto:
      'Aplicaré los apoyos que en su caso me sean otorgados única y exclusivamente para los fines autorizados.'
  },
  {
    inciso: 'd)',
    texto:
      'Los datos e información que asiento en esta solicitud y los documentos que la acompañan son verídicos.'
  },
  {
    inciso: 'e)',
    texto:
      'Me comprometo a ejecutar las inversiones y acciones del proyecto en los términos y plazos autorizados.'
  },
  {
    inciso: 'f)',
    texto:
      'Proporcionaré la información y facilitaré el acceso al predio que se me requiera para efectos de supervisión, seguimiento y auditoría.'
  },
  {
    inciso: 'g)',
    texto:
      'Entiendo que la presentación de esta solicitud no implica la autorización del apoyo ni compromiso de pago alguno por parte de la Secretaría.'
  }
] as const;

/** Etiqueta de la casilla obligatoria del paso 6. */
export const DECLARACION_ACEPTACION = 'Acepto las declaraciones anteriores';
