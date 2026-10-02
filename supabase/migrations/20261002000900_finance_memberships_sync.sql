-- =====================================================================
-- Business OS · 0900 · Gastos, proveedores, membresías, tareas y series en la sincronización
--   Forward-only y NO destructiva: solo añade columnas opcionales, triggers y amplía sync_push.
--   Ningún dato existente cambia. Reversión: supabase/rollbacks/20261002000900_down.sql
--
--   * sync_push admite las tablas que ya existían desde 0200/0300 (con RLS desde 0500) pero no eran
--     sincronizables: suppliers, expense_categories, expenses, customer_memberships, membership_charges,
--     tasks, document_series. Las políticas RLS y permisos (expenses.manage, memberships.manage,
--     customers.manage, settings.manage) se aplican igual que antes: sync_push es SECURITY INVOKER.
--   * Nueva operación `delete` acotada a invoice_items de facturas en BORRADOR (editar un borrador).
--     Una factura emitida sigue siendo inmutable (guard_invoice_items también se dispara al borrar).
--   * public.server_capabilities(): la app detecta qué versión del esquema tiene el servidor y no
--     ofrece módulos cuyo guardado el servidor aún no admite.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Columnas opcionales (todas con default o nullable: no afectan a filas existentes)
-- ---------------------------------------------------------------------
alter table public.expenses add column if not exists notes text;
alter table public.invoice_items add column if not exists discount bigint not null default 0 check (discount >= 0);
alter table public.invoices add column if not exists discount_total bigint not null default 0 check (discount_total >= 0);
alter table public.customer_memberships add column if not exists paused_at timestamptz;
alter table public.customer_memberships add column if not exists resume_on date;
alter table public.customer_memberships add column if not exists notes text;
alter table public.organization_settings add column if not exists onboarding jsonb not null default '{}'::jsonb;

create index if not exists customer_memberships_customer_idx on public.customer_memberships (organization_id, customer_id);
create index if not exists membership_charges_membership_idx on public.membership_charges (customer_membership_id);
create index if not exists tasks_org_status_idx on public.tasks (organization_id, status);
create index if not exists expenses_supplier_idx on public.expenses (organization_id, supplier_id);

-- Líneas de factura: 0400 prohibía todo DELETE. Un BORRADOR no es un documento fiscal y debe poder editarse
-- (quitar líneas); una factura emitida o anulada sigue sin poder perder líneas (guard_invoice_items lanza si
-- la factura no está en borrador). Se sustituye el bloqueo total por ese guard, también para DELETE.
drop trigger if exists trg_invoice_items_no_delete on public.invoice_items;
drop trigger if exists trg_invoice_items_guard_delete on public.invoice_items;
create trigger trg_invoice_items_guard_delete before delete on public.invoice_items
  for each row execute function app.guard_invoice_items();

-- Auditoría de cargos de membresía (las demás tablas nuevas ya tenían trigger desde 0400)
drop trigger if exists trg_membership_charges_audit on public.membership_charges;
create trigger trg_membership_charges_audit after insert or update or delete on public.membership_charges
  for each row execute function app.audit_row();

-- ---------------------------------------------------------------------
-- Capacidades del servidor
-- ---------------------------------------------------------------------
create or replace function public.server_capabilities() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'schema', 900,
    'features', jsonb_build_array('expenses', 'suppliers', 'memberships', 'tasks', 'invoice_editor', 'onboarding'));
$$;
revoke all on function public.server_capabilities() from public, anon;
grant execute on function public.server_capabilities() to authenticated;

-- ---------------------------------------------------------------------
-- sync_push v2 (misma firma y semántica que 0700; amplía la lista de tablas y añade `delete` acotado)
-- ---------------------------------------------------------------------
create or replace function public.sync_push(p_org uuid, p_batch jsonb) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  allowed constant text[] := array[
    'organizations','organization_settings','locations','tax_rates','payment_methods','document_series','product_categories',
    'imports','products','membership_plans','membership_plan_versions','customers','customer_notes','suppliers',
    'expense_categories','customer_memberships','tasks','cash_sessions','cash_movements','sales','sale_items','invoices',
    'invoice_items','payments','membership_charges','expenses','cash_closings','import_records'];
  deletable constant text[] := array['invoice_items'];
  op jsonb;
  t text;
  kind text;
  rws jsonb;
  rw jsonb;
  cols text;
  writable text[];
  r jsonb;
  out jsonb := '[]'::jsonb;
  n int;
