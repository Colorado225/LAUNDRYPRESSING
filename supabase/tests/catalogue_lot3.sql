-- =============================================================================
-- catalogue_lot3.sql — forfaits au nombre de vêtements (migration 030)
-- =============================================================================
-- Couvre côté serveur BL-002/003/005/006/007/008 : prix indépendant de la
-- répartition des articles, quatre politiques de dépassement, ligne porteuse
-- recalculée et détails à 0 FCFA. Transaction jetable, annulée à la fin.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000f2', 'lot3-owner@test.local')
on conflict (id) do nothing;
insert into public.tenants (id, name) values
  ('77777777-7777-4777-8777-777777777771', 'Blanchisserie Lot 3')
on conflict (id) do nothing;
insert into public.tenant_users (user_id, tenant_id, role) values
  ('00000000-0000-4000-8000-0000000000f2', '77777777-7777-4777-8777-777777777771', 'owner')
on conflict (user_id, tenant_id) do nothing;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '00000000-0000-4000-8000-0000000000f2', 'role', 'authenticated')::text,
  true
);
select set_config('request.headers', '{"x-tenant-id":"77777777-7777-4777-8777-777777777771"}', true);
set local role authenticated;

do $$
declare
  v_tenant constant uuid := '77777777-7777-4777-8777-777777777771';
  v_order constant uuid := '77777777-7777-4777-8777-777777777772';
  v_carrier constant uuid := '77777777-7777-4777-8777-777777777773';
  v_business_model text;
  v_activity uuid;
  v_service uuid;
  v_shirt uuid;
  v_jeans uuid;
  v_extra uuid;
  v_repeat uuid;
  v_reject uuid;
  v_manual uuid;
  v_quote jsonb;
  v_audit_count integer;
