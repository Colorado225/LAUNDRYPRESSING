-- =============================================================================
-- 021_tenant_onboarding_services.sql — activités et prestations par pressing
-- =============================================================================
-- Ajoute une configuration légère des prestations, distincte d'un catalogue
-- tarifaire. Les tarifs restent saisis sur les commandes et aucun prix par
-- défaut n'est installé.
-- Les pressings existants sont considérés comme déjà configurés ; les nouveaux
-- pressings passent par l'onboarding après leur création.
-- =============================================================================

begin;

alter table public.tenants
  add column onboarding_completed_at timestamptz;

update public.tenants
   set onboarding_completed_at = created_at
 where onboarding_completed_at is null;

create table public.tenant_services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  activity_code text not null check (activity_code in (
    'pressing',
    'blanchisserie',
    'nettoyage_sec',
    'repassage',
    'retouches',
    'collecte_livraison',
    'tapis_moquettes',
    'cuir'
  )),
  service_name text not null check (char_length(btrim(service_name)) between 2 and 80),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  constraint tenant_services_id_tenant_unique unique (id, tenant_id)
);

create unique index tenant_services_name_unique
  on public.tenant_services (tenant_id, activity_code, lower(btrim(service_name)));
create index tenant_services_tenant_order_idx
  on public.tenant_services (tenant_id, activity_code, sort_order, service_name);

alter table public.tenant_services enable row level security;

create policy tenant_services_select_member
  on public.tenant_services for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy tenant_services_insert_owner
  on public.tenant_services for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  );

create policy tenant_services_update_owner
  on public.tenant_services for update to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  );

create policy tenant_services_delete_owner
  on public.tenant_services for delete to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  );

revoke all on public.tenant_services from anon;
revoke all on public.tenant_services from public;
grant select, insert, update, delete on public.tenant_services to authenticated;

create or replace function public.save_tenant_services(p_services jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_completed_at timestamptz;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  if public.current_tenant_role() <> 'owner' then
    raise exception 'Seul le propriétaire peut configurer les prestations.' using errcode = '42501';
  end if;
  if p_services is null or jsonb_typeof(p_services) <> 'array'
     or jsonb_array_length(p_services) < 1 or jsonb_array_length(p_services) > 80 then
    raise exception 'Choisissez au moins une prestation (80 au maximum).' using errcode = '22023';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_services) as service(value)
     where jsonb_typeof(service.value) <> 'object'
        or coalesce(service.value ->> 'activity_code', '') not in (
          'pressing', 'blanchisserie', 'nettoyage_sec', 'repassage',
          'retouches', 'collecte_livraison', 'tapis_moquettes', 'cuir'
        )
        or char_length(btrim(coalesce(service.value ->> 'service_name', ''))) not between 2 and 80
  ) then
    raise exception 'Une activité ou une prestation est invalide.' using errcode = '22023';
  end if;

  delete from public.tenant_services where tenant_id = v_tenant;

  insert into public.tenant_services (tenant_id, activity_code, service_name, sort_order)
  select v_tenant,
         service.value ->> 'activity_code',
         btrim(service.value ->> 'service_name'),
         (service.ordinality - 1)::integer
    from jsonb_array_elements(p_services) with ordinality as service(value, ordinality);

  update public.tenants
     set onboarding_completed_at = coalesce(onboarding_completed_at, now())
   where id = v_tenant
   returning onboarding_completed_at into v_completed_at;

  return v_completed_at;
end;
$$;

comment on table public.tenant_services is
  'Activités et prestations choisies par un pressing ; aucun tarif prédéfini.';
comment on column public.tenants.onboarding_completed_at is
  'Date de première configuration des activités et prestations du pressing.';
comment on function public.save_tenant_services(jsonb) is
  'Remplace la configuration des prestations du pressing actif ; propriétaire uniquement.';

revoke all on function public.save_tenant_services(jsonb) from public, anon;
grant execute on function public.save_tenant_services(jsonb) to authenticated;

commit;
