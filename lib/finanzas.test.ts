import { describe, expect, it } from "vitest";
import { estadoDe, type Movimiento, planDeCuotas, resumen, revisarAlta } from "./finanzas";

describe("planDeCuotas", () => {
  it("reparte el total y la última cuota se lleva el redondeo", () => {
    const plan = planDeCuotas({ tipo: "cobro", concepto: "Obra", importe: 1000, vence: "2026-01-31", cuotas: 3, frecuencia: "mensual", leadId: null });
    expect(plan.map((p) => p.importe)).toEqual([333, 333, 334]);
    expect(plan.map((p) => p.vence)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(plan.map((p) => p.cuota)).toEqual([1, 2, 3]);
  });

  it("semanal y quincenal suman días; una sola cuota va tal cual", () => {
    const base = { tipo: "pago" as const, concepto: "x", importe: 90, vence: "2026-12-28", leadId: null };
    expect(planDeCuotas({ ...base, cuotas: 2, frecuencia: "semanal" }).map((p) => p.vence)).toEqual(["2026-12-28", "2027-01-04"]);
    expect(planDeCuotas({ ...base, cuotas: 2, frecuencia: "quincenal" }).map((p) => p.vence)).toEqual(["2026-12-28", "2027-01-12"]);
    expect(planDeCuotas({ ...base, cuotas: 1, frecuencia: "mensual" })).toEqual([{ importe: 90, vence: "2026-12-28", cuota: null }]);
  });
});

describe("revisarAlta", () => {
  it("acepta un alta válida y rechaza lo que no lo es", () => {
    const bien = revisarAlta({ tipo: "cobro", concepto: "  Señal  ", importe: 500, vence: "2026-11-30", cuotas: 2 });
    expect(bien).toEqual({ alta: { tipo: "cobro", concepto: "Señal", importe: 500, vence: "2026-11-30", cuotas: 2, frecuencia: "mensual", leadId: null } });
    expect(revisarAlta({ tipo: "otro" })).toMatchObject({ campo: "tipo" });
    expect(revisarAlta({ tipo: "pago", concepto: "x", importe: 0, vence: "2026-11-30" })).toMatchObject({ campo: "importe" });
    expect(revisarAlta({ tipo: "pago", concepto: "x", importe: 10, vence: "2026-02-30" })).toMatchObject({ campo: "vence" });
    expect(revisarAlta({ tipo: "pago", concepto: "x", importe: 10, vence: "2026-02-10", cuotas: 61 })).toMatchObject({ campo: "cuotas" });
  });
});

describe("estadoDe y resumen", () => {
  const m = (o: Partial<Movimiento>): Movimiento => ({
    id: "m", tipo: "cobro", concepto: "x", importe: 100, vence: "2026-11-19", pagadoEn: null, leadId: null, cuota: null, cuotas: null, grupo: null, creadoEn: 0, ...o,
  });

  it("vencido, hoy, pronto, pendiente y pagado", () => {
    expect(estadoDe(m({ vence: "2026-11-18" }), "2026-11-19")).toBe("vencido");
    expect(estadoDe(m({ vence: "2026-11-19" }), "2026-11-19")).toBe("hoy");
    expect(estadoDe(m({ vence: "2026-11-25" }), "2026-11-19")).toBe("pronto");
    expect(estadoDe(m({ vence: "2026-12-25" }), "2026-11-19")).toBe("pendiente");
    expect(estadoDe(m({ pagadoEn: 1 }), "2026-11-19")).toBe("pagado");
  });

  it("suma lo pendiente, lo vencido y lo pagado este mes", () => {
    const r = resumen(
      [
        m({ importe: 100, vence: "2026-11-01" }),
        m({ importe: 50, vence: "2026-12-01" }),
        m({ tipo: "pago", importe: 30, vence: "2026-11-02" }),
        m({ importe: 70, pagadoEn: 5 }),
      ],
      "2026-11-19",
      () => "2026-11",
    );
    expect(r).toEqual({ porCobrar: 150, porPagar: 30, vencidoCobrar: 100, vencidoPagar: 30, vencidos: 2, cobradoMes: 70, pagadoMes: 0, saldoPendiente: 120 });
  });
});
