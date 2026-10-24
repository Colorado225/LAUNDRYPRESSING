-- =============================================================================
-- palier4.sql — abonnement, multi-boutiques, supervision et support
-- =============================================================================
-- Vérifie sur une vraie base les mécanismes de `007_palier4.sql` :
--   1. formules lisibles, jamais modifiables par un pressing ;
--   2. état d'abonnement calculé (active, grace, expired, suspended) ;
--   3. lecture seule effective : l'écriture est refusée, la lecture reste ouverte,
--      y compris pour les fonctions security definer (encaissement) ;
--   4. multi-boutiques : en-tête validé, rôle recalculé par boutique, en-tête
--      forgé ignoré ;
--   5. supervision réservée à l'éditeur ;
--   6. support : demande invisible aux autres pressings, réponse de l'éditeur.
--
-- ⚠ Test LOCAL : à exécuter sur un PostgreSQL préparé par
--   `supabase/tests/local/00_bootstrap.sql` (voir `scripts/sql-verify.sh`).
--   Tout se termine par ROLLBACK.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Comptes et pressings de test
-- -----------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000d4', 'gerant@test.local'),
  ('00000000-0000-4000-8000-0000000000e5', 'editeur@test.local'),
  ('00000000-0000-4000-8000-0000000000f6', 'comptoir@test.local')
on conflict (id) do nothing;

insert into public.tenants (id, name, phone) values
  ('33333333-3333-4333-8333-333333333333', 'Pressing Abobo', '+225 07 00 00 00 03')
on conflict (id) do nothing;

insert into public.tenant_users (user_id, tenant_id, role) values
  ('00000000-0000-4000-8000-0000000000d4', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('00000000-0000-4000-8000-0000000000d4', '22222222-2222-4222-8222-222222222222', 'receptionist'),
  ('00000000-0000-4000-8000-0000000000f6', '11111111-1111-4111-8111-111111111111', 'receptionist')
on conflict (user_id, tenant_id) do nothing;

insert into public.platform_admins (user_id, display_name)
values ('00000000-0000-4000-8000-0000000000e5', 'Éditeur Pressing Pro')
on conflict (user_id) do nothing;

do $$
begin
  begin
    insert into public.platform_admins (user_id, display_name)
    values ('00000000-0000-4000-8000-0000000000d4', 'Compte client interdit');
    raise exception 'ÉCHEC 0.1 — un second super-administrateur a été ajouté.';
  exception
    when unique_violation then
      raise notice 'OK 0.1 — un seul super-administrateur peut être inscrit.';
  end;
end $$;

-- =============================================================================
-- 1. FORMULES
-- =============================================================================
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.plans where is_active;
  if v_n <> 3 then
    raise exception 'ÉCHEC 1.1 — % formule(s) active(s) au lieu de 3.', v_n;
  end if;
  raise notice 'OK 1.1 — trois formules commerciales sont disponibles';
end $$;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-0000-4000-8000-0000000000f6',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('tenant_id', '11111111-1111-4111-8111-111111111111')
  )::text,
  true
);

do $$
declare v_n integer; v_refus boolean := false;
begin
  select count(*) into v_n from public.plans;
  if v_n < 3 then
    raise exception 'ÉCHEC 1.2 — un pressing ne voit pas les formules.';
  end if;

  begin
    insert into public.plans (code, name, price_fcfa, duration_days, max_shops)
    values ('pirate', 'Pirate', 1, 30, 1);
  exception when insufficient_privilege then
    v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 1.2 — un pressing a pu créer une formule.';
  end if;
  raise notice 'OK 1.2 — formules lisibles, écriture refusée au pressing';
end $$;

-- =============================================================================
-- 2. ÉTAT DE L'ABONNEMENT
-- =============================================================================
reset role;

do $$
begin
  if public.subscription_state('11111111-1111-4111-8111-111111111111') <> 'active' then
    raise exception 'ÉCHEC 2.1 — un pressing sans abonnement devrait rester actif.';
  end if;
  raise notice 'OK 2.1 — absence d''abonnement = compte historique actif';
end $$;

insert into public.subscriptions
  (tenant_id, plan_code, status, started_on, current_period_end)
values
  ('11111111-1111-4111-8111-111111111111', 'pro', 'active', current_date - 20, current_date + 10)
on conflict (tenant_id) do update
  set plan_code = excluded.plan_code,
      status = excluded.status,
      current_period_end = excluded.current_period_end;

