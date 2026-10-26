-- Vérifications post-migration 020 : le modèle libre de lignes fonctionne,
-- tandis que le catalogue et les modèles commerciaux ont disparu.
do $$
declare
  v_tenant uuid := '82000000-0000-4000-8000-000000000001';
  v_user uuid := '82000000-0000-4000-8000-000000000002';
  v_order uuid := '82000000-0000-4000-8000-000000000003';
  v_line uuid := '82000000-0000-4000-8000-000000000004';
  v_table text;
  v_column text;
  v_tables text[] := array[
    'catalog_entries', 'catalog_families', 'catalog_articles', 'catalog_services',
    'catalog_article_aliases', 'catalog_service_operations', 'catalog_operation_definitions',
    'catalog_model_templates', 'catalog_template_installations', 'laundry_models',
    'laundry_model_services', 'laundry_model_catalog_scope', 'laundry_model_templates',
    'order_item_family_packages', 'order_item_family_package_contents'
  ];
  v_columns text[] := array[
    'catalog_entry_id', 'laundry_model_id', 'laundry_model_name_snapshot',
    'laundry_model_type_snapshot', 'laundry_weight_kg',
    'laundry_price_breakdown_snapshot', 'laundry_services_snapshot',
    'laundry_price_per_kg_snapshot', 'laundry_package_price_snapshot',
    'laundry_included_weight_kg_snapshot', 'laundry_overage_price_per_kg_snapshot',
    'laundry_minimum_weight_kg_snapshot', 'laundry_billing_increment_kg_snapshot',
    'laundry_minimum_charge_snapshot', 'service_operations_snapshot'
  ];
begin
  foreach v_table in array v_tables loop
    if to_regclass('public.' || v_table) is not null then
      raise exception 'La table public.% devait être supprimée par la migration 020.', v_table;
    end if;
  end loop;

  foreach v_column in array v_columns loop
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'order_items' and column_name = v_column
    ) then
      raise exception 'La colonne order_items.% devait être supprimée par la migration 020.', v_column;
    end if;
  end loop;

  if to_regclass('public.order_items') is null or to_regclass('public.order_balances') is null then
    raise exception 'Les lignes de commande ou la vue des soldes ont été supprimées par erreur.';
  end if;

  insert into public.tenants (id, name) values (v_tenant, 'Vérification sans catalogue');
  insert into auth.users (id, email) values (v_user, 'migration-020@local.invalid');
  insert into public.tenant_users (user_id, tenant_id, role)
    values (v_user, v_tenant, 'owner');
  insert into public.orders (id, tenant_id, customer_name, customer_phone, qr_code, total_amount)
    values (v_order, v_tenant, 'Client test', '0700000000', 'migration-020-' || v_order, 6000);

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_user::text,
      'app_metadata', jsonb_build_object('tenant_id', v_tenant::text, 'tenant_role', 'owner')
    )::text,
    false
  );
  execute 'set role authenticated';

  -- Une ligne libre ne doit plus exiger de tarif catalogue ni de motif de dérogation.
  insert into public.order_items (
    id, order_id, tenant_id, label, price, quantity, billed_quantity,
    billing_unit, unit_price, pricing_mode, price_status
  ) values (
    v_line, v_order, v_tenant, 'Chemise', 6000, 2, 2,
    'PIECE', 3000, 'FIXED', 'CONFIRMED'
  );

  if not exists (
    select 1 from public.order_items
     where id = v_line and tenant_id = v_tenant and label = 'Chemise' and price = 6000
  ) then
    raise exception 'La ligne de commande libre n''a pas été conservée.';
  end if;

  raise notice 'OK migration 020 : suppression du catalogue/modèles et création d’une ligne libre';
end;
$$;
