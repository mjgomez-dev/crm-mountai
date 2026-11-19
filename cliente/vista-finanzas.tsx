"use client";

import { ArrowDownLeft, ArrowUpRight, Check, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fechaEn } from "@/lib/agenda";
import { estadoDe, type EstadoMovimiento, type Frecuencia, LIMITES_FINANZAS, type Movimiento, resumen, type TipoMovimiento } from "@/lib/finanzas";
import type { Bd } from "@/lib/tipos";
import { confirmar } from "./confirmaciones";
import { BOTON, BOTON_PRINCIPAL, Dialogo, ENTRADA, ErrorCampo, FOCO, SELECT, Segmentado } from "./configuracion/controles";
import { abrirCliente } from "./navegacion";
import { useNegocio } from "./negocio";

// Finanzas: lo que te deben (cobros) y lo que debes (pagos), con cuotas y vencimientos. Arriba, los
// totales; debajo, la lista por mes. Se marca «Pagado» con un clic y se deshace igual.

type Filtro = "pendientes" | "vencidos" | "pagados" | "todos";
type FiltroTipo = "todo" | TipoMovimiento;

const TONO: Record<EstadoMovimiento, { punto: string; texto: string; etiqueta: string }> = {
  pagado: { punto: "bg-ok", texto: "text-ok-texto", etiqueta: "Pagado" },
  vencido: { punto: "bg-error", texto: "text-error-texto", etiqueta: "Vencido" },
  hoy: { punto: "bg-atencion", texto: "text-atencion-texto", etiqueta: "Vence hoy" },
  pronto: { punto: "bg-atencion", texto: "text-atencion-texto", etiqueta: "Esta semana" },
  pendiente: { punto: "bg-nuevo", texto: "text-secundario", etiqueta: "Pendiente" },
};

const DIA = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const MES = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: "UTC" });
const textoDia = (f: string) => DIA.format(new Date(`${f}T12:00:00Z`));
const textoMes = (f: string) => {
  const t = MES.format(new Date(`${f.slice(0, 7)}-15T12:00:00Z`));
  return t.charAt(0).toUpperCase() + t.slice(1);
};

async function llamar(cuerpo: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string; campo?: string }> {
  try {
    const r = await fetch("/api/finanzas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
    const datos = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; campo?: string } | null;
    if (r.ok && datos?.ok) return { ok: true };
    return { ok: false, error: datos?.error ?? "No se ha podido guardar. Inténtalo otra vez.", campo: datos?.campo };
  } catch {
    return { ok: false, error: "Sin conexión con el CRM. Inténtalo otra vez." };
  }
}

