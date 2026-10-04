import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { SessionProvider, useSession } from "@/app/session";
import { AppShell } from "@/app/AppShell";
import { ALL_ITEMS } from "@/app/nav";
import { ROUTE_PERMISSIONS } from "@/app/routePermissions";
import { ToastProvider, Skeleton } from "@/design-system/components";
import { AuthPage, OnboardingPage } from "@/features/auth/AuthPages";
import { PlannedModulePage } from "@/features/planned/PlannedModulePage";
import type { Permission } from "@/domain/permissions";
import { LogoMark } from "@/app/Logo";

const DashboardPage = lazy(() => import("@/features/dashboard/DashboardPage"));
const PosPage = lazy(() => import("@/features/pos/PosPage"));
const SalesPage = lazy(() => import("@/features/sales/SalesPage"));
const CashPage = lazy(() => import("@/features/cash/CashPage"));
const CatalogPage = lazy(() => import("@/features/catalog/CatalogPage"));
const CustomersPage = lazy(() => import("@/features/customers/CustomersPage"));
const CustomerDetailPage = lazy(() => import("@/features/customers/CustomerDetailPage"));
const InvoicesPage = lazy(() => import("@/features/invoices/InvoicesPage"));
const PaymentsPage = lazy(() => import("@/features/payments/PaymentsPage"));
const ImportsPage = lazy(() => import("@/features/imports/ImportsPage"));
const ImportWizardPage = lazy(() => import("@/features/imports/ImportWizardPage"));
const ImportDetailPage = lazy(() => import("@/features/imports/ImportDetailPage"));
const ReportsPage = lazy(() => import("@/features/reports/ReportsPage"));
const ReportsHubPage = lazy(() => import("@/features/reports/ReportsHubPage"));
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage"));
const FinancePage = lazy(() => import("@/features/finance/FinancePage"));
const CashflowPage = lazy(() => import("@/features/finance/CashflowPage"));
const TaxesPage = lazy(() => import("@/features/finance/TaxesPage"));
const ExpensesPage = lazy(() => import("@/features/expenses/ExpensesPage"));
const SuppliersPage = lazy(() => import("@/features/expenses/SuppliersPage"));
const SupplierDetailPage = lazy(() => import("@/features/expenses/SuppliersPage").then((m) => ({ default: m.SupplierDetailPage })));
const InvoiceEditorPage = lazy(() => import("@/features/invoices/InvoiceEditorPage"));
const InvoiceDetailPage = lazy(() => import("@/features/invoices/InvoiceDetailPage"));
const MembershipsPage = lazy(() => import("@/features/memberships/MembershipsPage"));
const FollowUpPage = lazy(() => import("@/features/tasks/FollowUpPage"));
const OnboardingWizard = lazy(() => import("@/features/onboarding/OnboardingWizard"));

function PageFallback() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-8 sm:px-6 lg:px-8" aria-busy="true" aria-label="Cargando">
      <Skeleton className="h-3.5 w-40" />
      <div className="mt-3 flex items-end justify-between gap-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="hidden h-9 w-64 rounded-lg sm:block" />
      </div>
      <Skeleton className="mt-8 h-24 rounded-xl" />
      <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="hidden h-80 rounded-xl lg:block" />
      </div>
    </div>
  );
}

/** El permiso de cada ruta sale de ROUTE_PERMISSIONS (una sola tabla, comprobada por tests contra la navegación). */
function Guard({ route, perm: explicit, children }: { route?: string; perm?: Permission; children: ReactNode }) {
  const { can } = useSession();
  const perm = (explicit ?? ROUTE_PERMISSIONS[route ?? ""])!;
  if (!can(perm)) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="text-xl font-semibold">Sin acceso</h1>
        <p className="mt-2 text-sm text-fg-3">Tu rol no tiene permiso para ver esta sección ({perm}). Pide acceso a un administrador.</p>
      </div>
    );
  }
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}

const planned = ALL_ITEMS.filter((i) => i.status === "PLANNED" || i.status === "DESIGNED");

