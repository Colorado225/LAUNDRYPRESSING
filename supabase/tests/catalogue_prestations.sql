-- =============================================================================
-- catalogue_prestations.sql — catégories, tarification multi-mode et forfaits
-- =============================================================================
-- À exécuter après 027. Transaction jetable, annulée à la fin.
-- Vérifie le nouveau catalogue configurable sans toucher aux lignes libres.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'catalogue-owner@test.local'),
  ('00000000-0000-4000-8000-0000000000e2', 'catalogue-recept@test.local')
on conflict (id) do nothing;
insert into public.tenants (id, name) values
  ('55555555-5555-4555-8555-555555555551', 'Pressing Catalogue')
on conflict (id) do nothing;
insert into public.tenant_users (user_id, tenant_id, role) values
  ('00000000-0000-4000-8000-0000000000e1', '55555555-5555-4555-8555-555555555551', 'owner'),
  ('00000000-0000-4000-8000-0000000000e2', '55555555-5555-4555-8555-555555555551', 'receptionist')
on conflict (user_id, tenant_id) do nothing;

-- Identité par défaut : le propriétaire.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '00000000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  v_pressing uuid;
  v_blanchisserie uuid;
  v_categorie uuid;
  v_piece uuid;
  v_paire uuid;
  v_devis uuid;
  v_forfait uuid;
  v_tier uuid;
  v_sqlstate text;
  v_compte integer;