export function VistaFinanzas({ bd, ahora, ranura }: { bd: Bd; ahora: Date; ranura?: HTMLElement | null }) {
  const { formato, zona } = useNegocio();
  const [movimientos, setMovimientos] = useState<Movimiento[] | null>(null);
  const [errorCarga, setErrorCarga] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("pendientes");
  const [tipo, setTipo] = useState<FiltroTipo>("todo");
  const [alta, setAlta] = useState(false);
  const [aBorrar, setABorrar] = useState<Movimiento | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await fetch("/api/finanzas", { cache: "no-store" });
      const datos = (await r.json()) as { ok: boolean; movimientos?: Movimiento[] };
      if (!datos.ok || !datos.movimientos) throw new Error("respuesta");
      setMovimientos(datos.movimientos);
      setErrorCarga(false);
    } catch {
      setErrorCarga(true);
    }
  }, []);

  // Al entrar y cada vez que cambian los datos del panel (otro cliente borrado, otra pestaña…).
  useEffect(() => {
    void cargar();
  }, [cargar, bd]);

  const hoy = fechaEn(ahora, zona).fecha;
  const mesDe = useCallback((ts: number) => fechaEn(new Date(ts), zona).fecha.slice(0, 7), [zona]);
  const totales = useMemo(() => resumen(movimientos ?? [], hoy, mesDe), [movimientos, hoy, mesDe]);

  const visibles = useMemo(() => {
    const lista = (movimientos ?? []).filter((m) => {
      if (tipo !== "todo" && m.tipo !== tipo) return false;
      const e = estadoDe(m, hoy);
      if (filtro === "pendientes") return e !== "pagado";
      if (filtro === "vencidos") return e === "vencido";
      if (filtro === "pagados") return e === "pagado";
      return true;
    });
    // Los pagados, del más reciente al más antiguo; lo pendiente, por vencimiento.
    if (filtro === "pagados") lista.sort((a, b) => (b.pagadoEn ?? 0) - (a.pagadoEn ?? 0));
    const porMes = new Map<string, Movimiento[]>();
    for (const m of lista) {
      const clave = filtro === "pagados" && m.pagadoEn !== null ? mesDe(m.pagadoEn) : m.vence.slice(0, 7);
      porMes.set(clave, [...(porMes.get(clave) ?? []), m]);
    }
    return [...porMes];
  }, [movimientos, filtro, tipo, hoy, mesDe]);

  const pagar = async (m: Movimiento, pagado: boolean) => {
    setMovimientos((lista) => lista?.map((x) => (x.id === m.id ? { ...x, pagadoEn: pagado ? Date.now() : null } : x)) ?? null);
    const r = await llamar({ accion: "pagar", id: m.id, pagado });
    if (!r.ok) {
      confirmar(r.error, { tono: "error" });
      await cargar();
      return;
    }
    confirmar(pagado ? (m.tipo === "cobro" ? "Marcado como cobrado" : "Marcado como pagado") : "Vuelve a estar pendiente", {
      accion: { texto: "Deshacer", hacer: () => void pagar(m, !pagado) },
    });
  };

  const accionCabecera = (
    <button type="button" onClick={() => setAlta(true)} className={BOTON_PRINCIPAL}>
      <Plus aria-hidden className="size-4" strokeWidth={2} />
      Movimiento
    </button>
  );

  return (
    <>
      {ranura ? createPortal(accionCabecera, ranura) : <div className="flex justify-end">{accionCabecera}</div>}

      <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tarjeta
          titulo="Por cobrar"
          valor={formato.importe(totales.porCobrar)}
          detalle={totales.vencidoCobrar > 0 ? `${formato.importe(totales.vencidoCobrar)} vencido` : "Nada vencido"}
          tonoDetalle={totales.vencidoCobrar > 0 ? "error" : "neutro"}
          icono={<ArrowDownLeft aria-hidden className="size-4" strokeWidth={2} />}
          acento="ok"
        />
        <Tarjeta
          titulo="Por pagar"
          valor={formato.importe(totales.porPagar)}
          detalle={totales.vencidoPagar > 0 ? `${formato.importe(totales.vencidoPagar)} vencido` : "Nada vencido"}
          tonoDetalle={totales.vencidoPagar > 0 ? "error" : "neutro"}
          icono={<ArrowUpRight aria-hidden className="size-4" strokeWidth={2} />}
          acento="error"
        />
        <Tarjeta titulo="Cobrado este mes" valor={formato.importe(totales.cobradoMes)} detalle={`Pagado: ${formato.importe(totales.pagadoMes)}`} tonoDetalle="neutro" />
        <Tarjeta
          titulo="Saldo pendiente"
          valor={`${totales.saldoPendiente < 0 ? "−" : ""}${formato.importe(Math.abs(totales.saldoPendiente))}`}
          detalle="Lo que entra menos lo que sale"
          tonoDetalle="neutro"
          tonoValor={totales.saldoPendiente < 0 ? "error" : totales.saldoPendiente > 0 ? "ok" : undefined}
        />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <FiltroSegmentado<Filtro>
          etiqueta="Mostrar"
          valor={filtro}
          cambiar={setFiltro}
          opciones={[
            { valor: "pendientes", texto: "Pendientes" },
            { valor: "vencidos", texto: totales.vencidos > 0 ? `Vencidos · ${totales.vencidos}` : "Vencidos" },
            { valor: "pagados", texto: "Pagados" },
            { valor: "todos", texto: "Todos" },
          ]}
        />
        <FiltroSegmentado<FiltroTipo>
          etiqueta="Tipo"
          valor={tipo}
          cambiar={setTipo}
          opciones={[
            { valor: "todo", texto: "Todo" },
            { valor: "cobro", texto: "Cobros" },
            { valor: "pago", texto: "Pagos" },
          ]}
        />
      </div>

      {errorCarga && movimientos === null && (
        <p className="rounded-[12px] border border-linea bg-white p-4 text-[14px] text-error-texto">No se han podido leer las finanzas. Recarga la página.</p>
      )}

      {movimientos !== null && visibles.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-[16px] border border-dashed border-linea bg-white px-6 py-12 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-lienzo text-secundario">
            <Check aria-hidden className="size-5" strokeWidth={1.75} />
          </span>
          <p className="text-[15px] font-medium">{movimientos.length === 0 ? "Aún no hay movimientos" : "Nada por aquí"}</p>
          <p className="max-w-[380px] text-[14px] leading-5 text-secundario">
            {movimientos.length === 0
              ? "Apunta lo que te deben tus clientes y lo que tienes que pagar tú. Si va a plazos, el CRM crea las cuotas con su vencimiento."
              : "Con estos filtros no hay ningún movimiento."}
          </p>
          {movimientos.length === 0 && (
            <button type="button" onClick={() => setAlta(true)} className={`${BOTON} mt-1`}>
              <Plus aria-hidden className="size-4" strokeWidth={2} />
              Añadir el primero
            </button>
          )}
        </div>
      )}

      {visibles.map(([mes, lista]) => {
        const neto = lista.reduce((s, m) => s + (m.tipo === "cobro" ? m.importe : -m.importe), 0);
        return (
          <section key={mes} aria-label={textoMes(mes)} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between px-1">
              <h2 className="text-[13px] font-medium tracking-[0.02em] text-secundario uppercase">{textoMes(mes)}</h2>
              <span className={`text-[13px] tabular-nums ${neto < 0 ? "text-error-texto" : "text-secundario"}`}>
                {neto < 0 ? "−" : "+"}
                {formato.importe(Math.abs(neto))}
              </span>
            </div>
            <ul className="overflow-hidden rounded-[14px] border border-linea bg-white">
              {lista.map((m) => (
                <Fila key={m.id} m={m} hoy={hoy} importe={formato.importe} fechaPago={formato.dia} pagar={pagar} borrar={() => setABorrar(m)} />
              ))}
            </ul>
          </section>
        );
      })}

      <DialogoAlta
        abierto={alta}
        cerrar={() => setAlta(false)}
        hoy={hoy}
        bd={bd}
        guardado={async (n) => {
          setAlta(false);
          confirmar(n > 1 ? `${n} cuotas añadidas` : "Movimiento añadido");
          setFiltro("pendientes");
          await cargar();
        }}
      />

      <Dialogo
        abierto={aBorrar !== null}
        cerrar={() => setABorrar(null)}
        rol="alertdialog"
        titulo="¿Borrar este movimiento?"
        descripcion={aBorrar ? `«${aBorrar.concepto}» · ${formato.importe(aBorrar.importe)}. No se puede deshacer.` : undefined}
        acciones={
          <>
            <button type="button" className={BOTON} onClick={() => setABorrar(null)}>
              Cancelar
            </button>
            {aBorrar?.grupo && (
              <button
                type="button"
                className={BOTON}
                onClick={async () => {
                  const m = aBorrar;
                  setABorrar(null);
                  const r = await llamar({ accion: "borrar", id: m.id, todoElPlan: true });
                  confirmar(r.ok ? "Plan de cuotas borrado" : r.error, r.ok ? undefined : { tono: "error" });
                  await cargar();
                }}
              >
                Borrar todas las cuotas
              </button>
            )}
            <button
              type="button"
              className={`${BOTON_PRINCIPAL} !bg-error-texto hover:!bg-error`}
              onClick={async () => {
                if (!aBorrar) return;
                const m = aBorrar;
                setABorrar(null);
                const r = await llamar({ accion: "borrar", id: m.id });
                confirmar(r.ok ? "Movimiento borrado" : r.error, r.ok ? undefined : { tono: "error" });
                await cargar();
              }}
            >
              {aBorrar?.grupo ? "Solo esta cuota" : "Borrar"}
            </button>
          </>
        }
      />
    </>
  );
}

