// Paso 3 del formulario: actividad economica (seccion 3 del papel).
// Las 4 actividades son independientes y los subcampos de cada una SOLO se
// renderizan si su casilla esta marcada (12.8.2).
import { TIPOS_PRODUCCION_GANADERA } from '@sedea/shared';

export interface DatosActividad {
  agricola: boolean;
  agr_superficie_total_ha: string;
  agr_superficie_siembra_ha: string;
  agr_temporal_ha: string;
  agr_riego_ha: string;
  agr_cultivo_principal: string;
  ganadera: boolean;
  gan_tipo_ganado: string;
  gan_num_cabezas: string;
  gan_superficie_agostadero_ha: string;
  gan_produccion: string;
  acuicola: boolean;
  acu_especies: string;
  pesca: boolean;
  pes_especies: string;
}

interface Props {
  valores: DatosActividad;
  cambiar: (campo: keyof DatosActividad, valor: string | boolean) => void;
}

export default function SeccionActividad({ valores, cambiar }: Props) {
  return (
    <div data-testid="seccion-actividad">
      <h3>3. Actividad económica</h3>

      <label className="casilla">
        <input
          type="checkbox"
          data-testid="chk-agricola"
          checked={valores.agricola}
          onChange={(e) => cambiar('agricola', e.target.checked)}
        />
        Agrícola
      </label>

      {valores.agricola && (
        <>
          <div className="campo">
            <label htmlFor="input-agr-superficie-total">Superficie total (ha)</label>
            <input
              id="input-agr-superficie-total"
              data-testid="input-agr-superficie-total"
              type="number"
              step="0.001"
              value={valores.agr_superficie_total_ha}
              onChange={(e) => cambiar('agr_superficie_total_ha', e.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="input-agr-superficie-siembra">Superficie de siembra (ha)</label>
            <input
              id="input-agr-superficie-siembra"
              data-testid="input-agr-superficie-siembra"
              type="number"
              step="0.001"
              value={valores.agr_superficie_siembra_ha}
              onChange={(e) => cambiar('agr_superficie_siembra_ha', e.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="input-agr-temporal">Superficie de temporal (ha)</label>
            <input
              id="input-agr-temporal"
              data-testid="input-agr-temporal"
              type="number"
              step="0.001"
              value={valores.agr_temporal_ha}
              onChange={(e) => cambiar('agr_temporal_ha', e.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="input-agr-riego">Superficie de riego (ha)</label>
            <input
              id="input-agr-riego"
              data-testid="input-agr-riego"
              type="number"
              step="0.001"
              value={valores.agr_riego_ha}
              onChange={(e) => cambiar('agr_riego_ha', e.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="input-agr-cultivo">Cultivo principal</label>
            <input
              id="input-agr-cultivo"
              data-testid="input-agr-cultivo"
              type="text"
              value={valores.agr_cultivo_principal}
              onChange={(e) => cambiar('agr_cultivo_principal', e.target.value)}
            />
          </div>
        </>
      )}

      <label className="casilla">
        <input
          type="checkbox"
          data-testid="chk-ganadera"
          checked={valores.ganadera}
          onChange={(e) => cambiar('ganadera', e.target.checked)}
        />
        Ganadera
      </label>

      {valores.ganadera && (
        <>
          <div className="campo">
            <label htmlFor="input-gan-tipo-ganado">Tipo de ganado</label>
            <input
              id="input-gan-tipo-ganado"
              data-testid="input-gan-tipo-ganado"
              type="text"
              value={valores.gan_tipo_ganado}
              onChange={(e) => cambiar('gan_tipo_ganado', e.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="input-gan-cabezas">Número de cabezas o colmenas</label>
            <input
              id="input-gan-cabezas"
              data-testid="input-gan-cabezas"
              type="number"
              value={valores.gan_num_cabezas}
              onChange={(e) => cambiar('gan_num_cabezas', e.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="input-gan-agostadero">Superficie de agostadero (ha)</label>
            <input
              id="input-gan-agostadero"
              data-testid="input-gan-agostadero"
              type="number"
              step="0.001"
              value={valores.gan_superficie_agostadero_ha}
              onChange={(e) => cambiar('gan_superficie_agostadero_ha', e.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="select-gan-produccion">Tipo de producción</label>
            <select
              id="select-gan-produccion"
              data-testid="select-gan-produccion"
              value={valores.gan_produccion}
              onChange={(e) => cambiar('gan_produccion', e.target.value)}
            >
              <option value="">Sin especificar</option>
              {TIPOS_PRODUCCION_GANADERA.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      <label className="casilla">
        <input
          type="checkbox"
          data-testid="chk-acuicola"
          checked={valores.acuicola}
          onChange={(e) => cambiar('acuicola', e.target.checked)}
        />
        Acuícola
      </label>

      {valores.acuicola && (
        <div className="campo">
          <label htmlFor="input-acu-especies">Especies acuícolas</label>
          <input
            id="input-acu-especies"
            data-testid="input-acu-especies"
            type="text"
            value={valores.acu_especies}
            onChange={(e) => cambiar('acu_especies', e.target.value)}
          />
        </div>
      )}

      <label className="casilla">
        <input
          type="checkbox"
          data-testid="chk-pesca"
          checked={valores.pesca}
          onChange={(e) => cambiar('pesca', e.target.checked)}
        />
        Pesca
      </label>

      {valores.pesca && (
        <div className="campo">
          <label htmlFor="input-pes-especies">Especies de pesca</label>
          <input
            id="input-pes-especies"
            data-testid="input-pes-especies"
            type="text"
            value={valores.pes_especies}
            onChange={(e) => cambiar('pes_especies', e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
