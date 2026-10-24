-- =============================================================================
-- palier2.sql — catalogue, workflow et caisse
-- =============================================================================
-- Vérifie sur une vraie base les mécanismes de la migration `004_palier2.sql` :
--   1. catalogue réservé au propriétaire, unicité (article, prestation) ;
--   2. prix historisé : renommer ou retarifer le catalogue ne touche pas les
--      anciennes lignes de commande ;
--   3. workflow : le statut avance, ne recule pas (sauf propriétaire),
--      l'annulation est réservée au comptoir ;
--   4. caisse : acompte, solde, refus du trop-perçu, idempotence ;
--   5. clôture journalière : total attendu recalculé serveur, écart, unicité.
--
-- ⚠ Test LOCAL : à exécuter sur un PostgreSQL préparé par
--   `supabase/tests/local/00_bootstrap.sql` (voir `scripts/sql-verify.sh`).
--   Tout se termine par ROLLBACK.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Comptes de test et commande dédiée
-- -----------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'artisan@test.local'),
  ('00000000-0000-4000-8000-0000000000b2', 'reception@test.local'),
  ('00000000-0000-4000-8000-0000000000c3', 'proprietaire@test.local')
on conflict (id) do nothing;

-- Commande dédiée aux contrôles (10 000 FCFA, échéance dépassée).
insert into public.orders
  (id, tenant_id, customer_name, customer_phone, status, qr_code, total_amount, due_date)
values
  ('cccccccc-0000-4000-8000-0000000000c1',
   '11111111-1111-4111-8111-111111111111',
   'Client palier 2', '+2250700000010', 'received',
   '11111111-1111-4111-8111-111111111111-cccccccc-0000-4000-8000-0000000000c1-1750000009999',
   10000, current_date - 2);

-- =============================================================================
-- 1. CATALOGUE — propriétaire seulement
-- =============================================================================
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
  v_id uuid;
  v_refus boolean := false;
begin
  insert into public.catalog_entries (tenant_id, article, service, price)
  values ('11111111-1111-4111-8111-111111111111', 'Chemise', 'Lavage', 1500)
  returning id into v_id;

  raise notice 'OK 1.1 — le propriétaire crée une prestation';

  -- 1.2 Unicité (article, prestation) par pressing.
  begin
    insert into public.catalog_entries (tenant_id, article, service, price)
    values ('11111111-1111-4111-8111-111111111111', 'Chemise', 'Lavage', 2000);
  exception
    when unique_violation then
      v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 1.2 — doublon (article, prestation) accepté.';
  end if;
  raise notice 'OK 1.2 — doublon refusé (23505)';

  -- 1.3 Prix négatif refusé.
  v_refus := false;
  begin
    insert into public.catalog_entries (tenant_id, article, service, price)
    values ('11111111-1111-4111-8111-111111111111', 'Robe', 'Lavage', -100);
  exception
    when check_violation then
      v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 1.3 — prix négatif accepté.';
  end if;
  raise notice 'OK 1.3 — prix négatif refusé';
end;
$$;

-- =============================================================================
-- 2. PRIX HISTORISÉ
-- =============================================================================
do $$
declare
  v_entry uuid;
  v_prix integer;
  v_article text;
