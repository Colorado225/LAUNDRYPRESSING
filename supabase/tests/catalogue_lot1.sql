-- =============================================================================
-- catalogue_lot1.sql — catalogue : installation, isolation, prix obligatoires
-- =============================================================================
-- À exécuter après 027. Transaction jetable, annulée à la fin.
-- Couvre CAT-002/003/004/006/007 et la garde serveur des prix (Lot 1).
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'catalogue-owner@test.local'),
  ('00000000-0000-4000-8000-0000000000e2', 'catalogue-autre@test.local')
on conflict (id) do nothing;
insert into public.tenants (id, name) values
  ('55555555-5555-4555-8555-555555555551', 'Pressing Catalogue'),
  ('55555555-5555-4555-8555-555555555552', 'Pressing Voisin')
on conflict (id) do nothing;
insert into public.tenant_users (user_id, tenant_id, role) values
  ('00000000-0000-4000-8000-0000000000e1', '55555555-5555-4555-8555-555555555551', 'owner'),
  ('00000000-0000-4000-8000-0000000000e2', '55555555-5555-4555-8555-555555555552', 'owner')
on conflict (user_id, tenant_id) do nothing;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '00000000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text,
  true
);
select set_config('request.headers', '{"x-tenant-id":"55555555-5555-4555-8555-555555555551"}', true);
set local role authenticated;

do $$
declare
  v_tenant constant uuid := '55555555-5555-4555-8555-555555555551';
  v_result jsonb;
  v_activity uuid;
  v_service uuid;
  v_chemise uuid;
  v_sqlstate text;
