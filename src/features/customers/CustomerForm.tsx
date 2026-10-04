import { useState } from "react";
import { useCtx } from "@/app/session";
import { Button, Field, Input, Modal, Select, useToast, DateInput } from "@/design-system/components";
import { createCustomer, updateCustomer, type CustomerInput } from "@/data/repos/customers";
import type { Customer, CustomerStatus } from "@/domain/types";
import { classifyTaxId } from "@/lib/taxid";

export const CUSTOMER_STATUS: Record<CustomerStatus, { label: string; tone: "success" | "neutral" | "warning" | "danger" | "accent" }> = {
  lead: { label: "Lead", tone: "accent" },
  active: { label: "Activo", tone: "success" },
  inactive: { label: "Inactivo", tone: "warning" },
  cancelled: { label: "Baja", tone: "neutral" },
  blocked: { label: "Bloqueado", tone: "danger" },
};

export function CustomerForm({ customer, onClose, onSaved }: { customer?: Customer; onClose: () => void; onSaved?: (c: Customer) => void }) {
  const ctx = useCtx();
  const toast = useToast();
  const [f, setF] = useState<CustomerInput>(() => ({
    firstName: customer?.firstName ?? "", lastName: customer?.lastName ?? "", taxId: customer?.taxId ?? "", email: customer?.email ?? "", phone: customer?.phone ?? "",
    birthDate: customer?.birthDate ?? "", address: customer?.address ?? "", postalCode: customer?.postalCode ?? "", city: customer?.city ?? "",
    companyName: customer?.companyName ?? "", status: customer?.status ?? "active", source: customer?.source ?? "", joinedAt: customer?.joinedAt ?? "", leftAt: customer?.leftAt ?? "",
  }));
  const tax = classifyTaxId(f.taxId);
  const set = (k: keyof CustomerInput) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = () => {
    try {
      const c = customer ? updateCustomer(ctx, customer.id, f) : createCustomer(ctx, f);
      toast.success(customer ? "Cliente actualizado" : "Cliente creado");
      if (onSaved) onSaved(c);
      else onClose();
    } catch (e) {
      toast.fromError(e);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={customer ? "Editar cliente" : "Nuevo cliente"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" onClick={save} disabled={!f.firstName.trim()}>Guardar</Button></>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" required><Input autoFocus value={f.firstName} onChange={set("firstName")} /></Field>
        <Field label="Apellidos"><Input value={f.lastName} onChange={set("lastName")} /></Field>
        <Field
          label="DNI / NIF / NIE"
          error={tax.kind === "invalid" ? "No es un DNI/NIE/CIF válido (letra de control o formato)" : null}
          hint={tax.kind === "foreign" ? "Documento extranjero" : tax.valid ? `${tax.kind.toUpperCase()} válido` : undefined}
        >
          <Input value={f.taxId} onChange={set("taxId")} invalid={tax.kind === "invalid"} />
        </Field>
        <Field label="Estado">
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as CustomerStatus })}>
            {Object.entries(CUSTOMER_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Teléfono"><Input type="tel" value={f.phone} onChange={set("phone")} placeholder="+34 600 000 000" /></Field>
        <Field label="Fecha de nacimiento"><DateInput value={f.birthDate} onChange={set("birthDate")} /></Field>
        <Field label="Empresa"><Input value={f.companyName} onChange={set("companyName")} placeholder="Opcional" /></Field>
        <Field label="Dirección" className="sm:col-span-2"><Input value={f.address} onChange={set("address")} /></Field>
        <Field label="Código postal"><Input value={f.postalCode} onChange={set("postalCode")} /></Field>
        <Field label="Ciudad"><Input value={f.city} onChange={set("city")} /></Field>
        <Field label="Fecha de alta"><DateInput value={f.joinedAt} onChange={set("joinedAt")} /></Field>
        <Field label="Fecha de baja"><DateInput value={f.leftAt} onChange={set("leftAt")} /></Field>
      </div>
    </Modal>
  );
}

/** Origen del cliente (cómo nos conoció): valores guardados → texto para el usuario. Sin traducir nunca claves internas. */
export const CUSTOMER_SOURCE: Record<string, string> = {
  walk_in: "Vino al centro",
  instagram: "Instagram",
  referral: "Recomendación",
  google: "Google",
  web: "Web",
  import: "Importación",
  pos: "Caja",
};
export const sourceLabel = (s?: string) => (s ? CUSTOMER_SOURCE[s] ?? s.replace(/_/g, " ") : "—");