function Tarjeta(p: {
  titulo: string;
  valor: string;
  detalle: string;
  tonoDetalle: "error" | "neutro";
  tonoValor?: "ok" | "error";
  icono?: React.ReactNode;
  acento?: "ok" | "error";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-[14px] border border-linea bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-secundario">
        {p.icono && (
          <span className={`flex size-5 items-center justify-center rounded-full ${p.acento === "ok" ? "bg-ok/15 text-ok-texto" : "bg-error/15 text-error-texto"}`}>
            {p.icono}
          </span>
        )}
        {p.titulo}
      </span>
      <span
        className={`truncate text-[22px] leading-7 font-medium tracking-[-0.01em] tabular-nums ${
          p.tonoValor === "ok" ? "text-ok-texto" : p.tonoValor === "error" ? "text-error-texto" : ""
        }`}
      >
        {p.valor}
      </span>
      <span className={`truncate text-[12.5px] ${p.tonoDetalle === "error" ? "text-error-texto" : "text-secundario"}`}>{p.detalle}</span>
    </div>
  );
}

function FiltroSegmentado<T extends string>(p: { etiqueta: string; valor: T; cambiar: (v: T) => void; opciones: { valor: T; texto: string }[] }) {
  return (
    <div role="radiogroup" aria-label={p.etiqueta} className="inline-flex flex-wrap gap-0.5 rounded-[10px] border border-linea bg-white p-0.5">
      {p.opciones.map((o) => {
        const activa = o.valor === p.valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={activa}
            onClick={() => p.cambiar(o.valor)}
            className={`h-8 cursor-pointer rounded-[8px] px-3 text-[13px] font-medium transition-colors duration-150 ease-out max-lg:min-h-10 ${FOCO} ${
              activa ? "bg-tinta text-white" : "text-secundario hover:bg-lienzo hover:text-tinta"
            }`}
          >
            {o.texto}
          </button>
        );
      })}
    </div>
  );
}

