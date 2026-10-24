-- =============================================================================
-- recette_reelle.sql — recette d'isolation sur un projet Supabase RÉEL
-- =============================================================================
-- Les autres fichiers de `supabase/tests/` tournent sur un PostgreSQL jetable
-- préparé par `00_bootstrap.sql`. Celui-ci est écrit pour être collé **tel quel
-- dans le SQL Editor d'un vrai projet Supabase** : il n'y a rien à installer,
-- rien à provisionner, et il ne laisse aucune trace (tout finit par ROLLBACK).
--
-- Ce qu'il prouve, et que les tests locaux ne peuvent pas prouver :
--   1. l'authentification par jeton (`request.jwt.claims`) telle que PostgREST
--      la fabrique réellement, avec les rôles `anon` et `authenticated` que
--      Supabase accorde par défaut ;
--   2. l'isolation entre **deux pressings** ayant chacun leur propriétaire ;
--   3. la matrice de rôles (propriétaire, artisan) sur des tables réelles ;
--   4. le passage en lecture seule d'un abonnement échu ;
--   5. l'inviolabilité du journal d'audit (migration 009).
--
-- Mode d'emploi :
--   • sur un vrai projet : SQL Editor → coller ce fichier → Run. Lire les
--     NOTICE « OK … ». Une anomalie lève une exception et interrompt le script ;
--   • en local : `npm run sql:verify` le rejoue avec les autres (il est dans la
--     liste de `scripts/sql-verify.sh`).
--
-- ⚠ Les identifiants utilisés sont préfixés par `3333…` / `4444…` / `5555…`
--   pour ne jamais croiser un vrai compte.
-- =============================================================================

begin;

-- =============================================================================
-- 0. DEUX PRESSINGS, TROIS COMPTES
-- =============================================================================
-- Les comptes sont créés dans `auth.users` : c'est la seule façon d'obtenir des
-- `auth.uid()` valides sans passer par l'API d'administration.
-- Volontairement réduit à `(id, email)` : sur un vrai projet Supabase les
-- autres colonnes ont des valeurs par défaut, et le `auth.users` minimal du
-- bootstrap local ne les connaît pas. Le script tourne donc aux deux endroits.
insert into auth.users (id, email) values
  ('33333333-3333-4333-8333-333333333331', 'recette.patron-a@exemple.ci'),
  ('33333333-3333-4333-8333-333333333332', 'recette.atelier-a@exemple.ci'),
  ('44444444-4444-4444-8444-444444444441', 'recette.patron-b@exemple.ci')
on conflict (id) do nothing;

insert into public.tenants (id, name, phone) values
  ('55555555-5555-4555-8555-555555555551', 'Pressing Recette A', '+2250700000101'),
  ('55555555-5555-4555-8555-555555555552', 'Pressing Recette B', '+2250700000102')
on conflict (id) do nothing;

insert into public.tenant_users (user_id, tenant_id, role) values
  ('33333333-3333-4333-8333-333333333331', '55555555-5555-4555-8555-555555555551', 'owner'),
  ('33333333-3333-4333-8333-333333333332', '55555555-5555-4555-8555-555555555551', 'artisan'),
  ('44444444-4444-4444-8444-444444444441', '55555555-5555-4555-8555-555555555552', 'owner')
on conflict (user_id, tenant_id) do nothing;

insert into public.orders
  (id, tenant_id, customer_name, customer_phone, status, qr_code, total_amount, payment_status)
values
  ('66666666-6666-4666-8666-666666666661', '55555555-5555-4555-8555-555555555551',
   'Client A', '0700000201', 'received', 'recette-a-1', 5000, 'pending'),
  ('66666666-6666-4666-8666-666666666662', '55555555-5555-4555-8555-555555555552',
   'Client B', '0700000202', 'received', 'recette-b-1', 7000, 'pending')
on conflict (id) do nothing;

-- Le propriétaire A fait une action sensible : elle doit apparaître dans SON
-- journal, et rester invisible pour B.
update public.tenants set phone = '+2250700000199'
where id = '55555555-5555-4555-8555-555555555551';