begin
  insert into public.catalog_entries (tenant_id, article, service, price)
  values ('11111111-1111-4111-8111-111111111111', 'Costume', 'Nettoyage à sec', 5000)
  returning id into v_entry;

  insert into public.order_items
    (order_id, tenant_id, label, price, catalog_entry_id, article_name, service_name)
  values
    ('cccccccc-0000-4000-8000-0000000000c1',
     '11111111-1111-4111-8111-111111111111',
     'Costume — Nettoyage à sec', 5000, v_entry, 'Costume', 'Nettoyage à sec');

  -- Le catalogue change : nouveau nom, nouveau tarif.
  update public.catalog_entries
  set    article = 'Costume 3 pièces', price = 7000
  where  id = v_entry;

  select price, article_name into v_prix, v_article
  from   public.order_items
  where  catalog_entry_id = v_entry;

  if v_prix <> 5000 or v_article <> 'Costume' then
    raise exception 'ÉCHEC 2.1 — la ligne de commande a suivi la modification du catalogue (% FCFA, %).',
      v_prix, v_article;
  end if;
  raise notice 'OK 2.1 — prix et libellé historisés (% FCFA, %)', v_prix, v_article;

  -- Une ligne libre (sans catalogue) reste possible.
  insert into public.order_items
    (order_id, tenant_id, label, price, price_reason)
  values
    ('cccccccc-0000-4000-8000-0000000000c1',
     '11111111-1111-4111-8111-111111111111',
     'Retouche spéciale', 1000, 'Retouche demandée au comptoir.');
  raise notice 'OK 2.2 — ligne libre acceptée';
end;
$$;

-- =============================================================================
-- 3. CATALOGUE — rôles non autorisés
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
begin
  begin
    insert into public.catalog_entries (tenant_id, article, service, price)
    values ('11111111-1111-4111-8111-111111111111', 'Pantalon', 'Repassage', 800);
    raise exception 'ÉCHEC 3.1 — un réceptionniste a pu créer une prestation.';
  exception
    when insufficient_privilege then
      raise notice 'OK 3.1 — écriture du catalogue refusée au réceptionniste (42501)';
  end;
end;
$$;

-- =============================================================================
-- 4. WORKFLOW — le statut avance, ne recule pas
-- =============================================================================
do $$
begin
  -- 4.1 Avancer : autorisé.
  update public.orders
  set    status = 'sorting'
  where  id = 'cccccccc-0000-4000-8000-0000000000c1';

  -- 4.2 Reculer : interdit hors propriétaire.
  begin
    update public.orders
    set    status = 'received'
    where  id = 'cccccccc-0000-4000-8000-0000000000c1';
    raise exception 'ÉCHEC 4.2 — un réceptionniste a pu faire reculer le statut.';
  exception
    when insufficient_privilege then
      raise notice 'OK 4.2 — marche arrière refusée (42501)';
  end;

  -- 4.3 Le réceptionniste peut annuler.
  update public.orders
  set    status = 'cancelled'
  where  id = 'aaaaaaaa-0000-4000-8000-000000000001';

  raise notice 'OK 4.3 — annulation autorisée au comptoir';
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
begin
  -- 4.4 L'artisan fait avancer.
  update public.orders
  set    status = 'washing'
  where  id = 'cccccccc-0000-4000-8000-0000000000c1';
  raise notice 'OK 4.4 — l''artisan fait avancer la commande';

  -- 4.5 L'artisan ne peut pas annuler.
  begin
    update public.orders
    set    status = 'cancelled'
    where  id = 'cccccccc-0000-4000-8000-0000000000c1';
    raise exception 'ÉCHEC 4.5 — un artisan a pu annuler une commande.';
  exception
    when insufficient_privilege then
      raise notice 'OK 4.5 — annulation refusée à l''artisan (42501)';
  end;

  -- 4.6 L'artisan ne peut pas déplacer l'échéance.
  begin
    update public.orders
    set    due_date = current_date + 5
    where  id = 'cccccccc-0000-4000-8000-0000000000c1';
    raise exception 'ÉCHEC 4.6 — un artisan a pu modifier l''échéance.';
  exception
    when insufficient_privilege then
      raise notice 'OK 4.6 — échéance protégée (42501)';
  end;
end;
$$;

-- =============================================================================
-- 5. CAISSE — acompte, solde, refus, idempotence
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
  v_paiement uuid := gen_random_uuid();
  v_resultat jsonb;
  v_statut   text;
  v_refus    boolean := false;
