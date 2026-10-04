-- =====================================================================
-- Business OS · 0910 · Auditoría de equipo, empresa y configuración
--   Forward-only y NO destructiva: solo crea funciones y triggers de auditoría. No toca ningún dato.
--   Reversión: supabase/rollbacks/20261005000910_down.sql
--
--   * Equipo: invitar a alguien o cambiarle el rol queda como «invite» / «role_change» con el nombre o
--     email y la clave del rol (antes: insert/update genérico con el role_id en bruto).
--   * Empresa (organizations) y configuración (organization_settings) no tenían auditoría en servidor.
--   * Líneas de factura (invoice_items): editar un borrador deja traza de cada línea.
--   (sale_items no se audita: el historial de la venta ya queda en sales/payments y duplicaría filas.)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Equipo
-- ---------------------------------------------------------------------
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

-- Sustituye al trigger genérico de la tabla (mismo nombre): un solo registro por cambio, ya etiquetado
drop trigger if exists trg_organization_members_audit on public.organization_members;
create trigger trg_organization_members_audit after insert or update on public.organization_members
  for each row execute function app.audit_member();

-- ---------------------------------------------------------------------
-- Empresa y configuración (la entidad es la propia empresa)
-- ---------------------------------------------------------------------
create or replace function app.audit_org_config() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  -- organizations no tiene organization_id: su id es la empresa (vía jsonb, que no exige el campo)
  v_org uuid := coalesce(n->>'organization_id', n->>'id')::uuid;
  diff jsonb := '{}'::jsonb;
  k text;
  ctx jsonb;
begin
  for k in select jsonb_object_keys(n) loop
    if k not in ('updated_at') and (o -> k) is distinct from (n -> k) then
      -- El logo (data URL) no se copia entero en la auditoría
      diff := diff || jsonb_build_object(k, case when k like '%logo%' then jsonb_build_object('changed', true)
                                                 else jsonb_build_object('from', o -> k, 'to', n -> k) end);
    end if;
  end loop;
  if diff = '{}'::jsonb then return new; end if;
  begin
    ctx := nullif(current_setting('app.audit_ctx', true), '')::jsonb -> v_org::text;
  exception when others then ctx := null;
  end;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id, entity_label, changes, context)
  values (v_org, auth.uid(), coalesce(ctx->>'action', 'update'), tg_table_name, v_org,
          coalesce(ctx->>'label', case tg_table_name when 'organizations' then 'Datos de la empresa' else 'Configuración' end), diff, ctx->'context');
  return new;
end $$;

drop trigger if exists trg_organizations_audit on public.organizations;
create trigger trg_organizations_audit after update on public.organizations
  for each row execute function app.audit_org_config();
drop trigger if exists trg_organization_settings_audit on public.organization_settings;
create trigger trg_organization_settings_audit after update on public.organization_settings
  for each row execute function app.audit_org_config();

-- ---------------------------------------------------------------------
-- Líneas de factura (borradores): auditoría genérica por fila
-- ---------------------------------------------------------------------
drop trigger if exists trg_invoice_items_audit on public.invoice_items;
create trigger trg_invoice_items_audit after insert or update or delete on public.invoice_items
  for each row execute function app.audit_row();
