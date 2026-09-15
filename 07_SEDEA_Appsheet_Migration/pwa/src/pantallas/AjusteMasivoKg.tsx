// Ajuste masivo de kilogramos (SOLO admin): sube un Excel/CSV con folio +
// cantidad_asignada nueva -- avena y garbanzo no manejan monto, por
// indicacion de la Direccion, asi que solo se toca cantidad. Reemplaza el
// ajuste "a ojo" que varios companeros venian haciendo para que la suma de
// kg cuadrara contra el tope real disponible por Regional/Municipio: el
// sistema no valida ese tope en automatico hoy (los escalones de
// `cantidadMaxima.ts` topan por PERSONA, nunca la SUMA de varias
// solicitudes). Ver backend/src/servicios/ajusteMasivoKg.ts.
//
// Flujo en 2 pasos, mismo candado que "Editar solicitudes"/"Anular
// solicitud": 1) subir el archivo y revisar el plan (sin tocar nada aun),
// 2) confirmar con motivo + contrasena propia -- se aplica solo lo marcado
// como "aplicable"; lo demas (folio no encontrado, ya anulada, ya tiene
// entrega, ambiguo) se omite automaticamente y queda listado aparte.
import { useRef, useState } from 'react';
import { api, ErrorPeticion } from '../api/cliente';
import type { ItemPlanAjusteKg, RespuestaPrevisualizacionAjusteKg } from '../api/cliente';
import { useEstadoRed } from '../sync/estadoRed';
import CampoPassword from '../componentes/CampoPassword';

