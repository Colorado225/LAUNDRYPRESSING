-- =============================================================================
-- 00_bootstrap.sql — environnement local minimal pour rejouer les migrations
-- =============================================================================
-- Supabase fournit d'office : les rôles `anon`, `authenticated` et
-- `service_role`, le schéma `auth`, `auth.users`, `auth.uid()` et `auth.jwt()`.
-- PostgreSQL nu ne les a pas. Ce fichier les recrée à l'identique (surface
-- minimale) pour pouvoir exécuter `001`, `002`, `003`, le jeu de démonstration
-- et les tests RLS sur un PostgreSQL ordinaire.
--
-- Il n'est JAMAIS appliqué sur un projet Supabase : les objets existent déjà.
--
-- Usage :
--   psql "$DATABASE_URL" -f supabase/tests/local/00_bootstrap.sql
-- =============================================================================

-- `gen_random_uuid()` fait partie du cœur depuis PostgreSQL 13 ; l'extension
-- n'est utile qu'aux versions antérieures. Les distributions allégées
-- (comme celle utilisée en intégration continue) peuvent ne pas la fournir :
-- on l'active si possible, sans bloquer les tests.
do $$
begin
  begin
    create extension if not exists "pgcrypto";
  exception
    when others then
      raise notice 'pgcrypto indisponible (%): utilisation de gen_random_uuid() natif.', sqlerrm;
  end;
end;
$$;

-- --- Rôles -------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;

-- --- Schéma auth -------------------------------------------------------------
create schema if not exists auth;

grant usage on schema auth to anon, authenticated, service_role;

-- Sous-ensemble des colonnes réellement utilisées par le projet.
create table if not exists auth.users (
  id                 uuid primary key,
  email              text unique,
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- `request.jwt.claims` est la variable de session posée par PostgREST.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

grant execute on function auth.jwt() to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

grant select on auth.users to authenticated;
grant select, insert, update, delete on auth.users to service_role;
