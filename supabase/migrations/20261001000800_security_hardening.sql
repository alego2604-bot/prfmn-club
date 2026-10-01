-- =====================================================================
-- Business OS · 0800 · Endurecimiento de seguridad (hallazgos del Security Advisor de Supabase)
--   * public.create_organization: sin ejecución anónima. Supabase concede EXECUTE a `anon`
--     por privilegios por defecto, así que el `revoke ... from public` de 0400 no bastaba.
--   * search_path fijo en los helpers internos de triggers (aviso function_search_path_mutable).
--   * Los helpers de triggers no se pueden invocar directamente desde clientes. Los triggers
--     siguen funcionando: PostgreSQL no comprueba EXECUTE al disparar un trigger.
-- Ya aplicada en business-os-staging antes de versionarse aquí. Es idempotente (revoke/grant/
-- alter function), así que reaplicarla no cambia nada. Reversión: supabase/rollbacks/20261001000800_down.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- create_organization: solo usuarios autenticados (la función además exige auth.uid())
-- ---------------------------------------------------------------------
revoke all on function public.create_organization(text, text, text, text, text, boolean) from public, anon;
grant execute on function public.create_organization(text, text, text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- search_path fijo en helpers internos
-- ---------------------------------------------------------------------
alter function app.touch_updated_at()          set search_path = public, pg_temp;
alter function app.normalize_tax_id(text)      set search_path = public, pg_temp;
alter function app.assign_sale_number()        set search_path = public, pg_temp;
alter function app.forbid_mutation()           set search_path = public, pg_temp;
alter function app.guard_sale_update()         set search_path = public, pg_temp;
alter function app.guard_payment_update()      set search_path = public, pg_temp;
alter function app.guard_invoice_update()      set search_path = public, pg_temp;
alter function app.guard_invoice_items()       set search_path = public, pg_temp;
alter function app.guard_cash_closing_update() set search_path = public, pg_temp;
alter function app.guard_price_permission()    set search_path = public, pg_temp;

-- ---------------------------------------------------------------------
-- Sin ejecución directa desde clientes
-- ---------------------------------------------------------------------
revoke all on function
  app.touch_updated_at(),
  app.normalize_tax_id(text),
  app.assign_sale_number(),
  app.forbid_mutation(),
  app.guard_sale_update(),
  app.guard_payment_update(),
  app.guard_invoice_update(),
  app.guard_invoice_items(),
  app.guard_cash_closing_update(),
  app.guard_price_permission()
from public, anon, authenticated;
