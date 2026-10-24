-- =============================================================================
-- palier1.sql — verrou optimiste, historique et guichet unique de paiement
-- =============================================================================
-- Vérifie sur une vraie base les trois mécanismes introduits par la migration
-- `003_palier1.sql` :
--   1. `version` n'augmente QUE sur un champ métier (pas sur le paiement) ;
--   2. l'historique conserve l'ancien statut (`previous_status`) ;
--   3. une commande ne peut pas avoir deux guichets de paiement ouverts.
--
-- ⚠ Test LOCAL : à exécuter sur un PostgreSQL préparé par
--   `supabase/tests/local/00_bootstrap.sql` (voir `scripts/sql-verify.sh`),
--   après `001`, `002`, `003` et `seed.sql`.
--
-- Tout se termine par ROLLBACK : aucune donnée n'est modifiée durablement.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Prérequis
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.orders') is null then
    raise exception 'ÉCHEC : appliquez d''abord les migrations.';
  end if;
  if (select count(*) from public.orders) < 3 then
    raise exception 'ÉCHEC : chargez supabase/seed.sql (3 commandes attendues).';
  end if;
  raise notice 'OK   — schéma et jeu de démonstration chargés';
end $$;

-- =============================================================================
-- 1. VERSION : seulement les champs métier
-- =============================================================================
do $$
declare
  v_avant   integer;
  v_apres   integer;
begin
  select version into v_avant
  from   public.orders
  where  id = 'aaaaaaaa-0000-4000-8000-000000000001';

  if v_avant is null then
    raise exception 'ÉCHEC 1.0 — commande de démonstration absente.';
  end if;
  raise notice 'OK 1.0 — une commande neuve démarre en version %', v_avant;

  -- 1.1 Un changement de statut incrémente la version.
  update public.orders
  set    status = 'ironing'
  where  id = 'aaaaaaaa-0000-4000-8000-000000000001';

  select version into v_apres
  from   public.orders
  where  id = 'aaaaaaaa-0000-4000-8000-000000000001';

  if v_apres <> v_avant + 1 then
    raise exception 'ÉCHEC 1.1 — version % au lieu de % après changement de statut.', v_apres, v_avant + 1;
  end if;
  raise notice 'OK 1.1 — changement de statut : version % → %', v_avant, v_apres;

  -- 1.2 Une écriture du paiement (service_role) NE change PAS la version :
  --     sinon toutes les tablettes verraient un conflit à chaque paiement.
  v_avant := v_apres;

  update public.orders
  set    payment_status = 'paid',
         payment_method = 'wave'
  where  id = 'aaaaaaaa-0000-4000-8000-000000000001';

  select version into v_apres
  from   public.orders
  where  id = 'aaaaaaaa-0000-4000-8000-000000000001';

  if v_apres <> v_avant then
    raise exception 'ÉCHEC 1.2 — le paiement a modifié la version (% → %).', v_avant, v_apres;
  end if;
  raise notice 'OK 1.2 — écriture du paiement : version inchangée (%)', v_apres;

  -- 1.3 Deux écritures identiques ne changent rien (idempotence du verrou).
  update public.orders
  set    status = 'ironing'
  where  id = 'aaaaaaaa-0000-4000-8000-000000000001';

  select version into v_apres
  from   public.orders
  where  id = 'aaaaaaaa-0000-4000-8000-000000000001';

  if v_apres <> v_avant then
    raise exception 'ÉCHEC 1.3 — une écriture sans effet a modifié la version.';
  end if;
  raise notice 'OK 1.3 — écriture sans changement : version stable (%)', v_apres;
end;
$$;

-- =============================================================================
-- 2. HISTORIQUE : ancien statut conservé
-- =============================================================================
do $$
declare
  v_previous text;
  v_status   text;
begin
  select previous_status, status
    into v_previous, v_status
  from   public.order_status_history
  where  order_id = 'aaaaaaaa-0000-4000-8000-000000000001'
  order  by changed_at desc
  limit  1;

  if v_previous is null then
    raise exception 'ÉCHEC 2.1 — previous_status n''est pas renseigné.';
  end if;

  if v_previous <> 'washing' or v_status <> 'ironing' then
    raise exception 'ÉCHEC 2.2 — historique incohérent (% → %).', v_previous, v_status;
  end if;

  raise notice 'OK 2 — historique complet : % → %', v_previous, v_status;
end;
$$;

-- =============================================================================
-- 3. GUICHET UNIQUE DE PAIEMENT
-- =============================================================================
do $$
declare
  v_refus boolean := false;
begin
  insert into public.payment_transactions
    (order_id, tenant_id, transaction_id, amount, order_amount, status, payment_url)
  values
    ('aaaaaaaa-0000-4000-8000-000000000001',
     '11111111-1111-4111-8111-111111111111',
     'TEST-GUICHET-1', 8500, 8500, 'pending', 'https://exemple.test/payer/1');
  raise notice 'OK 3.1 — premier guichet ouvert';

  -- 3.2 Un second guichet ouvert sur la même commande doit être refusé.
  begin
    insert into public.payment_transactions
      (order_id, tenant_id, transaction_id, amount, order_amount, status, payment_url)
    values
      ('aaaaaaaa-0000-4000-8000-000000000001',
       '11111111-1111-4111-8111-111111111111',
       'TEST-GUICHET-2', 8500, 8500, 'pending', 'https://exemple.test/payer/2');
  exception
    when unique_violation then
      v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 3.2 — deux guichets ouverts simultanément : double paiement possible.';
  end if;
  raise notice 'OK 3.2 — second guichet refusé (23505)';

  -- 3.3 Une fois le premier clôturé, un nouveau guichet est autorisé.
  update public.payment_transactions
  set    status = 'cancelled'
  where  transaction_id = 'TEST-GUICHET-1';

  insert into public.payment_transactions
    (order_id, tenant_id, transaction_id, amount, order_amount, status, payment_url)
  values
    ('aaaaaaaa-0000-4000-8000-000000000001',
     '11111111-1111-4111-8111-111111111111',
     'TEST-GUICHET-3', 8500, 8500, 'pending', 'https://exemple.test/payer/3');
  raise notice 'OK 3.3 — nouveau guichet autorisé après clôture';

  -- 3.4 Deux guichets sur des commandes différentes restent possibles.
  insert into public.payment_transactions
    (order_id, tenant_id, transaction_id, amount, order_amount, status, payment_url)
  values
    ('aaaaaaaa-0000-4000-8000-000000000002',
     '11111111-1111-4111-8111-111111111111',
     'TEST-GUICHET-4', 12000, 12000, 'pending', 'https://exemple.test/payer/4');
  raise notice 'OK 3.4 — guichets indépendants sur deux commandes';
end;
$$;

-- =============================================================================
-- 4. BILAN
-- =============================================================================
select controle
from (values
  ('1.0 version initiale'),
  ('1.1 statut : version incrémentée'),
  ('1.2 paiement : version inchangée'),
  ('1.3 écriture sans effet : version stable'),
  ('2   historique : previous_status renseigné'),
  ('3.1 premier guichet ouvert'),
  ('3.2 second guichet refusé'),
  ('3.3 guichet remplacé après clôture'),
  ('3.4 guichets indépendants par commande')
) as t(controle);

rollback;
