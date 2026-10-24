-- =============================================================================
-- Vérifications de la restructuration multi-tenant du catalogue (migration 013)
-- =============================================================================

do $$
declare
  v_article_chemise uuid;
  v_article_pantalon uuid;
  v_service_lavage uuid;
  v_count integer;
  v_entry_id uuid;
  v_family_id uuid;
  v_foreign_article_id uuid;
  v_order_id uuid := gen_random_uuid();
begin
  -- La reprise garde les montants et archives, rattache les anciens libellés
  -- aux mêmes référentiels tenant-scoped, et bloque la vente avant vérification.
  select count(*) into v_count
    from public.catalog_entries
   where tenant_id = '33333333-3333-4333-8333-333333333333'
     and article_id is not null and service_id is not null;
  if v_count <> 3 then
    raise exception 'Reprise catalogue incomplète : % tarifs structurés sur 3.', v_count;
  end if;

  select id into v_article_chemise
    from public.catalog_articles
   where tenant_id = '33333333-3333-4333-8333-333333333333'
     and public.catalog_name_key(name) = public.catalog_name_key('Chemise');
  select id into v_article_pantalon
    from public.catalog_articles
   where tenant_id = '33333333-3333-4333-8333-333333333333'
     and public.catalog_name_key(name) = public.catalog_name_key('Pantalon');
  select id into v_service_lavage
    from public.catalog_services
   where tenant_id = '33333333-3333-4333-8333-333333333333'
     and public.catalog_name_key(name) = public.catalog_name_key('Lavage');

  if v_article_chemise is null or v_article_pantalon is null or v_service_lavage is null then
    raise exception 'Les références article/prestation héritées n''ont pas été créées.';
  end if;

  if (select count(*) from public.catalog_entries
       where tenant_id = '33333333-3333-4333-8333-333333333333'
         and article_id = v_article_chemise and article = 'Chemise') <> 2 then
    raise exception 'Les variantes de casse/espaces de Chemise ne partagent pas leur article canonique.';
  end if;

  if not exists (
    select 1 from public.catalog_entries
     where id = '33333333-3333-4333-8333-333333333301'
       and price = 1500 and is_active and requires_review
       and pricing_mode = 'FIXED' and billing_unit = 'PIECE'
  ) then
    raise exception 'Le tarif historique (prix, état ou revue) a été altéré.';
  end if;

  if not exists (
    select 1 from public.catalog_entries
     where id = '33333333-3333-4333-8333-333333333303'
       and price = 0 and pricing_mode = 'UNCONFIGURED' and requires_review
  ) then
    raise exception 'Un ancien prix nul doit devenir un tarif non configuré.';
  end if;

  if (select count(*) from public.catalog_families
       where tenant_id = '33333333-3333-4333-8333-333333333333'
         and public.catalog_name_key(name) = public.catalog_name_key('À classer')) <> 1 then
    raise exception 'La famille neutre de reprise est absente ou dupliquée.';
  end if;

  -- Crée un vrai propriétaire local et vérifie la visibilité isolée par tenant.
  insert into auth.users (id, email)
  values ('33333333-3333-4333-8333-333333333399', 'catalog-owner@local.invalid')
  on conflict (id) do nothing;

  insert into public.orders (
    id, tenant_id, customer_name, customer_phone, qr_code, total_amount
  ) values (
    v_order_id,
    '33333333-3333-4333-8333-333333333333',
    'Client de test', '+2250700000033',
    'catalogue-model-' || v_order_id::text, 1500
  );

  perform set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333399', false);
  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-4333-8333-333333333399","app_metadata":{"tenant_id":"33333333-3333-4333-8333-333333333333","tenant_role":"owner"}}',
    false
  );
  execute 'set role authenticated';

  select count(*) into v_count from public.catalog_families
   where tenant_id = '33333333-3333-4333-8333-333333333333';
  if v_count <> 1 then raise exception 'Le propriétaire ne voit pas les familles de son pressing.'; end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-4333-8333-333333333399","app_metadata":{"tenant_id":"11111111-1111-4111-8111-111111111111","tenant_role":"owner"}}',
    false
  );
  select count(*) into v_count from public.catalog_families
   where tenant_id = '33333333-3333-4333-8333-333333333333';
  if v_count <> 0 then raise exception 'Une famille traverse la frontière RLS du tenant.'; end if;

  perform set_config(
    'request.jwt.claims',
    '{"sub":"33333333-3333-4333-8333-333333333399","app_metadata":{"tenant_id":"33333333-3333-4333-8333-333333333333","tenant_role":"owner"}}',
    false
  );

  begin
    insert into public.order_items (
      order_id, tenant_id, label, price, catalog_entry_id, article_name, service_name
    ) values (
      v_order_id,
      '33333333-3333-4333-8333-333333333333',
      'Chemise', 1500,
      '33333333-3333-4333-8333-333333333301', 'Chemise', 'Lavage'
    );
    raise exception 'Un tarif hérité non vérifié a été accepté dans une commande.';
  exception when sqlstate '22023' then
    null;
  end;

  insert into public.catalog_families (tenant_id, name)
  values ('33333333-3333-4333-8333-333333333333', 'Textiles délicats')
  returning id into v_family_id;

  insert into public.catalog_articles (tenant_id, family_id, name, care_instructions, default_unit)
  values ('33333333-3333-4333-8333-333333333333', v_family_id, 'Veste', 'Nettoyage doux', 'KG')
  returning id into v_article_pantalon;

  insert into public.catalog_services (tenant_id, name, service_type, application_scope)
  values ('33333333-3333-4333-8333-333333333333', 'Détachage', 'option', 'article')
  returning id into v_service_lavage;

  insert into public.catalog_entries (
    tenant_id, article, service, price, article_id, service_id,
    pricing_mode, billing_unit, minimum_quantity, billing_increment,
    minimum_charge, conditions, requires_review
  ) values (
    '33333333-3333-4333-8333-333333333333', 'Veste', 'Détachage', 2000,
    v_article_pantalon, v_service_lavage, 'FROM', 'KG', 2, 0.5,
    1000, 'Selon état du textile', false
  ) returning id into v_entry_id;

  if not exists (
    select 1 from public.catalog_entries
     where id = v_entry_id and article_id = v_article_pantalon
       and service_id = v_service_lavage and billing_unit = 'KG'
       and pricing_mode = 'FROM' and minimum_quantity = 2
       and billing_increment = 0.5 and minimum_charge = 1000
  ) then
    raise exception 'Les propriétés du tarif au kilo n''ont pas été conservées.';
  end if;

  -- La casse et les espaces ne permettent pas de créer un second article
  -- équivalent dans le même pressing.
  begin
    insert into public.catalog_articles (tenant_id, family_id, name)
    values ('33333333-3333-4333-8333-333333333333', v_family_id, '  vEsTe  ');
    raise exception 'Une variante de casse/espaces a échappé à l''unicité du tenant.';
  exception when unique_violation then
    null;
  end;

  -- Une écriture forgée avec le tenant d'un autre pressing est refusée par RLS.
  begin
    insert into public.catalog_families (tenant_id, name)
    values ('11111111-1111-4111-8111-111111111111', 'Famille étrangère');
    raise exception 'RLS a accepté une famille d''un autre tenant.';
  exception when insufficient_privilege then
    null;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claims', '{}', false);

  -- Les références d'un autre tenant ne peuvent pas être associées à un tarif.
  insert into public.catalog_families (tenant_id, name)
  values ('11111111-1111-4111-8111-111111111111', 'Famille de test inter-tenant')
  on conflict (tenant_id, public.catalog_name_key(name)) do nothing;
  select id into v_family_id from public.catalog_families
   where tenant_id = '11111111-1111-4111-8111-111111111111'
     and public.catalog_name_key(name) = public.catalog_name_key('Famille de test inter-tenant');
  insert into public.catalog_articles (tenant_id, family_id, name)
  values ('11111111-1111-4111-8111-111111111111', v_family_id, 'Article étranger')
  on conflict (tenant_id, public.catalog_name_key(name)) do nothing;
  select id into v_foreign_article_id from public.catalog_articles
   where tenant_id = '11111111-1111-4111-8111-111111111111'
     and public.catalog_name_key(name) = public.catalog_name_key('Article étranger');

  begin
    insert into public.catalog_entries (
      tenant_id, article, service, price, article_id, service_id
    ) values (
      '33333333-3333-4333-8333-333333333333', 'Veste', 'Détachage', 2000,
      (select id from public.catalog_articles where tenant_id = '11111111-1111-4111-8111-111111111111' limit 1),
      v_service_lavage
    );
    raise exception 'Une référence d''article inter-tenant a été acceptée.';
  exception when foreign_key_violation then
    null;
  end;

  raise notice 'OK catalogue structuré, reprise, unités, RLS et unicité par tenant';
end;
$$;
