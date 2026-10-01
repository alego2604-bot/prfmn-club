import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileX, RotateCcw, ShieldAlert } from "lucide-react";
import { useCtx, useSession, useWorkspace } from "@/app/session";
import { Badge, Button, Callout, DataTable, DescriptionList, EmptyState, Kpi, Page, PageHeader, ReasonDialog, Segmented, useToast, type Column } from "@/design-system/components";
import type { ImportRecordRow } from "@/domain/types";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { revertBlockers, revertImport } from "./engine/commit";
import { ImportStatus, KIND_LABEL } from "./ImportsPage";

const REC_STATUS = {
  imported: { label: "Importado", tone: "success" as const },
  duplicate: { label: "Duplicado", tone: "info" as const },
  error: { label: "Error", tone: "danger" as const },
  ignored: { label: "Ignorado", tone: "neutral" as const },
};

export default function ImportDetailPage() {
  const { id } = useParams();
  const ws = useWorkspace();
  const ctx = useCtx();
  const { can, store } = useSession();
  const toast = useToast();
  const [reverting, setReverting] = useState(false);
  const [filter, setFilter] = useState<"all" | ImportRecordRow["status"]>("all");
  const job = ws.imports.find((i) => i.id === id);
  if (!job) return <Page><EmptyState icon={FileX} title="Importación no encontrada" action={<Link to="/importaciones"><Button>Volver</Button></Link>} /></Page>;
  const records = ws.importRecords.filter((r) => r.importId === job.id);
  const blockers = revertBlockers(ws, job.id);
  const link = (r: ImportRecordRow) =>
    r.entityType === "sales" ? `/ventas?venta=${r.entityId}` : r.entityType === "invoices" ? `/facturas?factura=${r.entityId}` : r.entityType === "products" ? `/catalogo?producto=${r.entityId}` : null;
  const columns: Column<ImportRecordRow>[] = [
    { id: "origin", header: "Origen", sortValue: (r) => `${r.sheet}${String(r.rowNumber).padStart(6, "0")}`, exportValue: (r) => `${r.sheet} fila ${r.rowNumber}`, cell: (r) => <span className="whitespace-nowrap text-fg-2">{r.sheet} · fila {r.rowNumber}</span> },
    { id: "status", header: "Resultado", sortValue: (r) => r.status, exportValue: (r) => REC_STATUS[r.status].label, cell: (r) => <Badge tone={REC_STATUS[r.status].tone}>{REC_STATUS[r.status].label}</Badge> },
    { id: "conf", header: "Confianza", exportValue: (r) => r.confidence ?? "", cell: (r) => <span className="text-fg-3">{r.confidence === "high" ? "Alta" : r.confidence === "medium" ? "Media" : r.confidence === "review" ? "Revisada" : "—"}</span> },
    { id: "msg", header: "Motivos", exportValue: (r) => r.messages.join(" | "), cell: (r) => <span className="line-clamp-2 max-w-[520px] text-xs text-fg-3">{r.messages.join(" · ") || "—"}</span> },
    { id: "entity", header: "Registro", exportValue: (r) => r.entityId ?? "", cell: (r) => { const to = link(r); return to ? <Link to={to} className="text-accent-fg hover:underline">Abrir →</Link> : <span className="text-fg-3">—</span>; } },
  ];
  return (
    <Page wide>
      <Link to="/importaciones" className="mb-4 inline-flex items-center gap-1.5 text-sm text-fg-3 hover:text-fg"><ArrowLeft className="h-4 w-4" />Importaciones</Link>
      <PageHeader
        title={job.fileName}
        description={`${KIND_LABEL[job.kind]} · ${formatDateTime(job.createdAt)} · ${store.getMeta().users.find((u) => u.id === job.createdBy)?.fullName ?? ""}`}
        actions={
          <>
            <ImportStatus job={job} />
            {job.status === "completed" && can("imports.revert") && <Button icon={RotateCcw} onClick={() => setReverting(true)} disabled={blockers.length > 0}>Revertir</Button>}
          </>
        }
      />
      {job.status === "reverted" && <Callout className="mb-4" title="Importación revertida">{formatDateTime(job.revertedAt!)} · «{job.revertReason}». Sus registros siguen en el histórico como anulados.</Callout>}
      {job.status === "completed" && blockers.length > 0 && <Callout tone="warning" icon={ShieldAlert} className="mb-4" title="No se puede revertir de forma segura">{blockers.join(" · ")}</Callout>}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Registros" value={job.summary.found.toLocaleString("es-ES")} />
        <Kpi label="Creados" value={Object.values(job.summary.created).reduce((a, b) => a + b, 0).toLocaleString("es-ES")} hint={Object.entries(job.summary.created).map(([k, v]) => `${v} ${k}`).join(" · ")} />
        <Kpi label="Duplicados" value={job.summary.duplicates.toLocaleString("es-ES")} />
        <Kpi label="Ignorados / errores" value={`${job.summary.ignored} / ${job.summary.errors}`} />
        <Kpi label="Importe" value={formatMoney(job.summary.totalAmount ?? 0)} />
      </div>
      <DescriptionList
        className="mb-6 rounded-lg border border-line bg-surface px-5"
        items={[
          { label: "Archivo original (SHA-256)", value: <span className="font-mono text-xs">{job.fileSha256}</span> },
          { label: "Tamaño", value: `${(job.fileSize / 1024).toFixed(0)} KB` },
          { label: "Centro", value: ws.locations.find((l) => l.id === job.locationId)?.name ?? "—" },
        ]}
      />
      <DataTable
        rows={records.filter((r) => filter === "all" || r.status === filter)}
        columns={columns}
        getRowId={(r) => r.id}
        exportName={`Importacion_${job.fileName}`}
        exportCompany={ws.organization.name}
        searchText={(r) => `${r.sheet} ${r.rowNumber} ${r.messages.join(" ")}`}
        toolbar={<Segmented size="sm" value={filter} onChange={setFilter} items={[{ value: "all", label: "Todos" }, { value: "imported", label: "Importados" }, { value: "duplicate", label: "Duplicados" }, { value: "ignored", label: "Ignorados" }, { value: "error", label: "Errores" }]} />}
        empty={{ icon: FileX, title: "Sin registros" }}
      />
      <ReasonDialog
        open={reverting}
        onClose={() => setReverting(false)}
        danger
        title="Revertir importación"
        description="Nada se borra: las ventas y facturas creadas quedarán anuladas con este motivo, sus cobros compensados, y los productos/clientes creados se archivarán si nadie más los usa."
        confirmLabel="Revertir"
        onConfirm={(r) => { try { revertImport(ctx, job.id, r); toast.success("Importación revertida"); setReverting(false); } catch (e) { toast.fromError(e); } }}
      />
    </Page>
  );
}
