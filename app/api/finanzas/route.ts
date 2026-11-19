import { borrarMovimiento, crearMovimientos, leerLead, leerMovimientos, marcarMovimiento } from "@/lib/bd";
import { revisarAlta } from "@/lib/finanzas";
import { log } from "@/lib/log";

// Finanzas del panel: cobros y pagos, cuotas y vencimientos.
// GET: la lista. POST con `accion`: «crear», «pagar» (con `pagado`) o «borrar» (con `todoElPlan`).

function error(mensaje: string, status: number, campo?: string) {
  return Response.json({ ok: false, error: mensaje, ...(campo ? { campo } : {}) }, { status });
}

export async function GET() {
  return Response.json({ ok: true, movimientos: await leerMovimientos() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const cuerpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!cuerpo || typeof cuerpo !== "object") return error("Petición no válida", 400);
  const accion = cuerpo.accion;

  if (accion === "crear") {
    const revision = revisarAlta(cuerpo);
    if ("error" in revision) return error(revision.error, 400, revision.campo);
    const { alta } = revision;
    if (alta.leadId && !(await leerLead(alta.leadId))) return error("Ese cliente ya no existe", 404, "leadId");
    const n = await crearMovimientos(alta);
    log(`Finanzas: ${alta.tipo === "cobro" ? "cobro" : "pago"} añadido${n > 1 ? ` en ${n} cuotas` : ""}`);
    return Response.json({ ok: true, creados: n });
  }

  const id = typeof cuerpo.id === "string" ? cuerpo.id : "";
  if (!id) return error("Falta el movimiento", 400);

  if (accion === "pagar") {
    const bien = await marcarMovimiento(id, cuerpo.pagado !== false);
    return bien ? Response.json({ ok: true }) : error("Ese movimiento ya no existe", 404);
  }

  if (accion === "borrar") {
    const n = await borrarMovimiento(id, cuerpo.todoElPlan === true);
    return n > 0 ? Response.json({ ok: true, borrados: n }) : error("Ese movimiento ya no existe", 404);
  }

  return error("Acción desconocida", 400);
}
