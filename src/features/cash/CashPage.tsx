import { useMemo, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Calculator, CheckCircle2, History, Lock, RotateCcw, Unlock, Wallet, XCircle } from "lucide-react";
import { useCtx, useLocationScope, useSession, useWorkspace, usePersonName } from "@/app/session";
import {
  Badge, Button, Card, CardHeader, DataTable, DescriptionList, Drawer, Field, Input, Modal, MoneyInput, Page, PageHeader, ReasonDialog,
  Segmented, Textarea, useToast, type Column,
} from "@/design-system/components";
import { addCashMovement, closeCashSession, openCashSession, reopenCashSession, sessionSummary } from "@/data/repos/cash";
import { closingStatus, countDenominations, EURO_DENOMINATIONS } from "@/domain/cash";
import type { CashClosing, CashSession, Location } from "@/domain/types";
import { formatDateTime, formatTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/cn";

export default function CashPage() {
  const ws = useWorkspace();
  const { locations, filterId } = useLocationScope();
  const [selected, setSelected] = useState<CashClosing | null>(null);
  const shown = filterId ? locations.filter((l) => l.id === filterId) : locations;
  const userName = useUserNames();
  const methodName = new Map(ws.paymentMethods.map((m) => [m.key, m.name]));

  const closings = useMemo(
    () =>
      ws.cashClosings
        .filter((c) => {
          const s = ws.cashSessions.find((x) => x.id === c.cashSessionId);
          return s && shown.some((l) => l.id === s.locationId);
        })
        .sort((a, b) => b.closedAt.localeCompare(a.closedAt)),
    [ws.cashClosings, ws.cashSessions, shown],
  );
  const locOf = (c: CashClosing) => ws.locations.find((l) => l.id === ws.cashSessions.find((s) => s.id === c.cashSessionId)?.locationId)?.name ?? "";

  const columns: Column<CashClosing>[] = [
    { id: "date", header: "Cierre", cell: (c) => formatDateTime(c.closedAt), sortValue: (c) => c.closedAt, exportValue: (c) => new Date(c.closedAt), exportFormat: "datetime" },
    { id: "loc", header: "Centro", cell: locOf, exportValue: locOf, defaultHidden: ws.locations.length < 2 },
    { id: "by", header: "Cerrado por", cell: (c) => userName(c.closedBy), exportValue: (c) => userName(c.closedBy) },
    { id: "sales", header: "Ventas", align: "right", cell: (c) => `${c.salesCount} · ${formatMoney(c.salesTotal)}`, sortValue: (c) => c.salesTotal, exportValue: (c) => c.salesTotal / 100, exportFormat: "money" },
    { id: "card", header: "Tarjeta", align: "right", cell: (c) => formatMoney(c.totalsByMethod.card ?? 0), exportValue: (c) => (c.totalsByMethod.card ?? 0) / 100, exportFormat: "money", defaultHidden: true },
    { id: "expected", header: "Efectivo esperado", align: "right", cell: (c) => formatMoney(c.expectedCash), exportValue: (c) => c.expectedCash / 100, exportFormat: "money" },
    { id: "counted", header: "Contado", align: "right", cell: (c) => formatMoney(c.countedCash), exportValue: (c) => c.countedCash / 100, exportFormat: "money" },
    { id: "diff", header: "Diferencia", align: "right", sortValue: (c) => c.difference, exportValue: (c) => c.difference / 100, exportFormat: "money", cell: (c) => <span className={cn("font-medium", c.difference < 0 ? "text-danger-fg" : c.difference > 0 ? "text-warning-fg" : "text-success-fg")}>{c.difference > 0 ? "+" : ""}{formatMoney(c.difference)}</span> },
    {
      id: "status", header: "Estado", exportValue: (c) => (c.supersededAt ? "Reabierta" : c.status === "balanced" ? "Cuadrada" : "Descuadre"),
      cell: (c) => (c.supersededAt ? <Badge>Reabierta · v{c.version}</Badge> : c.status === "balanced" ? <Badge tone="success" dot>Cuadrada</Badge> : <Badge tone="danger" dot>Descuadre</Badge>),
    },
  ];

  return (
    <Page wide>
      <PageHeader title="Cierres de caja" description="Abre el turno, registra entradas y salidas de efectivo y cierra con arqueo. El sistema calcula lo esperado por método de pago." />
      <div className="grid gap-4 xl:grid-cols-2">
        {shown.map((l) => <LocationCash key={l.id} location={l} />)}
      </div>
      <div className="mt-10">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold tracking-tight"><History className="h-4 w-4 text-fg-3" />Historial de cierres</h2>
        <DataTable
          rows={closings}
          columns={columns}
          getRowId={(c) => c.id}
          onRowClick={setSelected}
          exportName="Cierres_de_caja"
          exportCompany={ws.organization.name}
          storageKey="closings"
          empty={{ icon: Wallet, title: "Aún no hay cierres", description: "Cuando cierres la caja, el arqueo quedará aquí con su diferencia y observaciones." }}
        />
      </div>
      {selected && (
        <ClosingDrawer closing={selected} onClose={() => setSelected(null)} methodName={(k) => methodName.get(k) ?? k} userName={userName} location={locOf(selected)} />
      )}
    </Page>
  );
}

function useUserNames() {
  return usePersonName();
}

function LocationCash({ location }: { location: Location }) {
  const ws = useWorkspace();
  const ctx = useCtx();
  const { can } = useSession();
  const toast = useToast();
  const userName = useUserNames();
  const session = ws.cashSessions.find((s) => s.locationId === location.id && s.status === "open");
  const [float, setFloat] = useState<number | null>(0);
  const [closing, setClosing] = useState(false);
  const [movement, setMovement] = useState<"cash_in" | "cash_out" | null>(null);

  if (!session) {
    return (
      <Card>
        <CardHeader title={location.name} description="Caja cerrada" action={<Badge dot>Cerrada</Badge>} />
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Fondo de caja inicial" hint="El efectivo con el que empiezas el turno.">
            <MoneyInput value={float} onChange={setFloat} className="w-40" />
          </Field>
          <Button
            variant="primary"
            icon={Unlock}
            disabled={!can("cash.operate") || float === null}
            onClick={() => {
              try {
                openCashSession(ctx, location.id, float ?? 0);
                toast.success(`Caja de ${location.name} abierta`);
              } catch (e) {
                toast.fromError(e);
              }
            }}
          >
            Abrir caja
          </Button>
        </div>
      </Card>
    );
  }

  const sum = sessionSummary(ws, session);
  const methods = ws.paymentMethods.filter((m) => sum.totalsByMethod[m.key]);
  return (
    <Card padded={false}>
      <div className="flex items-start justify-between gap-3 p-5">
        <div>
          <h3 className="text-md font-semibold">{location.name}</h3>
          <p className="text-sm text-fg-3">Abierta {formatDateTime(session.openedAt)} por {userName(session.openedBy)}</p>
        </div>
        <Badge tone="success" dot>Abierta</Badge>
      </div>
      <div className="grid grid-cols-2 gap-px border-y border-line bg-line sm:grid-cols-4">
        {[
          ["Ventas", `${sum.salesCount}`],
          ["Total turno", formatMoney(sum.salesTotal)],
          ["Fondo inicial", formatMoney(sum.openingFloat)],
          ["Efectivo esperado", formatMoney(sum.expectedCash)],
        ].map(([l, v]) => (
          <div key={l} className="min-w-0 bg-surface px-4 py-3">
            <p className="truncate text-xs text-fg-3" title={l}>{l}</p>
            <p className="mt-0.5 text-lg font-semibold num">{v}</p>
          </div>
        ))}
      </div>
      <div className="p-5">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-3">Por método de pago</p>
        {methods.length ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
            {methods.map((m) => (
              <div key={m.id} className="flex justify-between"><span className="text-fg-2">{m.name}</span><span className="font-medium num">{formatMoney(sum.totalsByMethod[m.key]!)}</span></div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-fg-3">Sin cobros en este turno todavía.</p>
        )}
        {(sum.cashIn > 0 || sum.cashOut > 0) && (
          <p className="mt-3 text-xs text-fg-3 num">Entradas {formatMoney(sum.cashIn)} · Salidas {formatMoney(sum.cashOut)}</p>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button icon={ArrowDownLeft} disabled={!can("cash.operate")} onClick={() => setMovement("cash_in")}>Entrada</Button>
          <Button icon={ArrowUpRight} disabled={!can("cash.operate")} onClick={() => setMovement("cash_out")}>Salida</Button>
          <Button variant="primary" icon={Lock} className="ml-auto" disabled={!can("cash.operate")} onClick={() => setClosing(true)}>Cerrar caja</Button>
        </div>
      </div>
      {closing && <CloseDialog session={session} expected={sum.expectedCash} totals={sum.totalsByMethod} salesTotal={sum.salesTotal} onClose={() => setClosing(false)} />}
      {movement && <MovementDialog sessionId={session.id} kind={movement} onClose={() => setMovement(null)} />}
    </Card>
  );
}

function MovementDialog({ sessionId, kind, onClose }: { sessionId: string; kind: "cash_in" | "cash_out"; onClose: () => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={kind === "cash_in" ? "Entrada de efectivo" : "Salida de efectivo"}
      description={kind === "cash_in" ? "Cambio añadido al cajón, por ejemplo." : "Pago en efectivo a un proveedor, retirada a banco…"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            disabled={!amount || !reason.trim()}
            onClick={() => {
              try {
                addCashMovement(ctx, sessionId, kind, amount ?? 0, reason);
                toast.success("Movimiento registrado");
                onClose();
              } catch (e) {
                toast.fromError(e);
              }
            }}
          >
            Registrar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Importe"><MoneyInput autoFocus value={amount} onChange={setAmount} /></Field>
        <Field label="Motivo" required><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === "cash_in" ? "Cambio" : "Compra de hielo"} /></Field>
      </div>
    </Modal>
  );
}

function CloseDialog({ session, expected, totals, salesTotal, onClose }: { session: CashSession; expected: number; totals: Record<string, number>; salesTotal: number; onClose: () => void }) {
  const ctx = useCtx();
  const ws = useWorkspace();
  const toast = useToast();
  const [mode, setMode] = useState<"amount" | "count">("amount");
  const [counted, setCounted] = useState<number | null>(null);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [notes, setNotes] = useState("");
  const value = mode === "count" ? countDenominations(counts) : counted;
  const status = value !== null ? closingStatus(expected, value) : null;
  return (
    <Modal
      open
      onClose={onClose}
      title="Cerrar caja"
      description={`Turno abierto a las ${formatTime(session.openedAt)} · ventas ${formatMoney(salesTotal)}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            icon={Lock}
            disabled={value === null || (status?.status === "discrepancy" && !notes.trim())}
            onClick={() => {
              try {
                const c = closeCashSession(ctx, session.id, value ?? 0, notes);
                if (c.status === "balanced") toast.success("Caja cuadrada", "Cierre guardado.");
                else toast.warning(`Cierre con descuadre de ${formatMoney(c.difference)}`, "Queda registrado con tu observación.");
                onClose();
              } catch (e) {
                toast.fromError(e);
              }
            }}
          >
            Confirmar cierre
          </Button>
        </>
      }
    >
      <div className="mb-5 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        {ws.paymentMethods.filter((m) => totals[m.key]).map((m) => (
          <div key={m.id} className="rounded-md bg-surface-2 px-3 py-2">
            <p className="text-xs text-fg-3">{m.name}</p>
            <p className="font-semibold num">{formatMoney(totals[m.key]!)}</p>
          </div>
        ))}
      </div>
      <Segmented value={mode} onChange={setMode} items={[{ value: "amount", label: "Importe total" }, { value: "count", label: "Contar billetes y monedas" }]} size="sm" className="mb-4" />
      {mode === "amount" ? (
        <Field label="Efectivo contado en el cajón"><MoneyInput autoFocus value={counted} onChange={setCounted} className="max-w-[220px]" /></Field>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {EURO_DENOMINATIONS.map((d) => (
            <label key={d} className="flex flex-col gap-1 rounded-md border border-line p-2">
              <span className="text-xs text-fg-3 num">{d >= 100 ? `${d / 100} €` : `${d} c`}</span>
              <Input type="number" min={0} inputMode="numeric" className="h-8 num" value={counts[d] ?? ""} onChange={(e) => setCounts({ ...counts, [d]: Math.max(0, Number(e.target.value) || 0) })} />
            </label>
          ))}
        </div>
      )}

      <div className="mt-5 grid grid-cols-3 overflow-hidden rounded-lg border border-line text-center">
        <div className="p-3"><p className="text-xs text-fg-3">Esperado</p><p className="text-lg font-semibold num">{formatMoney(expected)}</p></div>
        <div className="border-x border-line p-3"><p className="text-xs text-fg-3">Real</p><p className="text-lg font-semibold num">{value === null ? "—" : formatMoney(value)}</p></div>
        <div className="p-3"><p className="text-xs text-fg-3">Diferencia</p><p className={cn("text-lg font-semibold num", status && status.difference !== 0 && (status.difference < 0 ? "text-danger-fg" : "text-warning-fg"))}>{status ? `${status.difference > 0 ? "+" : ""}${formatMoney(status.difference)}` : "—"}</p></div>
      </div>
      {status && (
        <div className={cn("mt-3 flex items-center justify-center gap-2 rounded-lg py-3 text-md font-semibold", status.status === "balanced" ? "bg-success-soft text-success-fg" : "bg-danger-soft text-danger-fg")}>
          {status.status === "balanced" ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
          {status.status === "balanced" ? "CAJA CUADRADA" : "DESCUADRE"}
        </div>
      )}
      <Field label="Observaciones" required={status?.status === "discrepancy"} className="mt-4" hint={status?.status === "discrepancy" ? "Obligatorio cuando hay descuadre." : undefined}>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: faltan 2 € por un cambio mal dado" />
      </Field>
    </Modal>
  );
}

function ClosingDrawer({ closing, onClose, methodName, userName, location }: { closing: CashClosing; onClose: () => void; methodName: (k: string) => string; userName: (id?: string) => string; location: string }) {
  const ctx = useCtx();
  const { can } = useSession();
  const toast = useToast();
  const [reopen, setReopen] = useState(false);
  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={`Cierre · ${location}`}
        subtitle={`${formatDateTime(closing.closedAt)} · versión ${closing.version}`}
        footer={!closing.supersededAt && can("cash.reopen") ? <Button icon={RotateCcw} onClick={() => setReopen(true)}>Reabrir caja</Button> : undefined}
      >
        <div className={cn("mb-5 flex items-center gap-2 rounded-lg px-4 py-3 font-semibold", closing.supersededAt ? "bg-surface-sunken text-fg-2" : closing.status === "balanced" ? "bg-success-soft text-success-fg" : "bg-danger-soft text-danger-fg")}>
          {closing.status === "balanced" ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
          {closing.status === "balanced" ? "Caja cuadrada" : `Descuadre de ${formatMoney(closing.difference)}`}
          {closing.supersededAt && <span className="ml-auto text-xs font-normal">Reabierta</span>}
        </div>
        <DescriptionList
          items={[
            { label: "Cerrado por", value: userName(closing.closedBy) },
            { label: "Ventas", value: `${closing.salesCount} · ${formatMoney(closing.salesTotal)}` },
            ...Object.entries(closing.totalsByMethod).map(([k, v]) => ({ label: methodName(k), value: formatMoney(v) })),
            { label: "Fondo inicial", value: formatMoney(closing.openingFloat) },
            { label: "Entradas / salidas", value: `${formatMoney(closing.cashIn)} / ${formatMoney(closing.cashOut)}` },
            { label: "Efectivo esperado", value: formatMoney(closing.expectedCash) },
            { label: "Efectivo contado", value: formatMoney(closing.countedCash) },
            { label: "Observaciones", value: closing.notes ?? "—" },
            ...(closing.supersededAt ? [{ label: "Reabierta", value: `${formatDateTime(closing.supersededAt)} por ${userName(closing.supersededBy)} · «${closing.reopenReason}»` }] : []),
          ]}
        />
        <p className="mt-6 flex items-start gap-2 text-xs text-fg-3"><Calculator className="mt-0.5 h-3.5 w-3.5" />Esperado = fondo inicial + cobros en efectivo − devoluciones en efectivo + entradas − salidas. Las ventas anuladas no cuentan.</p>
      </Drawer>
      <ReasonDialog
        open={reopen}
        onClose={() => setReopen(false)}
        title="Reabrir caja"
        description="El cierre actual no se borra: quedará marcado como reemplazado y al volver a cerrar se creará una nueva versión."
        confirmLabel="Reabrir"
        onConfirm={(reason) => {
          try {
            reopenCashSession(ctx, closing.cashSessionId, reason);
            toast.success("Caja reabierta");
            setReopen(false);
            onClose();
          } catch (e) {
            toast.fromError(e);
          }
        }}
      />
    </>
  );
}

