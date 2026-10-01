/**
 * Almacén local por empresa (tenant). Cada empresa es un documento independiente en IndexedDB:
 * es estructuralmente imposible que una consulta lea datos de otra empresa.
 *
 * Todas las escrituras pasan por `store.update(fn)`: la función recibe el workspace actual y
 * devuelve el nuevo. Si lanza, no se aplica nada (atomicidad, p. ej. en importaciones).
 */
import type {
  AuditLog, CashClosing, CashMovement, CashSession, Customer, CustomerNote, ImportJob, ImportRecordRow, Invoice,
  InvoiceItem, Location, Member, MembershipPlan, MembershipPlanVersion, Organization, OrganizationSettings, Payment,
  PaymentMethod, Product, ProductCategory, ProductPrice, Sale, SaleItem, TaxRate, UserAccount,
} from "@/domain/types";
import type { KV } from "./persistence";

export const SCHEMA_VERSION = 1;

export interface Workspace {
  schemaVersion: number;
  organization: Organization;
  settings: OrganizationSettings;
  locations: Location[];
  taxRates: TaxRate[];
  paymentMethods: PaymentMethod[];
  categories: ProductCategory[];
  products: Product[];
  productPrices: ProductPrice[];
  membershipPlans: MembershipPlan[];
  planVersions: MembershipPlanVersion[];
  customers: Customer[];
  customerNotes: CustomerNote[];
  cashSessions: CashSession[];
  cashMovements: CashMovement[];
  cashClosings: CashClosing[];
  sales: Sale[];
  saleItems: SaleItem[];
  payments: Payment[];
  invoices: Invoice[];
  invoiceItems: InvoiceItem[];
  imports: ImportJob[];
  importRecords: ImportRecordRow[];
  auditLogs: AuditLog[];
  counters: Record<string, number>;
}

export interface Meta {
  schemaVersion: number;
  users: UserAccount[];
  members: Member[];
  organizations: { id: string; name: string; isDemo: boolean; vertical: string }[];
}

const META_KEY = "meta";
const wsKey = (orgId: string) => `ws:${orgId}`;

type Listener = () => void;

export class Store {
  private meta: Meta = { schemaVersion: SCHEMA_VERSION, users: [], members: [], organizations: [] };
  private ws: Workspace | null = null;
  private listeners = new Set<Listener>();
  private writing: Promise<void> | null = null;
  private dirty = false;
  version = 0;

  constructor(private kv: KV) {}

  async init(): Promise<void> {
    this.meta = (await this.kv.get<Meta>(META_KEY)) ?? this.meta;
  }

  getMeta(): Meta {
    return this.meta;
  }

  getWorkspace(): Workspace | null {
    return this.ws;
  }

  requireWorkspace(): Workspace {
    if (!this.ws) throw new Error("No hay empresa activa");
    return this.ws;
  }

  async openWorkspace(orgId: string): Promise<Workspace> {
    const ws = await this.kv.get<Workspace>(wsKey(orgId));
    if (!ws) throw new Error("Empresa no encontrada en este dispositivo");
    this.ws = ws;
    this.emit();
    return ws;
  }

  closeWorkspace(): void {
    this.ws = null;
    this.emit();
  }

  async createWorkspace(ws: Workspace): Promise<void> {
    await this.kv.set(wsKey(ws.organization.id), ws);
  }

  async deleteWorkspace(orgId: string): Promise<void> {
    await this.kv.del(wsKey(orgId));
  }

  async updateMeta(fn: (m: Meta) => Meta): Promise<void> {
    this.meta = fn(this.meta);
    await this.kv.set(META_KEY, this.meta);
    this.emit();
  }

  /** Escritura atómica sobre el workspace activo. */
  update(fn: (ws: Workspace) => Workspace): Workspace {
    const current = this.requireWorkspace();
    const next = fn(current);
    if (next.organization.id !== current.organization.id) throw new Error("Cambio de empresa no permitido");
    this.ws = next;
    this.scheduleSave();
    this.emit();
    return next;
  }

  /** Espera a que lo pendiente esté en disco (p. ej. tras una importación). */
  async flush(): Promise<void> {
    while (this.writing) await this.writing;
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getVersion = (): number => this.version;

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  /**
   * Guardado inmediato tras cada escritura (sin temporizador: una venta no puede perderse por cerrar la pestaña).
   * Si ya hay una escritura en curso, se marca como pendiente y se vuelve a guardar el último estado al terminar.
   */
  private scheduleSave() {
    this.dirty = true;
    if (this.writing) return;
    this.writing = (async () => {
      try {
        while (this.dirty) {
          this.dirty = false;
          const ws = this.ws;
          if (ws) await this.kv.set(wsKey(ws.organization.id), ws);
        }
      } finally {
        this.writing = null;
      }
    })();
  }

  async exportWorkspaceJson(): Promise<string> {
    await this.flush();
    return JSON.stringify(this.requireWorkspace(), null, 2);
  }
}
