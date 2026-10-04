-- Reversión de 0920. No toca datos: retira triggers, funciones y políticas nuevas y restaura las anteriores (0500, 0900, 0910).
-- ⚠ Al revertir, un empleado vuelve a poder registrar cobros de facturas por la API y las columnas sensibles de `customers`
--   vuelven a ser legibles para quien ve clientes. La aplicación detecta server_capabilities().schema y vuelve a leer `customers`.

-- C. customers: columnas sensibles legibles de nuevo
drop function if exists public.customers_sensitive(uuid, uuid, int);
drop view if exists public.customers_safe;
grant select on public.customers to authenticated;
drop trigger if exists trg_customers_sensitive on public.customers;
drop function if exists app.guard_customer_sensitive();
drop trigger if exists trg_invoices_customer_snapshot on public.invoices;
drop function if exists app.fill_invoice_customer_snapshot();

-- B. equipo
drop function if exists public.set_member_overrides(uuid, text[], text[]);
drop trigger if exists trg_role_permissions_guard on public.role_permissions;
drop function if exists app.guard_role_permission_insert();
drop trigger if exists trg_members_guard on public.organization_members;
drop function if exists app.guard_member_change();
drop function if exists app.valid_permission_overrides(jsonb);
drop function if exists app.actor_holds_role(uuid, uuid);

-- A. cobros
drop trigger if exists trg_membership_charges_paid on public.membership_charges;
drop function if exists app.guard_membership_charge_paid();
drop trigger if exists trg_invoices_permissions on public.invoices;
drop function if exists app.guard_invoice_permissions();
drop trigger if exists trg_payments_permission on public.payments;
drop function if exists app.guard_payment_insert();
drop policy if exists invoice_items_insert on public.invoice_items;
create policy invoice_items_insert on public.invoice_items for insert to authenticated
  with check (app.has_permission(organization_id, 'invoices.manage'));
drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices for insert to authenticated
  with check (app.has_permission(organization_id, 'invoices.manage') and app.can_access_location(organization_id, location_id));
drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices for update to authenticated
  using (app.has_permission(organization_id, 'invoices.manage') and app.can_access_location(organization_id, location_id))
  with check (app.has_permission(organization_id, 'invoices.manage') and app.can_access_location(organization_id, location_id));
delete from public.role_permissions
 where permission = 'payments.manage' and role_id in (select id from public.roles where organization_id is null and key = 'manager');

-- D. auditoría
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (app.has_permission(organization_id, 'audit.view'));
create or replace function app.audit_member() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_name text;
  v_role text;
  v_old_role text;
begin
  select coalesce(p.full_name, new.invited_email, 'Miembro') into v_name from (select 1) x left join public.profiles p on p.id = new.user_id;
  select key into v_role from public.roles where id = new.role_id;
  if tg_op = 'INSERT' then
    insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, entity_label, context)
    values (new.organization_id, auth.uid(), 'invite', 'organization_members', new.id, v_name,
            jsonb_build_object('role', v_role, 'email', new.invited_email));
    return new;
  end if;
  if new.role_id is distinct from old.role_id then
    select key into v_old_role from public.roles where id = old.role_id;
    insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, entity_label, context)
    values (new.organization_id, auth.uid(), 'role_change', 'organization_members', new.id, v_name,
            jsonb_build_object('from', v_old_role, 'to', v_role));
  end if;
  if new.location_ids is distinct from old.location_ids or new.status is distinct from old.status then
    insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, entity_label, changes)
    values (new.organization_id, auth.uid(), 'update', 'organization_members', new.id, v_name,
            jsonb_strip_nulls(jsonb_build_object(
              'location_ids', case when new.location_ids is distinct from old.location_ids then jsonb_build_object('from', to_jsonb(old.location_ids), 'to', to_jsonb(new.location_ids)) end,
              'status', case when new.status is distinct from old.status then jsonb_build_object('from', old.status, 'to', new.status) end)));
  end if;
  return new;
end $$;

-- E. capacidades y sync_push (versiones de 0900)
create or replace function public.server_capabilities() returns jsonb
language sql stable security invoker set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'schema', 900,
    'features', jsonb_build_array('expenses', 'suppliers', 'memberships', 'tasks', 'invoice_editor', 'onboarding'));
$$;
revoke all on function public.server_capabilities() from public, anon;
grant execute on function public.server_capabilities() to authenticated;

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
