import {
  LayoutDashboard,
  Users,
  Target,
  CalendarDays,
  ShoppingCart,
  Store,
  Receipt,
  MessageSquare,
  Zap,
  BarChart3,
  Settings,
  Dumbbell,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

export const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/clientes", label: "Clientes", icon: Users },
  { to: "/leads", label: "Leads", icon: Target },
  { to: "/reservas", label: "Reservas", icon: CalendarDays },
  { to: "/pos", label: "TPV", icon: ShoppingCart },
  { to: "/tienda", label: "Tienda", icon: Store },
  { to: "/facturacion", label: "Facturación", icon: Receipt },
  { to: "/comunicaciones", label: "Comunicaciones", icon: MessageSquare },
  { to: "/automatizaciones", label: "Automatizaciones", icon: Zap },
  { to: "/workouts", label: "Workouts", icon: Dumbbell },
  { to: "/informes", label: "Informes", icon: BarChart3 },
  { to: "/configuracion", label: "Configuración", icon: Settings },
];
