-- =============================================================================
-- Vérifications des règles d'archivage des références catalogue (migration 015)
-- =============================================================================

do $$
declare
  v_tenant uuid := '77777777-7777-4777-8777-777777777777';
  v_user uuid := '77777777-7777-4777-8777-777777777799';
  v_order uuid := gen_random_uuid();
  v_family uuid;
  v_article uuid;
  v_service uuid;
  v_service_actif uuid;
  v_entry uuid;
  v_item uuid := gen_random_uuid();
  v_refus boolean;
begin
  insert into public.tenants (id, name) values (v_tenant, 'Cycle de vie catalogue')
    on conflict (id) do nothing;
  insert into auth.users (id, email) values (v_user, 'catalogue-lifecycle@local.invalid')
    on conflict (id) do nothing;
  insert into public.orders (
    id, tenant_id, customer_name, customer_phone, qr_code, total_amount
  ) values (
    v_order, v_tenant, 'Client cycle de vie', '+2250700000077', 'lifecycle-' || v_order::text, 1500
  );

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_user::text,
      'app_metadata', jsonb_build_object('tenant_id', v_tenant::text, 'tenant_role', 'owner')
    )::text,
    false
  );
  execute 'set role authenticated';

  insert into public.catalog_families (tenant_id, name)
  values (v_tenant, 'Articles actifs') returning id into v_family;
  insert into public.catalog_articles (tenant_id, family_id, name)
  values (v_tenant, v_family, 'Chemise de test') returning id into v_article;
  insert into public.catalog_services (tenant_id, name)
  values (v_tenant, 'Lavage test') returning id into v_service;
  insert into public.catalog_entries (
    tenant_id, article, service, price, article_id, service_id, is_active
  ) values (
    v_tenant, 'Chemise de test', 'Lavage test', 1500, v_article, v_service, true
  ) returning id into v_entry;
  insert into public.order_items (
    id, order_id, tenant_id, label, price, catalog_entry_id, article_name, service_name
  ) values (
    v_item, v_order, v_tenant, 'Chemise de test', 1500, v_entry, 'Chemise de test', 'Lavage test'
  );

  v_refus := false;
  begin
    update public.catalog_articles set is_active = false where id = v_article and tenant_id = v_tenant;
  exception when check_violation then
    v_refus := true;
  end;
  if not v_refus then raise exception 'Un article avec un tarif actif a été archivé.'; end if;

  v_refus := false;
  begin
    update public.catalog_services set is_active = false where id = v_service and tenant_id = v_tenant;
  exception when check_violation then
    v_refus := true;
  end;
  if not v_refus then raise exception 'Une prestation avec un tarif actif a été archivée.'; end if;

  update public.catalog_entries set is_active = false where id = v_entry and tenant_id = v_tenant;
  update public.catalog_articles set is_active = false where id = v_article and tenant_id = v_tenant;
  update public.catalog_services set is_active = false where id = v_service and tenant_id = v_tenant;

  v_refus := false;
  begin
    update public.catalog_entries set is_active = true where id = v_entry and tenant_id = v_tenant;
  exception when check_violation then
    v_refus := true;
  end;
  if not v_refus then raise exception 'Un tarif a été réactivé avec une référence archivée.'; end if;

  v_refus := false;
  begin
    insert into public.order_items (
      order_id, tenant_id, label, price, catalog_entry_id, article_name, service_name
    ) values (
      v_order, v_tenant, 'Ligne hors ligne périmée', 1500, v_entry, 'Chemise de test', 'Lavage test'
    );
  exception when check_violation then
    v_refus := true;
  end;
  if not v_refus then raise exception 'Une nouvelle commande a utilisé une référence archivée.'; end if;

  -- Une commande déjà créée conserve son instantané tarifaire après archivage.
  if not exists (select 1 from public.order_items where id = v_item and price = 1500) then
    raise exception 'L''historique de commande a été altéré par l''archivage.';
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', false);
  delete from public.tenants where id = v_tenant;
  set constraints all immediate;
  raise notice 'OK archivage protégé, tarifs historiques et refus des références périmées';
end;
$$;