begin
  insert into public.tenant_activities (tenant_id, name) values
    ('55555555-5555-4555-8555-555555555551', 'Pressing')
  returning id into v_pressing;
  insert into public.tenant_activities (tenant_id, name) values
    ('55555555-5555-4555-8555-555555555551', 'Blanchisserie')
  returning id into v_blanchisserie;

  -- 1. Catégories CRUD et unicité par activité.
  insert into public.tenant_service_categories (tenant_id, activity_id, name)
  values ('55555555-5555-4555-8555-555555555551', v_blanchisserie, 'Lavage au poids')
  returning id into v_categorie;

  begin
    insert into public.tenant_service_categories (tenant_id, activity_id, name)
    values ('55555555-5555-4555-8555-555555555551', v_blanchisserie, 'lavage au poids ');
  exception when unique_violation then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '23505' then
    raise exception 'ECHEC 1 : une catégorie en doublon (casse près) a été acceptée';
  end if;
  raise notice 'OK 1 — unicité des catégories par activité vérifiée.';

  -- 2. Prix de référence à la pièce désormais autorisé, toutes unités.
  insert into public.tenant_services (
    tenant_id, activity_id, category_id, service_name, billing_unit, unit_price
  ) values (
    '55555555-5555-4555-8555-555555555551', v_pressing, null, 'Chemise repassée',
    'PIECE', 500
  ) returning id into v_piece;

  insert into public.tenant_services (
    tenant_id, activity_id, service_name, billing_unit, unit_price
  ) values (
    '55555555-5555-4555-8555-555555555551', v_pressing, 'Chaussettes', 'PAIR', 250
  ) returning id into v_paire;

  if not exists (
    select 1 from public.tenant_services
     where id in (v_piece, v_paire) and unit_price is not null
     having count(*) = 2
  ) then
    raise exception 'ECHEC 2 : les prix de référence à la pièce/paire ne sont pas conservés';
  end if;
  raise notice 'OK 2 — prix de référence acceptés pour les unités pièce et paire.';

  -- 3. Devis : unité FLAT obligatoire et aucun prix de référence.
  begin
    insert into public.tenant_services (
      tenant_id, activity_id, service_name, billing_unit, pricing_mode, unit_price
    ) values (
      '55555555-5555-4555-8555-555555555551', v_pressing, 'Devis textile délicat',
      'PIECE', 'QUOTE', 1000
    );
  exception when check_violation then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '23514' then
    raise exception 'ECHEC 3 : un devis avec prix et unité pièce a été accepté';
  end if;

  v_sqlstate := null;
  insert into public.tenant_services (
    tenant_id, activity_id, service_name, billing_unit, pricing_mode
  ) values (
    '55555555-5555-4555-8555-555555555551', v_pressing, 'Nettoyage canapé sur devis',
    'FLAT', 'QUOTE'
  ) returning id into v_devis;
  if not exists (select 1 from public.tenant_services where id = v_devis and unit_price is null) then
    raise exception 'ECHEC 4 : le devis forfaitaire doit rester sans prix de référence';
  end if;
  raise notice 'OK 3 — les règles de cohérence des devis sont appliquées.';

  -- 4. Forfait poids et paliers.
  insert into public.tenant_services (
    tenant_id, activity_id, category_id, service_name, billing_unit, pricing_mode
  ) values (
    '55555555-5555-4555-8555-555555555551', v_blanchisserie, v_categorie,
    'Laver repasser', 'PACKAGE', 'FIXED'
  ) returning id into v_forfait;

  insert into public.tenant_weight_tiers (
    tenant_id, tenant_service_id, label, weight_kg, price_fcfa, sort_order
  ) values
    ('55555555-5555-4555-8555-555555555551', v_forfait, '10 kg', 10, 15000, 0),
    ('55555555-5555-4555-8555-555555555551', v_forfait, '15 kg', 15, 22000, 1),
    ('55555555-5555-4555-8555-555555555551', v_forfait, '20 kg', 20, 28500, 2);

  select id into v_tier
    from public.tenant_weight_tiers
   where tenant_service_id = v_forfait and weight_kg = 10;

  select count(*) into v_compte from public.tenant_weight_tiers
   where tenant_service_id = v_forfait;
  if v_compte <> 3 then
    raise exception 'ECHEC 5 : les trois paliers de poids ne sont pas enregistrés';
  end if;

  v_sqlstate := null;
  begin
    insert into public.tenant_weight_tiers (
      tenant_id, tenant_service_id, label, weight_kg, price_fcfa
    ) values (
      '55555555-5555-4555-8555-555555555551', v_piece, '5 kg', 5, 5000
    );
  exception when check_violation then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '23514' then
    raise exception 'ECHEC 6 : un palier a été accepté sur une prestation à la pièce';
  end if;

  v_sqlstate := null;
  begin
    update public.tenant_services set billing_unit = 'KG' where id = v_forfait;
  exception when check_violation then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '23514' then
    raise exception 'ECHEC 7 : changer d''unité avec des paliers existants devrait être refusé';
  end if;
  raise notice 'OK 4 — paliers de poids protégés et cohérents avec le forfait.';

  -- 5. Ligne de commande avec snapshot de forfait.
  insert into public.orders (
    id, tenant_id, customer_name, customer_phone, qr_code, total_amount
  ) values (
    '55555555-5555-4555-8555-555555555552',
    '55555555-5555-4555-8555-555555555551',
    'Client forfait', '0700000002', 'CMD-CATALOGUE-01', 15000
  );

  insert into public.order_items (
    id, order_id, tenant_id, label, price, quantity, billed_quantity,
    billing_unit, unit_price, pricing_mode, price_status, service_name,
    tenant_service_id, activity_name_snapshot, category_name_snapshot,
    package_snapshot
  ) values (
    '55555555-5555-4555-8555-555555555553',
    '55555555-5555-4555-8555-555555555552',
    '55555555-5555-4555-8555-555555555551',
    'Laver repasser — 10 kg', 15000, 1, 1,
    'PACKAGE', 15000, 'FIXED', 'CONFIRMED', 'Laver repasser',
    v_forfait, 'Blanchisserie', 'Lavage au poids',
    jsonb_build_object(
      'tier_id', v_tier,
      'label', '10 kg',
      'weight_kg', 10,
      'price_fcfa', 15000,
      'service_name', 'Laver repasser'
    )
  );
  raise notice 'OK 5 — ligne de forfait avec snapshot acceptée.';

  -- Prix falsifié sur une ligne forfaitaire : le CHECK doit refuser.
  v_sqlstate := null;
  begin
    insert into public.order_items (
      id, order_id, tenant_id, label, price, quantity, billed_quantity,
      billing_unit, unit_price, pricing_mode, price_status,
      package_snapshot
    ) values (
      '55555555-5555-4555-8555-555555555554',
      '55555555-5555-4555-8555-555555555552',
      '55555555-5555-4555-8555-555555555551',
      'Forfait falsifié', 1000, 1, 1,
      'PACKAGE', 1000, 'FIXED', 'CONFIRMED',
      jsonb_build_object(
        'tier_id', v_tier, 'label', '10 kg', 'weight_kg', 10,
        'price_fcfa', 15000, 'service_name', 'Laver repasser'
      )
    );
  exception when check_violation then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '23514' then
    raise exception 'ECHEC 8 : un prix de ligne différent du palier figé a été accepté';
  end if;

  v_sqlstate := null;
  begin
    insert into public.order_items (
      id, order_id, tenant_id, label, price, quantity, billed_quantity,
      billing_unit, unit_price, pricing_mode, price_status,
      package_snapshot
    ) values (
      '55555555-5555-4555-8555-555555555555',
      '55555555-5555-4555-8555-555555555552',
      '55555555-5555-4555-8555-555555555551',
      'Snapshot mal formé', 15000, 1, 1,
      'PACKAGE', 15000, 'FIXED', 'CONFIRMED',
      jsonb_build_object('label', '10 kg', 'price_fcfa', 15000)
    );
  exception when check_violation then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '23514' then
    raise exception 'ECHEC 9 : un snapshot de forfait incomplet a été accepté';
  end if;
  raise notice 'OK 6 — le serveur rejette les forfaits falsifiés ou mal formés.';

  -- 6. Types de vêtements élargis.
  if not public.valid_order_garment_details(
    '[{"type":"COUETTE","quantity":1},{"type":"CHAUSSETTES","quantity":2},{"type":"LINGE_DE_MAISON","quantity":3}]'::jsonb
  ) then
    raise exception 'ECHEC 10 : les nouveaux types de linge ont été rejetés';
  end if;
  if public.valid_order_garment_details('[{"type":"INCONNU","quantity":1}]'::jsonb) then
    raise exception 'ECHEC 11 : un type de vêtement inconnu a été accepté';
  end if;
  raise notice 'OK 7 — enum de linge élargi validé côté serveur.';

  -- 7. Ligne libre historique : toujours acceptée, sans aucune référence.
  insert into public.order_items (
    id, order_id, tenant_id, label, price, quantity, billed_quantity,
    billing_unit, unit_price, pricing_mode, price_status, price_reason
  ) values (
    '55555555-5555-4555-8555-555555555556',
    '55555555-5555-4555-8555-555555555552',
    '55555555-5555-4555-8555-555555555551',
    'Ligne libre', 2000, 2, 2,
    'PIECE', 1000, 'FIXED', 'CONFIRMED', 'Ligne libre saisie au comptoir — test'
  );
  if not exists (
    select 1 from public.order_items where id = '55555555-5555-4555-8555-555555555556'
      and package_snapshot is null and category_name_snapshot is null
  ) then
    raise exception 'ECHEC 12 : la ligne libre historique ne doit pas porter de snapshot';
  end if;
  raise notice 'OK 8 — les lignes libres restent acceptées sans snapshot.';
