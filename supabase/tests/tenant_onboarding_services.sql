-- =============================================================================
-- tenant_onboarding_services.sql — onboarding et isolation des prestations
-- =============================================================================
-- À exécuter après la migration 021 sur une base locale jetable. Tout se termine
-- par ROLLBACK ; aucun compte ou pressing réel n'est touché.
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

-- Le propriétaire peut enregistrer ses activités et terminer l'onboarding.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '00000000-0000-4000-8000-0000000000c1', 'role', 'authenticated')::text,
  true
);
select set_config('request.headers', '{"x-tenant-id":"33333333-3333-4333-8333-333333333331"}', true);
set local role authenticated;

select public.save_tenant_services('[
  {"activity_code":"pressing","service_name":"Lavage et repassage"},
  {"activity_code":"pressing","service_name":"Détachage spécial"},
  {"activity_code":"retouches","service_name":"Ourlet"}
]'::jsonb);

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.tenant_services;
  if v_count <> 3 then
    raise exception 'ECHEC 2 : % prestations visibles, 3 attendues', v_count;
  end if;
  if (select onboarding_completed_at from public.tenants where id = '33333333-3333-4333-8333-333333333331') is null then
    raise exception 'ECHEC 3 : l’onboarding n’a pas été marqué comme terminé';
  end if;
  raise notice 'OK 2 — propriétaire : prestations enregistrées et onboarding terminé.';

  if (select count(*) from public.tenant_services where tenant_id = '33333333-3333-4333-8333-333333333332') <> 0 then
    raise exception 'ECHEC 4 : fuite des prestations vers un autre pressing';
  end if;
  raise notice 'OK 3 — isolation : les prestations d’un autre pressing restent invisibles.';
end $$;

reset role;

-- Un réceptionniste peut lire mais pas remplacer la configuration du propriétaire.
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
    perform public.save_tenant_services('[{"activity_code":"pressing","service_name":"Intrusion"}]'::jsonb);
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate;
  end;
  if v_code is distinct from '42501' then
    raise exception 'ECHEC 5 : écriture réceptionniste refusée avec SQLSTATE % (42501 attendu)', v_code;
  end if;
  raise notice 'OK 4 — la configuration reste réservée au propriétaire.';
end $$;

rollback;
