-- Reversión de 0900. Devuelve sync_push a la lista de tablas de 0700 (reaplica su definición desde
-- 20261001000700_cloud_sync.sql tras ejecutar esto) y retira lo añadido. Las columnas nuevas se
-- conservan a propósito: borrarlas perdería datos (gastos con notas, descuentos, pausas). Si de verdad
-- hay que quitarlas, hacerlo en una migración nueva tras exportar esos datos.
drop policy if exists invoice_items_delete on public.invoice_items;
drop trigger if exists trg_invoice_items_guard_delete on public.invoice_items;
create trigger trg_invoice_items_no_delete before delete on public.invoice_items for each row execute function app.forbid_mutation();
drop trigger if exists trg_membership_charges_audit on public.membership_charges;
drop function if exists public.server_capabilities();
-- Después: psql -f supabase/migrations/20261001000700_cloud_sync.sql (solo la sección de sync_push)
