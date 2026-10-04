-- Reversión de 0910: vuelve al trigger genérico del equipo y retira los nuevos. No toca datos (la auditoría ya escrita se conserva).
drop trigger if exists trg_invoice_items_audit on public.invoice_items;
drop trigger if exists trg_organization_settings_audit on public.organization_settings;
drop trigger if exists trg_organizations_audit on public.organizations;
drop function if exists app.audit_org_config();
drop trigger if exists trg_organization_members_audit on public.organization_members;
create trigger trg_organization_members_audit after insert or update or delete on public.organization_members
  for each row execute function app.audit_row();
drop function if exists app.audit_member();
