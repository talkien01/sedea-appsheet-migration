// Campo de contrasena con boton de "mostrar/ocultar" (el ojito). Envoltorio
// delgado sobre <input type="password"|"text">: alterna el `type` en vez de
// desenmascarar con CSS, para que el propio navegador/gestor de contrasenas
// siga tratandolo como campo de password (autocompletado, advertencias de
// contrasena filtrada, etc.) mientras esta oculto.
//
// Puramente visual/cliente: no cambia que se manda al servidor, no queda
// nada nuevo en ningun log -- el usuario decide mostrarla, nadie mas la ve
// salvo quien ya esta viendo su pantalla en ese momento.
//
// Reusa los iconos ya existentes en el proyecto (IconoOjo/IconoOjoTachado,
// hoy usados para mostrar/ocultar filas en Dictamen/Depuracion) en vez de
// agregar iconografia nueva.
import type { InputHTMLAttributes } from 'react';
import { useState } from 'react';
import { IconoOjo, IconoOjoTachado } from './Iconos';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Si se pasa, el boton de mostrar/ocultar usa `${testId}-mostrar`. */
  testId?: string;
};

export default function CampoPassword({ testId, ...resto }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="campo-password">
      <input {...resto} data-testid={testId} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="boton-mostrar-password"
        data-testid={testId ? `${testId}-mostrar` : undefined}
        aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        title={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        // tabIndex -1: el orden de tabulacion natural pasa del campo al
        // siguiente control del formulario, no se detiene en el ojito.
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? <IconoOjoTachado tamano={18} /> : <IconoOjo tamano={18} />}
      </button>
    </div>
  );
}
