-- =============================================================================
-- isolation.sql — Vérification de l'isolation multi-tenant (phase 6)
-- =============================================================================
-- Objectif : prouver, sur une vraie base, qu'un utilisateur du pressing A ne
-- peut NI lire NI écrire les données du pressing B.
--
-- Mode d'emploi
--   1. Appliquer 001_init.sql, 002_payments.sql puis seed.sql.
--   2. Ouvrir ce fichier dans le SQL Editor de Supabase et l'exécuter.
--   3. Lire les messages NOTICE : chaque « OK » est une garantie vérifiée.
--      Toute anomalie lève une exception et interrompt le script.
--
-- Pourquoi `set local role authenticated` + `request.jwt.claims` ?
--   On rejoue exactement ce que fait PostgREST pour une requête authentifiée :
--   le rôle `authenticated` et le JWT décodé dans `request.jwt.claims`. Aucun
--   compte utilisateur réel n'est donc nécessaire (et rien n'est créé au
--   passage : tout se termine par ROLLBACK).
--
-- ⚠ Le script échoue volontairement si le jeu de démonstration n'est pas
--   chargé : sans données, le test ne prouverait rien.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Prérequis
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.orders') is null then
    raise exception 'ECHEC : appliquez d''abord supabase/migrations/001_init.sql';
  end if;
  if to_regclass('public.payment_transactions') is null then
    raise exception 'ECHEC : appliquez d''abord supabase/migrations/002_payments.sql';
  end if;
  if (select count(*) from public.orders) < 3 then
    raise exception 'ECHEC : chargez supabase/seed.sql (3 commandes attendues)';
  end if;
  raise notice 'OK   — schéma complet et jeu de démonstration chargé';
end $$;


-- =============================================================================
-- PRESSING 1 — Cocody (11111111-…)
-- =============================================================================
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-000000000001',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'tenant_id', '11111111-1111-4111-8111-111111111111',
      'tenant_role', 'owner'
    )
  )::text,
  true
);

set local role authenticated;

-- 1. Lecture : uniquement les commandes du pressing courant.
do $$
declare n integer;
begin
  select count(*) into n from public.orders;
  if n <> 2 then
    raise exception 'ECHEC : le pressing 1 voit % commandes (2 attendues)', n;
  end if;
  raise notice 'OK   — pressing 1 : ne voit que ses 2 commandes';
end $$;

-- 2. Lecture ciblée : la commande de l'autre pressing reste invisible même en
--    la demandant par son identifiant exact (le cas le plus révélateur).
do $$
declare n integer;
begin
  select count(*) into n
    from public.orders
   where id = 'bbbbbbbb-0000-4000-8000-000000000001';

  if n <> 0 then
    raise exception 'ECHEC : accès à la commande du pressing 2 par identifiant';
  end if;
  raise notice 'OK   — pressing 1 : commande du pressing 2 introuvable par identifiant';
end $$;

-- 3. Vêtements : la table enfant est isolée de la même façon.
do $$
declare n integer;
begin
  select count(*) into n from public.order_items;
  if n <> 3 then
    raise exception 'ECHEC : le pressing 1 voit % lignes (3 attendues)', n;
  end if;
  raise notice 'OK   — pressing 1 : ne voit que ses 3 lignes de vêtements';
end $$;

-- 4. Écriture : impossible de créer une commande pour un autre pressing.
--    On exige le code 42501 (insufficient_privilege) : un autre code d'erreur
--    (contrainte, typage…) ferait passer le test pour une mauvaise raison.
do $$
declare
  code_erreur text := null;
begin
  begin
    insert into public.orders
      (tenant_id, customer_name, customer_phone, qr_code, total_amount)
    values
      ('22222222-2222-4222-8222-222222222222', 'Intrusion', '+2250700000009', 'TEST-INTRUSION', 1000);
  exception
    when others then
      code_erreur := sqlstate;
  end;

  if code_erreur is null then
    raise exception 'ECHEC : écriture inter-pressing acceptée';
  end if;
  if code_erreur <> '42501' then
    raise exception 'ECHEC : refus pour la mauvaise raison (SQLSTATE %)', code_erreur;
  end if;
  raise notice 'OK   — pressing 1 : insertion pour le pressing 2 refusée par la RLS';
end $$;

-- 5. Paiements : la table est en lecture seule pour le client.
do $$
declare
  code_erreur text := null;
begin
  begin
    insert into public.payment_transactions
      (tenant_id, order_id, transaction_id, amount, order_amount)
    values
      ('11111111-1111-4111-8111-111111111111',
       'aaaaaaaa-0000-4000-8000-000000000001',
       'TEST-FRAUDE', 100, 100);
  exception
    when others then
      code_erreur := sqlstate;
  end;

  if code_erreur is null then
    raise exception 'ECHEC : un client a pu s''auto-attribuer un paiement';
  end if;
  if code_erreur <> '42501' then
    raise exception 'ECHEC : refus pour la mauvaise raison (SQLSTATE %)', code_erreur;
  end if;
  raise notice 'OK   — pressing 1 : écriture dans payment_transactions refusée par la RLS';
end $$;

reset role;


-- =============================================================================
-- PRESSING 2 — Yopougon (22222222-…)
-- =============================================================================
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-000000000002',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'tenant_id', '22222222-2222-4222-8222-222222222222',
      'tenant_role', 'owner'
    )
  )::text,
  true
);

set local role authenticated;

do $$
declare n integer;
begin
  select count(*) into n from public.orders;
  if n <> 1 then
    raise exception 'ECHEC : le pressing 2 voit % commandes (1 attendue)', n;
  end if;
  raise notice 'OK   — pressing 2 : ne voit que sa commande';
end $$;

do $$
declare n integer;
begin
  select count(*) into n
    from public.orders
   where tenant_id = '11111111-1111-4111-8111-111111111111';

  if n <> 0 then
    raise exception 'ECHEC : fuite de données du pressing 1 vers le pressing 2';
  end if;
  raise notice 'OK   — pressing 2 : aucune commande du pressing 1';
end $$;

reset role;


-- =============================================================================
-- ANONYME — aucun accès aux tables métier
-- =============================================================================
set local role anon;

do $$
declare
  code_erreur text := null;
begin
  begin
    perform 1 from public.orders limit 1;
  exception
    when others then
      code_erreur := sqlstate;
  end;

  if code_erreur is null then
    raise exception 'ECHEC : un visiteur anonyme lit les commandes';
  end if;
  raise notice 'OK   — anonyme : lecture des commandes refusée (SQLSTATE %)', code_erreur;
end $$;

reset role;

do $$
begin
  raise notice '=== Isolation multi-tenant : toutes les vérifications sont passées ===';
end $$;

-- Aucune donnée de test ne doit subsister.
rollback;