do $$
begin
  if public.subscription_state('11111111-1111-4111-8111-111111111111') <> 'active' then
    raise exception 'ÉCHEC 2.2 — abonnement en cours non reconnu.';
  end if;
  raise notice 'OK 2.2 — abonnement en cours = actif';
end $$;

update public.subscriptions
set    current_period_end = current_date - 2
where  tenant_id = '11111111-1111-4111-8111-111111111111';

do $$
begin
  if public.subscription_state('11111111-1111-4111-8111-111111111111') <> 'grace' then
    raise exception 'ÉCHEC 2.3 — période de grâce non détectée.';
  end if;
  if not public.tenant_writable('11111111-1111-4111-8111-111111111111') then
    raise exception 'ÉCHEC 2.3 — la grâce devrait rester inscriptible.';
  end if;
  raise notice 'OK 2.3 — période de grâce : écritures encore autorisées';
end $$;

update public.subscriptions
set    current_period_end = current_date - 30
where  tenant_id = '11111111-1111-4111-8111-111111111111';

do $$
begin
  if public.subscription_state('11111111-1111-4111-8111-111111111111') <> 'expired' then
    raise exception 'ÉCHEC 2.4 — abonnement échu non détecté.';
  end if;
  if public.tenant_writable('11111111-1111-4111-8111-111111111111') then
    raise exception 'ÉCHEC 2.4 — un abonnement échu reste inscriptible.';
  end if;
  raise notice 'OK 2.4 — abonnement échu : écritures fermées';
end $$;

update public.subscriptions
set    status = 'suspended', current_period_end = current_date + 30
where  tenant_id = '11111111-1111-4111-8111-111111111111';

do $$
begin
  if public.subscription_state('11111111-1111-4111-8111-111111111111') <> 'suspended' then
    raise exception 'ÉCHEC 2.5 — suspension non prioritaire sur les dates.';
  end if;
  raise notice 'OK 2.5 — suspension l''emporte sur une période encore valide';
end $$;

-- Retour à un abonnement sain pour la suite.
update public.subscriptions
set    status = 'active', current_period_end = current_date + 10
where  tenant_id = '11111111-1111-4111-8111-111111111111';

-- =============================================================================
-- 3. LECTURE SEULE QUAND L'ABONNEMENT EST ÉCHU
-- =============================================================================
set local role authenticated;

insert into public.orders
  (id, tenant_id, customer_name, customer_phone, status, qr_code, total_amount)
values
  ('cccc0000-0000-4000-8000-0000000000a1',
   '11111111-1111-4111-8111-111111111111',
   'Client Abonnement', '0700000099', 'received',
   'abonnement-0000-4000-8000-0000000000a1', 5000);

do $$
begin
  raise notice 'OK 3.0 — commande créée tant que l''abonnement est valide';
end $$;

reset role;
update public.subscriptions
set    current_period_end = current_date - 30
where  tenant_id = '11111111-1111-4111-8111-111111111111';
set local role authenticated;

do $$
declare
  v_refus   boolean := false;
  v_lecture integer;
begin
  -- 3.1 Écriture directe refusée par la politique restrictive.
  begin
    insert into public.orders
      (id, tenant_id, customer_name, customer_phone, status, qr_code, total_amount)
    values
      ('cccc0000-0000-4000-8000-0000000000a2',
       '11111111-1111-4111-8111-111111111111',
       'Client Bloqué', '0700000098', 'received',
       'abonnement-0000-4000-8000-0000000000a2', 3000);
  exception when insufficient_privilege then
    v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 3.1 — commande acceptée malgré un abonnement échu.';
  end if;
  raise notice 'OK 3.1 — commande refusée quand l''abonnement est échu';

  -- 3.2 La lecture reste ouverte : le client garde ses données.
  select count(*) into v_lecture
  from   public.orders
  where  tenant_id = '11111111-1111-4111-8111-111111111111';

  if v_lecture < 1 then
    raise exception 'ÉCHEC 3.2 — le pressing ne peut plus lire ses commandes.';
  end if;
  raise notice 'OK 3.2 — lecture des commandes toujours possible (% ligne(s))', v_lecture;
end $$;

do $$
declare v_refus boolean := false;
begin
  -- 3.3 L'encaissement passe par une fonction security definer : le
  --     déclencheur doit aussi le refuser.
  begin
    perform public.record_cash_payment(
      'cccc0000-0000-4000-8000-0000000000a1', 1000
    );
  exception when insufficient_privilege then
    v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 3.3 — encaissement accepté malgré un abonnement échu.';
  end if;
  raise notice 'OK 3.3 — encaissement refusé quand l''abonnement est échu';
