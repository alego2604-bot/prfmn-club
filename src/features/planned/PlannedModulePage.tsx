import { Link } from "react-router-dom";
import { ArrowRight, Check, Database } from "lucide-react";
import type { NavItem } from "@/app/nav";
import { Button, Card, Page, StatusPill } from "@/design-system/components";

/** Qué existe ya de cada módulo (tablas, reglas). Honesto: nada de botones falsos. */
const FOUNDATIONS: Record<string, string[]> = {
  "/seguimiento": ["Reglas de actividad configurables (Ajustes → Reglas)", "Tablas customer_notes (con «silenciar avisos hasta») y tasks", "Alertas siempre con motivo explicado"],
  "/membresias": ["Tablas membership_plans + membership_plan_versions (precio con vigencia)", "customer_memberships apunta a la versión → el histórico nunca cambia", "Tarifas detectadas automáticamente al importar las facturas"],
  "/asistencia": ["Tabla attendance con deduplicación por cliente + hora + clase", "Fuente: importación (BeMadBox), check-in o integración"],
  "/leads": ["customers.pipeline_stage (lead → member / lost) y lost_reason", "Auditoría de cada cambio de etapa"],
  "/inbox": ["Tabla communications (canal, dirección, estado, resultado, autor)", "Solo WhatsApp Business Platform oficial, sin automatizaciones no oficiales"],
  "/plantillas": ["Tabla message_templates por categoría y canal", "Generación con IA: propone → revisas → envías (nunca automático)"],
  "/gastos": ["Tablas expenses, expense_categories y suppliers", "Detección de duplicados por proveedor + nº de factura", "Vínculo documento original ↔ gasto (document_links)"],
  "/proveedores": ["Tabla suppliers con NIF normalizado y categoría por defecto"],
  "/conciliacion": ["Tabla bank_transactions con estado de emparejamiento"],
  "/analytics": ["Capa de KPIs pura y testeada (src/domain/analytics.ts)"],
  "/copilot": ["Solo lectura bajo RLS, con la consulta de origen en cada respuesta"],
  "/documentos": ["Tablas documents + document_links (polimórfico)", "Hash SHA-256 para detectar archivos repetidos"],
};

export function PlannedModulePage({ item }: { item: NavItem }) {
  const f = FOUNDATIONS[item.to] ?? [];
  return (
    <Page>
      <div className="mx-auto max-w-2xl py-10">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-surface shadow-xs">
          <item.icon className="h-5 w-5 text-fg-2" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{item.label}</h1>
          <StatusPill status={item.status} />
        </div>
        <p className="mt-2 text-md text-fg-2">{item.description}</p>
        <Card className="mt-8">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold"><Database className="h-4 w-4 text-fg-3" />Ya preparado en la arquitectura</p>
          {f.length ? (
            <ul className="flex flex-col gap-2 text-sm text-fg-2">
              {f.map((x) => <li key={x} className="flex gap-2.5"><Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />{x}</li>)}
            </ul>
          ) : (
            <p className="text-sm text-fg-3">Pendiente de diseño detallado.</p>
          )}
          <p className="mt-5 border-t border-line pt-4 text-sm text-fg-3">
            Este módulo aún no tiene interfaz funcional, así que no muestra botones que no hacen nada. Ver el orden de construcción en <span className="font-mono text-xs">docs/PROJECT_MASTER.md</span>.
          </p>
        </Card>
        <div className="mt-6">
          <Link to="/"><Button iconRight={ArrowRight}>Volver al inicio</Button></Link>
        </div>
      </div>
    </Page>
  );
}
