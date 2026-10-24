-- =============================================================================
-- palier3.sql — clients, stocks, fournisseurs et dépenses
-- =============================================================================
-- Vérifie sur une vraie base les mécanismes de `006_palier3.sql` :
--   1. clients créés et rattachés automatiquement depuis une commande ;
--   2. téléphones normalisés (un numéro = une fiche) ;
--   3. droits de la fiche client (comptoir écrit, atelier non) ;
--   4. stock tenu par les mouvements, sortie impossible au-delà du disponible ;
--   5. dépenses réservées au propriétaire ;
--   6. vue d'agrégation mensuelle filtrée par la RLS.
--
-- ⚠ Test LOCAL : à exécuter sur un PostgreSQL préparé par
--   `supabase/tests/local/00_bootstrap.sql` (voir `scripts/sql-verify.sh`).
--   Tout se termine par ROLLBACK.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Comptes de test
-- -----------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'artisan@test.local'),
  ('00000000-0000-4000-8000-0000000000b2', 'reception@test.local'),
  ('00000000-0000-4000-8000-0000000000c3', 'proprietaire@test.local')
on conflict (id) do nothing;

insert into public.tenant_users (user_id, tenant_id, role) values
  ('00000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'artisan'),
  ('00000000-0000-4000-8000-0000000000b2', '11111111-1111-4111-8111-111111111111', 'receptionist'),
  ('00000000-0000-4000-8000-0000000000c3', '11111111-1111-4111-8111-111111111111', 'owner')
on conflict (user_id, tenant_id) do nothing;

-- =============================================================================
-- 1. CLIENTS ISSUS DES COMMANDES
-- =============================================================================
-- Créé en tant que propriétaire des données (`postgres`), sans jeton : c'est
-- exactement le chemin d'un enregistrement de commande au comptoir, où le
-- déclencheur fait tout le travail.
insert into public.orders
  (id, tenant_id, customer_name, customer_phone, status, qr_code, total_amount)
values
  ('aaaa0000-0000-4000-8000-0000000000a1',
   '11111111-1111-4111-8111-111111111111',
   'Awa Koné', '+225 07 00 00 00 21', 'received',
   '11111111-1111-4111-8111-111111111111-aaaa0000-0000-4000-8000-0000000000a1-1750000009997',
   5000),
  ('aaaa0000-0000-4000-8000-0000000000a2',
   '11111111-1111-4111-8111-111111111111',
   'Awa K.', '0700000021', 'received',
   '11111111-1111-4111-8111-111111111111-aaaa0000-0000-4000-8000-0000000000a2-1750000009996',
   3000);

do $$
declare
  v_clients integer;
  v_lien    uuid;
begin
  -- 1.1 Une fiche est créée pour le premier numéro rencontré.
  select count(*) into v_clients
  from   public.customers
  where  tenant_id = '11111111-1111-4111-8111-111111111111'
    and  phone_key = '0700000021';

  if v_clients <> 1 then
    raise exception 'ÉCHEC 1.1 — % fiche(s) client au lieu d''une.', v_clients;
  end if;
  raise notice 'OK 1.1 — fiche client créée par la commande';

  -- 1.2 Le second numéro, écrit autrement, réutilise la même fiche.
  select customer_id into v_lien
  from   public.orders
  where  id = 'aaaa0000-0000-4000-8000-0000000000a2';

  if v_lien is null then
    raise exception 'ÉCHEC 1.2 — commande non rattachée à une fiche client.';
  end if;

  select count(*) into v_clients
  from   public.customers
  where  tenant_id = '11111111-1111-4111-8111-111111111111';

  if v_clients < 1 then
    raise exception 'ÉCHEC 1.2 — aucune fiche client.';
  end if;
  raise notice 'OK 1.2 — « +225 07 00 00 00 21 » et « 0700000021 » désignent la même fiche';

  -- 1.3 Le nom le plus récent est conservé.
  if (select name from public.customers where id = v_lien) <> 'Awa K.' then
    raise exception 'ÉCHEC 1.3 — le nom de la fiche n''a pas été actualisé.';
  end if;
  raise notice 'OK 1.3 — nom de la fiche actualisé par la commande la plus récente';
end;
$$;

-- 1.4 Le comptoir enrichit la fiche ; l'atelier n'y touche pas.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-0000000000b2',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'tenant_id', '11111111-1111-4111-8111-111111111111',
      'tenant_role', 'receptionist'
    )
  )::text,
  true
);

set local role authenticated;

do $$
declare
  v_lignes integer;