end $$;

do $$
declare v_etat text; v_ecrit boolean;
begin
  -- 3.4 L'application peut lire son état pour afficher le bandeau.
  select public.my_subscription() ->> 'state',
         (public.my_subscription() ->> 'writable')::boolean
  into   v_etat, v_ecrit;

  if v_etat <> 'expired' or v_ecrit then
    raise exception 'ÉCHEC 3.4 — my_subscription renvoie % / %.', v_etat, v_ecrit;
  end if;
  raise notice 'OK 3.4 — l''état d''abonnement reste lisible en lecture seule';
end $$;

-- Renouvellement par l'éditeur, puis l'écriture repart.
reset role;
insert into public.platform_admins (user_id) values ('00000000-0000-4000-8000-0000000000e5')
on conflict (user_id) do nothing;

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-0000-4000-8000-0000000000e5',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select public.platform_set_subscription(
  '11111111-1111-4111-8111-111111111111', 'pro', 30, 'active', null
);

do $$
begin
  if not public.tenant_writable('11111111-1111-4111-8111-111111111111') then
    raise exception 'ÉCHEC 3.5 — le renouvellement ne rétablit pas l''écriture.';
  end if;
  raise notice 'OK 3.5 — renouvellement : écriture rétablie';
end $$;

-- Retour au compte du comptoir pour la suite.
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-0000-4000-8000-0000000000f6',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('tenant_id', '11111111-1111-4111-8111-111111111111')
  )::text,
  true
);

-- =============================================================================
-- 4. MULTI-BOUTIQUES
-- =============================================================================
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-0000-4000-8000-0000000000d4',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'tenant_id', '11111111-1111-4111-8111-111111111111',
      'tenant_role', 'owner'
    )
  )::text,
  true
);

do $$
declare v_tenant uuid; v_role text;
begin
  -- 4.1 La boutique choisie dans l'en-tête l'emporte sur la claim.
  perform set_config('request.headers', '{"x-tenant-id":"22222222-2222-4222-8222-222222222222"}', true);
  v_tenant := public.current_tenant_id();
  v_role   := public.current_tenant_role();

  if v_tenant <> '22222222-2222-4222-8222-222222222222' then
    raise exception 'ÉCHEC 4.1 — boutique active % au lieu de Yopougon.', v_tenant;
  end if;
  if v_role <> 'receptionist' then
    raise exception 'ÉCHEC 4.1 — rôle % au lieu de receptionist sur la 2e boutique.', v_role;
  end if;
  raise notice 'OK 4.1 — en-tête honoré et rôle recalculé par boutique';

  -- 4.2 Retour à la première boutique : le rôle propriétaire revient.
  perform set_config('request.headers', '{"x-tenant-id":"11111111-1111-4111-8111-111111111111"}', true);
  if public.current_tenant_id() <> '11111111-1111-4111-8111-111111111111'
     or public.current_tenant_role() <> 'owner' then
    raise exception 'ÉCHEC 4.2 — changement de boutique incomplet.';
  end if;
  raise notice 'OK 4.2 — retour à la première boutique, rôle propriétaire';

  -- 4.3 En-tête forgé vers un pressing dont le compte n'est pas membre.
  perform set_config('request.headers', '{"x-tenant-id":"33333333-3333-4333-8333-333333333333"}', true);
  if public.current_tenant_id() = '33333333-3333-4333-8333-333333333333' then
    raise exception 'ÉCHEC 4.3 — un en-tête forgé donne accès à un autre pressing.';
  end if;
  raise notice 'OK 4.3 — en-tête vers un pressing non rattaché ignoré';
end $$;

do $$
declare v_n integer;
begin
  -- 4.4 Un compte non membre ne peut pas lire les commandes d'Abobo.
  perform set_config('request.headers', '{"x-tenant-id":"33333333-3333-4333-8333-333333333333"}', true);

  select count(*) into v_n
  from   public.orders
  where  tenant_id = '33333333-3333-4333-8333-333333333333';

  if v_n <> 0 then
    raise exception 'ÉCHEC 4.4 — % commande(s) d''un autre pressing visible(s).', v_n;
  end if;
  raise notice 'OK 4.4 — aucune lecture croisée via un en-tête forgé';
end $$;

