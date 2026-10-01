-- =====================================================================
-- Business OS · 0600 · Capa de integraciones (opcional, desacoplada)
-- ---------------------------------------------------------------------
-- Business OS no depende en tiempo de ejecución de ningún otro producto.
-- Cualquier sistema externo (una plataforma de entrenamiento, un software de reservas,
-- una pasarela de pago…) se conecta como PROVEEDOR a través de API/webhooks:
--   * nunca se leen ni escriben tablas internas de otro producto;
--   * los datos recibidos se guardan como datos propios de Business OS
--     (p. ej. attendance.source = 'integration'), así que todo sigue funcionando
--     si la integración se desconecta o el otro producto deja de existir.
-- Los secretos (tokens, claves de firma) NO se guardan aquí: solo una referencia
-- a Supabase Vault / secrets de Edge Functions.
-- =====================================================================

create table public.integration_connections (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider        text not null check (provider ~ '^[a-z0-9_]{2,40}$'),   -- identificador genérico del proveedor
  display_name    text not null,
  direction       text not null default 'inbound' check (direction in ('inbound','outbound','both')),
  scopes          text[] not null default '{}',     -- p. ej. {'attendance.read'}
  secret_ref      text,                             -- referencia a Vault; nunca el secreto
  status          text not null default 'disabled' check (status in ('disabled','active','error','revoked')),
  last_sync_at    timestamptz,
  last_error      text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, provider, display_name)
);
create trigger trg_integration_connections_touch before update on public.integration_connections
  for each row execute function app.touch_updated_at();
create trigger trg_integration_connections_audit after insert or update or delete on public.integration_connections
  for each row execute function app.audit_row();

-- Correspondencia entre una entidad de Business OS y su id en el sistema externo.
create table public.external_identities (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id   uuid not null,
  entity_type     text not null check (entity_type in ('customer','product','location','invoice','sale')),
  entity_id       uuid not null,
  external_id     text not null,
  created_at      timestamptz not null default now(),
  unique (connection_id, entity_type, external_id),
  unique (connection_id, entity_type, entity_id),
  foreign key (organization_id, connection_id) references public.integration_connections (organization_id, id) on delete cascade
);

-- Registro de eventos entrantes/salientes. Idempotente: el mismo evento no se procesa dos veces.
create table public.integration_events (
  id              bigint generated always as identity primary key,
  organization_id uuid not null,
  connection_id   uuid not null,
  direction       text not null check (direction in ('inbound','outbound')),
  event_type      text not null,                    -- p. ej. 'attendance.recorded'
  idempotency_key text not null,
  payload         jsonb not null,
  status          text not null default 'received' check (status in ('received','processed','ignored','failed')),
  error           text,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz,
  unique (connection_id, idempotency_key),
  foreign key (organization_id, connection_id) references public.integration_connections (organization_id, id) on delete cascade
);
create index integration_events_pending_idx on public.integration_events (organization_id, status) where status = 'received';

alter table public.integration_connections enable row level security;
alter table public.external_identities enable row level security;
alter table public.integration_events enable row level security;

-- Gestionar integraciones = configuración de empresa
create policy integration_connections_select on public.integration_connections for select to authenticated
  using (app.has_permission(organization_id, 'settings.manage'));
create policy integration_connections_insert on public.integration_connections for insert to authenticated
  with check (app.has_permission(organization_id, 'settings.manage'));
create policy integration_connections_update on public.integration_connections for update to authenticated
  using (app.has_permission(organization_id, 'settings.manage'))
  with check (app.has_permission(organization_id, 'settings.manage'));

create policy external_identities_select on public.external_identities for select to authenticated
  using (app.has_permission(organization_id, 'settings.manage'));

-- Los eventos los escribe solo el servidor (Edge Function que verifica la firma); los usuarios autorizados los leen.
create policy integration_events_select on public.integration_events for select to authenticated
  using (app.has_permission(organization_id, 'settings.manage'));
