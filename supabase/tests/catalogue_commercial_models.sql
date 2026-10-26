-- =============================================================================
-- Vérifications des modèles de catalogue, prestations d'atelier et forfaits famille (019)
-- =============================================================================

do $$
declare
  v_tenant uuid := '19191919-1919-4919-8919-191919191901';
  v_user uuid := '19191919-1919-4919-8919-191919191999';
  v_order uuid := gen_random_uuid();
  v_rpc_order uuid := gen_random_uuid();
  v_family uuid;
  v_article_shirt uuid;
  v_article_trousers uuid;
  v_outside_article uuid;
  v_service uuid;
  v_model uuid;
  v_professional_model uuid;
  v_item uuid;
  v_stable_item uuid := gen_random_uuid();
  v_package uuid;
  v_template_result jsonb;
  v_rejected boolean;
begin
  insert into public.tenants (id, name) values (v_tenant, 'Catalogue modèles 019')
    on conflict (id) do nothing;
  insert into auth.users (id, email) values (v_user, 'catalogue-019@local.invalid')
    on conflict (id) do nothing;
  insert into public.tenant_users (user_id, tenant_id, role)
    values (v_user, v_tenant, 'owner') on conflict do nothing;
  insert into public.orders (id, tenant_id, customer_name, customer_phone, qr_code, total_amount)
    values (v_order, v_tenant, 'Client forfait famille', '+2250700000019', 'catalogue-019-' || v_order::text, 9500);
  insert into public.orders (id, tenant_id, customer_name, customer_phone, qr_code, total_amount)
    values (v_rpc_order, v_tenant, 'Client RPC famille', '+2250700000019', 'catalogue-rpc-019-' || v_rpc_order::text, 8000);

  perform set_config('request.jwt.claim.sub', v_user::text, false);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_user::text,
    'app_metadata', jsonb_build_object('tenant_id', v_tenant::text, 'tenant_role', 'owner')
  )::text, false);
  execute 'set role authenticated';

  v_template_result := public.initialize_catalog_model_templates();
  if (v_template_result ->> 'families')::integer < 4
     or (v_template_result ->> 'articles')::integer < 10
     or (v_template_result ->> 'services')::integer < 5 then
    raise exception 'Les modèles initiaux de catalogue n''ont pas été importés : %.', v_template_result;
  end if;
  if (select count(*) from public.catalog_entries where tenant_id = v_tenant) <> 0 then
    raise exception 'L''import des modèles a créé de faux tarifs.';
  end if;
  if (select count(*) from public.catalog_model_templates where template_kind = 'FAMILY') < 4 then
    raise exception 'Les modèles globaux de famille sont incomplets.';
  end if;

  if not exists (select 1 from public.catalog_template_installations where tenant_id = v_tenant) then
    raise exception 'Le marqueur évitant de réimporter après personnalisation est absent.';
  end if;
  v_template_result := public.initialize_catalog_model_templates();
  if (v_template_result ->> 'imported')::boolean then
    raise exception 'L''initialisation automatique a réimporté un catalogue déjà initialisé.';
  end if;

  -- Import réexécuté manuellement sans doublons et sans écraser les choix du tenant.
  v_template_result := public.apply_catalog_model_templates();
  if (v_template_result ->> 'families')::integer <> 0
     or (v_template_result ->> 'articles')::integer <> 0
     or (v_template_result ->> 'services')::integer <> 0 then
    raise exception 'L''import des modèles n''est pas idempotent : %.', v_template_result;
  end if;

  select id into v_family from public.catalog_families
   where tenant_id = v_tenant and template_code = 'family_clothing';
  select id into v_article_shirt from public.catalog_articles
   where tenant_id = v_tenant and template_code = 'article_shirt';
  select id into v_article_trousers from public.catalog_articles
   where tenant_id = v_tenant and template_code = 'article_trousers';
  select id into v_service from public.catalog_services
   where tenant_id = v_tenant and template_code = 'service_wash_iron';
  if v_family is null or v_article_shirt is null or v_article_trousers is null or v_service is null then
    raise exception 'Les références réutilisables pour le forfait famille manquent.';
  end if;
  if not exists (select 1 from public.catalog_article_aliases
                  where tenant_id = v_tenant and article_id = v_article_shirt
                    and public.catalog_name_key(alias) = public.catalog_name_key('Chemise homme')) then
    raise exception 'L''alias de chemise n''a pas été importé.';
  end if;
  if not exists (select 1 from public.catalog_service_operations
                  where tenant_id = v_tenant and service_id = v_service and operation_code = 'IRON') then
    raise exception 'Les opérations d''atelier de la prestation ne sont pas reliées.';
  end if;
  perform public.save_catalog_service_operations(v_service, array['WASH', 'IRON']::text[]);
  if (select count(*) from public.catalog_service_operations
       where tenant_id = v_tenant and service_id = v_service) <> 2 then
    raise exception 'La modification des opérations d''atelier n''a pas remplacé la liste.';
  end if;
  perform public.save_catalog_article_aliases(v_article_shirt, array['Chemise homme', 'Haut boutonné']::text[]);
  if not exists (select 1 from public.catalog_article_aliases
                  where tenant_id = v_tenant and article_id = v_article_shirt
                    and alias = 'Haut boutonné')
     or exists (select 1 from public.catalog_article_aliases
                 where tenant_id = v_tenant and article_id = v_article_shirt
                   and alias = 'Chemisette') then
    raise exception 'Les alias du pressing ne sont pas modifiables.';
  end if;

  if (select count(*) from public.laundry_model_templates) < 3
     or exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'laundry_model_templates'
                   and column_name in ('price', 'price_per_kg', 'package_price')) then
    raise exception 'Les modèles professionnels doivent être réutilisables sans aucun prix par défaut.';
  end if;
  v_rejected := false;
  begin
    perform public.apply_laundry_model_template('pro_uniform_weight_package', '{"name":"Sans prix"}'::json);
  exception when invalid_parameter_value then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'Un modèle professionnel sans prix saisi a été accepté.'; end if;
  v_professional_model := public.apply_laundry_model_template(
    'pro_uniform_weight_package',
    '{"name":"Forfait uniforme entreprise","package_price":12000}'::json
  );
  if not exists (select 1 from public.laundry_models
                  where id = v_professional_model and audience = 'PROFESSIONAL'
                    and model_type = 'WEIGHT_PACKAGE' and pricing_basis = 'KG'
                    and package_price = 12000 and included_weight_kg = 10) then
    raise exception 'Le modèle professionnel réutilisable n''a pas été configuré depuis son modèle.';
  end if;
  insert into public.order_items (
    order_id, tenant_id, label, price, quantity, billing_unit, unit_price,
    laundry_model_id, laundry_weight_kg, price_reason
  ) values (
    v_rpc_order, v_tenant, 'Linge professionnel au poids', 12000, 1, 'FLAT', 12000,
    v_professional_model, 5, 'Modèle professionnel au poids'
  ) returning id into v_item;
  if (select jsonb_array_length(service_operations_snapshot) from public.order_items where id = v_item) = 0 then
    raise exception 'Les opérations d''atelier du modèle commercial ne sont pas figées avec la commande.';
  end if;

  v_model := public.save_laundry_model(
    json_build_object(
      'name', 'Forfait famille trois pièces', 'model_type', 'FAMILY_PACKAGE',
      'pricing_basis', 'PIECE', 'audience', 'INDIVIDUAL', 'package_price', 8000,
      'included_pieces', 3, 'overage_price_per_piece', 1500,
      'conditions', 'Prix global pour trois pièces', 'is_active', true
    ),
    json_build_array(json_build_object(
      'service_id', v_service, 'inclusion_mode', 'INCLUDED', 'sort_order', 0
    )),
    json_build_array(json_build_object('family_id', v_family))
  );
  if not exists (select 1 from public.laundry_models
                  where id = v_model and model_type = 'FAMILY_PACKAGE'
                    and pricing_basis = 'PIECE' and package_price = 8000
                    and included_pieces = 3 and overage_price_per_piece = 1500) then
    raise exception 'Le forfait famille n''a pas conservé sa tarification globale par pièce.';
  end if;
  if not exists (select 1 from public.laundry_model_catalog_scope
                  where tenant_id = v_tenant and model_id = v_model and family_id = v_family) then
    raise exception 'Le périmètre du forfait famille n''a pas été enregistré.';
  end if;

  insert into public.order_items (
    id, order_id, tenant_id, label, price, quantity, billed_quantity, billing_unit,
    unit_price, price_status, price_reason
  ) values (
    gen_random_uuid(), v_order, v_tenant, 'Forfait famille trois pièces', 9500, 1, 1,
    'FLAT', 9500, 'CONFIRMED', 'Forfait famille à prix global confirmé'
  ) returning id into v_item;
  insert into public.order_item_family_packages (
    tenant_id, order_id, order_item_id, laundry_model_id, model_name_snapshot,
    package_price_snapshot, included_pieces_snapshot, overage_price_per_piece_snapshot,
    piece_count, scope_snapshot, price_breakdown_snapshot
  ) values (
    v_tenant, v_order, v_item, v_model, 'ne pas faire confiance au client',
    1, 1, 0, 4, '[]'::jsonb, '{}'::jsonb
  ) returning id into v_package;
  -- Les valeurs de prix et le périmètre venant du navigateur sont remplacés par
  -- les données du modèle courant dans le déclencheur BEFORE INSERT.
  if not exists (select 1 from public.order_item_family_packages
                  where id = v_package and model_name_snapshot = 'Forfait famille trois pièces'
                    and package_price_snapshot = 8000 and included_pieces_snapshot = 3
                    and overage_price_per_piece_snapshot = 1500
                    and jsonb_array_length(scope_snapshot) = 1
                    and price_breakdown_snapshot ->> 'total_price' = '9500'
                    and price_breakdown_snapshot ->> 'overage_pieces' = '1') then
    raise exception 'Le serveur n''a pas figé le forfait et son périmètre.';
  end if;
  insert into public.order_item_family_package_contents (
    tenant_id, order_id, order_item_id, article_id, article_name_snapshot, quantity
  ) values
    (v_tenant, v_order, v_item, v_article_shirt, 'libellé falsifié', 2),
    (v_tenant, v_order, v_item, v_article_trousers, 'libellé falsifié', 2);

  if (select sum(quantity) from public.order_item_family_package_contents
       where tenant_id = v_tenant and order_item_id = v_item) <> 4 then
    raise exception 'Le détail des pièces du forfait famille n''a pas été conservé.';
  end if;
  if not exists (select 1 from public.order_item_family_package_contents
                  where tenant_id = v_tenant and order_item_id = v_item
                    and article_id = v_article_shirt and article_name_snapshot = 'Chemise'
                    and jsonb_array_length(service_operations_snapshot) > 0) then
    raise exception 'Le snapshot des articles et opérations d''atelier est absent.';
  end if;

  -- Un article hors périmètre ne peut pas être glissé dans le forfait.
  v_rejected := false;
  begin
    insert into public.catalog_articles (tenant_id, family_id, name, default_unit)
    values (v_tenant, (select id from public.catalog_families where tenant_id = v_tenant and template_code = 'family_household'),
            'Drap hors forfait', 'PIECE') returning id into v_outside_article;
    insert into public.order_item_family_package_contents (
      tenant_id, order_id, order_item_id, article_id, article_name_snapshot, quantity
    ) values (v_tenant, v_order, v_item, v_outside_article, 'Drap', 1);
  exception when check_violation then
    v_rejected := true;
  end;
  if not v_rejected then raise exception 'Un article hors périmètre a été accepté dans le forfait.'; end if;

  -- L'opération de service est un snapshot d'atelier, pas une prestation facturée
  -- supplémentaire sur chacune des pièces.
  if exists (select 1 from public.order_items
              where id = v_item and service_operations_snapshot <> '[]'::jsonb) then
    raise exception 'Une ligne forfaitaire a reçu une liste d''opérations erronée.';
  end if;

  -- Parcours utilisable par PostgREST : ligne et composition créées dans une
  -- seule transaction, validées avant que la requête ne rende la main.
  v_item := public.create_family_package_order_item(
    v_rpc_order, v_model,
    json_build_array(
      json_build_object('article_id', v_article_shirt, 'quantity', 1),
      json_build_object('article_id', v_article_trousers, 'quantity', 1)
    ),
    8000, 'Prix global du forfait famille confirmé', 'Forfait test atomique', null, null, v_stable_item
  );
  if not exists (select 1 from public.order_item_family_packages p
                  where p.tenant_id = v_tenant and p.order_item_id = v_item
                    and p.piece_count = 2 and p.package_price_snapshot = 8000)
     or (select count(*) from public.order_item_family_package_contents c
          where c.tenant_id = v_tenant and c.order_item_id = v_item) <> 2 then
    raise exception 'Le RPC atomique n''a pas créé la ligne et son détail.';
  end if;

  -- Une réponse réseau perdue peut entraîner le même appel : l'identifiant
  -- client stable rend le retry idempotent, sans doublon de ligne/composition.
  if public.create_family_package_order_item(
      v_rpc_order, v_model,
      json_build_array(
        json_build_object('article_id', v_article_shirt, 'quantity', 1),
        json_build_object('article_id', v_article_trousers, 'quantity', 1)
      ),
      8000, 'Prix global du forfait famille confirmé', 'Forfait test atomique', null, null, v_stable_item
    ) <> v_stable_item
     or (select count(*) from public.order_items where id = v_stable_item) <> 1
     or (select count(*) from public.order_item_family_package_contents where order_item_id = v_stable_item) <> 2 then
    raise exception 'Le retry du RPC famille n''est pas idempotent.';
  end if;

  raise notice 'OK — import idempotent, base tarifaire sans prix, prestations avec opérations, forfait famille détaillé et vérifications serveur.';
end;
$$;
