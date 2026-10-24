-- =============================================================================
-- roles.sql — contrôle des autorisations par rôle (palier 1)
-- =============================================================================
-- ⚠ Test LOCAL : les trois comptes ci-dessous sont fictifs. Il s'exécute sur
--   un PostgreSQL préparé par `supabase/tests/local/00_bootstrap.sql`
--   (voir `scripts/sql-verify.sh`), pas dans le SQL Editor d'un projet réel où
--   ces identifiants n'existent pas et où `auth.users` possède d'autres
--   colonnes obligatoires.
--
--   Le script est enveloppé dans une transaction annulée à la fin : il ne
--   laisse AUCUNE trace, pas même les comptes de test.
--
-- Il rejoue les requêtes PostgREST en se plaçant dans la peau d'un utilisateur
-- authentifié (`request.jwt.claims`), comme le fait déjà `isolation.sql`.
--
-- Chaque contrôle lève une exception explicite s'il échoue : atteindre la
-- dernière requête signifie que tout est conforme.
--
-- Rappel de la matrice :
--   owner        : tout
--   receptionist : créer, encaisser, faire avancer, modifier les détails
--   artisan      : faire avancer uniquement (ni montants, ni encaissement)
-- =============================================================================

begin;

-- =============================================================================
-- 0. COMPTES DE TEST
-- =============================================================================
-- L'historique des statuts porte une clé étrangère vers `auth.users` :
-- `changed_by` doit référencer un compte existant, sinon la transition échoue
-- pour une raison sans rapport avec les droits testés.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'artisan@test.local'),
  ('00000000-0000-4000-8000-0000000000b2', 'reception@test.local'),
  ('00000000-0000-4000-8000-0000000000c3', 'proprietaire@test.local')
on conflict (id) do nothing;

-- =============================================================================
-- 1. ARTISAN DU PRESSING 1
-- =============================================================================
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
  lignes integer;
begin
  -- 1.1 Faire avancer une commande : autorisé.
  update public.orders
  set    status = 'ironing'
  where  id = 'aaaaaaaa-0000-4000-8000-000000000001';

  get diagnostics lignes = row_count;
  if lignes <> 1 then
    raise exception 'ÉCHEC 1.1 — un artisan ne peut pas faire avancer une commande (0 ligne touchée).';
  end if;
  raise notice 'OK 1.1 — l''artisan fait avancer une commande.';

  -- 1.2 Modifier le montant : interdit par guard_order_update.
  begin
    update public.orders
    set    total_amount = 1
    where  id = 'aaaaaaaa-0000-4000-8000-000000000001';
    raise exception 'ÉCHEC 1.2 — un artisan a pu modifier le montant d''une commande.';
  exception
    when insufficient_privilege then
      raise notice 'OK 1.2 — montant protégé (42501).';
  end;

  -- 1.3 Modifier les coordonnées du client : interdit.
  begin
    update public.orders
    set    customer_phone = '+2250100000000'
    where  id = 'aaaaaaaa-0000-4000-8000-000000000001';
    raise exception 'ÉCHEC 1.3 — un artisan a pu modifier le téléphone du client.';
  exception
    when insufficient_privilege then
      raise notice 'OK 1.3 — coordonnées client protégées (42501).';
  end;

  -- 1.4 Écrire le statut de paiement : réservé au service_role (webhook).
  begin
    update public.orders
    set    payment_status = 'paid'
    where  id = 'aaaaaaaa-0000-4000-8000-000000000001';
    raise exception 'ÉCHEC 1.4 — payment_status est modifiable par un utilisateur.';
  exception
    when insufficient_privilege then
      raise notice 'OK 1.4 — statut de paiement réservé au serveur (42501).';
  end;

  -- 1.5 Créer une commande : interdit par la politique d'insertion.
  begin
    insert into public.orders
      (id, tenant_id, customer_name, customer_phone, status, qr_code, total_amount)
    values
      ('dddddddd-0000-4000-8000-0000000000a1',
       '11111111-1111-4111-8111-111111111111',
       'Test artisan', '+2250700000009', 'received',
       '11111111-1111-4111-8111-111111111111-dddddddd-0000-4000-8000-0000000000a1',
       1000);
    raise exception 'ÉCHEC 1.5 — un artisan a pu créer une commande.';
  exception
    when insufficient_privilege then
      raise notice 'OK 1.5 — création de commande refusée à l''artisan (42501).';
  end;
end;
$$;

-- =============================================================================
-- 2. RÉCEPTIONNISTE DU PRESSING 1
-- =============================================================================
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
  lignes integer;