begin
  -- 5.1 Acompte de 3 000 sur une commande de 10 000.
  v_resultat := public.record_cash_payment(
    'cccccccc-0000-4000-8000-0000000000c1', 3000, v_paiement, 'Acompte client');

  if (v_resultat ->> 'remaining')::integer <> 7000 then
    raise exception 'ÉCHEC 5.1 — reste à payer % au lieu de 7 000.', v_resultat ->> 'remaining';
  end if;

  select payment_status into v_statut
  from   public.orders
  where  id = 'cccccccc-0000-4000-8000-0000000000c1';

  if v_statut <> 'partial' then
    raise exception 'ÉCHEC 5.1 — statut % au lieu de « partial ».', v_statut;
  end if;
  raise notice 'OK 5.1 — acompte enregistré, reste 7 000, statut partiel';

  -- 5.2 Renvoi du même identifiant : aucun second encaissement.
  v_resultat := public.record_cash_payment(
    'cccccccc-0000-4000-8000-0000000000c1', 3000, v_paiement, 'Acompte client');

  if (v_resultat ->> 'duplicate')::boolean is not true
     or (v_resultat ->> 'paid')::integer <> 3000 then
    raise exception 'ÉCHEC 5.2 — le renvoi a créé un doublon (% ).', v_resultat;
  end if;
  raise notice 'OK 5.2 — renvoi idempotent, un seul encaissement';

  -- 5.3 Trop-perçu refusé.
  begin
    perform public.record_cash_payment(
      'cccccccc-0000-4000-8000-0000000000c1', 8000, gen_random_uuid(), null);
    raise exception 'ÉCHEC 5.3 — un montant supérieur au solde a été accepté.';
  exception
    when others then
      if sqlerrm like 'ÉCHEC%' then raise; end if;
      v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 5.3 — trop-perçu accepté.';
  end if;
  raise notice 'OK 5.3 — trop-perçu refusé';

  -- 5.4 Solde intégral : la commande passe à « payée ».
  v_resultat := public.record_cash_payment(
    'cccccccc-0000-4000-8000-0000000000c1', 7000, gen_random_uuid(), null);

  select payment_status into v_statut
  from   public.orders
  where  id = 'cccccccc-0000-4000-8000-0000000000c1';

  if v_statut <> 'paid' or (v_resultat ->> 'remaining')::integer <> 0 then
    raise exception 'ÉCHEC 5.4 — solde non soldé (statut %, reste %).',
      v_statut, v_resultat ->> 'remaining';
  end if;
  raise notice 'OK 5.4 — solde intégral, commande payée';

  -- 5.5 Payer une commande déjà soldée est refusé.
  begin
    perform public.record_cash_payment(
      'cccccccc-0000-4000-8000-0000000000c1', 100, gen_random_uuid(), null);
    raise exception 'ÉCHEC 5.5 — paiement accepté sur une commande soldée.';
  exception
    when others then
      if sqlerrm like 'ÉCHEC%' then raise; end if;
      raise notice 'OK 5.5 — commande soldée protégée';
  end;
end;
$$;

-- =============================================================================
-- 6. CAISSE — l'artisan ne peut pas encaisser
-- =============================================================================
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
begin
  begin
    perform public.record_cash_payment(
      'aaaaaaaa-0000-4000-8000-000000000002', 1000, gen_random_uuid(), null);
    raise exception 'ÉCHEC 6 — un artisan a pu encaisser.';
  exception
    when insufficient_privilege then
      raise notice 'OK 6 — encaissement refusé à l''artisan (42501)';
  end;
end;
$$;

-- =============================================================================
-- 7. CLÔTURE DE CAISSE
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
  v_session public.cash_sessions;
  v_encaisse integer;
