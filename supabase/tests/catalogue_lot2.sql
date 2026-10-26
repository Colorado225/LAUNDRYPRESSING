-- =============================================================================
-- catalogue_lot2.sql — kilo par tranches, modèles et forfaits (028 + 029)
-- =============================================================================
-- Couvre PRICE-002/003/004/006 et les bases modèles/forfaits.
-- Transaction jetable, annulée à la fin.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000f1', 'lot2-owner@test.local')
on conflict (id) do nothing;
insert into public.tenants (id, name) values
  ('66666666-6666-4666-8666-666666666661', 'Pressing Lot 2')
on conflict (id) do nothing;
insert into public.tenant_users (user_id, tenant_id, role) values
  ('00000000-0000-4000-8000-0000000000f1', '66666666-6666-4666-8666-666666666661', 'owner')
on conflict (user_id, tenant_id) do nothing;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '00000000-0000-4000-8000-0000000000f1', 'role', 'authenticated')::text,
  true
);
select set_config('request.headers', '{"x-tenant-id":"66666666-6666-4666-8666-666666666661"}', true);
set local role authenticated;

do $$
declare
  v_tenant constant uuid := '66666666-6666-4666-8666-666666666661';
  v_activity uuid;
  v_kilo_progressif uuid;
  v_kilo_flat uuid;
  v_rule uuid;
  v_quote jsonb;
  v_profile uuid;
  v_profile_copie uuid;
  v_package uuid;
