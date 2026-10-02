import { Link, useNavigate } from "react-router-dom";
import { FileSpreadsheet, Upload } from "lucide-react";
import { useWorkspace, usePersonName } from "@/app/session";
import { Badge, Button, DataTable, Page, PageHeader, type Column } from "@/design-system/components";
import type { ImportJob } from "@/domain/types";
import { formatDateTime } from "@/lib/dates";
import { formatMoney, NUM } from "@/lib/money";
import { importState } from "./engine/commit";
import { STATE_LABEL } from "./ImportProgress";

export const KIND_LABEL: Record<ImportJob["kind"], string> = { sales: "Ventas / caja", invoices: "Facturas emitidas", customers: "Clientes", catalog: "Catálogo", attendance: "Asistencia", expenses: "Gastos", bank: "Extracto bancario" };

export function ImportStatus({ job }: { job: ImportJob }) {
  const state = importState(job);
  if (state === "COMPLETED") return job.summary.review || job.summary.errors ? <Badge tone="warning" dot>Completada con avisos</Badge> : <Badge tone="success" dot>Completada</Badge>;
  const meta = STATE_LABEL[state];
  return <Badge tone={meta.tone} dot={state === "IMPORTING"}>{meta.label}</Badge>;
}

export default function ImportsPage() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const userName = usePersonName();
  const columns: Column<ImportJob>[] = [
    { id: "date", header: "Fecha", sortValue: (j) => j.createdAt, exportValue: (j) => new Date(j.createdAt), exportFormat: "datetime", cell: (j) => formatDateTime(j.createdAt) },
    { id: "file", header: "Archivo", exportValue: (j) => j.fileName, cell: (j) => <span className="flex items-center gap-2 font-medium"><FileSpreadsheet className="h-4 w-4 text-success" />{j.fileName}</span> },
    { id: "kind", header: "Tipo", exportValue: (j) => KIND_LABEL[j.kind], cell: (j) => KIND_LABEL[j.kind] },
    { id: "found", header: "Registros", align: "right", exportValue: (j) => j.summary.found, exportFormat: "integer", cell: (j) => j.summary.found.toLocaleString("es-ES", NUM) },
    { id: "created", header: "Creados", exportValue: (j) => Object.entries(j.summary.created).map(([k, v]) => `${v} ${k}`).join(", "), cell: (j) => <span className="text-fg-2">{Object.entries(j.summary.created).map(([k, v]) => `${v.toLocaleString("es-ES", NUM)} ${k}`).join(" · ") || "—"}</span> },
    { id: "dups", header: "Duplicados", align: "right", exportValue: (j) => j.summary.duplicates, exportFormat: "integer", cell: (j) => j.summary.duplicates },
    { id: "ignored", header: "Ignorados", align: "right", exportValue: (j) => j.summary.ignored, exportFormat: "integer", cell: (j) => j.summary.ignored, defaultHidden: true },
    { id: "amount", header: "Importe", align: "right", exportValue: (j) => (j.summary.totalAmount ?? 0) / 100, exportFormat: "money", cell: (j) => formatMoney(j.summary.totalAmount ?? 0) },
    { id: "user", header: "Usuario", exportValue: (j) => userName(j.createdBy), cell: (j) => userName(j.createdBy) },
    { id: "status", header: "Estado", exportValue: (j) => STATE_LABEL[importState(j)].label, cell: (j) => <ImportStatus job={j} /> },
  ];
  return (
    <Page wide>
      <PageHeader
        title="Importaciones"
        description="Cada importación sabe qué archivo, qué filas y qué registros creó. Se puede revertir mientras sea seguro."
        actions={<Link to="/importaciones/nueva"><Button variant="primary" icon={Upload}>Nueva importación</Button></Link>}
      />
      <DataTable
        rows={[...ws.imports].sort((a, b) => b.createdAt.localeCompare(a.createdAt))}
        columns={columns}
        getRowId={(j) => j.id}
        onRowClick={(j) => navigate(`/importaciones/${j.id}`)}
        exportName="Importaciones"
        exportCompany={ws.organization.name}
        empty={{ icon: Upload, title: "Aún no has importado nada", description: "Empieza por tu Excel de caja anual o por el listado trimestral de facturas.", action: <Link to="/importaciones/nueva"><Button variant="primary" icon={Upload}>Importar archivo</Button></Link> }}
      />
    </Page>
  );
}
