-- =============================================================================
-- Vérification des unités, prix calculés et instantanés de ligne (migration 014)
-- =============================================================================

do $$
declare
  v_tenant uuid := '66666666-6666-4666-8666-666666666666';
  v_user uuid := '66666666-6666-4666-8666-666666666699';
  v_order uuid := gen_random_uuid();
  v_family uuid;
  v_article uuid;
  v_weight_service uuid;
  v_quote_service uuid;
  v_review_service uuid;
  v_unconfigured_service uuid;
  v_bad_quote_service uuid;
  v_weight_entry uuid;
  v_quote_entry uuid;
  v_review_entry uuid;
  v_unconfigured_entry uuid;
  v_entry uuid;
  v_item uuid := gen_random_uuid();
  v_count integer;
  v_amount integer;
  v_failed boolean;
begin
  insert into public.tenants (id, name) values (v_tenant, 'Tarification test')
    on conflict (id) do nothing;
  insert into auth.users (id, email) values (v_user, 'pricing-owner@local.invalid')
    on conflict (id) do nothing;
  insert into public.orders (
    id, tenant_id, customer_name, customer_phone, qr_code, total_amount
  ) values (v_order, v_tenant, 'Client tarification', '+2250700000066', 'pricing-' || v_order::text, 0);

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
  values (v_tenant, 'Linge de maison') returning id into v_family;
  insert into public.catalog_articles (tenant_id, family_id, name, default_unit)
  values (v_tenant, v_family, 'Couette', 'KG') returning id into v_article;
  insert into public.catalog_services (tenant_id, name, service_type, application_scope)
  values (v_tenant, 'Lavage au poids', 'treatment', 'article') returning id into v_weight_service;
  insert into public.catalog_services (tenant_id, name, service_type, application_scope)
  values (v_tenant, 'Nettoyage sur devis', 'other', 'article') returning id into v_quote_service;
  insert into public.catalog_services (tenant_id, name, service_type, application_scope)
  values (v_tenant, 'Tarif provisoire', 'treatment', 'article') returning id into v_review_service;
  insert into public.catalog_services (tenant_id, name, service_type, application_scope)
  values (v_tenant, 'Tarif absent', 'treatment', 'article') returning id into v_unconfigured_service;
  insert into public.catalog_services (tenant_id, name, service_type, application_scope)
  values (v_tenant, 'Devis incorrect', 'other', 'article') returning id into v_bad_quote_service;

  insert into public.catalog_entries (
    tenant_id, article, service, price, article_id, service_id,
    pricing_mode, billing_unit, minimum_quantity, billing_increment,
    minimum_charge, conditions, requires_review
  ) values (
    v_tenant, 'Couette', 'Lavage au poids', 1500, v_article, v_weight_service,
    'FROM', 'KG', 2, 0.5, 3500, 'Poids final vérifié à la réception', false
  ) returning id into v_weight_entry;
  insert into public.catalog_entries (
    tenant_id, article, service, price, article_id, service_id,
    pricing_mode, billing_unit, requires_review
  ) values (
    v_tenant, 'Couette', 'Nettoyage sur devis', 0, v_article, v_quote_service,
    'QUOTE', 'FLAT', false
  ) returning id into v_quote_entry;
  v_failed := false;
  begin
    insert into public.catalog_entries (
      tenant_id, article, service, price, article_id, service_id, pricing_mode, billing_unit
    ) values (
      v_tenant, 'Couette', 'Devis incorrect', 0, v_article, v_bad_quote_service, 'QUOTE', 'PIECE'
    );
  exception when check_violation then
    v_failed := true;
  end;
  if not v_failed then raise exception 'Un devis mesuré a été accepté au catalogue.'; end if;

  insert into public.catalog_entries (
    tenant_id, article, service, price, article_id, service_id, requires_review
  ) values (
    v_tenant, 'Couette', 'Tarif provisoire', 1500, v_article, v_review_service, true
  ) returning id into v_review_entry;
  insert into public.catalog_entries (
    tenant_id, article, service, price, article_id, service_id, pricing_mode, requires_review
  ) values (
    v_tenant, 'Couette', 'Tarif absent', 0, v_article, v_unconfigured_service, 'UNCONFIGURED', false
  ) returning id into v_unconfigured_entry;

  -- 6,4 kg, arrondi à 6,5 kg : prix unitaire historisé et total calculé serveur.
  insert into public.order_items (
    id, order_id, tenant_id, label, price, quantity, unit_price,
    catalog_entry_id, price_status
  ) values (
    v_item, v_order, v_tenant, 'Couette — lavage au poids', 9750, 6.4, 1500,
    v_weight_entry, 'ESTIMATED'
  );
  if not exists (
    select 1 from public.order_items
     where id = v_item and quantity = 6.4 and billed_quantity = 6.5
       and billing_unit = 'KG' and unit_price = 1500 and price = 9750
       and pricing_mode = 'FROM' and price_status = 'ESTIMATED'
       and family_name_snapshot = 'Linge de maison'
       and catalog_unit_price_snapshot = 1500
       and billing_increment_snapshot = 0.5
       and minimum_charge_snapshot = 3500
       and conditions_snapshot = 'Poids final vérifié à la réception'
  ) then
    raise exception 'Le calcul ou l''instantané du tarif au kilo est incorrect.';
  end if;

  -- Le minimum de quantité et le minimum de facturation sont appliqués dans
  -- l'ordre convenu : max(quantité mesurée, minimum), arrondi par incrément,
  -- montant total puis plancher monétaire.
  v_amount := public.catalog_line_total(
    public.catalog_billable_quantity(1, 'KG', 2, 0.5), 1500, 3500
  );
  if v_amount <> 3500 then raise exception 'Le minimum de facturation attendu était 3500.'; end if;

  -- Un total modifié côté client ne peut pas contourner le calcul SQL.
  v_failed := false;
  begin
    insert into public.order_items (
      order_id, tenant_id, label, price, quantity, unit_price, catalog_entry_id
    ) values (v_order, v_tenant, 'Poids manipulé', 9600, 6.4, 1500, v_weight_entry);
  exception when sqlstate '22023' then
    v_failed := true;
  end;
  if not v_failed then raise exception 'Un total incohérent a été accepté.'; end if;

  -- Un devis n'est accepté qu'avec un prix final confirmé ; l'unité reste forfait.
  insert into public.order_items (
    order_id, tenant_id, label, price, quantity, unit_price, catalog_entry_id
  ) values (v_order, v_tenant, 'Nettoyage de couette', 8000, 1, 8000, v_quote_entry);
  if not exists (
    select 1 from public.order_items
     where order_id = v_order and catalog_entry_id = v_quote_entry
       and pricing_mode = 'QUOTE' and billing_unit = 'FLAT' and price = 8000
  ) then
    raise exception 'Le devis confirmé n''a pas été conservé.';
  end if;

  -- Tarifs non confirmés ou non configurés refusés même si le client connaît l'ID.
  foreach v_entry in array array[v_review_entry, v_unconfigured_entry] loop
    v_failed := false;
    begin
      insert into public.order_items (
        order_id, tenant_id, label, price, quantity, unit_price, catalog_entry_id
      ) values (v_order, v_tenant, 'Tarif protégé', 1500, 1, 1500, v_entry);
    exception when sqlstate '22023' then
      v_failed := true;
    end;
    if not v_failed then raise exception 'Un tarif protégé a été accepté.'; end if;
  end loop;

  -- Une saisie libre reste possible, mais le motif est obligatoire aussi côté SQL.
  v_failed := false;
  begin
    insert into public.order_items (
      order_id, tenant_id, label, price, quantity, unit_price
    ) values (v_order, v_tenant, 'Ourlet pantalon', 700, 1, 700);
  exception when sqlstate '22023' then
    v_failed := true;
  end;
  if not v_failed then raise exception 'Une ligne libre sans motif a été acceptée.'; end if;

  insert into public.order_items (
    order_id, tenant_id, label, price, quantity, unit_price, price_reason
  ) values (v_order, v_tenant, 'Ourlet pantalon', 700, 1, 700, 'Retouche demandée au comptoir');

  -- Un changement ultérieur du catalogue ne réécrit pas le tarif ni les noms
  -- déjà copiés sur la commande.
  update public.catalog_entries set price = 1700 where id = v_weight_entry;
  update public.order_items
     set special_instructions = 'Manipuler séparément'
   where id = v_item;
  if not exists (
    select 1 from public.order_items
     where id = v_item and unit_price = 1500 and catalog_unit_price_snapshot = 1500
       and service_name = 'Lavage au poids' and family_name_snapshot = 'Linge de maison'
  ) then
    raise exception 'Le changement du catalogue a réécrit un ancien instantané.';
  end if;

  -- Une correction de quantité recalcule le prix et journalise l'ancien et le
  -- nouveau détail ; aucun statut de paiement n'est modifié par cette migration.
  update public.order_items
     set quantity = 7, price = 10500
   where id = v_item;
  if not exists (
    select 1 from public.order_price_history
     where order_item_id = v_item and previous_price = 9750 and new_price = 10500
       and (previous_snapshot ->> 'billed_quantity')::numeric = 6.5
       and (new_snapshot ->> 'billed_quantity')::numeric = 7
  ) then
    raise exception 'La correction de quantité n''a pas été historisée.';
  end if;

  -- Le service de calcul rejette aussi les fractions de pièce et les forfaits
  -- multipliés, y compris s'il est appelé directement.
  v_failed := false;
  begin
    perform public.catalog_billable_quantity(1.25, 'PIECE', null, null);
  exception when sqlstate '22023' then
    v_failed := true;
  end;
  if not v_failed then raise exception 'Une fraction de pièce a été acceptée.'; end if;
  v_failed := false;
  begin
    perform public.catalog_billable_quantity(1, 'PIECE', 1.5, null);
  exception when sqlstate '22023' then
    v_failed := true;
  end;
  if not v_failed then raise exception 'Un minimum fractionnaire de pièces a été accepté.'; end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', false);
  delete from public.tenants where id = v_tenant;
  set constraints all immediate;
  raise notice 'OK quantités, unités, prix serveur, devis, instantanés et historique';
end;
$$;