-- =============================================================================
-- 5. SUPERVISION
-- =============================================================================
-- 5.1 Un utilisateur ordinaire ne peut pas ouvrir la console.
do $$
declare v_refus boolean := false;
begin
  perform set_config('request.headers', '', true);
  begin
    perform public.platform_tenants_overview();
  exception when insufficient_privilege then
    v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 5.1 — la supervision est accessible à un pressing.';
  end if;
  raise notice 'OK 5.1 — supervision refusée à un compte de pressing';
end $$;

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-0000-4000-8000-0000000000e5',
    'role', 'authenticated'
  )::text,
  true
);

do $$
declare v_n integer;
begin
  select count(*) into v_n from public.platform_tenants_overview();
  if v_n < 2 then
    raise exception 'ÉCHEC 5.2 — l''éditeur ne voit que % pressing(s).', v_n;
  end if;
  raise notice 'OK 5.2 — l''éditeur voit les % pressings', v_n;
end $$;

select public.platform_set_subscription(
  '11111111-1111-4111-8111-111111111111', 'essentiel', 30, 'suspended', 'Impayé'
);

do $$
declare v_etat text;
begin
  select state into v_etat
  from   public.platform_tenants_overview()
  where  tenant_id = '11111111-1111-4111-8111-111111111111';

  if v_etat <> 'suspended' then
    raise exception 'ÉCHEC 5.3 — suspension non visible (%).', v_etat;
  end if;

  if public.tenant_writable('11111111-1111-4111-8111-111111111111') then
    raise exception 'ÉCHEC 5.3 — un pressing suspendu reste inscriptible.';
  end if;
  raise notice 'OK 5.3 — suspension tracée et écriture fermée';

  perform public.platform_set_subscription(
    '11111111-1111-4111-8111-111111111111', 'pro', 30, 'active', null
  );
  if not public.tenant_writable('11111111-1111-4111-8111-111111111111') then
    raise exception 'ÉCHEC 5.3 — réactivation sans effet.';
  end if;
  raise notice 'OK 5.4 — réactivation de la boutique';
end $$;

-- =============================================================================
-- 6. SUPPORT
-- =============================================================================
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-0000-4000-8000-0000000000f6',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('tenant_id', '11111111-1111-4111-8111-111111111111')
  )::text,
  true
);
select set_config('request.headers', '', true);

do $$
declare v_id uuid;
begin
  insert into public.support_requests (tenant_id, author_id, author_name, subject, message)
  values (
    '11111111-1111-4111-8111-111111111111',
    '00000000-0000-4000-8000-0000000000f6',
    'Comptoir Cocody',
    'Imprimante thermique',
    'Le reçu ne sort plus depuis hier soir.'
  )
  returning id into v_id;

  if v_id is null then
    raise exception 'ÉCHEC 6.1 — demande de support non créée.';
  end if;
  raise notice 'OK 6.1 — demande de support créée par le comptoir';
end $$;

-- 6.2 Aucune fuite vers un autre pressing.
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-0000-4000-8000-0000000000d4',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('tenant_id', '22222222-2222-4222-8222-222222222222')
  )::text,
  true
);
select set_config('request.headers', '{"x-tenant-id":"22222222-2222-4222-8222-222222222222"}', true);

do $$
declare v_n integer;
begin
  select count(*) into v_n
  from   public.support_requests
  where  tenant_id = '11111111-1111-4111-8111-111111111111';

  if v_n <> 0 then
    raise exception 'ÉCHEC 6.2 — un pressing voit les demandes d''un autre.';
  end if;
  raise notice 'OK 6.2 — demandes de support invisibles aux autres pressings';
end $$;

-- 6.3 L'éditeur répond et clôture.
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-0000-4000-8000-0000000000e5',
    'role', 'authenticated'
  )::text,
  true
);
select set_config('request.headers', '', true);

do $$
declare v_id uuid; v_statut text;
begin
  -- L'éditeur lit les demandes par sa fonction dédiée : la table reste
  -- protégée par la RLS des pressings.
  select id into v_id
  from   public.platform_support_requests()
  where  subject = 'Imprimante thermique'
  limit  1;

  perform public.platform_answer_support(v_id, 'Rouleau changé ? Sinon, ticket ouvert chez le fournisseur.', 'closed');

  select status into v_statut
  from   public.platform_support_requests()
  where  id = v_id;
  if v_statut <> 'closed' then
    raise exception 'ÉCHEC 6.3 — demande non clôturée.';
  end if;
  raise notice 'OK 6.3 — l''éditeur répond et clôture la demande';
end $$;