begin
  -- CAT-006 : l'installation clone la bibliothèque, sans aucun prix.
  v_result := public.install_catalog_reference();
  if (v_result ->> 'articles_crees')::int < 40 then
    raise exception 'ECHEC 1 : installation incomplète (% articles)', v_result;
  end if;
  if exists (select 1 from public.service_garment_prices where tenant_id = v_tenant) then
    raise exception 'ECHEC 2 : l''installation ne doit créer aucun prix';
  end if;
  raise notice 'OK 1 — catalogue de référence installé sans prix (CAT-006).';

  -- CAT-007 : second appel idempotent, aucun doublon.
  v_result := public.install_catalog_reference();
  if (v_result ->> 'articles_crees')::int <> 0 then
    raise exception 'ECHEC 3 : la réinstallation a créé des doublons (%)', v_result;
  end if;
  raise notice 'OK 2 — réinstallation sans doublon (CAT-007).';

  select id into v_chemise from public.garment_types
   where tenant_id = v_tenant and code = 'SHIRT';

  -- CAT-002 : même code deux fois dans le même pressing → rejet.
  begin
    insert into public.garment_types (tenant_id, category_id, code, name)
    select v_tenant, category_id, 'SHIRT', 'Chemise bis'
      from public.garment_types where id = v_chemise;
    raise exception 'ECHEC 4 : code en double accepté dans le même pressing';
  exception when unique_violation then
    raise notice 'OK 3 — code en double rejeté dans le pressing (CAT-002).';
  end;

  -- CAT-004 : la bibliothèque système est en lecture seule pour un pressing.
  update public.garment_types set name = 'Piratée' where tenant_id is null and code = 'SHIRT';
  if exists (select 1 from public.garment_types where tenant_id is null and name = 'Piratée') then
    raise exception 'ECHEC 5 : un pressing a modifié la bibliothèque système';
  end if;
  raise notice 'OK 4 — bibliothèque système non modifiable (CAT-005).';

  -- Prestation de test rattachée au pressing.
  insert into public.tenant_activities (tenant_id, name)
  values (v_tenant, 'Pressing') returning id into v_activity;
  insert into public.tenant_services (tenant_id, activity_id, service_name, code)
  values (v_tenant, v_activity, 'Lavage + repassage', 'WASH_IRON')
  returning id into v_service;

  insert into public.orders (id, tenant_id, customer_name, customer_phone, qr_code, total_amount)
  values ('55555555-5555-4555-8555-555555555553', v_tenant, 'Cliente Catalogue', '0700000002', 'CMD-CATALOGUE-1', 800);

  -- Ligne catalogue sans tarif configuré → refusée (jamais assimilée à zéro).
  begin
    insert into public.order_items (
      id, order_id, tenant_id, label, price, quantity, billed_quantity,
      billing_unit, unit_price, pricing_mode, price_status,
      tenant_service_id, activity_name_snapshot, service_name, garment_type_id
    ) values (
      '55555555-5555-4555-8555-555555555554',
      '55555555-5555-4555-8555-555555555553', v_tenant,
      'Chemise', 800, 1, 1, 'PIECE', 800, 'FIXED', 'CONFIRMED',
      v_service, 'Pressing', 'Lavage + repassage', v_chemise
    );
    raise exception 'ECHEC 6 : ligne vendue sans tarif configuré';
  exception when check_violation then
    raise notice 'OK 5 — tarif non configuré refusé côté serveur (UI-002/API-001).';
  end;

  -- Prix configuré : la ligne au tarif de grille passe.
  insert into public.service_garment_prices (tenant_id, tenant_service_id, garment_type_id, price_xof)
  values (v_tenant, v_service, v_chemise, 800);

  insert into public.order_items (
    id, order_id, tenant_id, label, price, quantity, billed_quantity,
    billing_unit, unit_price, pricing_mode, price_status,
    tenant_service_id, activity_name_snapshot, service_name, garment_type_id
  ) values (
    '55555555-5555-4555-8555-555555555555',
    '55555555-5555-4555-8555-555555555553', v_tenant,
    'Chemise', 1600, 2, 2, 'PIECE', 800, 'FIXED', 'CONFIRMED',
    v_service, 'Pressing', 'Lavage + repassage', v_chemise
  );
  raise notice 'OK 6 — ligne au tarif catalogue acceptée (INT-001).';

  -- Dérogation sans motif → refusée ; avec motif ≥ 10 caractères → tracée.
  begin
    insert into public.order_items (
      id, order_id, tenant_id, label, price, quantity, billed_quantity,
      billing_unit, unit_price, pricing_mode, price_status,
      tenant_service_id, activity_name_snapshot, service_name, garment_type_id
    ) values (
      '55555555-5555-4555-8555-555555555556',
      '55555555-5555-4555-8555-555555555553', v_tenant,
      'Chemise', 500, 1, 1, 'PIECE', 500, 'FIXED', 'CONFIRMED',
      v_service, 'Pressing', 'Lavage + repassage', v_chemise
    );
    raise exception 'ECHEC 7 : dérogation de prix sans motif acceptée';
  exception when check_violation then
    raise notice 'OK 7 — dérogation sans motif refusée.';
  end;

  -- Catalogue obligatoire : ligne libre à la pièce refusée après installation.
  begin
    insert into public.order_items (
      id, order_id, tenant_id, label, price, quantity, billed_quantity,
      billing_unit, unit_price, pricing_mode, price_status
    ) values (
      '55555555-5555-4555-8555-555555555557',
      '55555555-5555-4555-8555-555555555553', v_tenant,
      'Article libre', 1000, 1, 1, 'PIECE', 1000, 'FIXED', 'CONFIRMED'
    );
    raise exception 'ECHEC 8 : ligne libre acceptée malgré le catalogue obligatoire';
  exception when check_violation then
    raise notice 'OK 8 — ligne libre refusée, catalogue obligatoire après installation.';
  end;
end;
$$;

-- CAT-003 : même code dans un second pressing, données isolées.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '00000000-0000-4000-8000-0000000000e2', 'role', 'authenticated')::text,
  true
);
select set_config('request.headers', '{"x-tenant-id":"55555555-5555-4555-8555-555555555552"}', true);

do $$
declare
  v_voisin constant uuid := '55555555-5555-4555-8555-555555555552';
begin
  perform public.install_catalog_reference();
  if not exists (
    select 1 from public.garment_types where tenant_id = v_voisin and code = 'SHIRT'
  ) then
    raise exception 'ECHEC 9 : le code SHIRT doit pouvoir exister dans le second pressing';
  end if;
  -- CAT-004 : aucun prix du premier pressing n'est visible ici.
  if exists (select 1 from public.service_garment_prices) then
    raise exception 'ECHEC 10 : les prix d''un autre pressing sont lisibles';
  end if;
  raise notice 'OK 9 — codes réutilisables entre pressings, prix isolés (CAT-003/004).';
end;
$$;

rollback;
