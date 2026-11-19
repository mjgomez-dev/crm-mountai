"use client";

import { useCallback, useEffect, useState } from "react";
import { CLAVE_TEMA as CLAVE, CONSULTA_OSCURO as OSCURO } from "@/lib/tema";

// El tema del panel: claro, oscuro o el del sistema. Se recuerda en este navegador (localStorage) y
// se aplica como <html data-tema="claro|oscuro">. La web pública no lo usa: solo lo pone el panel.

export type PreferenciaTema = "claro" | "oscuro" | "sistema";

export function leerPreferencia(): PreferenciaTema {
  try {
    const v = localStorage.getItem(CLAVE);
    if (v === "claro" || v === "oscuro" || v === "sistema") return v;
  } catch {
    // Sin almacenamiento (ventana privada): el del sistema.
  }
  return "sistema";
}

function resolver(p: PreferenciaTema): "claro" | "oscuro" {
  if (p !== "sistema") return p;
  return typeof matchMedia === "function" && matchMedia(OSCURO).matches ? "oscuro" : "claro";
}

function aplicar(p: PreferenciaTema, suave: boolean): void {
  const raiz = document.documentElement;
  if (suave) {
    raiz.classList.add("cambiando-tema");
    window.setTimeout(() => raiz.classList.remove("cambiando-tema"), 260);
  }
  raiz.dataset.tema = resolver(p);
}

/** Aplica el tema mientras el panel está montado y devuelve la preferencia y cómo cambiarla. */
export function useTema(): { preferencia: PreferenciaTema; efectivo: "claro" | "oscuro"; cambiar: (p: PreferenciaTema) => void } {
  const [preferencia, setPreferencia] = useState<PreferenciaTema>("sistema");
  const [efectivo, setEfectivo] = useState<"claro" | "oscuro">("claro");

  useEffect(() => {
    const p = leerPreferencia();
    setPreferencia(p);
    aplicar(p, false);
    setEfectivo(resolver(p));
    const consulta = matchMedia(OSCURO);
    const alCambiar = () => {
      const actual = leerPreferencia();
      if (actual !== "sistema") return;
      aplicar(actual, true);
      setEfectivo(resolver(actual));
    };
    consulta.addEventListener("change", alCambiar);
    return () => {
      consulta.removeEventListener("change", alCambiar);
      delete document.documentElement.dataset.tema;
    };
  }, []);

  const cambiar = useCallback((p: PreferenciaTema) => {
    try {
      localStorage.setItem(CLAVE, p);
    } catch {
      // Se aplica igual, aunque no se recuerde.
    }
    setPreferencia(p);
    aplicar(p, true);
    setEfectivo(resolver(p));
  }, []);

  return { preferencia, efectivo, cambiar };
}