begin
  select coalesce(sum(amount), 0) into v_encaisse
  from   public.payment_transactions
  where  tenant_id = '11111111-1111-4111-8111-111111111111'
    and  provider = 'cash'
    and  status = 'paid';

  -- 7.1 Clôture conforme.
  select * into v_session
  from public.close_cash_session((now() at time zone 'Africa/Abidjan')::date, v_encaisse, 'Journée normale');

  if v_session.expected_total <> v_encaisse or v_session.difference <> 0 then
    raise exception 'ÉCHEC 7.1 — attendu % / déclaré % / écart %.',
      v_session.expected_total, v_session.declared_total, v_session.difference;
  end if;
  raise notice 'OK 7.1 — clôture conforme : % FCFA, écart nul', v_encaisse;

  -- 7.2 Re-clôture avec un manque déclaré : même session, écart négatif.
  select * into v_session
  from public.close_cash_session((now() at time zone 'Africa/Abidjan')::date, v_encaisse - 2000, 'Manque');

  if v_session.difference <> -2000 then
    raise exception 'ÉCHEC 7.2 — écart % au lieu de -2 000.', v_session.difference;
  end if;

  if (select count(*) from public.cash_sessions where business_date = (now() at time zone 'Africa/Abidjan')::date) <> 1 then
    raise exception 'ÉCHEC 7.2 — plusieurs clôtures pour la même journée.';
  end if;
  raise notice 'OK 7.2 — re-clôture : écart -2 000, une seule session';

  -- 7.3 Les encaissements sont rattachés à la session.
  if exists (
    select 1 from public.payment_transactions
    where tenant_id = '11111111-1111-4111-8111-111111111111'
      and provider = 'cash' and status = 'paid' and cash_session_id is null
  ) then
    raise exception 'ÉCHEC 7.3 — des encaissements ne sont pas rattachés à la clôture.';
  end if;
  raise notice 'OK 7.3 — encaissements rattachés à la session';
end;
$$;

-- 7.4 Clôture d'une journée future refusée.
do $$
begin
  begin
    perform public.close_cash_session((now() at time zone 'Africa/Abidjan')::date + 1, 0, null);
    raise exception 'ÉCHEC 7.4 — clôture d''une journée future acceptée.';
  exception
    when others then
      if sqlerrm like 'ÉCHEC%' then raise; end if;
      raise notice 'OK 7.4 — journée future refusée';
  end;
end;
$$;

-- =============================================================================
-- 8. SOLDE CALCULÉ
-- =============================================================================
do $$
declare
  v_solde integer;
begin
  select remaining_amount into v_solde
  from   public.order_balances
  where  order_id = 'aaaaaaaa-0000-4000-8000-000000000002';

  if v_solde <> 0 then
    raise exception 'ÉCHEC 8.1 — solde % pour une commande payée.', v_solde;
  end if;
  raise notice 'OK 8.1 — solde nul sur une commande payée';

  select remaining_amount into v_solde
  from   public.order_balances
  where  order_id = 'cccccccc-0000-4000-8000-0000000000c1';

  if v_solde <> 0 then
    raise exception 'ÉCHEC 8.2 — solde % après règlement intégral.', v_solde;
  end if;
  raise notice 'OK 8.2 — solde recalculé après règlement';
end;
$$;

reset role;

-- =============================================================================
-- 9. BILAN
-- =============================================================================
select controle
from (values
  ('1.1 propriétaire : création de prestation'),
  ('1.2 doublon article/prestation refusé'),
  ('1.3 prix négatif refusé'),
  ('2.1 prix et libellé historisés'),
  ('2.2 ligne libre acceptée'),
  ('3.1 réceptionniste : catalogue en lecture seule'),
  ('4.2 marche arrière refusée'),
  ('4.3 annulation au comptoir'),
  ('4.4 artisan : avancement autorisé'),
  ('4.5 artisan : annulation refusée'),
  ('4.6 artisan : échéance protégée'),
  ('5.1 acompte et statut partiel'),
  ('5.2 renvoi idempotent'),
  ('5.3 trop-perçu refusé'),
  ('5.4 solde intégral'),
  ('5.5 commande soldée protégée'),
  ('6   artisan : encaissement refusé'),
  ('7.1 clôture conforme'),
  ('7.2 re-clôture et unicité'),
  ('7.3 encaissements rattachés'),
  ('7.4 journée future refusée'),
  ('8   solde recalculé')
) as t(controle);

rollback;