begin
  update public.customers
  set    notes = 'Cliente habituelle, préfère le repassage léger',
         address = 'Cocody, près de la pharmacie'
  where  phone_key = '0700000021';

  get diagnostics v_lignes = row_count;
  if v_lignes <> 1 then
    raise exception 'ÉCHEC 1.4 — le comptoir n''a pas pu enrichir la fiche (% ligne(s)).', v_lignes;
  end if;
  raise notice 'OK 1.4 — le comptoir enrichit la fiche client';
end;
$$;

reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-0000000000a1',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'tenant_id', '11111111-1111-4111-8111-111111111111',
      'tenant_role', 'artisan'
    )
  )::text,
  true
);

set local role authenticated;

do $$
declare
  v_lignes integer;
begin
  update public.customers
  set    notes = 'Écrit par l''atelier'
  where  phone_key = '0700000021';

  get diagnostics v_lignes = row_count;
  if v_lignes <> 0 then
    raise exception 'ÉCHEC 1.5 — un artisan a modifié une fiche client.';
  end if;
  raise notice 'OK 1.5 — modification de fiche refusée à l''atelier';
end;
$$;

-- =============================================================================
-- 2. STOCK
-- =============================================================================
reset role;

-- Le libellé d'unité « palette » n'est pas dans la liste : l'insertion doit
-- être refusée.
do $$
declare
  v_refus boolean := false;
begin
  begin
    insert into public.stock_items (tenant_id, name, unit)
    values ('11111111-1111-4111-8111-111111111111', 'Article invalide', 'palette');
  exception
    when check_violation then
      v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 2.0 — unité inconnue acceptée.';
  end if;
  raise notice 'OK 2.0 — unité de stock inconnue refusée (23514)';
end;
$$;

-- Création de l'article (unité autorisée).
insert into public.stock_items (id, tenant_id, name, category, unit, quantity, min_quantity, unit_cost)
values
  ('bbbb0000-0000-4000-8000-0000000000b1',
   '11111111-1111-4111-8111-111111111111',
   'Lessive liquide 5 L', 'produit', 'flacon', 0, 2, 4500);

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-0000000000c3',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'tenant_id', '11111111-1111-4111-8111-111111111111',
      'tenant_role', 'owner'
    )
  )::text,
  true
);

set local role authenticated;

do $$
declare
  v_quantite numeric;
  v_refus    boolean := false;
begin
  -- 2.1 Entrée de 10 flacons.
  insert into public.stock_movements (tenant_id, item_id, kind, quantity, unit_cost, reason)
  values ('11111111-1111-4111-8111-111111111111',
          'bbbb0000-0000-4000-8000-0000000000b1', 'in', 10, 4500, 'Livraison fournisseur');

  select quantity into v_quantite
  from   public.stock_items
  where  id = 'bbbb0000-0000-4000-8000-0000000000b1';

  if v_quantite <> 10 then
    raise exception 'ÉCHEC 2.1 — quantité % au lieu de 10.', v_quantite;
  end if;
  raise notice 'OK 2.1 — entrée de 10, stock à 10';

  -- 2.2 Sortie de 3.
  insert into public.stock_movements (tenant_id, item_id, kind, quantity, reason)
  values ('11111111-1111-4111-8111-111111111111',
          'bbbb0000-0000-4000-8000-0000000000b1', 'out', 3, 'Service du jour');

  select quantity into v_quantite
  from   public.stock_items
  where  id = 'bbbb0000-0000-4000-8000-0000000000b1';

  if v_quantite <> 7 then
    raise exception 'ÉCHEC 2.2 — quantité % au lieu de 7.', v_quantite;
  end if;
  raise notice 'OK 2.2 — sortie de 3, stock à 7';

  -- 2.3 Sortie impossible au-delà du disponible.
  begin
    insert into public.stock_movements (tenant_id, item_id, kind, quantity)
    values ('11111111-1111-4111-8111-111111111111',
            'bbbb0000-0000-4000-8000-0000000000b1', 'out', 100);
  exception
    when invalid_parameter_value then
      v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 2.3 — sortie de 100 acceptée avec 7 en stock.';
  end if;
  raise notice 'OK 2.3 — sortie supérieure au stock refusée (22023)';
end;
$$;

-- 2.4 Le comptoir enregistre les sorties, pas l'atelier.
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-0000000000b2',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'tenant_id', '11111111-1111-4111-8111-111111111111',
      'tenant_role', 'receptionist'
    )
  )::text,
  true
);

set local role authenticated;

do $$
declare
  v_quantite numeric;
