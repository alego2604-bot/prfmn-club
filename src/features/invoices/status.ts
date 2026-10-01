import type { InvoiceStatus } from "@/domain/types";

export const INVOICE_STATUS: Record<InvoiceStatus, { label: string; tone: "success" | "warning" | "neutral" | "danger" | "accent" }> = {
  draft: { label: "Borrador", tone: "neutral" },
  issued: { label: "Pendiente", tone: "warning" },
  partially_paid: { label: "Parcial", tone: "warning" },
  paid: { label: "Cobrada", tone: "success" },
  void: { label: "Anulada", tone: "danger" },
};
