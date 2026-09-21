-- =============================================================================
-- Reclasificar solicitudes capturadas como AVENA (CFA) que debian ser GARBANZO (CFG)
-- Hace lo MISMO que el boton "Reclasificar concepto" del sistema, para usarse
-- YA mientras se despliega el boton. Todo o nada: si cualquier folio falla
-- una validacion, NO se cambia nada (una sola transaccion).
--
-- Por cada folio: crea solicitud nueva CFG (mismos datos, mismos documentos,
-- fotos/GPS ya capturadas pasan al beneficiario nuevo), la cantidad se baja al
-- maximo de garbanzo segun superficie si lo rebasa, y ANULA la de avena
-- (queda de historial, apuntando a la nueva). Deja rastro en auditoria_log.
--
-- COMO USARLO (en el VPS, por SSH):
--   1) RESPALDO primero (ajusta el nombre del contenedor/usuario/BD):
--        docker exec <contenedor_db> pg_dump -U <usuario> <bd> > respaldo_antes_reclasif.sql
--   2) Edita la lista de FOLIOS de abajo (los 9 folios CFA-...).
--   3) Correlo:
--        docker exec -i <contenedor_db> psql -U <usuario> -d <bd> -v ON_ERROR_STOP=1 < reclasificar_avena_a_garbanzo.sql
--      Si algo no cuadra, imprime el error y NO cambia nada.
--   4) Al final imprime la tabla folio_viejo -> folio_nuevo (cantidades incluidas).
--
-- OJO: despues, en la PWA, ventanilla debe volver a "Descargar padron" (folios nuevos).
-- =============================================================================

BEGIN;

