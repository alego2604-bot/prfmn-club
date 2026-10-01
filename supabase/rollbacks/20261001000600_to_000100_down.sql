-- Reversión completa de las migraciones 0100–0600 (esquema inicial + integraciones).
-- ⚠ DESTRUCTIVO: solo para development/staging. NUNCA en producción con datos reales
--   (allí los cambios se hacen con migraciones nuevas hacia delante).
begin;
drop function if exists public.create_organization(text, text, text, text, text, boolean);
drop table if exists
  public.integration_events, public.external_identities, public.integration_connections,
  public.audit_logs, public.notifications, public.import_records, public.imports, public.document_links, public.documents,
  public.bank_transactions, public.expenses, public.expense_categories, public.suppliers, public.payments,
  public.membership_charges, public.invoice_items, public.invoices, public.stock_movements, public.sale_items,
  public.organization_counters, public.sales, public.cash_closings, public.cash_movements, public.cash_sessions,
  public.communications, public.message_templates, public.tasks, public.customer_notes, public.attendance,
  public.customer_memberships, public.customers, public.membership_plan_versions, public.membership_plans,
  public.product_prices, public.products, public.product_categories, public.organization_settings,
  public.document_series, public.payment_methods, public.tax_rates, public.organization_members,
  public.role_permissions, public.roles, public.permissions, public.profiles, public.locations,
  public.organization_modules, public.organization_subscriptions, public.organizations, public.platform_plans
  cascade;
drop schema if exists app cascade;
commit;