-- =============================================================================
-- 1. PROPRIÉTAIRE A — NE VOIT QUE SON PRESSING
-- =============================================================================
do $$
declare
  n integer;
  v_tenant uuid;
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '33333333-3333-4333-8333-333333333331',
      'role', 'authenticated',
      'app_metadata', jsonb_build_object(
        'tenant_id', '55555555-5555-4555-8555-555555555551',
        'tenant_role', 'owner'
      )
    )::text,
    true
  );
  set local role authenticated;

  v_tenant := public.current_tenant_id();
  if v_tenant is distinct from '55555555-5555-4555-8555-555555555551'::uuid then
    raise exception 'ECHEC 1.1 — pressing courant incorrect (%)', v_tenant;
  end if;
  raise notice 'OK 1.1 — le pressing courant est bien celui du jeton.';

  select count(*) into n from public.orders;
  if n <> 1 then
    raise exception 'ECHEC 1.2 — le propriétaire A voit % commande(s) au lieu de 1', n;
  end if;
  raise notice 'OK 1.2 — le propriétaire A ne voit que sa commande.';

  select count(*) into n from public.orders
  where tenant_id = '55555555-5555-4555-8555-555555555552';
  if n <> 0 then
    raise exception 'ECHEC 1.3 — fuite inter-pressing : % commande(s) de B visibles', n;
  end if;
  raise notice 'OK 1.3 — aucune commande du pressing B n''est visible.';

  -- Journal d'audit : sa propre action est là.
  select count(*) into n from public.audit_log
  where tenant_id = '55555555-5555-4555-8555-555555555551';
  if n = 0 then
    raise exception 'ECHEC 1.4 — l''action du propriétaire A n''est pas journalisée';
  end if;
  raise notice 'OK 1.4 — le propriétaire A lit son journal d''audit.';

  select count(*) into n from public.audit_log
  where tenant_id = '55555555-5555-4555-8555-555555555552';
  if n <> 0 then
    raise exception 'ECHEC 1.5 — fuite : % ligne(s) du journal de B visibles', n;
  end if;
  raise notice 'OK 1.5 — le journal du pressing B reste invisible.';

  reset role;
end $$;

-- =============================================================================
-- 2. PROPRIÉTAIRE B — SYMÉTRIQUE
-- =============================================================================
do $$
declare
  n integer;
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '44444444-4444-4444-8444-444444444441',
      'role', 'authenticated',
      'app_metadata', jsonb_build_object(
        'tenant_id', '55555555-5555-4555-8555-555555555552',
        'tenant_role', 'owner'
      )
    )::text,
    true
  );
  set local role authenticated;

  select count(*) into n from public.orders;
  if n <> 1 then
    raise exception 'ECHEC 2.1 — le propriétaire B voit % commande(s) au lieu de 1', n;
  end if;
  raise notice 'OK 2.1 — le propriétaire B ne voit que sa commande.';

  select count(*) into n from public.audit_log
  where tenant_id = '55555555-5555-4555-8555-555555555551';
  if n <> 0 then
    raise exception 'ECHEC 2.2 — le propriétaire B lit le journal de A';
  end if;
  raise notice 'OK 2.2 — le propriétaire B ne lit pas le journal de A.';

  reset role;
end $$;

-- =============================================================================
-- 3. ARTISAN A — FAIT AVANCER, NE TOUCHE NI AUX MONTANTS NI AU JOURNAL
-- =============================================================================
do $$
declare
  n integer;
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '33333333-3333-4333-8333-333333333332',
      'role', 'authenticated',
      'app_metadata', jsonb_build_object(
        'tenant_id', '55555555-5555-4555-8555-555555555551',
        'tenant_role', 'artisan'
      )
    )::text,
    true
  );
  set local role authenticated;

  update public.orders set status = 'washing'
  where id = '66666666-6666-4666-8666-666666666661';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'ECHEC 3.1 — l''artisan n''a pas pu faire avancer la commande';
  end if;
  raise notice 'OK 3.1 — l''artisan fait avancer une commande.';

  begin
    update public.orders set total_amount = 1
    where id = '66666666-6666-4666-8666-666666666661';
    raise exception 'ECHEC 3.2 — l''artisan a pu modifier un montant';
  exception
    when insufficient_privilege then
      raise notice 'OK 3.2 — montant protégé pour l''artisan (42501).';
  end;

  select count(*) into n from public.audit_log;
  if n <> 0 then
    raise exception 'ECHEC 3.3 — l''artisan lit % ligne(s) du journal', n;
  end if;
  raise notice 'OK 3.3 — le journal reste réservé au propriétaire.';

  reset role;