function Fila(p: {
  m: Movimiento;
  hoy: string;
  importe: (n: number) => string;
  fechaPago: (ts: number) => string;
  pagar: (m: Movimiento, pagado: boolean) => Promise<void>;
  borrar: () => void;
}) {
  const { m } = p;
  const estado = estadoDe(m, p.hoy);
  const tono = TONO[estado];
  const pagado = m.pagadoEn !== null;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-linea px-4 py-3 last:border-b-0 max-sm:px-3">
      <span aria-hidden className={`size-2.5 shrink-0 rounded-full ${tono.punto}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`text-[14px] leading-5 font-medium break-words ${pagado ? "text-secundario line-through decoration-secundario/40" : ""}`}>
          {m.concepto}
          {m.cuota !== null && m.cuotas !== null && (
            <span className="ml-2 rounded-full bg-lienzo px-2 py-0.5 align-[1px] text-[11.5px] font-medium text-secundario no-underline">
              Cuota {m.cuota}/{m.cuotas}
            </span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-x-2 text-[12.5px] leading-4 text-secundario">
          <span className={tono.texto}>{pagado && m.pagadoEn !== null ? `${m.tipo === "cobro" ? "Cobrado" : "Pagado"} ${p.fechaPago(m.pagadoEn)}` : `${tono.etiqueta} · ${textoDia(m.vence)}`}</span>
          {m.leadId && m.leadNombre && (
            <>
              <span aria-hidden>·</span>
              <button type="button" onClick={() => abrirCliente(m.leadId as string)} className={`cursor-pointer rounded-[4px] underline decoration-secundario/40 underline-offset-2 hover:text-tinta ${FOCO}`}>
                {m.leadNombre}
              </button>
            </>
          )}
        </span>
      </div>
      <span className={`shrink-0 text-[15px] font-medium tabular-nums ${m.tipo === "cobro" ? "text-ok-texto" : "text-tinta"} ${pagado ? "opacity-60" : ""}`}>
        {m.tipo === "cobro" ? "+" : "−"}
        {p.importe(m.importe)}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => void p.pagar(m, !pagado)}
          className={`${BOTON} h-8 px-2.5`}
          aria-label={pagado ? `Volver a pendiente: ${m.concepto}` : `Marcar como ${m.tipo === "cobro" ? "cobrado" : "pagado"}: ${m.concepto}`}
        >
          {pagado ? <RotateCcw aria-hidden className="size-3.5" strokeWidth={2} /> : <Check aria-hidden className="size-3.5" strokeWidth={2} />}
          <span className="max-sm:sr-only">{pagado ? "Deshacer" : m.tipo === "cobro" ? "Cobrado" : "Pagado"}</span>
        </button>
        <button
          type="button"
          onClick={p.borrar}
          aria-label={`Borrar: ${m.concepto}`}
          className={`flex size-8 cursor-pointer items-center justify-center rounded-[8px] text-secundario transition-colors duration-150 ease-out hover:bg-lienzo hover:text-error-texto max-lg:size-10 ${FOCO}`}
        >
          <Trash2 aria-hidden className="size-4" strokeWidth={1.75} />
        </button>
      </div>
    </li>
  );
}

function DialogoAlta(p: { abierto: boolean; cerrar: () => void; hoy: string; bd: Bd; guardado: (n: number) => Promise<void> }) {
  const { cfg, formato } = useNegocio();
  const [tipo, setTipo] = useState<TipoMovimiento>("cobro");
  const [concepto, setConcepto] = useState("");
  const [importe, setImporte] = useState("");
  const [vence, setVence] = useState(p.hoy);
  const [cuotas, setCuotas] = useState("1");
  const [frecuencia, setFrecuencia] = useState<Frecuencia>("mensual");
  const [leadId, setLeadId] = useState("");
  const [error, setError] = useState<{ texto: string; campo?: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const foco = useRef<HTMLInputElement>(null);
  const ids = { concepto: useId(), importe: useId(), vence: useId(), cuotas: useId(), frecuencia: useId(), cliente: useId(), tipo: useId(), error: useId() };

  // Cada vez que se abre, vacío y con la fecha de hoy.
  useEffect(() => {
    if (!p.abierto) return;
    setTipo("cobro");
    setConcepto("");
    setImporte("");
    setVence(p.hoy);
    setCuotas("1");
    setFrecuencia("mensual");
    setLeadId("");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.abierto]);

  const clientes = useMemo(
    () =>
      Object.values(p.bd.leads)
        .filter((l) => l.estado !== "spam")
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    [p.bd.leads],
  );

  const total = Number(importe.replace(/[^\d]/g, "")) || 0;
  const n = Math.max(1, Math.min(LIMITES_FINANZAS.cuotas, Number(cuotas) || 1));
  const porCuota = n > 1 && total > 0 ? Math.floor(total / n) : 0;

  const enviar = async () => {
    setEnviando(true);
    setError(null);
    try {
      const r = await fetch("/api/finanzas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "crear", tipo, concepto, importe: total, vence, cuotas: n, frecuencia, leadId: leadId || null }),
      });
      const datos = (await r.json().catch(() => null)) as { ok?: boolean; creados?: number; error?: string; campo?: string } | null;
      if (!r.ok || !datos?.ok) {
        setError({ texto: datos?.error ?? "No se ha podido guardar", campo: datos?.campo });
        return;
      }
      await p.guardado(datos.creados ?? 1);
    } catch {
      setError({ texto: "Sin conexión con el CRM. Inténtalo otra vez." });
    } finally {
      setEnviando(false);
    }
  };

  const etiqueta = "mb-1.5 block text-[13px] font-medium";
  const invalido = (campo: string) => (error?.campo === campo ? true : undefined);

  return (
    <Dialogo
      abierto={p.abierto}
      cerrar={p.cerrar}
      titulo="Nuevo movimiento"
      focoInicial={foco}
      acciones={
        <>
          <button type="button" className={BOTON} onClick={p.cerrar}>
            Cancelar
          </button>
          <button type="submit" form="form-finanzas" className={BOTON_PRINCIPAL} disabled={enviando}>
            {enviando ? "Guardando…" : n > 1 ? `Crear ${n} cuotas` : "Guardar"}
          </button>
        </>
      }
    >
      <form
        id="form-finanzas"
        className="mt-4 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void enviar();
        }}
      >
        <div>
          <span id={ids.tipo} className={etiqueta}>
            Tipo
          </span>
          <Segmentado
            opciones={[
              { valor: "cobro", texto: "Cobro (me pagan)" },
              { valor: "pago", texto: "Pago (pago yo)" },
            ]}
            valor={tipo}
            idEtiqueta={ids.tipo}
            cambiar={(v) => setTipo(v as TipoMovimiento)}
          />
        </div>
        <div>
          <label htmlFor={ids.concepto} className={etiqueta}>
            Concepto
          </label>
          <input
            ref={foco}
            id={ids.concepto}
            value={concepto}
            maxLength={LIMITES_FINANZAS.concepto}
            onChange={(e) => setConcepto(e.target.value)}
            placeholder={tipo === "cobro" ? "Reforma de cocina · señal" : "Alquiler del local"}
            className={`${ENTRADA} w-full`}
            aria-invalid={invalido("concepto")}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={ids.importe} className={etiqueta}>
              Importe total
            </label>
            <input
              id={ids.importe}
              inputMode="numeric"
              value={importe}
              onChange={(e) => setImporte(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="1000"
              className={`${ENTRADA} w-full tabular-nums`}
              aria-invalid={invalido("importe")}
            />
          </div>
          <div>
            <label htmlFor={ids.vence} className={etiqueta}>
              {n > 1 ? "Primer vencimiento" : "Vence"}
            </label>
            <input id={ids.vence} type="date" value={vence} onChange={(e) => setVence(e.target.value)} className={`${ENTRADA} w-full`} aria-invalid={invalido("vence")} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor={ids.cuotas} className={etiqueta}>
              Cuotas
            </label>
            <input
              id={ids.cuotas}
              type="number"
              min={1}
              max={LIMITES_FINANZAS.cuotas}
              value={cuotas}
              onChange={(e) => setCuotas(e.target.value)}
              className={`${ENTRADA} w-full tabular-nums`}
              aria-invalid={invalido("cuotas")}
            />
          </div>
          <div>
            <label htmlFor={ids.frecuencia} className={etiqueta}>
              Cada
            </label>
            <select
              id={ids.frecuencia}
              value={frecuencia}
              disabled={n === 1}
              onChange={(e) => setFrecuencia(e.target.value as Frecuencia)}
              className={`${SELECT} w-full`}
            >
              <option value="mensual">Mes</option>
              <option value="quincenal">15 días</option>
              <option value="semanal">Semana</option>
            </select>
          </div>
        </div>
        {porCuota > 0 && (
          <p className="-mt-1 text-[13px] text-secundario">
            {n} cuotas de unos {formato.importe(porCuota)}
          </p>
        )}
        <div>
          <label htmlFor={ids.cliente} className={etiqueta}>
            {cap(cfg.vocabulario.cliente.singular)} <span className="font-normal text-secundario">(opcional)</span>
          </label>
          <select id={ids.cliente} value={leadId} onChange={(e) => setLeadId(e.target.value)} className={`${SELECT} w-full`}>
            <option value="">Ninguno</option>
            {clientes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nombre}
              </option>
            ))}
          </select>
        </div>
        <ErrorCampo id={ids.error} error={error?.texto ?? null} />
      </form>
    </Dialogo>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
