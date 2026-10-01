/**
 * Validación de identificadores fiscales españoles (DNI, NIE, CIF).
 * Un documento extranjero (pasaporte) no es "inválido": se clasifica aparte.
 */
const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

export type TaxIdKind = "dni" | "nie" | "cif" | "foreign" | "invalid" | "empty";

export function normalizeTaxId(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function classifyTaxId(raw: string | null | undefined): { kind: TaxIdKind; normalized: string; valid: boolean } {
  const v = normalizeTaxId(raw);
  if (!v) return { kind: "empty", normalized: "", valid: false };
  if (/^\d{8}[A-Z]$/.test(v)) {
    return { kind: "dni", normalized: v, valid: DNI_LETTERS[Number(v.slice(0, 8)) % 23] === v[8] };
  }
  if (/^[XYZ]\d{7}[A-Z]$/.test(v)) {
    const num = "XYZ".indexOf(v[0]!) + v.slice(1, 8);
    return { kind: "nie", normalized: v, valid: DNI_LETTERS[Number(num) % 23] === v[8] };
  }
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(v)) {
    return { kind: "cif", normalized: v, valid: true };
  }
  if (/^[A-Z0-9]{6,12}$/.test(v) && /[A-Z]/.test(v) && /\d/.test(v) && !/^\d+[A-Z]$/.test(v)) {
    return { kind: "foreign", normalized: v, valid: true };
  }
  return { kind: "invalid", normalized: v, valid: false };
}
