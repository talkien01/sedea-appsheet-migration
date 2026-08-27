-- 024_descripcion_tipos_apoyo.sql
-- Descripcion homologada del concepto de apoyo.
--
-- Hasta hoy la columna "Descripcion" de la tabla de conceptos de Nueva
-- Solicitud la escribia ventanilla a mano, asi que el mismo concepto quedaba
-- redactado distinto en cada solicitud. La descripcion pasa a vivir en el
-- catalogo (`tipos_apoyo.descripcion`): ventanilla la ve en modo lectura y la
-- unica forma de cambiarla es editando el catalogo, lo que la homologa para
-- todos los solicitantes futuros de ese concepto.
--
-- Aditiva e idempotente: columna nullable, ningun dato existente se toca.

ALTER TABLE tipos_apoyo ADD COLUMN IF NOT EXISTS descripcion TEXT;

COMMENT ON COLUMN tipos_apoyo.descripcion IS
  'Descripcion homologada del concepto. Se muestra en modo lectura en la tabla de conceptos de la solicitud; solo se edita desde /catalogos.';