-- >>>>>>>>>>>>>>>>>>>>>>>>>  EDITAR AQUI: los 9 folios de avena  <<<<<<<<<<<<<<<<<<<<<<<<<
CREATE TEMP TABLE _folios (folio text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _folios (folio) VALUES
  ('CFA-XXX-XXX-0000-26'),
  ('CFA-XXX-XXX-0000-26');
-- <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

CREATE TEMP TABLE _resultado (
  folio_viejo text, folio_nuevo text, cantidad_vieja numeric, cantidad_nueva numeric,
  ajustada boolean, capturas_movidas int
) ON COMMIT DROP;

DO $$
DECLARE
  v_motivo   constant text := 'Captura equivocada: era garbanzo (CFG), se capturo como avena (CFA)';
  v_admin    bigint;
  v_dest     record;
  f          record;
  v_sol      solicitudes%ROWTYPE;
  v_ben      beneficiarios%ROWTYPE;
  v_doc      solicitud_documentos%ROWTYPE;
  v_conc     record;
  v_partes   text[];
  v_anio     int;
  v_consec   int;
  v_folio    text;
  v_sup      numeric;
  v_min      numeric;
  v_tope     numeric;
  v_cant     numeric;
  v_nuevo_id bigint;
  v_ben_id   bigint;
  v_conc_id  bigint;
  v_movidas  int;
  v_n        int;
BEGIN
  SELECT id INTO v_admin FROM usuarios WHERE usuario = 'admin' AND rol = 'admin';
  IF v_admin IS NULL THEN RAISE EXCEPTION 'No encontre el usuario admin'; END IF;

  -- Concepto y proyecto destino (garbanzo), buscados por nombre/prefijo, no por id fijo.
  SELECT count(*) INTO v_n FROM tipos_apoyo t JOIN proyectos p ON p.id = t.proyecto_id
   WHERE p.prefijo_folio = 'CFG' AND t.nombre ILIKE 'CFG:%GARBANZO%' AND t.activo AND p.activo;
  IF v_n <> 1 THEN RAISE EXCEPTION 'Esperaba 1 concepto CFG-GARBANZO activo y encontre %', v_n; END IF;
  SELECT t.id AS tipo_id, t.nombre, t.descripcion, t.unidad_medida, p.id AS proyecto_id,
         p.prefijo_folio, p.componente_id, p.modalidad_id
    INTO v_dest
    FROM tipos_apoyo t JOIN proyectos p ON p.id = t.proyecto_id
   WHERE p.prefijo_folio = 'CFG' AND t.nombre ILIKE 'CFG:%GARBANZO%' AND t.activo AND p.activo;

  FOR f IN SELECT folio FROM _folios ORDER BY folio LOOP
    -- ---- validaciones (mismas que el sistema) ---------------------------------
    SELECT * INTO v_sol FROM solicitudes WHERE folio = f.folio FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Folio % no existe', f.folio; END IF;
    IF v_sol.anulada_en IS NOT NULL THEN RAISE EXCEPTION 'Folio % ya esta anulado', f.folio; END IF;
    IF split_part(f.folio, '-', 1) <> 'CFA' THEN RAISE EXCEPTION 'Folio % no es CFA', f.folio; END IF;

    SELECT count(*) INTO v_n FROM solicitud_conceptos WHERE solicitud_id = v_sol.id;
    IF v_n <> 1 THEN RAISE EXCEPTION 'Folio % tiene % conceptos (solo se admite 1)', f.folio, v_n; END IF;
    SELECT sc.* INTO v_conc FROM solicitud_conceptos sc WHERE sc.solicitud_id = v_sol.id;

    IF EXISTS (SELECT 1 FROM entregas_apoyo ea JOIN solicitud_conceptos sc ON sc.id = ea.solicitud_concepto_id
                WHERE sc.solicitud_id = v_sol.id)
       OR EXISTS (SELECT 1 FROM conciliacion_recibos WHERE solicitud_id = v_sol.id) THEN
      RAISE EXCEPTION 'Folio % ya tiene entrega/conciliacion: NO se puede reclasificar', f.folio;
    END IF;

    IF v_sol.curp IS NOT NULL AND v_sol.curp <> '' AND EXISTS (
         SELECT 1 FROM solicitudes s JOIN solicitud_conceptos c ON c.solicitud_id = s.id
          WHERE s.curp = v_sol.curp AND s.anulada_en IS NULL AND s.id <> v_sol.id
            AND c.tipo_apoyo_id = v_dest.tipo_id) THEN
      RAISE EXCEPTION 'Folio %: esa CURP ya tiene garbanzo en otra solicitud', f.folio;
    END IF;

    -- ---- cantidad: se conserva salvo que rebase el escalon de garbanzo --------
    v_sup := COALESCE(NULLIF(v_sol.agr_superficie_total_ha, 0), NULLIF(v_sol.agr_superficie_siembra_ha, 0));
    v_cant := v_conc.cantidad;
    IF EXISTS (SELECT 1 FROM reglas_cantidad_maxima_escalon WHERE tipo_apoyo_id = v_dest.tipo_id) THEN
      IF v_sup IS NULL THEN RAISE EXCEPTION 'Folio % no tiene superficie capturada', f.folio; END IF;
      SELECT min(superficie_desde) INTO v_min FROM reglas_cantidad_maxima_escalon WHERE tipo_apoyo_id = v_dest.tipo_id;
      IF v_sup < v_min THEN
        RAISE EXCEPTION 'Folio %: superficie % ha menor al minimo % ha de garbanzo', f.folio, v_sup, v_min;
      END IF;
      SELECT cantidad INTO v_tope FROM reglas_cantidad_maxima_escalon
       WHERE tipo_apoyo_id = v_dest.tipo_id AND superficie_hasta >= v_sup
       ORDER BY superficie_hasta LIMIT 1;
      IF v_tope IS NULL THEN  -- por encima del ultimo escalon: se topa en el ultimo
        SELECT cantidad INTO v_tope FROM reglas_cantidad_maxima_escalon
         WHERE tipo_apoyo_id = v_dest.tipo_id ORDER BY superficie_hasta DESC LIMIT 1;
      END IF;
      v_cant := LEAST(v_conc.cantidad, v_tope);
    END IF;

    -- ---- folio nuevo: mismos codigos de regional/municipio/anio, prefijo CFG ---
    v_partes := string_to_array(f.folio, '-');
    IF array_length(v_partes, 1) <> 5 THEN RAISE EXCEPTION 'Folio % con formato inesperado', f.folio; END IF;
    v_anio := v_partes[5]::int;
    LOOP
      INSERT INTO solicitud_folios (prefijo, clave_regional, siglas_municipio, anio, consecutivo)
      VALUES ('CFG', v_partes[2], v_partes[3], v_anio, 1)
      ON CONFLICT (prefijo, clave_regional, siglas_municipio, anio)
      DO UPDATE SET consecutivo = solicitud_folios.consecutivo + 1
      RETURNING consecutivo INTO v_consec;
      v_folio := format('CFG-%s-%s-%s-%s', v_partes[2], v_partes[3], lpad(v_consec::text, 4, '0'), lpad(v_anio::text, 2, '0'));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM solicitudes WHERE folio = v_folio);
    END LOOP;

    -- ---- solicitud nueva (clon con folio/proyecto nuevos) ---------------------
    v_nuevo_id := nextval(pg_get_serial_sequence('solicitudes', 'id'));
    v_sol.id := v_nuevo_id;
    v_sol.folio := v_folio;
    v_sol.proyecto_id := v_dest.proyecto_id;
    v_sol.componente_id := COALESCE(v_dest.componente_id, v_sol.componente_id);
    v_sol.anulada_en := NULL; v_sol.anulada_por := NULL; v_sol.motivo_anulacion := NULL;
    v_sol.actualizado_en := now();
    v_sol.datos_extra := COALESCE(v_sol.datos_extra, '{}'::jsonb) || jsonb_build_object(
      'reclasificada_de', jsonb_build_object('folio', f.folio, 'concepto', 'CFA: SEMILLA DE AVENA'));
    INSERT INTO solicitudes SELECT (v_sol).*;

    INSERT INTO solicitud_conceptos
      (solicitud_id, orden, tipo_apoyo_id, descripcion, cantidad, unidad_medida,
       monto_estatal, monto_productor, monto_total)
    VALUES (v_nuevo_id, v_conc.orden, v_dest.tipo_id, v_dest.descripcion, v_cant,
            COALESCE(v_dest.unidad_medida, v_conc.unidad_medida),
            v_conc.monto_estatal, v_conc.monto_productor, v_conc.monto_total)
    RETURNING id INTO v_conc_id;

    -- ---- beneficiario nuevo + fotos/GPS ya capturadas -------------------------
    v_movidas := 0;
    IF v_conc.beneficiario_id IS NOT NULL THEN
      SELECT * INTO v_ben FROM beneficiarios WHERE id = v_conc.beneficiario_id;
      v_ben_id := nextval(pg_get_serial_sequence('beneficiarios', 'id'));
      v_ben.id := v_ben_id;
      v_ben.folio := v_folio;
      v_ben.solicitud_id := v_nuevo_id;
      v_ben.tipo_apoyo_id := v_dest.tipo_id;
      v_ben.cantidad_asignada := v_cant;
      v_ben.actualizado_en := now();
      v_ben.datos_extra := COALESCE(v_ben.datos_extra, '{}'::jsonb)
        || jsonb_build_object('solicitud_folio', v_folio,
             'reclasificada_de', jsonb_build_object('folio', f.folio, 'concepto', 'CFA: SEMILLA DE AVENA'));
      INSERT INTO beneficiarios SELECT (v_ben).*;
      UPDATE solicitud_conceptos SET beneficiario_id = v_ben_id WHERE id = v_conc_id;
      UPDATE capturas SET beneficiario_id = v_ben_id WHERE beneficiario_id = v_conc.beneficiario_id;
      GET DIAGNOSTICS v_movidas = ROW_COUNT;
      UPDATE beneficiarios SET actualizado_en = now() WHERE id = v_conc.beneficiario_id;
    END IF;

    -- ---- documentos tal cual estan --------------------------------------------
    FOR v_doc IN SELECT * FROM solicitud_documentos WHERE solicitud_id = v_conc.solicitud_id LOOP
      v_doc.id := nextval(pg_get_serial_sequence('solicitud_documentos', 'id'));
      v_doc.solicitud_id := v_nuevo_id;
      INSERT INTO solicitud_documentos SELECT (v_doc).*;
    END LOOP;

    -- ---- la de avena se ANULA (historial) + auditoria -------------------------
    UPDATE solicitudes
       SET anulada_en = now(), anulada_por = v_admin,
           motivo_anulacion = left(format('Reclasificada a %s (%s): %s', v_folio, v_dest.nombre, v_motivo), 500)
     WHERE folio = f.folio;

    INSERT INTO auditoria_log (usuario_id, accion, entidad, entidad_id, detalle)
    VALUES (v_admin, 'solicitud_reclasificada', 'solicitud', v_conc.solicitud_id::text,
            jsonb_build_object('folio_anterior', f.folio, 'folio_nuevo', v_folio,
                               'solicitud_nueva_id', v_nuevo_id,
                               'concepto_anterior', 'CFA: SEMILLA DE AVENA', 'concepto_nuevo', v_dest.nombre,
                               'cantidad_anterior', v_conc.cantidad, 'cantidad_nueva', v_cant,
                               'capturas_movidas', v_movidas, 'motivo', v_motivo, 'via', 'script_sql'));

    INSERT INTO _resultado VALUES (f.folio, v_folio, v_conc.cantidad, v_cant, v_cant <> v_conc.cantidad, v_movidas);
  END LOOP;
END $$;

-- Resumen para revisar ANTES de confirmar:
SELECT * FROM _resultado ORDER BY folio_viejo;

-- Si el resumen se ve bien, deja COMMIT. Si algo te late raro, cambia por ROLLBACK.
COMMIT;