export default function AjusteMasivoKg() {
  const enLinea = useEstadoRed();
  const refArchivo = useRef<HTMLInputElement>(null);

  const [archivo, setArchivo] = useState<File | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [plan, setPlan] = useState<RespuestaPrevisualizacionAjusteKg | null>(null);
  const [errorPlan, setErrorPlan] = useState<string | null>(null);

  const [motivo, setMotivo] = useState('');
  const [password, setPassword] = useState('');
  const [aplicando, setAplicando] = useState(false);
  const [errorAplicar, setErrorAplicar] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<{ aplicados: number } | null>(null);

  const subir = async () => {
    if (!archivo) return;
    setSubiendo(true);
    setErrorPlan(null);
    setPlan(null);
    setResultado(null);
    try {
      const respuesta = await api.previsualizarAjusteKg(archivo);
      setPlan(respuesta);
    } catch (fallo) {
      setErrorPlan(fallo instanceof ErrorPeticion ? fallo.message : 'No fue posible leer el archivo.');
    } finally {
      setSubiendo(false);
    }
  };

  const aplicables = plan?.items.filter((i) => i.aplicable) ?? [];
  const omitidas = plan?.items.filter((i) => !i.aplicable) ?? [];

  const confirmarAplicar = async () => {
    if (!plan || aplicables.length === 0) return;
    setAplicando(true);
    setErrorAplicar(null);
    try {
      const respuesta = await api.aplicarAjusteKg({
        motivo,
        password,
        archivo_nombre: plan.archivo_nombre,
        items: aplicables.map((i) => ({
          folio: i.folio,
          solicitud_concepto_id: i.solicitud_concepto_id!,
          beneficiario_id: i.beneficiario_id,
          cantidad_actual: i.cantidad_actual!,
          cantidad_nueva: i.cantidad_nueva
        }))
      });
      setResultado(respuesta);
      setConfirmando(false);
      setMotivo('');
      setPassword('');
      setPlan(null);
      setArchivo(null);
      if (refArchivo.current) refArchivo.current.value = '';
    } catch (fallo) {
      setErrorAplicar(
        fallo instanceof ErrorPeticion ? fallo.message : 'No fue posible aplicar el ajuste.'
      );
    } finally {
      setAplicando(false);
    }
  };

  return (
    <div className="tarjeta">
      <h1>Ajuste masivo de kilogramos</h1>
      <p className="dato">
        Sube el Excel o CSV con el folio y la nueva <strong>cantidad_asignada</strong> (kg) por
        beneficiario -- puede ser el mismo export del padrón de Beneficiarios ya editado a mano.
        Solo se usan las columnas <code>folio</code> y <code>cantidad_asignada</code> (o
        <code> cantidad_nueva</code>); si una solicitud tiene más de un concepto (avena y
        garbanzo juntos), también se usa <code>concepto_apoyo</code> para saber cuál ajustar.
        Este ajuste solo toca <strong>kg</strong>: avena y garbanzo no manejan monto.
      </p>

      {!enLinea && (
        <div className="mensaje aviso" role="status">
          Sin conexión: esta pantalla requiere internet.
        </div>
      )}

      {resultado && (
        <div className="mensaje exito" role="status" data-testid="resultado-ajuste-kg">
          Ajuste aplicado: {resultado.aplicados} concepto(s) actualizado(s).
        </div>
      )}

      <div className="filtros">
        <input
          ref={refArchivo}
          data-testid="input-archivo-ajuste-kg"
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          aria-label="Archivo de ajuste (Excel o CSV)"
          disabled={!enLinea}
          onChange={(e) => {
            setArchivo(e.target.files?.[0] ?? null);
            setErrorPlan(null);
          }}
        />
        <button
          type="button"
          data-testid="btn-previsualizar-ajuste-kg"
          disabled={!archivo || !enLinea || subiendo}
          onClick={() => void subir()}
        >
          {subiendo ? 'Leyendo…' : 'Previsualizar'}
        </button>
      </div>

      {errorPlan && (
        <div className="mensaje error" role="alert" data-testid="error-plan-ajuste-kg">
          {errorPlan}
        </div>
      )}

      {plan && (
        <>
          <div className="mensaje aviso" role="status" data-testid="resumen-ajuste-kg">
            {plan.resumen.aplicables} de {plan.resumen.total_filas} filas se pueden aplicar
            ({plan.resumen.omitidas} se omiten). Kg: {plan.resumen.kg_actuales.toLocaleString('es-MX')}
            {' → '}
            {plan.resumen.kg_nuevos.toLocaleString('es-MX')} (
            {plan.resumen.kg_nuevos - plan.resumen.kg_actuales >= 0 ? '+' : ''}
            {(plan.resumen.kg_nuevos - plan.resumen.kg_actuales).toLocaleString('es-MX')}).
          </div>

          {plan.errores_parseo.length > 0 && (
            <div className="mensaje aviso" role="status">
              {plan.errores_parseo.length} fila(s) del archivo no se pudieron leer:{' '}
              {plan.errores_parseo.map((e) => `fila ${e.fila}: ${e.mensaje}`).join(' · ')}
            </div>
          )}

          {aplicables.length > 0 && (
            <div className="tabla-contenedor">
              <h2>Se van a aplicar ({aplicables.length})</h2>
              <table data-testid="tabla-aplicables-ajuste-kg">
                <thead>
                  <tr>
                    <th>Folio</th>
                    <th>Beneficiario</th>
                    <th>Concepto</th>
                    <th>Kg actual</th>
                    <th>Kg nuevo</th>
                    <th>Cambio</th>
                  </tr>
                </thead>
                <tbody>
                  {aplicables.map((item) => (
                    <FilaAplicable key={`${item.folio}-${item.fila}`} item={item} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {omitidas.length > 0 && (
            <div className="tabla-contenedor">
              <h2>Se omiten ({omitidas.length})</h2>
              <table data-testid="tabla-omitidas-ajuste-kg">
                <thead>
                  <tr>
                    <th>Fila</th>
                    <th>Folio</th>
                    <th>Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {omitidas.map((item) => (
                    <tr key={`${item.folio}-${item.fila}`}>
                      <td data-etiqueta="Fila">{item.fila}</td>
                      <td data-etiqueta="Folio" className="mono">
                        {item.folio}
                      </td>
                      <td data-etiqueta="Motivo" className="celda-texto">
                        {item.motivo_omision}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {aplicables.length > 0 && !confirmando && (
            <button type="button" data-testid="btn-abrir-confirmacion-ajuste-kg" onClick={() => setConfirmando(true)}>
              Aplicar {aplicables.length} ajuste(s)
            </button>
          )}

          {confirmando && (
            <div className="tarjeta" style={{ marginTop: 12 }}>
              <h2>Confirmar ajuste</h2>
              <p className="dato">
                Esto va a cambiar la cantidad de {aplicables.length} concepto(s) de una vez. Escribe
                el motivo (ej. "Ajuste de kg de avena Tequisquiapan contra tope disponible, archivo
                de Oscar") y tu contraseña para confirmar.
              </p>
              <div className="campo">
                <label htmlFor="motivo-ajuste-kg">Motivo</label>
                <textarea
                  id="motivo-ajuste-kg"
                  data-testid="input-motivo-ajuste-kg"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="campo">
                <label htmlFor="password-ajuste-kg">Tu contraseña</label>
                <CampoPassword
                  id="password-ajuste-kg"
                  testId="input-password-ajuste-kg"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              {errorAplicar && (
                <div className="mensaje error" role="alert" data-testid="error-aplicar-ajuste-kg">
                  {errorAplicar}
                </div>
              )}
              <div className="acciones">
                <button
                  type="button"
                  data-testid="btn-confirmar-ajuste-kg"
                  disabled={aplicando || motivo.trim().length < 5 || password.trim().length === 0}
                  onClick={() => void confirmarAplicar()}
                >
                  {aplicando ? 'Aplicando…' : `Confirmar y aplicar ${aplicables.length}`}
                </button>
                <button
                  type="button"
                  className="secundario"
                  disabled={aplicando}
                  onClick={() => {
                    setConfirmando(false);
                    setErrorAplicar(null);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilaAplicable({ item }: { item: ItemPlanAjusteKg }) {
  const delta = item.delta ?? 0;
  return (
    <tr>
      <td data-etiqueta="Folio" className="mono">
        {item.folio}
      </td>
      <td data-etiqueta="Beneficiario">{item.beneficiario_nombre ?? '—'}</td>
      <td data-etiqueta="Concepto">{item.concepto_nombre ?? '—'}</td>
      <td data-etiqueta="Kg actual">{item.cantidad_actual?.toLocaleString('es-MX')}</td>
      <td data-etiqueta="Kg nuevo">{item.cantidad_nueva.toLocaleString('es-MX')}</td>
      <td data-etiqueta="Cambio">
        {delta >= 0 ? '+' : ''}
        {delta.toLocaleString('es-MX')}
      </td>
    </tr>
  );
}
