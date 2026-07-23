// Derivaciones compartidas sobre datos de cliente, usadas por ClientsListPage,
// ClientDetailPage y Dashboard. Centralizadas para que "qué cuenta como impago"
// o "qué cuenta como cliente nuevo" no diverjan entre pantallas.
import { PAYMENTS } from "@/mocks/invoices";
import { daysAgo } from "./utils";
import type { Client } from "./types";

export type PaymentStatusTone = "success" | "danger" | "neutral";

export function hasFailedPayment(clientId: string): boolean {
  return PAYMENTS.some((p) => p.clientId === clientId && p.status === "failed");
}

export function paymentStatusLabel(clientId: string): { label: string; tone: PaymentStatusTone } {
  const clientPayments = PAYMENTS.filter((p) => p.clientId === clientId);
  if (clientPayments.some((p) => p.status === "failed")) return { label: "Rechazado", tone: "danger" };
  if (clientPayments.length === 0) return { label: "Sin cobros", tone: "neutral" };
  return { label: "Al día", tone: "success" };
}

export function isNewClient(client: Client): boolean {
  return daysAgo(client.joinedAt) <= 30;
}
