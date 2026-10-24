-- =============================================================================
-- Vérifications fonctionnelles du catalogue tenant-scoped (migration 013)
-- =============================================================================

do $$
declare
  v_tenant uuid := '44444444-4444-4444-8444-444444444444';
  v_foreign_tenant uuid := '55555555-5555-4555-8555-555555555555';
  v_owner uuid := '44444444-4444-4444-8444-444444444499';
  v_family uuid;
  v_article uuid;
  v_service uuid;
  v_order_service uuid;
  v_foreign_family uuid;
  v_foreign_article uuid;
  v_entry uuid;
  v_order uuid := gen_random_uuid();
  v_count integer;
begin
  insert into public.tenants (id, name) values (v_tenant, 'Catalogue test 444')
    on conflict (id) do nothing;
  insert into public.tenants (id, name) values (v_foreign_tenant, 'Catalogue test 555')
    on conflict (id) do nothing;
  insert into auth.users (id, email) values (v_owner, 'catalogue-owner-444@local.invalid')
    on conflict (id) do nothing;

  insert into public.orders (
    id, tenant_id, customer_name, customer_phone, qr_code, total_amount
  ) values (
    v_order, v_tenant, 'Client catalogue', '+2250700000044',
    'catalogue-model-' || v_order::text, 1000
  );

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_owner::text,
      'app_metadata', jsonb_build_object('tenant_id', v_tenant::text, 'tenant_role', 'owner')
    )::text,
    false
  );
  execute 'set role authenticated';

  insert into public.catalog_families (tenant_id, name)
  values (v_tenant, 'Textiles délicats') returning id into v_family;
  insert into public.catalog_articles (
    tenant_id, family_id, name, care_instructions, default_unit
  ) values (
    v_tenant, v_family, 'Veste', 'Nettoyage doux', 'KG'
  ) returning id into v_article;
  insert into public.catalog_services (tenant_id, name, service_type, application_scope)
  values (v_tenant, 'Détachage', 'option', 'article') returning id into v_service;

  insert into public.catalog_entries (
    tenant_id, article, service, price, article_id, service_id,
    pricing_mode, billing_unit, minimum_quantity, billing_increment,
    minimum_charge, conditions, requires_review
  ) values (
    v_tenant, 'Veste', 'Détachage', 2000, v_article, v_service,
    'FROM', 'KG', 2, 0.5, 1000, 'Selon état du textile', false
  ) returning id into v_entry;

  if not exists (
    select 1 from public.catalog_entries
     where id = v_entry and article_id = v_article and service_id = v_service
       and billing_unit = 'KG' and pricing_mode = 'FROM'
       and minimum_quantity = 2 and billing_increment = 0.5 and minimum_charge = 1000
  ) then
    raise exception 'Les propriétés du tarif au kilo n''ont pas été conservées.';
  end if;

  -- Unicité tenant-scoped insensible à la casse et aux espaces.
  begin
    insert into public.catalog_articles (tenant_id, family_id, name)
    values (v_tenant, v_family, '  vEsTe  ');
    raise exception 'Une variante de casse/espaces a échappé à l''unicité du tenant.';
  exception when unique_violation then
    null;
  end;

  -- Une prestation globale se rattache à la commande, jamais à un faux article.
  insert into public.catalog_services (tenant_id, name, service_type, application_scope)
  values (v_tenant, 'Collecte', 'logistics', 'order') returning id into v_order_service;
  insert into public.catalog_entries (
    tenant_id, article, service, price, article_id, service_id, billing_unit
  ) values (
    v_tenant, 'Service global', 'Collecte', 1000, null, v_order_service, 'FLAT'
  ) returning id into v_entry;
  if not exists (
    select 1 from public.catalog_entries
     where id = v_entry and article_id is null and billing_unit = 'FLAT'
  ) then
    raise exception 'La prestation de commande a été rattachée à un article.';
  end if;

  -- Le client historique (texte sans IDs) est résolu automatiquement dans le
  -- tenant courant, sans écraser les lignes déjà structurées.
  insert into public.catalog_entries (tenant_id, article, service, price)
  values (v_tenant, 'Blouse', 'Lavage main', 2500);
  if not exists (
    select 1 from public.catalog_entries
     where tenant_id = v_tenant and article = 'Blouse' and service = 'Lavage main'
       and article_id is not null and service_id is not null
  ) then
    raise exception 'La compatibilité du client texte historique a échoué.';
  end if;

  -- Création d'un tarif non configuré et d'un devis sans montant facturable.
  insert into public.catalog_services (tenant_id, name, service_type, application_scope)
  values (v_tenant, 'Retouche spéciale', 'other', 'article') returning id into v_service;
  insert into public.catalog_entries (
    tenant_id, article, service, price, article_id, service_id,
    pricing_mode, billing_unit
  ) values (
    v_tenant, 'Veste', 'Retouche spéciale', 0, v_article, v_service, 'QUOTE', 'FLAT'
  ) returning id into v_entry;
  if not exists (
    select 1 from public.catalog_entries where id = v_entry and price = 0 and pricing_mode = 'QUOTE'
  ) then
    raise exception 'Le mode devis n''est pas représenté sans montant fictif.';
  end if;

  -- Une famille contenant des articles ne peut pas être supprimée en cascade.
  begin
    delete from public.catalog_families where id = v_family and tenant_id = v_tenant;
    execute 'set constraints catalog_articles_family_fk immediate';
  exception when others then
    v_count := 1;
  end;
  if coalesce(v_count, 0) <> 1 then
    raise exception 'Une famille référencée a été supprimée.';
  end if;
  v_count := 0;

  select count(*) into v_count from public.catalog_families
   where tenant_id = v_tenant and id = v_family;
  if v_count <> 1 then raise exception 'Le propriétaire ne voit pas sa famille.'; end if;

  -- Une autre identité tenant ne voit pas les lignes de ce pressing.
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_owner::text,
      'app_metadata', jsonb_build_object('tenant_id', v_foreign_tenant::text, 'tenant_role', 'owner')
    )::text,
    false
  );
  select count(*) into v_count from public.catalog_families where tenant_id = v_tenant;
  if v_count <> 0 then raise exception 'La RLS expose une famille d''un autre pressing.'; end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_owner::text,
      'app_metadata', jsonb_build_object('tenant_id', v_tenant::text, 'tenant_role', 'owner')
    )::text,
    false
  );
  begin
    insert into public.catalog_families (tenant_id, name)
    values (v_foreign_tenant, 'Tentative inter-tenant');
    raise exception 'RLS a accepté une famille d''un autre tenant.';
  exception when insufficient_privilege then
    null;
  end;

  -- Une FK article provenant d'un autre pressing est refusée même si le client
  -- présente une prestation valide du pressing courant.
  execute 'reset role';
  insert into public.catalog_families (tenant_id, name)
  values (v_foreign_tenant, 'Famille étrangère') returning id into v_foreign_family;
  insert into public.catalog_articles (tenant_id, family_id, name)
  values (v_foreign_tenant, v_foreign_family, 'Article étranger') returning id into v_foreign_article;
  execute 'set role authenticated';
  begin
    insert into public.catalog_entries (
      tenant_id, article, service, price, article_id, service_id
    ) values (v_tenant, 'Article étranger', 'Détachage', 2000, v_foreign_article, v_service);
    raise exception 'Une référence d''article inter-tenant a été acceptée.';
  exception when foreign_key_violation then
    null;
  end;

  -- Les tarifs hérités non confirmés sont bloqués côté serveur, même si un
  -- ancien client contourne le sélecteur qui les masque.
  insert into public.catalog_services (tenant_id, name, service_type, application_scope)
  values (v_tenant, 'Tarif à vérifier', 'treatment', 'article') returning id into v_service;
  insert into public.catalog_entries (
    tenant_id, article, service, price, article_id, service_id, requires_review
  ) values (v_tenant, 'Veste', 'Tarif à vérifier', 2000, v_article, v_service, true)
  returning id into v_entry;
  begin
    insert into public.order_items (
      order_id, tenant_id, label, price, catalog_entry_id, article_name, service_name
    ) values (v_order, v_tenant, 'Veste', 2000, v_entry, 'Veste', 'Détachage');
    raise exception 'Un tarif à vérifier a été accepté dans une commande.';
  exception when sqlstate '22023' then
    null;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', false);

  -- La suppression d'un tenant entier reste possible malgré les FK non
  -- destructives entre famille/article/tarif ; les suppressions partielles,
  -- elles, restent protégées.
  delete from public.tenants where id = v_tenant;
  set constraints all immediate;
  if exists (select 1 from public.tenants where id = v_tenant) then
    raise exception 'Le tenant de test n''a pas été supprimé.';
  end if;

  raise notice 'OK catalogue tenant-scoped, unités, devis, compatibilité, RLS et tarif à confirmer';
end;
$$;
