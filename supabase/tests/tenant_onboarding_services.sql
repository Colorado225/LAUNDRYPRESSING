-- =============================================================================
-- tenant_onboarding_services.sql — CRUD relationnel, RLS et onboarding
-- =============================================================================
-- À exécuter après les migrations 021 et 022 sur une base locale jetable.
-- Tout se termine par ROLLBACK ; aucun compte ou pressing réel n'est touché.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'onboarding-owner@test.local'),
  ('00000000-0000-4000-8000-0000000000c2', 'onboarding-reception@test.local'),
  ('00000000-0000-4000-8000-0000000000c3', 'autre-pressing@test.local')
on conflict (id) do nothing;

insert into public.tenants (id, name) values
  ('33333333-3333-4333-8333-333333333331', 'Pressing Onboarding'),
  ('33333333-3333-4333-8333-333333333332', 'Autre Pressing')
on conflict (id) do nothing;

insert into public.tenant_users (user_id, tenant_id, role) values
  ('00000000-0000-4000-8000-0000000000c1', '33333333-3333-4333-8333-333333333331', 'owner'),
  ('00000000-0000-4000-8000-0000000000c2', '33333333-3333-4333-8333-333333333331', 'receptionist'),
  ('00000000-0000-4000-8000-0000000000c3', '33333333-3333-4333-8333-333333333332', 'owner')
on conflict (user_id, tenant_id) do nothing;

-- Un nouveau tenant doit réellement apparaître comme non configuré.
do $$
begin
  if (select onboarding_completed_at from public.tenants where id = '33333333-3333-4333-8333-333333333331') is not null then
    raise exception 'ECHEC 1 : un nouveau pressing est marqué comme configuré';
  end if;
  raise notice 'OK 1 — un nouveau pressing démarre avec l’onboarding à faire.';
end $$;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '00000000-0000-4000-8000-0000000000c1', 'role', 'authenticated')::text,
  true
);
select set_config('request.headers', '{"x-tenant-id":"33333333-3333-4333-8333-333333333331"}', true);
set local role authenticated;

-- L'ancien RPC reste compatible : ses codes sont convertis en activités
-- relationnelles et la migration des lignes historiques est vérifiée.
select public.save_tenant_services('[
  {"activity_code":"pressing","service_name":"Lavage et repassage"},
  {"activity_code":"pressing","service_name":"Détachage spécial"},
  {"activity_code":"retouches","service_name":"Ourlet"}
]'::jsonb);

do $$
declare
  v_services integer;
  v_activities integer;
begin
  select count(*) into v_services from public.tenant_services;
  select count(*) into v_activities from public.tenant_activities;
  if v_services <> 3 or v_activities <> 2 then
    raise exception 'ECHEC 2 : % prestations / % activités (3 / 2 attendues)', v_services, v_activities;
  end if;
  if exists (
    select 1 from public.tenant_services s
     left join public.tenant_activities a on a.id = s.activity_id and a.tenant_id = s.tenant_id
     where a.id is null
  ) then
    raise exception 'ECHEC 3 : une prestation n''a pas son activité parente';
  end if;
  if (select onboarding_completed_at from public.tenants where id = '33333333-3333-4333-8333-333333333331') is null then
    raise exception 'ECHEC 4 : l’ancien RPC n’a pas terminé l’onboarding';
  end if;
  raise notice 'OK 2 — conversion héritée : activités, prestations liées et onboarding.';

  if (select count(*) from public.tenant_services where tenant_id = '33333333-3333-4333-8333-333333333332') <> 0
     or (select count(*) from public.tenant_activities where tenant_id = '33333333-3333-4333-8333-333333333332') <> 0 then
    raise exception 'ECHEC 5 : fuite des données vers un autre pressing';
  end if;
  raise notice 'OK 3 — isolation : aucune activité ou prestation étrangère visible.';
end $$;

-- CRUD direct sous RLS : ajouter, renommer et supprimer une activité et sa
-- prestation enfant. La suppression de l'activité doit cascader vers la ligne.
do $$
declare
  v_activity uuid;
  v_service uuid;
begin
  insert into public.tenant_activities (tenant_id, name)
  values ('33333333-3333-4333-8333-333333333331', 'Nettoyage ameublement')
  returning id into v_activity;

  insert into public.tenant_services (tenant_id, activity_id, service_name)
  values ('33333333-3333-4333-8333-333333333331', v_activity, 'Canapé trois places')
  returning id into v_service;

  update public.tenant_activities set name = 'Nettoyage de meubles' where id = v_activity;
  update public.tenant_services set service_name = 'Canapé grand format' where id = v_service;

  if (select name from public.tenant_activities where id = v_activity) <> 'Nettoyage de meubles'
     or (select service_name from public.tenant_services where id = v_service) <> 'Canapé grand format' then
    raise exception 'ECHEC 6 : les modifications CRUD ne sont pas enregistrées';
  end if;

  delete from public.tenant_activities where id = v_activity;
  if exists (select 1 from public.tenant_services where id = v_service) then
    raise exception 'ECHEC 7 : suppression parent sans cascade de la prestation';
  end if;
  raise notice 'OK 4 — CRUD propriétaire : create, update et delete en cascade.';

  perform public.complete_tenant_onboarding();
  raise notice 'OK 5 — la fonction sécurisée termine la configuration.';
end $$;

reset role;

-- Un réceptionniste peut lire, mais ne peut pas créer ou supprimer la
-- configuration; la règle est imposée par PostgreSQL, pas par l'interface.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '00000000-0000-4000-8000-0000000000c2', 'role', 'authenticated')::text,
  true
);
set local role authenticated;
do $$
declare v_code text;
begin
  begin
    insert into public.tenant_activities (tenant_id, name)
    values ('33333333-3333-4333-8333-333333333331', 'Activité interdite');
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate;
  end;
  if v_code is distinct from '42501' then
    raise exception 'ECHEC 8 : écriture réceptionniste refusée avec SQLSTATE % (42501 attendu)', v_code;
  end if;
  raise notice 'OK 6 — RLS : un réceptionniste ne modifie pas les activités.';
end $$;

rollback;
