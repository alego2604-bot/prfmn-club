-- =====================================================================
-- Business OS · 0500 · Row Level Security
-- Patrón: leer = miembro activo con permiso X (+ acceso al centro si aplica)
--         escribir = miembro activo con permiso Y (+ acceso al centro)
--         borrar = no existe política (salvo enlaces y notificaciones propias)
-- Tests de aislamiento: supabase/tests/rls_isolation.sql
-- =====================================================================

-- Activar RLS en TODAS las tablas de public
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Políticas generadas para tablas de negocio estándar
--   tabla, permiso lectura, permiso escritura, ¿tiene location_id?, ¿permite update?
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  loc_using text;
begin
  for r in
    select * from (values
      ('locations',                'member',          'settings.manage',   false, true),
      ('tax_rates',                'member',          'settings.manage',   false, true),
      ('payment_methods',          'member',          'settings.manage',   false, true),
      ('document_series',          'member',          'settings.manage',   false, true),
      ('organization_settings',    'member',          'settings.manage',   false, true),
      ('organization_modules',     'member',          'settings.manage',   false, true),
      ('product_categories',       'catalog.view',    'catalog.manage',    false, true),
      ('products',                 'catalog.view',    'catalog.manage',    false, true),
      ('membership_plans',         'catalog.view',    'catalog.manage',    false, true),
      ('membership_plan_versions', 'catalog.view',    'catalog.manage',    false, true),
      ('customers',                'customers.view',  'customers.manage',  false, true),
      ('customer_memberships',     'customers.view',  'memberships.manage',false, true),
      ('attendance',               'customers.view',  'attendance.manage', true,  false),
      ('customer_notes',           'customers.view',  'customers.manage',  false, true),
      ('tasks',                    'customers.view',  'customers.manage',  false, true),
      ('message_templates',        'customers.view',  'templates.manage',  false, true),
      ('communications',           'customers.view',  'communications.send', false, true),
      ('cash_sessions',            'sales.view',      'cash.operate',      true,  true),
      ('cash_movements',           'sales.view',      'cash.operate',      false, false),
      ('sales',                    'sales.view',      'pos.sell',          true,  false),
      ('sale_items',               'sales.view',      'pos.sell',          false, false),
      ('stock_movements',          'catalog.view',    'pos.sell',          true,  false),
      ('invoices',                 'finance.view',    'invoices.manage',   true,  true),
      ('invoice_items',            'finance.view',    'invoices.manage',   false, true),
      ('membership_charges',       'finance.view',    'memberships.manage',false, true),
      ('suppliers',                'finance.view',    'expenses.manage',   false, true),
      ('expense_categories',       'finance.view',    'expenses.manage',   false, true),
      ('expenses',                 'finance.view',    'expenses.manage',   true,  true),
      ('bank_transactions',        'finance.view',    'payments.manage',   false, true),
      ('documents',                'documents.manage','documents.manage',  true,  true),
      ('imports',                  'imports.run',     'imports.run',       true,  true),
      ('import_records',           'imports.run',     'imports.run',       false, true)
    ) as v(tbl, read_perm, write_perm, has_location, allow_update)
  loop
    loc_using := case when r.has_location then ' and app.can_access_location(organization_id, location_id)' else '' end;

    execute format(
      'create policy %I on public.%I for select to authenticated using (%s%s)',
      r.tbl || '_select', r.tbl,
      case when r.read_perm = 'member' then 'app.is_member(organization_id)'
           else format('app.has_permission(organization_id, %L)', r.read_perm) end,
      loc_using);

    execute format(
      'create policy %I on public.%I for insert to authenticated with check (app.has_permission(organization_id, %L)%s)',
      r.tbl || '_insert', r.tbl, r.write_perm, loc_using);

    if r.allow_update then
      execute format(
        'create policy %I on public.%I for update to authenticated using (app.has_permission(organization_id, %L)%s) with check (app.has_permission(organization_id, %L)%s)',
        r.tbl || '_update', r.tbl, r.write_perm, loc_using, r.write_perm, loc_using);
    end if;
  end loop;
end $$;

-- Ventas: anular requiere sales.void
create policy sales_update on public.sales for update to authenticated
  using (app.has_permission(organization_id, 'sales.void') and app.can_access_location(organization_id, location_id))
  with check (app.has_permission(organization_id, 'sales.void') and app.can_access_location(organization_id, location_id));

-- Cierres: cerrar = cash.operate; reabrir (update) = cash.reopen
create policy cash_closings_select on public.cash_closings for select to authenticated
  using (app.has_permission(organization_id, 'sales.view'));
create policy cash_closings_insert on public.cash_closings for insert to authenticated
  with check (app.has_permission(organization_id, 'cash.operate'));
create policy cash_closings_update on public.cash_closings for update to authenticated
  using (app.has_permission(organization_id, 'cash.reopen'))
  with check (app.has_permission(organization_id, 'cash.reopen'));

