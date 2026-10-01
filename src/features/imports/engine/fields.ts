import type { FieldDef, TargetKind } from "./types";

/** Sinónimos normalizados (minúsculas, sin acentos ni signos). Ampliables sin tocar la lógica. */
export const SALES_FIELDS: FieldDef[] = [
  { key: "date", label: "Fecha", type: "date", required: true, synonyms: ["fecha", "dia", "date", "fecha venta", "fecha hora", "fecha y hora"] },
  { key: "time", label: "Hora", type: "text", required: false, synonyms: ["hora", "time"] },
  { key: "product", label: "Producto", type: "text", required: true, synonyms: ["producto", "articulo", "product", "concepto", "item", "descripcion"] },
  { key: "category", label: "Categoría", type: "text", required: false, synonyms: ["categoria", "category", "familia", "tipo"] },
  { key: "unit_price", label: "Precio unitario", type: "money", required: false, synonyms: ["precio", "precio unitario", "pvp", "price", "unit price", "precio base"] },
  { key: "quantity", label: "Cantidad", type: "number", required: false, synonyms: ["unidades", "cantidad", "uds", "qty", "quantity", "unid"] },
  { key: "total", label: "Importe", type: "money", required: true, synonyms: ["importe", "total", "importe total", "amount", "total eur", "total e"] },
  { key: "payment_method", label: "Método de pago", type: "text", required: false, synonyms: ["forma de pago", "metodo de pago", "metodo pago", "pago", "payment method", "medio de pago"] },
  { key: "customer", label: "Cliente", type: "text", required: false, synonyms: ["cliente", "customer", "socio"] },
];

export const INVOICE_FIELDS: FieldDef[] = [
  { key: "invoice_number", label: "Nº factura", type: "text", required: true, synonyms: ["factura", "n factura", "numero factura", "no factura", "num factura", "invoice", "invoice number"] },
  { key: "issue_date", label: "Fecha de emisión", type: "date", required: true, synonyms: ["fecha factura", "fecha", "fecha emision", "issue date", "date"] },
  { key: "tax_id", label: "NIF", type: "text", required: false, synonyms: ["nif", "dni", "cif", "nif cif", "dni nif", "tax id", "vat id"] },
  { key: "customer", label: "Cliente", type: "text", required: true, synonyms: ["cliente", "nombre", "customer", "razon social"] },
  { key: "concept", label: "Concepto", type: "text", required: false, synonyms: ["concepto", "concept", "producto", "tarifa"] },
  { key: "period", label: "Periodo", type: "text", required: false, synonyms: ["periodo concepto", "periodo", "period"] },
  { key: "description", label: "Descripción", type: "text", required: false, synonyms: ["descripcion", "description", "detalle"] },
  { key: "base", label: "Base imponible", type: "money", required: false, synonyms: ["base imp", "base imponible", "base", "subtotal", "base imp e"] },
  { key: "vat_amount", label: "Cuota IVA", type: "money", required: false, synonyms: ["iva 21 cuota", "cuota iva", "iva", "cuota", "vat", "impuestos"] },
  { key: "total", label: "Total", type: "money", required: true, synonyms: ["total", "total e", "importe", "importe total", "total eur"] },
  { key: "payment_method", label: "Método de pago", type: "text", required: false, synonyms: ["metodo de pago", "forma de pago", "metodo pago", "pago", "payment method"] },
  { key: "status", label: "Estado del cobro", type: "text", required: false, synonyms: ["estado", "estado cobro", "status", "estado del cobro"] },
];

export const CATALOG_FIELDS: FieldDef[] = [
  { key: "product", label: "Producto", type: "text", required: true, synonyms: ["producto", "articulo", "nombre", "product"] },
  { key: "category", label: "Categoría", type: "text", required: false, synonyms: ["categoria", "category", "familia"] },
  { key: "price", label: "Precio", type: "money", required: true, synonyms: ["precio base", "precio", "pvp", "price"] },
];

/** Cabeceras que se ignoran a propósito (columnas redundantes o internas del origen) */
export const IGNORED_HEADERS = ["n", "no", "num", "iva 21 base", "clave", "id"];

export function fieldsFor(kind: TargetKind | "catalog"): FieldDef[] {
  return kind === "sales" ? SALES_FIELDS : kind === "invoices" ? INVOICE_FIELDS : CATALOG_FIELDS;
}

/** Métodos de pago escritos de mil formas → clave interna */
export const PAYMENT_SYNONYMS: [RegExp, string][] = [
  [/efectivo|cash|metalico|contado/, "cash"],
  [/bizum/, "bizum"],
  [/tpv online|online|stripe|redsys|web/, "online"],
  [/domicilia|sepa|recibo|direct debit/, "direct_debit"],
  [/transfer/, "transfer"],
  [/tarjeta|card|visa|mastercard|datafono|tpv/, "card"],
];

export const INVOICE_STATUS_SYNONYMS: [RegExp, "paid" | "issued" | "void"][] = [
  [/anulad|cancelad|void/, "void"],
  [/pendiente|impagad|devuelt|unpaid|pending/, "issued"],
  [/cobrad|pagad|paid/, "paid"],
];
