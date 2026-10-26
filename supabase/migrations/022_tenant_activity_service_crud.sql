-- =============================================================================
-- 022_tenant_activity_service_crud.sql — activités éditables et prestations liées
-- =============================================================================
-- Normalise le référentiel 021 : chaque activité est une ligne tenant-scoped,
-- chaque prestation porte une FK vers son activité. Les lignes historiques sont
-- converties sans toucher aux commandes ni à leurs instantanés.
-- =============================================================================

begin;

create table public.tenant_activities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  legacy_code text check (legacy_code is null or legacy_code in (
    'pressing', 'blanchisserie', 'nettoyage_sec', 'repassage',
    'retouches', 'collecte_livraison', 'tapis_moquettes', 'cuir'
  )),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_activities_id_tenant_unique unique (id, tenant_id)
);

create unique index tenant_activities_name_unique
  on public.tenant_activities (tenant_id, lower(btrim(name)));
create unique index tenant_activities_legacy_code_unique
  on public.tenant_activities (tenant_id, legacy_code)
  where legacy_code is not null;
create index tenant_activities_tenant_order_idx
  on public.tenant_activities (tenant_id, sort_order, name);

create trigger tenant_activities_updated_at
  before update on public.tenant_activities
  for each row execute function public.update_updated_at_column();

-- Reconstitue une activité par pressing à partir des codes historiques 021.
insert into public.tenant_activities (tenant_id, name, legacy_code, sort_order)
select distinct
       ts.tenant_id,
       case ts.activity_code
         when 'pressing' then 'Pressing'
         when 'blanchisserie' then 'Blanchisserie'
         when 'nettoyage_sec' then 'Nettoyage à sec'
         when 'repassage' then 'Repassage'
         when 'retouches' then 'Retouches et couture'
         when 'collecte_livraison' then 'Collecte et livraison'
         when 'tapis_moquettes' then 'Tapis et ameublement'
         when 'cuir' then 'Cuir et daim'
       end,
       ts.activity_code,
       case ts.activity_code
         when 'pressing' then 10
         when 'blanchisserie' then 20
         when 'nettoyage_sec' then 30
         when 'repassage' then 40
         when 'retouches' then 50
         when 'collecte_livraison' then 60
         when 'tapis_moquettes' then 70
         when 'cuir' then 80
       end
  from public.tenant_services ts
 where ts.activity_code is not null
on conflict (tenant_id, legacy_code) where legacy_code is not null do nothing;

alter table public.tenant_services
  add column activity_id uuid;

update public.tenant_services ts
   set activity_id = ta.id
  from public.tenant_activities ta
 where ta.tenant_id = ts.tenant_id
   and ta.legacy_code = ts.activity_code;

alter table public.tenant_services
  alter column activity_id set not null,
  alter column activity_code drop not null,
  drop constraint if exists tenant_services_activity_code_check,
  add constraint tenant_services_activity_tenant_fk
    foreign key (activity_id, tenant_id)
    references public.tenant_activities(id, tenant_id)
    on delete cascade;

drop index if exists public.tenant_services_name_unique;
drop index if exists public.tenant_services_tenant_order_idx;
create unique index tenant_services_name_unique
  on public.tenant_services (tenant_id, activity_id, lower(btrim(service_name)));
create index tenant_services_tenant_order_idx
  on public.tenant_services (tenant_id, activity_id, sort_order, service_name);

alter table public.tenant_activities enable row level security;

create policy tenant_activities_select_member
  on public.tenant_activities for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy tenant_activities_insert_owner
  on public.tenant_activities for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  );

create policy tenant_activities_update_owner
  on public.tenant_activities for update to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  );

create policy tenant_activities_delete_owner
  on public.tenant_activities for delete to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  );

revoke all on public.tenant_activities from anon;
revoke all on public.tenant_activities from public;
grant select, insert, update, delete on public.tenant_activities to authenticated;

-- Compatibilité avec les anciennes versions qui envoient encore des activity_code.
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

  insert into public.tenant_activities (tenant_id, name, legacy_code, sort_order)
  select v_tenant,
         case codes.code
           when 'pressing' then 'Pressing'
           when 'blanchisserie' then 'Blanchisserie'
           when 'nettoyage_sec' then 'Nettoyage à sec'
           when 'repassage' then 'Repassage'
           when 'retouches' then 'Retouches et couture'
           when 'collecte_livraison' then 'Collecte et livraison'
           when 'tapis_moquettes' then 'Tapis et ameublement'
           when 'cuir' then 'Cuir et daim'
         end,
         codes.code,
         (codes.position - 1)::integer
    from (
      select distinct on (service.value ->> 'activity_code')
             service.value ->> 'activity_code' as code,
             service.ordinality as position
        from jsonb_array_elements(p_services) with ordinality as service(value, ordinality)
       order by service.value ->> 'activity_code', service.ordinality
    ) codes
  on conflict (tenant_id, legacy_code) where legacy_code is not null do nothing;

  delete from public.tenant_services where tenant_id = v_tenant;

  insert into public.tenant_services (tenant_id, activity_id, activity_code, service_name, sort_order)
  select v_tenant,
         activity.id,
         activity.legacy_code,
         btrim(service.value ->> 'service_name'),
         (service.ordinality - 1)::integer
    from jsonb_array_elements(p_services) with ordinality as service(value, ordinality)
    join public.tenant_activities activity
      on activity.tenant_id = v_tenant
     and activity.legacy_code = service.value ->> 'activity_code';

  update public.tenants
     set onboarding_completed_at = coalesce(onboarding_completed_at, now())
   where id = v_tenant
   returning onboarding_completed_at into v_completed_at;

  return v_completed_at;
end;
$$;

create or replace function public.complete_tenant_onboarding()
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
    raise exception 'Seul le propriétaire peut terminer la configuration.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.tenant_activities where tenant_id = v_tenant)
     or not exists (select 1 from public.tenant_services where tenant_id = v_tenant) then
    raise exception 'Ajoutez au moins une activité et une prestation avant de continuer.' using errcode = '22023';
  end if;

  update public.tenants
     set onboarding_completed_at = coalesce(onboarding_completed_at, now())
   where id = v_tenant
   returning onboarding_completed_at into v_completed_at;

  return v_completed_at;
end;
$$;

comment on table public.tenant_activities is
  'Activités personnalisées par pressing, modifiables par son propriétaire.';
comment on column public.tenant_services.activity_id is
  'Activité parente de la prestation, dans le même pressing.';
comment on function public.complete_tenant_onboarding() is
  'Termine l’onboarding après vérification d’au moins une activité et une prestation.';

revoke all on function public.save_tenant_services(jsonb) from public, anon;
grant execute on function public.save_tenant_services(jsonb) to authenticated;
revoke all on function public.complete_tenant_onboarding() from public, anon;
grant execute on function public.complete_tenant_onboarding() to authenticated;

commit;