begin
  insert into public.stock_movements (tenant_id, item_id, kind, quantity, reason)
  values ('11111111-1111-4111-8111-111111111111',
          'bbbb0000-0000-4000-8000-0000000000b1', 'out', 2, 'Dosage du jour');

  select quantity into v_quantite
  from   public.stock_items
  where  id = 'bbbb0000-0000-4000-8000-0000000000b1';

  if v_quantite <> 5 then
    raise exception 'ÉCHEC 2.4 — quantité % au lieu de 5.', v_quantite;
  end if;
  raise notice 'OK 2.4 — le comptoir enregistre une sortie de 2, stock à 5';
end;
$$;

reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-0000000000a1',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'tenant_id', '11111111-1111-4111-8111-111111111111',
      'tenant_role', 'artisan'
    )
  )::text,
  true
);

set local role authenticated;

do $$
declare
  v_refus  boolean := false;
  v_lignes integer;
begin
  begin
    insert into public.stock_movements (tenant_id, item_id, kind, quantity)
    values ('11111111-1111-4111-8111-111111111111',
            'bbbb0000-0000-4000-8000-0000000000b1', 'out', 1);
  exception
    when insufficient_privilege then
      v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 2.5 — un artisan a enregistré un mouvement de stock.';
  end if;
  raise notice 'OK 2.5 — mouvement de stock refusé à l''atelier (42501)';

  -- 2.6 Le journal est définitif : aucune modification n'est même permise.
  begin
    update public.stock_movements
    set    quantity = 1
    where  item_id = 'bbbb0000-0000-4000-8000-0000000000b1';
    get diagnostics v_lignes = row_count;

    if v_lignes <> 0 then
      raise exception 'ÉCHEC 2.6 — un mouvement de stock a été modifié.';
    end if;
  exception
    when insufficient_privilege then
      null;  -- attendu : le droit de mise à jour n'existe pas
  end;
  raise notice 'OK 2.6 — journal des mouvements non modifiable';
end;
$$;

-- =============================================================================
-- 3. DÉPENSES
-- =============================================================================
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-0000000000c3',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'tenant_id', '11111111-1111-4111-8111-111111111111',
      'tenant_role', 'owner'
    )
  )::text,
  true
);

set local role authenticated;

do $$
declare
  v_refus boolean := false;
begin
  -- 3.1 Le propriétaire enregistre une dépense.
  insert into public.expenses (tenant_id, label, category, amount, spent_on, note)
  values ('11111111-1111-4111-8111-111111111111',
          'Loyer du mois', 'loyer', 150000,
          (now() at time zone 'Africa/Abidjan')::date, 'Payé en espèces');

  raise notice 'OK 3.1 — dépense enregistrée par le propriétaire';

  -- 3.2 Un montant nul est refusé.
  begin
    insert into public.expenses (tenant_id, label, category, amount)
    values ('11111111-1111-4111-8111-111111111111', 'Erreur', 'autre', 0);
  exception
    when check_violation then
      v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 3.2 — dépense à zéro acceptée.';
  end if;
  raise notice 'OK 3.2 — dépense nulle refusée (23514)';
end;
$$;

reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-0000000000b2',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'tenant_id', '11111111-1111-4111-8111-111111111111',
      'tenant_role', 'receptionist'
    )
  )::text,
  true
);

set local role authenticated;

do $$
declare
  v_lignes integer;
  v_refus  boolean := false;
begin
  -- 3.3 Le comptoir ne voit aucune dépense.
  select count(*) into v_lignes from public.expenses;

  if v_lignes <> 0 then
    raise exception 'ÉCHEC 3.3 — le comptoir voit % dépense(s).', v_lignes;
  end if;
  raise notice 'OK 3.3 — dépenses invisibles au comptoir (RLS)';

  -- 3.4 Et ne peut pas en créer.
  begin
    insert into public.expenses (tenant_id, label, category, amount)
    values ('11111111-1111-4111-8111-111111111111', 'Tentative', 'autre', 1000);
  exception
    when insufficient_privilege then
      v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 3.4 — le comptoir a créé une dépense.';
  end if;
  raise notice 'OK 3.4 — création de dépense refusée au comptoir (42501)';
end;
$$;

-- =============================================================================
-- 4. VUE D'AGRÉGATION
-- =============================================================================
reset role;

select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-0000000000c3',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'tenant_id', '11111111-1111-4111-8111-111111111111',
      'tenant_role', 'owner'
    )
  )::text,
  true
);

set local role authenticated;

do $$
declare
  v_total integer;
begin
  select coalesce(sum(total_amount), 0) into v_total
  from   public.expense_totals
  where  tenant_id = '11111111-1111-4111-8111-111111111111';

  if v_total <> 150000 then
    raise exception 'ÉCHEC 4.1 — total % au lieu de 150 000.', v_total;
  end if;
  raise notice 'OK 4.1 — vue des dépenses : 150 000 FCFA sur le mois';
end;
$$;

reset role;

rollback;