-- Pagos: los ve quien ve ventas o finanzas; los crea quien vende o gestiona cobros
create policy payments_select on public.payments for select to authenticated
  using ((app.has_permission(organization_id, 'sales.view') or app.has_permission(organization_id, 'finance.view'))
         and app.can_access_location(organization_id, location_id));
create policy payments_insert on public.payments for insert to authenticated
  with check ((app.has_permission(organization_id, 'pos.sell') or app.has_permission(organization_id, 'payments.manage'))
              and app.can_access_location(organization_id, location_id));
create policy payments_update on public.payments for update to authenticated
  using (app.has_permission(organization_id, 'payments.manage'))
  with check (app.has_permission(organization_id, 'payments.manage'));

-- Historial de precios: lectura con catálogo; escritura solo vía trigger (security definer)
create policy product_prices_select on public.product_prices for select to authenticated
  using (app.has_permission(organization_id, 'catalog.view'));

-- Cambiar un precio exige catalog.prices (además de catalog.manage)
create or replace function app.guard_price_permission() returns trigger
language plpgsql as $$
begin
  if auth.uid() is not null
     and (new.price, new.tax_rate_bp) is distinct from (old.price, old.tax_rate_bp)
     and not app.has_permission(new.organization_id, 'catalog.prices') then
    raise exception 'No tienes permiso para cambiar precios' using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
create trigger trg_products_price_permission before update on public.products
  for each row execute function app.guard_price_permission();

-- Enlaces documentales: se pueden quitar
create policy document_links_select on public.document_links for select to authenticated
  using (app.has_permission(organization_id, 'documents.manage') or app.has_permission(organization_id, 'finance.view'));
create policy document_links_insert on public.document_links for insert to authenticated
  with check (app.has_permission(organization_id, 'documents.manage'));
create policy document_links_delete on public.document_links for delete to authenticated
  using (app.has_permission(organization_id, 'documents.manage'));

-- Organizaciones
create policy organizations_select on public.organizations for select to authenticated
  using (app.is_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (app.has_permission(id, 'settings.manage'))
  with check (app.has_permission(id, 'settings.manage'));
-- insert: solo vía public.create_organization()

create policy organization_subscriptions_select on public.organization_subscriptions for select to authenticated
  using (app.is_member(organization_id));

-- Miembros
create policy organization_members_select on public.organization_members for select to authenticated
  using (app.is_member(organization_id));
create policy organization_members_insert on public.organization_members for insert to authenticated
  with check (app.has_permission(organization_id, 'team.manage'));
create policy organization_members_update on public.organization_members for update to authenticated
  using (app.has_permission(organization_id, 'team.manage'))
  with check (app.has_permission(organization_id, 'team.manage'));

-- Roles
create policy roles_select on public.roles for select to authenticated
  using (organization_id is null or app.is_member(organization_id));
create policy roles_write on public.roles for insert to authenticated
  with check (organization_id is not null and app.has_permission(organization_id, 'team.manage'));
create policy roles_update on public.roles for update to authenticated
  using (organization_id is not null and not is_system and app.has_permission(organization_id, 'team.manage'))
  with check (organization_id is not null and not is_system and app.has_permission(organization_id, 'team.manage'));

create policy role_permissions_select on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and (r.organization_id is null or app.is_member(r.organization_id))));
create policy role_permissions_insert on public.role_permissions for insert to authenticated
  with check (exists (select 1 from public.roles r where r.id = role_id and not r.is_system and app.has_permission(r.organization_id, 'team.manage')));
create policy role_permissions_delete on public.role_permissions for delete to authenticated
  using (exists (select 1 from public.roles r where r.id = role_id and not r.is_system and app.has_permission(r.organization_id, 'team.manage')));

-- Catálogos globales de solo lectura
create policy permissions_select on public.permissions for select to authenticated using (true);
create policy platform_plans_select on public.platform_plans for select to authenticated using (true);

-- Perfiles: el propio y los de compañeros de empresa
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or exists (
    select 1 from public.organization_members a
    join public.organization_members b on a.organization_id = b.organization_id
    where a.user_id = auth.uid() and a.status = 'active' and b.user_id = profiles.id));
create policy profiles_upsert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Notificaciones: las del equipo (user_id null) o las propias
create policy notifications_select on public.notifications for select to authenticated
  using (app.is_member(organization_id) and (user_id is null or user_id = auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (app.is_member(organization_id) and (user_id is null or user_id = auth.uid()))
  with check (app.is_member(organization_id) and (user_id is null or user_id = auth.uid()));

-- Auditoría: solo lectura con permiso; las escrituras las hace el trigger
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (app.has_permission(organization_id, 'audit.view'));

-- organization_counters: sin políticas → inaccesible desde la API (solo funciones definer)