end $$;

-- =============================================================================
-- 4. ANONYME — RIEN
-- =============================================================================
do $$
declare
  n integer;
begin
  perform set_config('request.jwt.claims', '', true);
  set local role anon;

  begin
    select count(*) into n from public.orders;
    reset role;
    raise exception 'ECHEC 4.1 — un anonyme a lu les commandes';
  exception
    when insufficient_privilege then
      reset role;
      raise notice 'OK 4.1 — lecture anonyme refusée (42501).';
  end;

  begin
    select public.create_tenant_for_user('Pressing Fantôme');
    raise exception 'ECHEC 4.2 — un anonyme a pu créer un pressing';
  exception
    when insufficient_privilege then
      raise notice 'OK 4.2 — création de pressing refusée à un anonyme.';
  end;
end $$;

-- =============================================================================
-- 5. ABONNEMENT ÉCHU — LECTURE PERMISE, ÉCRITURE REFUSÉE
-- =============================================================================
do $$
declare
  n integer;
begin
  -- L'abonnement de A est échu depuis hier. C'est l'éditeur qui le constate :
  -- ici, le script joue ce rôle (aucune session).
  insert into public.subscriptions
    (tenant_id, plan_code, status, started_on, current_period_end, grace_days)
  values
    ('55555555-5555-4555-8555-555555555551', 'essentiel', 'active',
     current_date - 30, current_date - 1, 0)
  on conflict (tenant_id) do update
    set plan_code = 'essentiel',
        status = 'active',
        current_period_end = current_date - 1,
        grace_days = 0;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '33333333-3333-4333-8333-333333333331',
      'role', 'authenticated',
      'app_metadata', jsonb_build_object(
        'tenant_id', '55555555-5555-4555-8555-555555555551',
        'tenant_role', 'owner'
      )
    )::text,
    true
  );
  set local role authenticated;

  if public.subscription_state('55555555-5555-4555-8555-555555555551') <> 'expired' then
    raise exception 'ECHEC 5.1 — l''abonnement échu n''est pas reconnu comme tel';
  end if;
  raise notice 'OK 5.1 — abonnement échu détecté (expired).';

  -- La lecture reste possible : les données du client lui appartiennent.
  select count(*) into n from public.orders;
  if n <> 1 then
    raise exception 'ECHEC 5.2 — la lecture est cassée par l''abonnement (% lignes)', n;
  end if;
  raise notice 'OK 5.2 — la lecture reste possible malgré l''abonnement échu.';

  -- L'écriture est refusée (politique restrictive).
  begin
    insert into public.orders (tenant_id, customer_name, customer_phone, status, qr_code, total_amount)
    values ('55555555-5555-4555-8555-555555555551', 'Client C', '0700000203',
            'received', 'recette-a-2', 1000);
    raise exception 'ECHEC 5.3 — une écriture a été acceptée malgré l''abonnement échu';
  exception
    when insufficient_privilege then
      raise notice 'OK 5.3 — écriture refusée quand l''abonnement est échu (42501).';
  end;

  reset role;
end $$;

-- =============================================================================
-- 6. ÉDITEUR — LA CONSOLE N'EST PAS UN COMPTE DE PRESSING
-- =============================================================================
do $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '33333333-3333-4333-8333-333333333331',
      'role', 'authenticated',
      'app_metadata', jsonb_build_object('tenant_id', '55555555-5555-4555-8555-555555555551')
    )::text,
    true
  );
  set local role authenticated;

  -- Un propriétaire de pressing n'est pas éditeur : la console doit refuser.
  begin
    perform * from public.platform_tenants_overview();
    raise exception 'ECHEC 6.1 — un propriétaire de pressing accède à la console éditeur';
  exception
    when insufficient_privilege then
      raise notice 'OK 6.1 — console de supervision refusée à un pressing (42501).';
  end;

  reset role;
end $$;

select set_config('request.jwt.claims', '', true);

rollback;
