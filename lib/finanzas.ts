// Finanzas: lo que te tienen que pagar (cobros) y lo que tienes que pagar tú (pagos), con su fecha de
// vencimiento y, si va a plazos, sus cuotas. Puro: lo usan el servidor (la API) y el navegador (la vista).

export type TipoMovimiento = "cobro" | "pago";
export type Frecuencia = "mensual" | "quincenal" | "semanal";

export interface Movimiento {
  id: string;
  tipo: TipoMovimiento;
  concepto: string;
  /** En unidades de la moneda del negocio, sin decimales (como el presupuesto de la ficha). */
  importe: number;
  /** AAAA-MM-DD. */
  vence: string;
  /** Cuándo se marcó como pagado; null si está pendiente. */
  pagadoEn: number | null;
  leadId: string | null;
  /** El nombre del cliente al leer, para pintarlo sin buscarlo. */
  leadNombre?: string | null;
  /** «Cuota 2 de 6»: las cuotas de un mismo plan comparten `grupo`. */
  cuota: number | null;
  cuotas: number | null;
  grupo: string | null;
  creadoEn: number;
}

export interface AltaMovimiento {
  tipo: TipoMovimiento;
  concepto: string;
  /** El importe TOTAL: con cuotas, se reparte entre ellas (la última se lleva el redondeo). */
  importe: number;
  /** El vencimiento de la primera cuota. */
  vence: string;
  cuotas: number;
  frecuencia: Frecuencia;
  leadId: string | null;
}

export const LIMITES_FINANZAS = { concepto: 120, cuotas: 60, importe: 2_000_000_000 } as const;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function fechaValida(f: string): boolean {
  if (!FECHA.test(f)) return false;
  const d = new Date(`${f}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
}

/** Revisa lo que llega del navegador. Devuelve el alta limpia o el error en español. */
export function revisarAlta(cuerpo: unknown): { alta: AltaMovimiento } | { error: string; campo: string } {
  const c = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as Record<string, unknown>;
  const tipo = c.tipo;
  if (tipo !== "cobro" && tipo !== "pago") return { error: "Elige si es un cobro o un pago", campo: "tipo" };
  const concepto = typeof c.concepto === "string" ? c.concepto.trim().replace(/\s+/g, " ") : "";
  if (!concepto) return { error: "Escribe el concepto", campo: "concepto" };
  if (concepto.length > LIMITES_FINANZAS.concepto) return { error: `El concepto, como mucho ${LIMITES_FINANZAS.concepto} caracteres`, campo: "concepto" };
  const importe = typeof c.importe === "number" ? c.importe : Number(String(c.importe ?? "").replace(/[^\d]/g, ""));
  if (!Number.isInteger(importe) || importe <= 0) return { error: "Escribe un importe mayor que 0, sin decimales", campo: "importe" };
  if (importe > LIMITES_FINANZAS.importe) return { error: "Ese importe es demasiado grande", campo: "importe" };
  const vence = typeof c.vence === "string" ? c.vence : "";
  if (!fechaValida(vence)) return { error: "Elige la fecha de vencimiento", campo: "vence" };
  const cuotas = c.cuotas === undefined || c.cuotas === null || c.cuotas === "" ? 1 : Number(c.cuotas);
  if (!Number.isInteger(cuotas) || cuotas < 1 || cuotas > LIMITES_FINANZAS.cuotas) return { error: `Las cuotas, de 1 a ${LIMITES_FINANZAS.cuotas}`, campo: "cuotas" };
  if (cuotas > importe) return { error: "Hay más cuotas que unidades del importe", campo: "cuotas" };
  const frecuencia = c.frecuencia ?? "mensual";
  if (frecuencia !== "mensual" && frecuencia !== "quincenal" && frecuencia !== "semanal") return { error: "Elige cada cuánto se paga", campo: "frecuencia" };
  const leadId = typeof c.leadId === "string" && c.leadId ? c.leadId : null;
  return { alta: { tipo, concepto, importe, vence, cuotas, frecuencia, leadId } };
}

/** Suma meses sin saltarse el fin de mes: 31 ene + 1 mes = 28/29 feb. */
function sumarMeses(fecha: string, meses: number): string {
  const [a, m, d] = fecha.split("-").map(Number);
  const total = a * 12 + (m - 1) + meses;
  const anio = Math.floor(total / 12);
  const mes = (total % 12) + 1;
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return `${anio}-${String(mes).padStart(2, "0")}-${String(Math.min(d, ultimo)).padStart(2, "0")}`;
}

function sumarDiasFecha(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Las cuotas de un alta: el importe repartido y una fecha por cuota. Con una sola, el movimiento tal cual. */
export function planDeCuotas(alta: AltaMovimiento): { importe: number; vence: string; cuota: number | null }[] {
  if (alta.cuotas === 1) return [{ importe: alta.importe, vence: alta.vence, cuota: null }];
  const base = Math.floor(alta.importe / alta.cuotas);
  const resto = alta.importe - base * alta.cuotas;
  return Array.from({ length: alta.cuotas }, (_, i) => ({
    importe: i === alta.cuotas - 1 ? base + resto : base,
    vence:
      alta.frecuencia === "mensual" ? sumarMeses(alta.vence, i) : sumarDiasFecha(alta.vence, i * (alta.frecuencia === "quincenal" ? 15 : 7)),
    cuota: i + 1,
  }));
}

export type EstadoMovimiento = "pagado" | "vencido" | "hoy" | "pronto" | "pendiente";

/** Pagado; vencido (pasó la fecha); hoy; pronto (en los próximos 7 días); pendiente. */
export function estadoDe(m: Pick<Movimiento, "pagadoEn" | "vence">, hoy: string): EstadoMovimiento {
  if (m.pagadoEn !== null) return "pagado";
  if (m.vence < hoy) return "vencido";
  if (m.vence === hoy) return "hoy";
  if (m.vence <= sumarDiasFecha(hoy, 7)) return "pronto";
  return "pendiente";
}

export interface ResumenFinanzas {
  porCobrar: number;
  porPagar: number;
  vencidoCobrar: number;
  vencidoPagar: number;
  /** Cuántos movimientos pendientes ya vencieron (cobros y pagos). */
  vencidos: number;
  cobradoMes: number;
  pagadoMes: number;
  /** Lo que entra menos lo que sale, de lo pendiente. */
  saldoPendiente: number;
}

/** Los totales de arriba. `mes` es AAAA-MM del mes actual, en la zona del negocio. */
export function resumen(movimientos: Movimiento[], hoy: string, mesDe: (ts: number) => string): ResumenFinanzas {
  const r: ResumenFinanzas = { porCobrar: 0, porPagar: 0, vencidoCobrar: 0, vencidoPagar: 0, vencidos: 0, cobradoMes: 0, pagadoMes: 0, saldoPendiente: 0 };
  const mes = hoy.slice(0, 7);
  for (const m of movimientos) {
    if (m.pagadoEn !== null) {
      if (mesDe(m.pagadoEn) === mes) {
        if (m.tipo === "cobro") r.cobradoMes += m.importe;
        else r.pagadoMes += m.importe;
      }
      continue;
    }
    if (m.tipo === "cobro") r.porCobrar += m.importe;
    else r.porPagar += m.importe;
    if (m.vence < hoy) {
      r.vencidos += 1;
      if (m.tipo === "cobro") r.vencidoCobrar += m.importe;
      else r.vencidoPagar += m.importe;
    }
  }
  r.saldoPendiente = r.porCobrar - r.porPagar;
  return r;
}