begin
  perform public.install_catalog_reference();

  insert into public.tenant_activities (tenant_id, name)
  values (v_tenant, 'Blanchisserie') returning id into v_activity;
  insert into public.tenant_services (tenant_id, activity_id, service_name, billing_unit, unit_price)
  values (v_tenant, v_activity, 'Lavage au kilo progressif', 'KG', null)
  returning id into v_kilo_progressif;
  insert into public.tenant_services (tenant_id, activity_id, service_name, billing_unit, unit_price)
  values (v_tenant, v_activity, 'Lavage au kilo simple', 'KG', null)
  returning id into v_kilo_flat;

  -- Règle progressive : 5 kg à 700, 5 kg à 600, reste à 500 (spec PRICE-004).
  insert into public.pricing_rules (tenant_id, tenant_service_id, rule_name, rule_mode)
  values (v_tenant, v_kilo_progressif, 'Progressive standard', 'progressive_tiers')
  returning id into v_rule;
  insert into public.pricing_rule_tiers (pricing_rule_id, min_kg, max_kg, price_per_kg_xof) values
    (v_rule, 0, 5, 700),
    (v_rule, 5, 10, 600),
    (v_rule, 10, null, 500);

  v_quote := public.quote_weight_price(v_kilo_progressif, 12);
  if (v_quote ->> 'montant')::int <> 7500 then
    raise exception 'ECHEC 1 : progressive 12 kg attendu 7500, obtenu %', v_quote;
  end if;
  v_quote := public.quote_weight_price(v_kilo_progressif, 5);
  if (v_quote ->> 'montant')::int <> 3500 then
    raise exception 'ECHEC 2 : 5 kg attendu 3500, obtenu %', v_quote;
  end if;
  raise notice 'OK 1 — progressif 12 kg = 7 500 et 5 kg = 3 500 (PRICE-002/004).';

  -- PRICE-006 : chevauchement de tranches refusé.
  begin
    insert into public.pricing_rule_tiers (pricing_rule_id, min_kg, max_kg, price_per_kg_xof)
    values (v_rule, 4, 6, 650);
    raise exception 'ECHEC 3 : tranche chevauchante acceptée';
  exception when check_violation then
    raise notice 'OK 2 — chevauchement de tranches refusé (PRICE-006).';
  end;

  -- Règle flat_rate : 12 kg tombe dans la tranche >= 10 kg à 600 → 7 200.
  insert into public.pricing_rules (tenant_id, tenant_service_id, rule_name, rule_mode)
  values (v_tenant, v_kilo_flat, 'Simple par palier', 'flat_rate')
  returning id into v_rule;
  insert into public.pricing_rule_tiers (pricing_rule_id, min_kg, max_kg, price_per_kg_xof) values
    (v_rule, 0, 10, 700),
    (v_rule, 10, null, 600);
  v_quote := public.quote_weight_price(v_kilo_flat, 12);
  if (v_quote ->> 'montant')::int <> 7200 then
    raise exception 'ECHEC 4 : flat_rate 12 kg attendu 7200, obtenu %', v_quote;
  end if;
  raise notice 'OK 3 — flat_rate 12 kg = 7 200 (PRICE-003).';

  -- Garde ligne au kilo : total juste accepté, poids facturé figé.
  insert into public.orders (id, tenant_id, customer_name, customer_phone, qr_code, total_amount)
  values ('66666666-6666-4666-8666-666666666662', v_tenant, 'Cliente Kilo', '0700000003', 'CMD-LOT2-1', 7500);
  insert into public.order_items (
    id, order_id, tenant_id, label, price, quantity, billed_quantity,
    billing_unit, unit_price, pricing_mode, price_status,
    tenant_service_id, activity_name_snapshot, service_name
  ) values (
    '66666666-6666-4666-8666-666666666663',
    '66666666-6666-4666-8666-666666666662', v_tenant,
    'Lavage au kilo progressif', 7500, 12, 12, 'KG', 625, 'FIXED', 'CONFIRMED',
    v_kilo_progressif, 'Blanchisserie', 'Lavage au kilo progressif'
  );

  begin
    insert into public.order_items (
      id, order_id, tenant_id, label, price, quantity, billed_quantity,
      billing_unit, unit_price, pricing_mode, price_status,
      tenant_service_id, activity_name_snapshot, service_name
    ) values (
      '66666666-6666-4666-8666-666666666664',
      '66666666-6666-4666-8666-666666666662', v_tenant,
      'Lavage au kilo progressif', 1000, 12, 12, 'KG', 83, 'FIXED', 'CONFIRMED',
      v_kilo_progressif, 'Blanchisserie', 'Lavage au kilo progressif'
    );
    raise exception 'ECHEC 5 : total au kilo incohérent accepté sans motif';
  exception when check_violation then
    raise notice 'OK 4 — total au kilo recalculé côté serveur (API-001 kilo).';
  end;

  -- Modèles : duplication d'un gabarit système en copie indépendante.
  select id into v_profile from public.laundry_profiles
   where tenant_id is null and code = 'OFFRE_PREMIUM';
  v_profile_copie := public.duplicate_laundry_profile(v_profile);
  if not exists (
    select 1 from public.laundry_profiles
     where id = v_profile_copie and tenant_id = v_tenant and profile_kind = 'custom'
  ) then
    raise exception 'ECHEC 6 : copie de modèle non rattachée au pressing';
  end if;
  if (select count(*) from public.laundry_profile_items where profile_id = v_profile_copie) < 5 then
    raise exception 'ECHEC 7 : articles du modèle non copiés';
  end if;
  raise notice 'OK 5 — modèle système dupliqué en copie indépendante.';

  -- Forfait : création + composition rattachée au pressing.
  insert into public.commercial_packages (tenant_id, code, name, price_xof)
  values (v_tenant, 'PACK_FAMILLE', 'Pack famille hebdo', 15000)
  returning id into v_package;
  insert into public.commercial_package_items (tenant_id, package_id, garment_type_id, quantity)
  select v_tenant, v_package, id, 10
    from public.garment_types where tenant_id = v_tenant and code = 'SHIRT';
  if not exists (
    select 1 from public.commercial_package_items where package_id = v_package
  ) then
    raise exception 'ECHEC 8 : composition de forfait non enregistrée';
  end if;
  raise notice 'OK 6 — forfait commercial créé avec sa composition.';
end;
$$;

rollback;
