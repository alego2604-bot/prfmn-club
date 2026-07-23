import { Route, createBrowserRouter, createRoutesFromElements } from "react-router-dom";
import { BarChart3, Dumbbell } from "lucide-react";
import { AdminLayout } from "@/layouts/AdminLayout";
import DashboardPage from "@/features/dashboard/DashboardPage";
import ClientsListPage from "@/features/clients/ClientsListPage";
import ClientDetailPage from "@/features/clients/ClientDetailPage";
import LeadsPage from "@/features/leads/LeadsPage";
import BookingsPage from "@/features/bookings/BookingsPage";
import PosPage from "@/features/pos/PosPage";
import ShopPage from "@/features/shop/ShopPage";
import ProductsPage from "@/features/shop/ProductsPage";
import InventoryPage from "@/features/shop/InventoryPage";
import InvoicesPage from "@/features/billing/InvoicesPage";
import PaymentsPage from "@/features/billing/PaymentsPage";
import UnpaidPage from "@/features/billing/UnpaidPage";
import CommunicationsPage from "@/features/communications/CommunicationsPage";
import AutomationsPage from "@/features/automations/AutomationsPage";
import SettingsPage from "@/features/settings/SettingsPage";
import { PlaceholderPage } from "@/features/placeholder/PlaceholderPage";

export const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<AdminLayout />}>
      <Route index element={<DashboardPage />} handle={{ title: "Dashboard" }} />
      <Route path="clientes" element={<ClientsListPage />} handle={{ title: "Clientes" }} />
      <Route path="clientes/:id" element={<ClientDetailPage />} handle={{ title: "Cliente 360" }} />
      <Route path="leads" element={<LeadsPage />} handle={{ title: "Leads / CRM" }} />
      <Route path="reservas" element={<BookingsPage />} handle={{ title: "Reservas" }} />
      <Route path="pos" element={<PosPage />} handle={{ title: "TPV" }} />
      <Route path="tienda" element={<ShopPage />} handle={{ title: "Tienda" }} />
      <Route path="tienda/productos" element={<ProductsPage />} handle={{ title: "Productos" }} />
      <Route path="tienda/inventario" element={<InventoryPage />} handle={{ title: "Inventario" }} />
      <Route path="facturacion" element={<InvoicesPage />} handle={{ title: "Facturas" }} />
      <Route path="facturacion/pagos" element={<PaymentsPage />} handle={{ title: "Pagos" }} />
      <Route path="facturacion/impagados" element={<UnpaidPage />} handle={{ title: "Impagados" }} />
      <Route path="comunicaciones" element={<CommunicationsPage />} handle={{ title: "Comunicaciones" }} />
      <Route path="automatizaciones" element={<AutomationsPage />} handle={{ title: "Automatizaciones" }} />
      <Route
        path="workouts"
        element={
          <PlaceholderPage
            icon={Dumbbell}
            title="Workouts"
            description="Programación y resultados deportivos. Se diseñará tomando como referencia funcional el prototipo existente, fuera de este proyecto."
          />
        }
        handle={{ title: "Workouts" }}
      />
      <Route
        path="informes"
        element={<PlaceholderPage icon={BarChart3} title="Informes" description="Informes y analítica avanzada — roadmap Fase 12." />}
        handle={{ title: "Informes" }}
      />
      <Route path="configuracion" element={<SettingsPage />} handle={{ title: "Configuración" }} />
    </Route>
  )
);
