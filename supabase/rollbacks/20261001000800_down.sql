-- Reversión de 0800 (security hardening). Restaura los privilegios por defecto y el search_path mutable.
-- Solo development/staging: en producción, una migración nueva hacia delante.
begin;
grant execute on function public.create_organization(text, text, text, text, text, boolean) to anon;
alter function app.touch_updated_at()          reset search_path;
alter function app.normalize_tax_id(text)      reset search_path;
alter function app.assign_sale_number()        reset search_path;
alter function app.forbid_mutation()           reset search_path;
alter function app.guard_sale_update()         reset search_path;
alter function app.guard_payment_update()      reset search_path;
alter function app.guard_invoice_update()      reset search_path;
alter function app.guard_invoice_items()       reset search_path;
alter function app.guard_cash_closing_update() reset search_path;
alter function app.guard_price_permission()    reset search_path;
grant execute on function
  app.touch_updated_at(), app.normalize_tax_id(text), app.assign_sale_number(), app.forbid_mutation(),
  app.guard_sale_update(), app.guard_payment_update(), app.guard_invoice_update(), app.guard_invoice_items(),
  app.guard_cash_closing_update(), app.guard_price_permission()
to public;
commit;