-- 6.4 La réponse est visible par le pressing concerné.
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-0000-4000-8000-0000000000f6',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('tenant_id', '11111111-1111-4111-8111-111111111111')
  )::text,
  true
);

do $$
declare v_reponse text;
begin
  select response into v_reponse
  from   public.support_requests
  where  subject = 'Imprimante thermique'
  limit  1;

  if v_reponse is null then
    raise exception 'ÉCHEC 6.4 — la réponse de l''éditeur est invisible au pressing.';
  end if;
  raise notice 'OK 6.4 — le pressing lit la réponse de l''éditeur';
end $$;

-- =============================================================================
-- 7. OUVERTURE DE BOUTIQUES ET RATTACHEMENT DES COMPTES
-- =============================================================================
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '00000000-0000-4000-8000-0000000000e5',
    'role', 'authenticated'
  )::text,
  true
);

do $$
declare
  v_shop   uuid;
  v_refus  boolean := false;
  v_n      integer;
begin
  -- 7.1 L'éditeur ouvre une deuxième boutique pour le gérant.
  select (public.platform_create_shop(
            'Pressing Treichville',
            '+225 07 00 00 00 04',
            '00000000-0000-4000-8000-0000000000d4',
            'pro',
            30
          ) ->> 'tenant_id')::uuid
  into v_shop;

  -- Lecture par la fonction de supervision : la table `tenant_users` est
  -- filtrée par la RLS (chacun ne voit que ses propres adhésions).
  select count(*) into v_n
  from   public.platform_members()
  where  user_id = '00000000-0000-4000-8000-0000000000d4' and role = 'owner';

  if v_n <> 2 or not public.tenant_writable(v_shop) then
    raise exception 'ÉCHEC 7.1 — boutique non créée ou abonnement absent (%).', v_n;
  end if;
  raise notice 'OK 7.1 — boutique créée, propriétaire rattaché, abonnement actif';

  -- 7.2 La formule Pro couvre trois boutiques : la quatrième est refusée.
  perform public.platform_create_shop('Pressing Marcory', null,
            '00000000-0000-4000-8000-0000000000d4', 'pro', 30);

  begin
    perform public.platform_create_shop('Pressing Koumassi', null,
              '00000000-0000-4000-8000-0000000000d4', 'pro', 30);
  exception when others then
    v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 7.2 — la limite de boutiques de la formule est ignorée.';
  end if;
  raise notice 'OK 7.2 — quatrième boutique refusée par la formule Pro';

  -- 7.3 Un compte sans adhésion n'apparaît pas dans la liste des membres.
  select count(*) into v_n
  from   public.platform_members()
  where  user_id = '00000000-0000-4000-8000-0000000000f6';

  if v_n <> 1 then
    raise exception 'ÉCHEC 7.3 — % adhésion(s) pour le comptoir au lieu d''une.', v_n;
  end if;
  raise notice 'OK 7.3 — adhésions listées par l''éditeur';
end $$;

do $$
declare v_refus boolean := false;
begin
  -- 7.4 Détacher le dernier propriétaire casserait la boutique : refusé.
  begin
    perform public.platform_set_member(
      '33333333-3333-4333-8333-333333333333',
      '00000000-0000-4000-8000-0000000000d4',
      null
    );
  exception when others then
    v_refus := true;
  end;

  -- Le gérant n'est pas propriétaire d'Abobo : on teste sur Cocody, dont il
  -- est l'unique propriétaire.
  if v_refus then
    v_refus := false;
  end if;

  begin
    perform public.platform_set_member(
      '11111111-1111-4111-8111-111111111111',
      '00000000-0000-4000-8000-0000000000d4',
      null
    );
  exception when others then
    v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 7.4 — le dernier propriétaire a pu être détaché.';
  end if;
  raise notice 'OK 7.4 — détachement du dernier propriétaire refusé';
end $$;

do $$
declare v_refus boolean := false;
begin
  -- 7.5 Rôle inconnu refusé.
  begin
    perform public.platform_set_member(
      '11111111-1111-4111-8111-111111111111',
      '00000000-0000-4000-8000-0000000000d4',
      'administrateur'
    );
  exception when others then
    v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 7.5 — rôle inconnu accepté.';
  end if;
  raise notice 'OK 7.5 — rôle inconnu refusé';
end $$;

reset role;

-- =============================================================================
-- BILAN
-- =============================================================================
select 'Palier 4 : 28 contrôles exécutés.' as bilan;

rollback;