begin
  if p_org is null or not app.is_member(p_org) then
    raise exception 'No perteneces a esta empresa' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('app.audit_ctx', coalesce(p_batch -> 'audit', '{}'::jsonb)::text, true);

  for op in select value from jsonb_array_elements(coalesce(p_batch -> 'ops', '[]'::jsonb)) loop
    t := op ->> 'table';
    kind := op ->> 'op';
    rws := coalesce(op -> 'rows', '[]'::jsonb);
    if jsonb_typeof(rws) <> 'array' or jsonb_array_length(rws) = 0 then continue; end if;

    if t = 'organization_modules' and kind = 'set_modules' then
      if not app.has_permission(p_org, 'settings.manage') then
        raise exception 'No tienes permiso para cambiar los módulos' using errcode = 'insufficient_privilege';
      end if;
      for rw in select value from jsonb_array_elements(rws) loop
        insert into public.organization_modules (organization_id, module_key, enabled)
        select p_org, m, (rw ->> 'enabled')::boolean
        from unnest(case rw ->> 'module'
                      when 'fitness' then array['fitness.memberships','fitness.attendance','fitness.drop_ins','fitness.classes']
                      else array[]::text[] end) m
        on conflict (organization_id, module_key) do update set enabled = excluded.enabled;
      end loop;
      continue;
    end if;

    if not (t = any (allowed)) then
      raise exception 'Tabla no sincronizable: %', t using errcode = 'invalid_parameter_value';
    end if;

    select array_agg(a.attname::text) into writable
    from pg_attribute a
    where a.attrelid = format('public.%I', t)::regclass and a.attnum > 0 and not a.attisdropped
      and a.attgenerated = '' and a.attidentity = '';

    if kind = 'insert' then
      if t in ('organizations','organization_settings') then
        raise exception 'Alta de empresa solo mediante create_organization()' using errcode = 'insufficient_privilege';
      end if;
      if exists (select 1 from jsonb_array_elements(rws) e where (e.value ->> 'organization_id')::uuid is distinct from p_org) then
        raise exception 'Registro de otra empresa en el lote (%)', t using errcode = 'insufficient_privilege';
      end if;
      select string_agg(quote_ident(k), ', ') into cols
      from (select distinct jsonb_object_keys(e.value) k from jsonb_array_elements(rws) e) s
      where k = any (writable);
      execute format(
        'with ins as (insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, $1) returning *)
         select coalesce(jsonb_agg(to_jsonb(ins)), ''[]''::jsonb) from ins', t, cols, cols, t)
        into r using rws;
      out := out || jsonb_build_array(jsonb_build_object('table', t, 'rows', r));

    elsif kind = 'update' then
      for rw in select value from jsonb_array_elements(rws) loop
        select string_agg(quote_ident(k), ', ') into cols
        from jsonb_object_keys(rw) k
        where k = any (writable) and k not in ('id', 'organization_id', 'created_at');
        if cols is null then continue; end if;
        if t = 'organizations' then
          execute format('update public.%I x set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where x.id = $2 returning to_jsonb(x.*)',
                         t, cols, cols, t) into r using rw, p_org;
        elsif t = 'organization_settings' then
          execute format('update public.%I x set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where x.organization_id = $2 returning to_jsonb(x.*)',
                         t, cols, cols, t) into r using rw, p_org;
        else
          execute format('update public.%I x set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where x.id = ($1 ->> ''id'')::uuid and x.organization_id = $2 returning to_jsonb(x.*)',
                         t, cols, cols, t) into r using rw, p_org;
        end if;
        get diagnostics n = row_count;
        if n = 0 then
          raise exception 'No se pudo actualizar % (no existe o no tienes permiso)', t using errcode = 'insufficient_privilege';
        end if;
        out := out || jsonb_build_array(jsonb_build_object('table', t, 'rows', jsonb_build_array(r)));
      end loop;

    elsif kind = 'delete' then
      if not (t = any (deletable)) then
        raise exception 'No se puede borrar en %', t using errcode = 'insufficient_privilege';
      end if;
      if not app.has_permission(p_org, 'invoices.manage') then
        raise exception 'No tienes permiso para editar facturas' using errcode = 'insufficient_privilege';
      end if;
      -- Solo líneas de borradores de esta empresa; el trigger guard_invoice_items lo vuelve a comprobar
      delete from public.invoice_items x
       where x.organization_id = p_org
         and x.id in (select (e.value ->> 'id')::uuid from jsonb_array_elements(rws) e)
         and exists (select 1 from public.invoices i where i.id = x.invoice_id and i.organization_id = p_org and i.status = 'draft');
    else
      raise exception 'Operación no soportada: %', kind using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  return out;
end $$;
revoke all on function public.sync_push(uuid, jsonb) from public, anon;
grant execute on function public.sync_push(uuid, jsonb) to authenticated;

-- Las líneas de borrador se borran con sync_push (security invoker): hace falta una política de DELETE
drop policy if exists invoice_items_delete on public.invoice_items;
create policy invoice_items_delete on public.invoice_items for delete to authenticated
  using (app.has_permission(organization_id, 'invoices.manage')
         and exists (select 1 from public.invoices i where i.id = invoice_id and i.status = 'draft'));
