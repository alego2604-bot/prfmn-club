-- Minimal stand-in for the pieces of Supabase that the migrations rely on.
-- ONLY for local testing on a vanilla PostgreSQL (scripts/db-test.sh). Never run against a Supabase project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id    uuid primary key,
  email text unique
);

-- Same contract as Supabase: the user id comes from the JWT "sub" claim.
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
grant usage on schema public to authenticated, anon;