function Root() {
  const s = useSession();
  if (s.status === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4" role="status">
        <LogoMark size={36} className="animate-pulse" />
        <p className="text-sm text-fg-3">Abriendo Business OS…</p>
      </div>
    );
  }
  if (s.status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <LogoMark size={36} className="mx-auto" />
          <h1 className="mt-6 text-lg font-semibold tracking-tight">No hemos podido cargar tu empresa</h1>
          <p className="mt-2 text-sm text-fg-3">Comprueba la conexión a internet. Tus datos están a salvo en el servidor.</p>
          <button type="button" onClick={s.retryBoot} className="mt-6 h-10 rounded-md bg-ink px-4 text-sm font-medium text-fg-inverse">Reintentar</button>
          {s.bootError && <details className="mt-4 text-left text-xs text-fg-3"><summary className="cursor-pointer">Detalles técnicos</summary><p className="mt-2 break-words font-mono">{s.bootError}</p></details>}
        </div>
      </div>
    );
  }
  if (s.status === "anon") return <AuthPage />;
  if (s.status === "no-org") return <OnboardingPage />;
  // Transición (cambio de empresa / cierre de sesión): nunca renderizar la app sin empresa cargada
  if (!s.store.getWorkspace()) return <div className="flex min-h-screen flex-col items-center justify-center gap-4" role="status"><LogoMark size={36} className="animate-pulse" /><p className="text-sm text-fg-3">Cargando tu empresa…</p></div>;
  return <AppShell />;
}

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { index: true, element: <Guard route="/"><DashboardPage /></Guard> },
      { path: "caja", element: <Guard route="/caja"><PosPage /></Guard> },
      { path: "ventas", element: <Guard route="/ventas"><SalesPage /></Guard> },
      { path: "cierres", element: <Guard route="/cierres"><CashPage /></Guard> },
      { path: "catalogo", element: <Guard route="/catalogo"><CatalogPage /></Guard> },
      { path: "clientes", element: <Guard route="/clientes"><CustomersPage /></Guard> },
      { path: "clientes/:id", element: <Guard route="/clientes/:id"><CustomerDetailPage /></Guard> },
      { path: "membresias", element: <Guard route="/membresias"><MembershipsPage /></Guard> },
      { path: "bienvenida", element: <Guard route="/bienvenida"><OnboardingWizard /></Guard> },
      { path: "seguimiento", element: <Guard route="/seguimiento"><FollowUpPage /></Guard> },
      { path: "finanzas", element: <Guard route="/finanzas"><FinancePage /></Guard> },
      { path: "flujo-de-caja", element: <Guard route="/flujo-de-caja"><CashflowPage /></Guard> },
      { path: "impuestos", element: <Guard route="/impuestos"><TaxesPage /></Guard> },
      { path: "gastos", element: <Guard route="/gastos"><ExpensesPage /></Guard> },
      { path: "proveedores", element: <Guard route="/proveedores"><SuppliersPage /></Guard> },
      { path: "proveedores/:id", element: <Guard route="/proveedores/:id"><SupplierDetailPage /></Guard> },
      { path: "facturas", element: <Guard route="/facturas"><InvoicesPage /></Guard> },
      { path: "facturas/nueva", element: <Guard route="/facturas/nueva"><InvoiceEditorPage /></Guard> },
      { path: "facturas/:id", element: <Guard route="/facturas/:id"><InvoiceDetailPage /></Guard> },
      { path: "facturas/:id/editar", element: <Guard route="/facturas/:id/editar"><InvoiceEditorPage /></Guard> },
      { path: "pagos", element: <Guard route="/pagos"><PaymentsPage /></Guard> },
      { path: "importaciones", element: <Guard route="/importaciones"><ImportsPage /></Guard> },
      { path: "importaciones/nueva", element: <Guard route="/importaciones/nueva"><ImportWizardPage /></Guard> },
      { path: "importaciones/:id", element: <Guard route="/importaciones/:id"><ImportDetailPage /></Guard> },
      { path: "informes", element: <Guard route="/informes"><ReportsHubPage /></Guard> },
      { path: "informes/gestoria", element: <Guard route="/informes/gestoria"><ReportsPage /></Guard> },
      { path: "informes/:key", element: <Guard route="/informes/:key"><ReportsHubPage /></Guard> },
      { path: "ajustes", element: <Guard route="/ajustes"><SettingsPage /></Guard> },
      ...planned.map((item) => ({ path: item.to.slice(1), element: item.perm ? <Guard perm={item.perm}><PlannedModulePage item={item} /></Guard> : <PlannedModulePage item={item} /> })),
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
], { basename: import.meta.env.BASE_URL.replace(/\/$/, "") || "/" });

export default function App() {
  return (
    <ToastProvider>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </ToastProvider>
  );
}
