import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { SessionProvider, useSession } from "@/app/session";
import { AppShell } from "@/app/AppShell";
import { ALL_ITEMS } from "@/app/nav";
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
const SettingsPage = lazy(() => import("@/features/settings/SettingsPage"));
const FinancePage = lazy(() => import("@/features/finance/FinancePage"));
const CashflowPage = lazy(() => import("@/features/finance/CashflowPage"));
const TaxesPage = lazy(() => import("@/features/finance/TaxesPage"));
const ExpensesPage = lazy(() => import("@/features/expenses/ExpensesPage"));
const SuppliersPage = lazy(() => import("@/features/expenses/SuppliersPage"));
const SupplierDetailPage = lazy(() => import("@/features/expenses/SuppliersPage").then((m) => ({ default: m.SupplierDetailPage })));
const InvoiceEditorPage = lazy(() => import("@/features/invoices/InvoiceEditorPage"));
const InvoiceDetailPage = lazy(() => import("@/features/invoices/InvoiceDetailPage"));

function PageFallback() {
  return (
    <div className="mx-auto max-w-[1280px] px-4 pt-8 sm:px-6 lg:px-8">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="mt-3 h-4 w-80" />
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
      </div>
      <Skeleton className="mt-6 h-72 rounded-lg" />
    </div>
  );
}

function Guard({ perm, children }: { perm: Permission; children: ReactNode }) {
  const { can } = useSession();
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
      <div className="flex min-h-screen items-center justify-center">
        <LogoMark size={36} className="animate-pulse" />
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
          <button onClick={s.retryBoot} className="mt-6 h-10 rounded-md bg-ink px-4 text-sm font-medium text-fg-inverse">Reintentar</button>
          {s.bootError && <details className="mt-4 text-left text-xs text-fg-3"><summary className="cursor-pointer">Detalles técnicos</summary><p className="mt-2 break-words font-mono">{s.bootError}</p></details>}
        </div>
      </div>
    );
  }
  if (s.status === "anon") return <AuthPage />;
  if (s.status === "no-org") return <OnboardingPage />;
  // Transición (cambio de empresa / cierre de sesión): nunca renderizar la app sin empresa cargada
  if (!s.store.getWorkspace()) return <div className="flex min-h-screen items-center justify-center"><LogoMark size={36} className="animate-pulse" /></div>;
  return <AppShell />;
}

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { index: true, element: <Guard perm="dashboard.view"><DashboardPage /></Guard> },
      { path: "caja", element: <Guard perm="pos.sell"><PosPage /></Guard> },
      { path: "ventas", element: <Guard perm="sales.view"><SalesPage /></Guard> },
      { path: "cierres", element: <Guard perm="sales.view"><CashPage /></Guard> },
      { path: "catalogo", element: <Guard perm="catalog.view"><CatalogPage /></Guard> },
      { path: "clientes", element: <Guard perm="customers.view"><CustomersPage /></Guard> },
      { path: "clientes/:id", element: <Guard perm="customers.view"><CustomerDetailPage /></Guard> },
      { path: "finanzas", element: <Guard perm="finance.view"><FinancePage /></Guard> },
      { path: "flujo-de-caja", element: <Guard perm="finance.view"><CashflowPage /></Guard> },
      { path: "impuestos", element: <Guard perm="finance.view"><TaxesPage /></Guard> },
      { path: "gastos", element: <Guard perm="finance.view"><ExpensesPage /></Guard> },
      { path: "proveedores", element: <Guard perm="finance.view"><SuppliersPage /></Guard> },
      { path: "proveedores/:id", element: <Guard perm="finance.view"><SupplierDetailPage /></Guard> },
      { path: "facturas", element: <Guard perm="finance.view"><InvoicesPage /></Guard> },
      { path: "facturas/nueva", element: <Guard perm="invoices.manage"><InvoiceEditorPage /></Guard> },
      { path: "facturas/:id", element: <Guard perm="finance.view"><InvoiceDetailPage /></Guard> },
      { path: "facturas/:id/editar", element: <Guard perm="invoices.manage"><InvoiceEditorPage /></Guard> },
      { path: "pagos", element: <Guard perm="finance.view"><PaymentsPage /></Guard> },
      { path: "importaciones", element: <Guard perm="imports.run"><ImportsPage /></Guard> },
      { path: "importaciones/nueva", element: <Guard perm="imports.run"><ImportWizardPage /></Guard> },
      { path: "importaciones/:id", element: <Guard perm="imports.run"><ImportDetailPage /></Guard> },
      { path: "informes", element: <Guard perm="analytics.view"><ReportsPage /></Guard> },
      { path: "ajustes", element: <Guard perm="dashboard.view"><SettingsPage /></Guard> },
      ...planned.map((item) => ({ path: item.to.slice(1), element: <PlannedModulePage item={item} /> })),
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

export default function App() {
  return (
    <ToastProvider>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </ToastProvider>
  );
}
