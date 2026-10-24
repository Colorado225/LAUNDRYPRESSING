-- =============================================================================
-- Vérifications des modèles au kilo/forfait et de leur isolation (016)
-- =============================================================================

do $$
declare
  v_tenant uuid := '66666666-6666-4666-8666-666666666601';
  v_other_tenant uuid := '66666666-6666-4666-8666-666666666602';
  v_user uuid := '66666666-6666-4666-8666-666666666699';
  v_service uuid;
  v_other_service uuid;
  v_model uuid;
  v_line_model uuid;
  v_order uuid := gen_random_uuid();
  v_item uuid;
  v_package_item uuid;
  v_refus boolean;
  v_count integer;
begin
  insert into public.tenants (id, name) values (v_tenant, 'Modèles commerciaux')
    on conflict (id) do nothing;
  insert into public.tenants (id, name) values (v_other_tenant, 'Autre pressing')
    on conflict (id) do nothing;
  insert into auth.users (id, email) values (v_user, 'laundry-models@local.invalid')
    on conflict (id) do nothing;
  insert into public.orders (
    id, tenant_id, customer_name, customer_phone, qr_code, total_amount
  ) values (
    v_order, v_tenant, 'Client modèle', '+2250700000066', 'laundry-model-' || v_order::text, 9200
  );
  insert into public.catalog_services (tenant_id, name)
    values (v_tenant, 'Lavage standard') returning id into v_service;
  insert into public.catalog_services (tenant_id, name)
    values (v_other_tenant, 'Service privé') returning id into v_other_service;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_user::text,
      'app_metadata', jsonb_build_object('tenant_id', v_tenant::text, 'tenant_role', 'owner')
    )::text,
    false
  );
  execute 'set role authenticated';

  v_model := public.save_laundry_model(
    json_build_object(
      'name', 'Linge au kilo', 'model_type', 'PER_KG', 'audience', 'ALL',
      'price_per_kg', 1200, 'billing_increment_kg', 0.1,
      'minimum_weight_kg', 1, 'minimum_charge', 1500,
      'is_active', true, 'sort_order', 1
    ),
    json_build_array(json_build_object(
      'service_id', v_service, 'inclusion_mode', 'INCLUDED', 'sort_order', 0
    ))
  );

  if not exists (
    select 1 from public.laundry_models
     where id = v_model and tenant_id = v_tenant
       and model_type = 'PER_KG' and price_per_kg = 1200 and minimum_weight_kg = 1
  ) then
    raise exception 'Le modèle au kilo n''a pas été enregistré avec ses paramètres.';
  end if;
  select count(*) into v_count from public.laundry_model_services
   where tenant_id = v_tenant and model_id = v_model and service_id = v_service
     and inclusion_mode = 'INCLUDED';
  if v_count <> 1 then raise exception 'La prestation incluse n''a pas été enregistrée.'; end if;

  perform public.save_laundry_model(
    json_build_object(
      'id', v_model, 'name', 'Forfait linge 5 kg', 'model_type', 'WEIGHT_PACKAGE',
      'audience', 'PROFESSIONAL', 'package_price', 6000, 'included_weight_kg', 5,
      'overage_price_per_kg', 800, 'billing_increment_kg', 0.1,
      'conditions', 'Sur rendez-vous', 'is_active', true, 'sort_order', 1
    ),
    json_build_array(json_build_object(
      'service_id', v_service, 'inclusion_mode', 'EXTRA', 'sort_order', 0
    ))
  );
  if not exists (
    select 1 from public.laundry_models
     where id = v_model and model_type = 'WEIGHT_PACKAGE'
       and package_price = 6000 and included_weight_kg = 5 and price_per_kg is null
  ) then
    raise exception 'Le passage au forfait n''a pas remplacé les champs incompatibles.';
  end if;
  if not exists (
    select 1 from public.laundry_model_services
     where model_id = v_model and service_id = v_service and inclusion_mode = 'EXTRA'
  ) then
    raise exception 'La mise à jour de la prestation supplémentaire a échoué.';
  end if;

  v_line_model := public.save_laundry_model(
    json_build_object(
      'name', 'Lavage au kilo', 'model_type', 'PER_KG', 'audience', 'ALL',
      'price_per_kg', 1000, 'minimum_weight_kg', 1,
      'billing_increment_kg', 0.1, 'minimum_charge', 1500,
      'is_active', true, 'sort_order', 2
    ), '[]'::json
  );

  insert into public.order_items (
    id, order_id, tenant_id, label, price, quantity, billed_quantity,
    billing_unit, unit_price, laundry_model_id, laundry_weight_kg, price_reason
  ) values (
    gen_random_uuid(), v_order, v_tenant, 'Forfait linge 5 kg', 6800, 1, 1,
    'FLAT', 6800, v_model, 6, 'Modèle commercial : forfait linge 5 kg'
  ) returning id into v_item;
  if not exists (
    select 1 from public.order_items
     where id = v_item and laundry_model_type_snapshot = 'WEIGHT_PACKAGE'
       and laundry_model_name_snapshot = 'Forfait linge 5 kg'
       and laundry_weight_kg = 6 and price = 6800
       and billing_unit = 'FLAT' and laundry_package_price_snapshot = 6000
       and laundry_overage_price_per_kg_snapshot = 800
       and laundry_price_breakdown_snapshot like '%kg supplémentaire%'
  ) then
    raise exception 'Le forfait ne conserve pas son poids, son calcul et ses instantanés.';
  end if;
  v_package_item := v_item;

  insert into public.order_items (
    order_id, tenant_id, label, price, quantity, billing_unit, unit_price,
    laundry_model_id, laundry_weight_kg, price_reason
  ) values (
    v_order, v_tenant, 'Lavage au kilo', 2400, 1, 'FLAT', 2400,
    v_line_model, 2.35, 'Modèle commercial : lavage au kilo'
  ) returning id into v_item;
  if not exists (
    select 1 from public.order_items
     where id = v_item and laundry_model_type_snapshot = 'PER_KG'
       and laundry_weight_kg = 2.35 and quantity = 2.35 and billed_quantity = 2.4
       and billing_unit = 'KG' and unit_price = 1000 and price = 2400
       and minimum_quantity_snapshot = 1 and billing_increment_snapshot = 0.1
  ) then
    raise exception 'Le tarif au kilo n''a pas été recalculé côté serveur.';
  end if;

  v_refus := false;
  begin
    insert into public.order_items (
      order_id, tenant_id, label, price, quantity, billing_unit, unit_price,
      laundry_model_id, laundry_weight_kg, price_reason
    ) values (
      v_order, v_tenant, 'Forfait falsifié', 6000, 1, 'FLAT', 6000,
      v_model, 6, 'Modèle commercial : forfait modifié'
    );
  exception when invalid_parameter_value then
    v_refus := true;
  end;
  if not v_refus then raise exception 'Un prix de forfait falsifié a été accepté.'; end if;

  perform public.save_laundry_model(
    json_build_object(
      'id', v_model, 'name', 'Forfait linge 5 kg', 'model_type', 'WEIGHT_PACKAGE',
      'audience', 'PROFESSIONAL', 'package_price', 6000, 'included_weight_kg', 5,
      'overage_price_per_kg', 800, 'billing_increment_kg', 0.1,
      'conditions', 'Sur rendez-vous', 'is_active', false, 'sort_order', 1
    ), '[]'::json
  );
  v_refus := false;
  begin
    insert into public.order_items (
      order_id, tenant_id, label, price, quantity, billing_unit, unit_price,
      laundry_model_id, laundry_weight_kg, price_reason
    ) values (
      v_order, v_tenant, 'Forfait archivé', 6800, 1, 'FLAT', 6800,
      v_model, 6, 'Modèle commercial : forfait archivé'
    );
  exception when foreign_key_violation then
    v_refus := true;
  end;
  if not v_refus then raise exception 'Un modèle archivé a été proposé à une nouvelle commande.'; end if;
  if not exists (
    select 1 from public.order_items
     where id = v_package_item and price = 6800
       and laundry_model_name_snapshot = 'Forfait linge 5 kg'
       and laundry_price_breakdown_snapshot like '%kg supplémentaire%'
  ) then
    raise exception 'L''archivage du modèle a altéré l''instantané d''une ancienne ligne.';
  end if;

  v_refus := false;
  begin
    perform public.save_laundry_model(
      json_build_object(
        'name', 'Forfait inter-pressings', 'model_type', 'WEIGHT_PACKAGE',
        'package_price', 1000, 'included_weight_kg', 1
      ),
      json_build_array(json_build_object(
        'service_id', v_other_service, 'inclusion_mode', 'INCLUDED'
      ))
    );
  exception when foreign_key_violation then
    v_refus := true;
  end;
  if not v_refus then raise exception 'Une prestation d''un autre pressing a été acceptée.'; end if;
  if exists (select 1 from public.laundry_models where name = 'Forfait inter-pressings') then
    raise exception 'Un modèle partiel a persisté après le refus atomique.';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_user::text,
      'app_metadata', jsonb_build_object('tenant_id', v_tenant::text, 'tenant_role', 'artisan')
    )::text,
    false
  );
  v_refus := false;
  begin
    perform public.save_laundry_model(
      json_build_object(
        'id', v_model, 'name', 'Modification interdite', 'model_type', 'WEIGHT_PACKAGE',
        'package_price', 6000, 'included_weight_kg', 5
      ), '[]'::json
    );
  exception when insufficient_privilege then
    v_refus := true;
  end;
  if not v_refus then raise exception 'Un artisan a pu modifier un modèle commercial.'; end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', false);
  delete from public.tenants where id in (v_tenant, v_other_tenant);
  set constraints all immediate;
  raise notice 'OK modèles au kilo/forfait, prestations, atomisation et isolation des rôles/tenants';
end;
$$;
