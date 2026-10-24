-- =============================================================================
-- Vérifications des coûts de consommables liés (migration 018)
-- =============================================================================

do $$
declare
  v_tenant uuid := '77777777-7777-4777-8777-777777777701';
  v_user uuid := '77777777-7777-4777-8777-777777777799';
  v_order uuid := '77777777-7777-4777-8777-777777777702';
  v_line uuid := '77777777-7777-4777-8777-777777777703';
  v_item uuid := '77777777-7777-4777-8777-777777777704';
  v_unknown_cost_item uuid := '77777777-7777-4777-8777-777777777705';
  v_cost numeric;
  v_missing bigint;
  v_count integer;
  v_refus boolean;
begin
  insert into public.tenants (id, name) values (v_tenant, 'Coûts consommables')
    on conflict (id) do nothing;
  insert into auth.users (id, email) values (v_user, 'stock-costs@local.invalid')
    on conflict (id) do nothing;
  insert into public.tenant_users (user_id, tenant_id, role)
    values (v_user, v_tenant, 'owner') on conflict (user_id, tenant_id) do nothing;
  insert into public.orders (id, tenant_id, customer_name, customer_phone, qr_code, total_amount)
    values (v_order, v_tenant, 'Client consommables', '0700000077', 'stock-cost-' || v_order, 5000);
  insert into public.order_items (
    id, order_id, tenant_id, label, price, quantity, billed_quantity,
    billing_unit, unit_price, price_reason
  ) values (
    v_line, v_order, v_tenant, 'Lavage chemise', 5000, 1, 1, 'PIECE', 5000,
    'Ligne de test de rapport'
  );
  insert into public.stock_items (
    id, tenant_id, name, category, unit, quantity, min_quantity, unit_cost
  ) values
    (v_item, v_tenant, 'Lessive de test', 'consommable', 'litre', 10, 1, 250),
    (v_unknown_cost_item, v_tenant, 'Produit sans coût', 'consommable', 'litre', 10, 1, null);

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_user::text,
      'app_metadata', jsonb_build_object('tenant_id', v_tenant::text, 'tenant_role', 'owner')
    )::text,
    false
  );
  execute 'set role authenticated';

  insert into public.stock_movements (
    tenant_id, item_id, kind, quantity, unit_cost, order_item_id, reason
  ) values (
    v_tenant, v_item, 'out', 2, 1, v_line, 'Consommation de la commande'
  );
  insert into public.stock_movements (tenant_id, item_id, kind, quantity, order_item_id, reason)
    values (v_tenant, v_unknown_cost_item, 'out', 1, v_line, 'Produit non chiffré');

  select sm.unit_cost into v_cost
    from public.stock_movements sm
   where sm.tenant_id = v_tenant and sm.item_id = v_item and sm.kind = 'out';
  if v_cost <> 250 then
    raise exception 'Le coût unitaire de la sortie doit être figé à 250 FCFA, reçu : %.', v_cost;
  end if;
  if (select unit_cost from public.stock_items where id = v_item and tenant_id = v_tenant) <> 250 then
    raise exception 'Une sortie ne doit pas modifier le coût courant de l’article.';
  end if;

  select r.cost_amount, r.missing_cost_movements into v_cost, v_missing
    from public.report_stock_consumption_costs(array[v_line]) r;
  if v_cost <> 500 or v_missing <> 1 then
    raise exception 'Agrégat erroné : coût %, mouvements non chiffrés %.', v_cost, v_missing;
  end if;
  raise notice 'OK coût unitaire figé et coût des consommables agrégé par ligne';

  execute 'reset role';
  update public.tenant_users set role = 'receptionist'
   where user_id = v_user and tenant_id = v_tenant;
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', v_user::text,
      'app_metadata', jsonb_build_object('tenant_id', v_tenant::text, 'tenant_role', 'receptionist')
    )::text,
    false
  );
  execute 'set role authenticated';
  select count(*) into v_count from public.report_stock_consumption_costs(array[v_line]);
  if v_count <> 0 then raise exception 'Un rôle autre que propriétaire voit les coûts détaillés.'; end if;
  v_refus := false;
  begin
    insert into public.stock_movements (
      tenant_id, item_id, kind, quantity, unit_cost, reason
    ) values (
      v_tenant, v_item, 'in', 1, 1, 'Tentative de modifier le coût'
    );
  exception when insufficient_privilege then
    v_refus := true;
  end;
  if not v_refus then raise exception 'Un réceptionniste a pu modifier le coût unitaire.'; end if;
  raise notice 'OK rapport et modification du coût réservés au propriétaire';

  execute 'reset role';
  perform set_config('request.jwt.claims', '{}', false);
  delete from public.tenants where id = v_tenant;
end;
$$;