begin
  -- 2.1 Créer une commande : autorisé.
  insert into public.orders
    (id, tenant_id, customer_name, customer_phone, status, qr_code, total_amount)
  values
    ('dddddddd-0000-4000-8000-0000000000b2',
     '11111111-1111-4111-8111-111111111111',
     'Test réception', '+2250700000008', 'received',
     '11111111-1111-4111-8111-111111111111-dddddddd-0000-4000-8000-0000000000b2',
     2000);
  raise notice 'OK 2.1 — le réceptionniste crée une commande.';

  -- 2.2 Modifier le montant : autorisé (correction au comptoir).
  update public.orders
  set    total_amount = 2500
  where  id = 'dddddddd-0000-4000-8000-0000000000b2';

  get diagnostics lignes = row_count;
  if lignes <> 1 then
    raise exception 'ÉCHEC 2.2 — le réceptionniste ne peut pas corriger un montant.';
  end if;
  raise notice 'OK 2.2 — le réceptionniste corrige un montant.';

  -- 2.3 Supprimer une commande : réservé au propriétaire.
  begin
    delete from public.orders
    where  id = 'dddddddd-0000-4000-8000-0000000000b2';
    -- Une suppression refusée par RLS ne lève pas d'erreur : elle ne touche
    -- simplement aucune ligne. On vérifie donc le nombre de lignes supprimées.
    get diagnostics lignes = row_count;
    if lignes > 0 then
      raise exception 'ÉCHEC 2.3 — un réceptionniste a pu supprimer une commande.';
    end if;
    raise notice 'OK 2.3 — suppression filtrée par la RLS (0 ligne).';
  end;
end;
$$;

-- =============================================================================
-- 3. PROPRIÉTAIRE : rouvrir une commande livrée
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
  lignes integer;
begin
  -- 3.1 Le propriétaire clôt la commande 2 (statut initial : ready).
  update public.orders
  set    status = 'delivered'
  where  id = 'aaaaaaaa-0000-4000-8000-000000000002';

  get diagnostics lignes = row_count;
  if lignes <> 1 then
    raise exception 'ÉCHEC 3.1 — le propriétaire ne peut pas livrer une commande.';
  end if;
  raise notice 'OK 3.1 — le propriétaire livre une commande.';

  -- 3.2 Il peut la rouvrir (correction d'erreur de saisie).
  update public.orders
  set    status = 'ready'
  where  id = 'aaaaaaaa-0000-4000-8000-000000000002';

  get diagnostics lignes = row_count;
  if lignes <> 1 then
    raise exception 'ÉCHEC 3.2 — le propriétaire ne peut pas rouvrir une commande livrée.';
  end if;
  raise notice 'OK 3.2 — le propriétaire rouvre une commande livrée.';
end;
$$;

-- =============================================================================
-- 4. L'ARTISAN NE PEUT PAS ROUVRIR UNE COMMANDE LIVRÉE
-- =============================================================================
reset role;

-- Remise en état « livrée » du contrôle 3 (le propriétaire vient de la
-- rouvrir). Exécuté hors RLS, avec les claims du propriétaire encore en place
-- pour que le garde-fou autorise la transition.
update public.orders
set    status = 'delivered'
where  id = 'aaaaaaaa-0000-4000-8000-000000000002';

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
begin
  begin
    update public.orders
    set    status = 'washing'
    where  id = 'aaaaaaaa-0000-4000-8000-000000000002'
      and  status = 'delivered';
    raise exception 'ÉCHEC 4 — un artisan a pu rouvrir une commande livrée.';
  exception
    when insufficient_privilege then
      raise notice 'OK 4 — réouverture d''une commande livrée refusée à l''artisan (42501).';
  end;
end;
$$;

reset role;

-- =============================================================================
-- 5. BILAN
-- =============================================================================
-- Atteindre cette requête signifie que tous les contrôles ci-dessus ont réussi.
select controle
from (values
  ('1.1 artisan : avancer une commande'),
  ('1.2 artisan : montant refusé'),
  ('1.3 artisan : coordonnées refusées'),
  ('1.4 utilisateur : statut de paiement refusé'),
  ('1.5 artisan : création refusée'),
  ('2.1 réceptionniste : création autorisée'),
  ('2.2 réceptionniste : correction de montant autorisée'),
  ('2.3 réceptionniste : suppression filtrée'),
  ('3.1 propriétaire : livraison autorisée'),
  ('3.2 propriétaire : réouverture autorisée'),
  ('4 artisan : réouverture refusée')
) as t(controle);

rollback;