begin
  select business_model into v_business_model
    from public.tenants
   where id = v_tenant;
  if v_business_model <> 'MIXTE' then
    raise exception 'ECHEC 1 : modèle d’exploitation par défaut attendu MIXTE, obtenu %', v_business_model;
  end if;
  raise notice 'OK 1 — modèle d’exploitation MIXTE par défaut.';

  perform public.install_catalog_reference();

  insert into public.tenant_activities (tenant_id, name)
  values (v_tenant, 'Blanchisserie') returning id into v_activity;
  insert into public.tenant_services (tenant_id, activity_id, service_name, billing_unit, unit_price)
  values (v_tenant, v_activity, 'Lavage et pliage', 'PIECE', null)
  returning id into v_service;

  select id into v_shirt from public.garment_types
   where tenant_id = v_tenant and code = 'SHIRT';
  select id into v_jeans from public.garment_types
   where tenant_id = v_tenant and code = 'JEANS';
  if v_shirt is null or v_jeans is null then
    raise exception 'ECHEC 2 : articles SHIRT/JEANS absents du catalogue installé';
  end if;

  insert into public.commercial_packages (
    tenant_id, tenant_service_id, code, name, price_xof,
    garments_included, overflow_policy, overflow_unit_price_xof
  ) values (
    v_tenant, v_service, 'PACK_25_EXTRA', 'Pack 25 vêtements', 2000,
    25, 'PER_EXTRA_ITEM', 100
  ) returning id into v_extra;

  insert into public.commercial_packages (
    tenant_id, code, name, price_xof, garments_included, overflow_policy
  ) values (
    v_tenant, 'PACK_25_REPEAT', 'Pack renouvelable', 2000,
    25, 'REPEAT_PACKAGE'
  ) returning id into v_repeat;

  insert into public.commercial_packages (
    tenant_id, code, name, price_xof, garments_included, overflow_policy
  ) values (
    v_tenant, 'PACK_25_REJECT', 'Pack strict', 2000,
    25, 'REJECT_OVER_LIMIT'
  ) returning id into v_reject;

  insert into public.commercial_packages (
    tenant_id, code, name, price_xof, garments_included, overflow_policy
  ) values (
    v_tenant, 'PACK_25_MANUAL', 'Pack sur devis au-delà', 2000,
    25, 'MANUAL_QUOTE'
  ) returning id into v_manual;

  -- BL-002/006 : 25 vêtements = prix du forfait ; 30 = 5 × 100 en plus.
  v_quote := public.quote_package_price(v_extra, 25);
  if (v_quote ->> 'montant')::int <> 2000 then
    raise exception 'ECHEC 3 : 25 vêtements attendu 2000, obtenu %', v_quote;
  end if;
  v_quote := public.quote_package_price(v_extra, 30);
  if (v_quote ->> 'montant')::int <> 2500 or (v_quote ->> 'supplement')::int <> 5 then
    raise exception 'ECHEC 4 : 30 vêtements PER_EXTRA attendu 2500, obtenu %', v_quote;
  end if;
  v_quote := public.quote_package_price(v_repeat, 30);
  if (v_quote ->> 'montant')::int <> 4000 then
    raise exception 'ECHEC 5 : 30 vêtements REPEAT attendu 4000, obtenu %', v_quote;
  end if;
  raise notice 'OK 2 — PER_EXTRA_ITEM et REPEAT_PACKAGE recalculés (BL-002/006).';

  begin
    v_quote := public.quote_package_price(v_reject, 26);
    raise exception 'ECHEC 6 : dépassement REJECT_OVER_LIMIT accepté : %', v_quote;
  exception when sqlstate '22023' then
    raise notice 'OK 3 — REJECT_OVER_LIMIT refuse 26 vêtements (BL-006).';
  end;

  -- MANUAL_QUOTE ne s’applique qu’au dépassement (BL-007).
  v_quote := public.quote_package_price(v_manual, 25);
  if (v_quote ->> 'montant')::int <> 2000 or (v_quote ->> 'manuel_requis')::boolean then
    raise exception 'ECHEC 7 : 25 vêtements sur devis attendu 2000 sans saisie, obtenu %', v_quote;
  end if;
  v_quote := public.quote_package_price(v_manual, 30);
  if not (v_quote ->> 'manuel_requis')::boolean or (v_quote -> 'montant') <> 'null'::jsonb then
    raise exception 'ECHEC 8 : montant manuel non exigé à 30 vêtements : %', v_quote;
  end if;
  v_quote := public.quote_package_price(v_manual, 30, 2700);
  if (v_quote ->> 'montant')::int <> 2700 then
    raise exception 'ECHEC 9 : montant manuel 2700 non retenu : %', v_quote;
  end if;
  raise notice 'OK 4 — MANUAL_QUOTE exigé seulement au-delà des 25 inclus (BL-007).';

  -- Ligne porteuse + détails : 18 chemises + 12 jeans, un seul montant.
  insert into public.orders (id, tenant_id, customer_name, customer_phone, qr_code, total_amount)
  values (v_order, v_tenant, 'Cliente Forfait', '0700000004', 'CMD-LOT3-1', 2500);
  insert into public.order_items (
    id, order_id, tenant_id, label, price, quantity, billed_quantity,
    billing_unit, unit_price, pricing_mode, price_status,
    tenant_service_id, activity_name_snapshot, service_name,
    commercial_package_id, conditions_snapshot
  ) values (
    v_carrier, v_order, v_tenant,
    'Pack 25 vêtements', 2500, 30, 30, 'PACKAGE', 83, 'FIXED', 'CONFIRMED',
    v_service, 'Blanchisserie', 'Lavage et pliage', v_extra,
    '30 vêtements comptés — 25 inclus + 5 × 100 FCFA'
  );
  insert into public.order_items (
    id, order_id, tenant_id, label, price, quantity, billed_quantity,
    billing_unit, unit_price, pricing_mode, price_status,
    tenant_service_id, activity_name_snapshot, service_name,
    garment_type_id, package_line_id
  ) values
    ('77777777-7777-4777-8777-777777777774', v_order, v_tenant,
     'Chemise', 0, 18, 18, 'PIECE', 0, 'FIXED', 'CONFIRMED',
     v_service, 'Blanchisserie', 'Lavage et pliage', v_shirt, v_carrier),
    ('77777777-7777-4777-8777-777777777775', v_order, v_tenant,
     'Jean', 0, 12, 12, 'PIECE', 0, 'FIXED', 'CONFIRMED',
     v_service, 'Blanchisserie', 'Lavage et pliage', v_jeans, v_carrier);
  raise notice 'OK 5 — porteuse à 2 500 et détails à 0 FCFA conservés (BL-008).';

  begin
    insert into public.order_items (
      id, order_id, tenant_id, label, price, quantity, billed_quantity,
      billing_unit, unit_price, pricing_mode, price_status,
      tenant_service_id, activity_name_snapshot, service_name,
      commercial_package_id
    ) values (
      '77777777-7777-4777-8777-777777777776', v_order, v_tenant,
      'Pack 25 vêtements', 2400, 30, 30, 'PACKAGE', 80, 'FIXED', 'CONFIRMED',
      v_service, 'Blanchisserie', 'Lavage et pliage', v_extra
    );
    raise exception 'ECHEC 10 : porteuse à 2400 acceptée sans motif';
  exception when check_violation then
    raise notice 'OK 6 — total de forfait différent refusé sans motif (API-001).';
  end;

  begin
    insert into public.order_items (
      id, order_id, tenant_id, label, price, quantity, billed_quantity,
      billing_unit, unit_price, pricing_mode, price_status,
      garment_type_id, package_line_id
    ) values (
      '77777777-7777-4777-8777-777777777777', v_order, v_tenant,
      'Chemise', 100, 1, 1, 'PIECE', 100, 'FIXED', 'CONFIRMED',
      v_shirt, v_carrier
    );
    raise exception 'ECHEC 11 : détail de forfait facturé accepté';
  exception when check_violation then
    raise notice 'OK 7 — détail inclus au forfait obligatoirement à 0 FCFA.';
  end;

  begin
    insert into public.order_items (
      id, order_id, tenant_id, label, price, quantity, billed_quantity,
      billing_unit, unit_price, pricing_mode, price_status,
      commercial_package_id
    ) values (
      '77777777-7777-4777-8777-777777777778', v_order, v_tenant,
      'Pack strict', 2000, 26, 26, 'PACKAGE', 77, 'FIXED', 'CONFIRMED', v_reject
    );
    raise exception 'ECHEC 12 : porteuse REJECT_OVER_LIMIT à 26 acceptée';
  exception when check_violation then
    raise notice 'OK 8 — garde ligne : dépassement strict refusé.';
  end;

  -- Devis manuel : montant positif accepté, zéro refusé.
  insert into public.orders (id, tenant_id, customer_name, customer_phone, qr_code, total_amount)
  values ('77777777-7777-4777-8777-777777777779', v_tenant, 'Cliente Devis', '0700000005', 'CMD-LOT3-2', 2700);
  insert into public.order_items (
    id, order_id, tenant_id, label, price, quantity, billed_quantity,
    billing_unit, unit_price, pricing_mode, price_status,
    commercial_package_id
  ) values (
    '77777777-7777-4777-8777-77777777777a',
    '77777777-7777-4777-8777-777777777779', v_tenant,
    'Pack sur devis au-delà', 2700, 30, 30, 'PACKAGE', 90, 'FIXED', 'CONFIRMED', v_manual
  );
  begin
    insert into public.order_items (
      id, order_id, tenant_id, label, price, quantity, billed_quantity,
      billing_unit, unit_price, pricing_mode, price_status,
      commercial_package_id
    ) values (
      '77777777-7777-4777-8777-77777777777b',
      '77777777-7777-4777-8777-777777777779', v_tenant,
      'Pack sur devis au-delà', 0, 30, 30, 'PACKAGE', 0, 'FIXED', 'CONFIRMED', v_manual
    );
    raise exception 'ECHEC 13 : devis manuel à 0 FCFA accepté';
  exception when check_violation then
    raise notice 'OK 9 — devis manuel positif exigé (BL-007).';
  end;

  select count(*) into v_audit_count
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and not t.tgisinternal
     and t.tgname = 'trg_audit_' || c.relname
     and c.relname in (
       'garment_categories', 'garment_types', 'service_garment_prices',
       'pricing_rules', 'laundry_profiles', 'commercial_packages',
       'commercial_package_items'
     );
  if v_audit_count <> 7 then
    raise exception 'ECHEC 14 : 7 déclencheurs d’audit catalogue attendus, obtenus %', v_audit_count;
  end if;
  raise notice 'OK 10 — audit étendu aux sept tables catalogue.';
end;
$$;

rollback;