end $$;

-- 9. RLS : le réceptionniste ne peut pas modifier le catalogue.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '00000000-0000-4000-8000-0000000000e2', 'role', 'authenticated')::text,
  true
);

do $$
declare
  v_sqlstate text;
begin
  begin
    insert into public.tenant_service_categories (tenant_id, activity_id, name)
    select '55555555-5555-4555-8555-555555555551', id, 'Categorie interdite'
      from public.tenant_activities limit 1;
  exception when insufficient_privilege then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'ECHEC 14 : un réceptionniste peut créer une catégorie';
  end if;

  v_sqlstate := null;
  begin
    insert into public.tenant_services (tenant_id, activity_id, service_name, unit_price)
    select '55555555-5555-4555-8555-555555555551', id, 'Prestation interdite', 500
      from public.tenant_activities limit 1;
  exception when insufficient_privilege then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'ECHEC 15 : un réceptionniste peut créer une prestation de référence';
  end if;

  v_sqlstate := null;
  begin
    insert into public.tenant_weight_tiers (
      tenant_id, tenant_service_id, label, weight_kg, price_fcfa
    )
    select '55555555-5555-4555-8555-555555555551', id, '5 kg', 5, 5000
      from public.tenant_services
     where billing_unit = 'PACKAGE'
     limit 1;
  exception when insufficient_privilege then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'ECHEC 16 : un réceptionniste peut créer un palier de poids';
  end if;

  -- La lecture reste autorisée pour le membre du pressing.
  if not exists (select 1 from public.tenant_services limit 1) then
    raise exception 'ECHEC 17 : un réceptionniste doit pouvoir lire le catalogue';
  end if;
  raise notice 'OK 10 — RLS : écritures propriétaire seul, lecture pour l''équipe.';
end $$;

-- 10. Retour au propriétaire : suppression de prestation et conservation des snapshots.
select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '00000000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text,
  true
);

do $$
declare
  v_forfait uuid;
begin
  select id into v_forfait
    from public.tenant_services
   where service_name = 'Laver repasser' and billing_unit = 'PACKAGE';

  delete from public.tenant_services where id = v_forfait;
  if not exists (
    select 1 from public.order_items where id = '55555555-5555-4555-8555-555555555553'
      and tenant_service_id is null
      and service_name = 'Laver repasser'
      and category_name_snapshot = 'Lavage au poids'
      and package_snapshot is not null
  ) then
    raise exception 'ECHEC 13 : la suppression de la prestation a altéré les snapshots';
  end if;
  raise notice 'OK 9 — suppression de prestation sans perte d''historique.';
end $$;

rollback;
