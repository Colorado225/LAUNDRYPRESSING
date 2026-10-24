-- =============================================================================
-- palier2_complement.sql — attribution, prix dérogatoire, réclamations, remboursements
-- =============================================================================
-- Vérifie sur une vraie base les mécanismes de `005_palier2_complement.sql` :
--   1. attribution d'une commande à un employé du pressing uniquement ;
--   2. prix des lignes : atelier en lecture seule, dérogation motivée et tracée ;
--   3. réclamations : déclaration par l'atelier, résolution par le comptoir ;
--   4. remboursements : propriétaire seulement, plafonnés aux encaissements ;
--   5. clôture de caisse : les remboursements en espèces sortent du tiroir.
--
-- ⚠ Test LOCAL : à exécuter sur un PostgreSQL préparé par
--   `supabase/tests/local/00_bootstrap.sql` (voir `scripts/sql-verify.sh`).
--   Tout se termine par ROLLBACK.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Comptes, appartenances et commande dédiée
-- -----------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'artisan@test.local'),
  ('00000000-0000-4000-8000-0000000000b2', 'reception@test.local'),
  ('00000000-0000-4000-8000-0000000000c3', 'proprietaire@test.local'),
  ('00000000-0000-4000-8000-0000000000d4', 'exterieur@test.local')
on conflict (id) do nothing;

insert into public.tenant_users (user_id, tenant_id, role) values
  ('00000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'artisan'),
  ('00000000-0000-4000-8000-0000000000b2', '11111111-1111-4111-8111-111111111111', 'receptionist'),
  ('00000000-0000-4000-8000-0000000000c3', '11111111-1111-4111-8111-111111111111', 'owner')
on conflict (user_id, tenant_id) do nothing;

insert into public.orders
  (id, tenant_id, customer_name, customer_phone, status, qr_code, total_amount, due_date)
values
  ('dddddddd-0000-4000-8000-0000000000d1',
   '11111111-1111-4111-8111-111111111111',
   'Client complément', '+2250700000011', 'received',
   '11111111-1111-4111-8111-111111111111-dddddddd-0000-4000-8000-0000000000d1-1750000009998',
   10000, current_date + 1);

-- Ligne de commande de référence : 5 000 FCFA, prix du catalogue.
insert into public.catalog_entries (id, tenant_id, article, service, price)
values ('eeeeeeee-0000-4000-8000-0000000000e1',
        '11111111-1111-4111-8111-111111111111', 'Blouson', 'Lavage', 5000)
on conflict do nothing;

insert into public.order_items
  (id, order_id, tenant_id, label, price, catalog_entry_id, article_name, service_name)
values
  ('ffffffff-0000-4000-8000-0000000000f1',
   'dddddddd-0000-4000-8000-0000000000d1',
   '11111111-1111-4111-8111-111111111111',
   'Blouson', 5000, 'eeeeeeee-0000-4000-8000-0000000000e1', 'Blouson', 'Lavage');

-- =============================================================================
-- 1. ATTRIBUTION À UN EMPLOYÉ
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
  v_assigne  uuid;
  v_horodate timestamptz;
  v_refus    boolean := false;
begin
  -- 1.1 Le propriétaire attribue la commande à un artisan du pressing.
  update public.orders
  set    assigned_to = '00000000-0000-4000-8000-0000000000a1'
  where  id = 'dddddddd-0000-4000-8000-0000000000d1';

  select assigned_to, assigned_at into v_assigne, v_horodate
  from   public.orders
  where  id = 'dddddddd-0000-4000-8000-0000000000d1';

  if v_assigne is distinct from '00000000-0000-4000-8000-0000000000a1' then
    raise exception 'ÉCHEC 1.1 — attribution non enregistrée.';
  end if;
  if v_horodate is null then
    raise exception 'ÉCHEC 1.1 — date d''attribution absente.';
  end if;
  raise notice 'OK 1.1 — commande attribuée, date d''attribution posée';

  -- 1.2 Un compte sans appartenance ne peut pas être désigné.
  begin
    update public.orders
    set    assigned_to = '00000000-0000-4000-8000-0000000000d4'
    where  id = 'dddddddd-0000-4000-8000-0000000000d1';
  exception
    when invalid_parameter_value then
      v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 1.2 — employé extérieur au pressing accepté.';
  end if;
  raise notice 'OK 1.2 — employé extérieur refusé (22023)';
end;
$$;

-- -----------------------------------------------------------------------------
-- 1.3 / 1.4 Un artisan ne peut prendre que sa propre commande
-- -----------------------------------------------------------------------------
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
  v_refus boolean := false;
begin
  begin
    update public.orders
    set    assigned_to = '00000000-0000-4000-8000-0000000000b2'
    where  id = 'dddddddd-0000-4000-8000-0000000000d1';
  exception
    when insufficient_privilege then
      v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 1.3 — un artisan a attribué une commande à un collègue.';
  end if;
  raise notice 'OK 1.3 — attribution à un collègue refusée à l''artisan (42501)';

  update public.orders
  set    assigned_to = '00000000-0000-4000-8000-0000000000a1'
  where  id = 'dddddddd-0000-4000-8000-0000000000d1';

  raise notice 'OK 1.4 — l''artisan peut prendre la commande pour lui';
end;
$$;

-- =============================================================================
-- 2. PRIX DES LIGNES
-- =============================================================================
-- 2.1 L'atelier ne modifie pas un prix : la politique RLS filtre la ligne.
do $$
declare
  v_lignes integer;
  v_prix   integer;
begin
  update public.order_items
  set    price = 100
  where  id = 'ffffffff-0000-4000-8000-0000000000f1';
  get diagnostics v_lignes = row_count;

  select price into v_prix
  from   public.order_items
  where  id = 'ffffffff-0000-4000-8000-0000000000f1';

  if v_lignes <> 0 or v_prix <> 5000 then
    raise exception 'ÉCHEC 2.1 — l''artisan a modifié un prix (% ligne(s), % FCFA).', v_lignes, v_prix;
  end if;
  raise notice 'OK 2.1 — prix verrouillé pour l''artisan';
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
  v_refus boolean := false;
  v_lignes integer;
  v_prix   integer;
begin
  -- 2.2 Dérogation sans motif : refusée.
  begin
    update public.order_items
    set    price = 4200
    where  id = 'ffffffff-0000-4000-8000-0000000000f1';
  exception
    when invalid_parameter_value then
      v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 2.2 — tarif dérogatoire accepté sans motif.';
  end if;
  raise notice 'OK 2.2 — dérogation sans motif refusée (22023)';

  -- 2.3 Dérogation motivée : acceptée et journalisée.
  update public.order_items
  set    price = 4200,
         price_reason = 'Geste commercial : tache ancienne signalée par le client'
  where  id = 'ffffffff-0000-4000-8000-0000000000f1';

  select price into v_prix
  from   public.order_items
  where  id = 'ffffffff-0000-4000-8000-0000000000f1';

  if v_prix <> 4200 then
    raise exception 'ÉCHEC 2.3 — dérogation motivée non appliquée.';
  end if;

  select count(*) into v_lignes
  from   public.order_price_history
  where  order_item_id = 'ffffffff-0000-4000-8000-0000000000f1'
    and  previous_price = 5000
    and  new_price = 4200;

  if v_lignes <> 1 then
    raise exception 'ÉCHEC 2.3 — journal des prix incomplet (% ligne(s)).', v_lignes;
  end if;
  raise notice 'OK 2.3 — dérogation motivée acceptée et journalisée';

  -- 2.4 Une ligne au prix du catalogue ne demande aucun motif.
  insert into public.order_items
    (order_id, tenant_id, label, price, catalog_entry_id, article_name, service_name)
  values
    ('dddddddd-0000-4000-8000-0000000000d1',
     '11111111-1111-4111-8111-111111111111',
     'Blouson', 5000, 'eeeeeeee-0000-4000-8000-0000000000e1', 'Blouson', 'Lavage');
  raise notice 'OK 2.4 — ligne au tarif du catalogue acceptée sans motif';

  -- 2.5 Une ligne libre (sans entrée de catalogue) reste possible.
  insert into public.order_items
    (order_id, tenant_id, label, price)
  values
    ('dddddddd-0000-4000-8000-0000000000d1',
     '11111111-1111-4111-8111-111111111111',
     'Retouche ourlet', 1500);
  raise notice 'OK 2.5 — ligne libre acceptée';
end;
$$;

-- =============================================================================
-- 3. RÉCLAMATIONS ET VÊTEMENTS ABÎMÉS
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
declare
  v_auteur   uuid;
  v_lignes   integer;
begin
  -- 3.1 L'atelier signale une tache apparue au lavage.
  insert into public.order_issues
    (tenant_id, order_id, order_item_id, kind, severity, stage, description)
  values
    ('11111111-1111-4111-8111-111111111111',
     'dddddddd-0000-4000-8000-0000000000d1',
     'ffffffff-0000-4000-8000-0000000000f1',
     'stained', 'major', 'treatment',
     'Tache de graisse apparue après le lavage, côté manche droite');

  select reported_by into v_auteur
  from   public.order_issues
  where  order_id = 'dddddddd-0000-4000-8000-0000000000d1';

  if v_auteur is distinct from '00000000-0000-4000-8000-0000000000a1' then
    raise exception 'ÉCHEC 3.1 — auteur de la réclamation non renseigné.';
  end if;
  raise notice 'OK 3.1 — l''artisan déclare un vêtement abîmé';

  -- 3.2 L'atelier ne peut pas clore la réclamation lui-même.
  update public.order_issues
  set    resolution = 'rejected'
  where  order_id = 'dddddddd-0000-4000-8000-0000000000d1';
  get diagnostics v_lignes = row_count;

  if v_lignes <> 0 then
    raise exception 'ÉCHEC 3.2 — l''artisan a clôturé une réclamation.';
  end if;
  raise notice 'OK 3.2 — clôture refusée à l''artisan';
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
  v_resolu  timestamptz;
  v_refus   boolean := false;
begin
  -- 3.3 Le comptoir traite la réclamation.
  update public.order_issues
  set    resolution = 'compensated',
         resolution_note = 'Remise de 2 000 FCFA accordée au client'
  where  order_id = 'dddddddd-0000-4000-8000-0000000000d1';

  select resolved_at into v_resolu
  from   public.order_issues
  where  order_id = 'dddddddd-0000-4000-8000-0000000000d1';

  if v_resolu is null then
    raise exception 'ÉCHEC 3.3 — réclamation non datée à la clôture.';
  end if;
  raise notice 'OK 3.3 — réclamation traitée par le comptoir';

  -- 3.4 Une description vide est refusée.
  begin
    insert into public.order_issues
      (tenant_id, order_id, kind, description)
    values
      ('11111111-1111-4111-8111-111111111111',
       'dddddddd-0000-4000-8000-0000000000d1', 'torn', ' ');
  exception
    when check_violation then
      v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 3.4 — réclamation sans description acceptée.';
  end if;
  raise notice 'OK 3.4 — description trop courte refusée (23514)';

  -- 3.5 Une ligne d'un autre pressing est refusée par la clé composite.
  v_refus := false;
  begin
    insert into public.order_issues
      (tenant_id, order_id, order_item_id, kind, description)
    values
      ('11111111-1111-4111-8111-111111111111',
       'dddddddd-0000-4000-8000-0000000000d1',
       gen_random_uuid(), 'torn', 'Bouton manquant sur une pièce inconnue');
  exception
    when foreign_key_violation then
      v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 3.5 — référence vers une ligne inexistante acceptée.';
  end if;
  raise notice 'OK 3.5 — référence croisée refusée (23503)';
end;
$$;

-- =============================================================================
-- 4. REMBOURSEMENTS
-- =============================================================================
do $$
declare
  v_refus boolean := false;
begin
  -- 4.1 Le comptoir ne rembourse pas, même s'il tient la caisse.
  begin
    perform public.record_refund(
      'dddddddd-0000-4000-8000-0000000000d1', 1000,
      'Remboursement demandé par le client');
  exception
    when insufficient_privilege then
      v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 4.1 — un réceptionniste a remboursé.';
  end if;
  raise notice 'OK 4.1 — remboursement refusé au réceptionniste (42501)';
end;
$$;

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
  v_resultat jsonb;
  v_refus    boolean := false;
  v_solde    record;
begin
  -- 4.2 Rien n'a encore été encaissé : le remboursement dépasse.
  begin
    perform public.record_refund(
      'dddddddd-0000-4000-8000-0000000000d1', 1000,
      'Remboursement demandé par le client');
  exception
    when invalid_parameter_value then
      v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 4.2 — remboursement sans encaissement accepté.';
  end if;
  raise notice 'OK 4.2 — remboursement supérieur aux encaissements refusé (22023)';

  -- Encaissement complet de la commande, puis remboursement partiel.
  perform public.record_cash_payment(
    'dddddddd-0000-4000-8000-0000000000d1', 10000, gen_random_uuid(), 'Règlement complet');

  v_resultat := public.record_refund(
    'dddddddd-0000-4000-8000-0000000000d1', 2000,
    'Tache non retirée sur le blouson, geste commercial');

  if (v_resultat ->> 'refundable_amount')::integer <> 8000 then
    raise exception 'ÉCHEC 4.3 — remboursable % au lieu de 8 000.',
      v_resultat ->> 'refundable_amount';
  end if;
  raise notice 'OK 4.3 — remboursement de 2 000 enregistré, 8 000 encore remboursables';

  -- 4.4 Le solde de la commande ne devient pas une dette du client.
  select * into v_solde
  from   public.order_balances
  where  order_id = 'dddddddd-0000-4000-8000-0000000000d1';

  if v_solde.remaining_amount <> 0 then
    raise exception 'ÉCHEC 4.4 — reste à payer % après remboursement.', v_solde.remaining_amount;
  end if;
  if v_solde.refunded_amount <> 2000 or v_solde.net_paid_amount <> 8000 then
    raise exception 'ÉCHEC 4.4 — vue incohérente (remboursé %, net %).',
      v_solde.refunded_amount, v_solde.net_paid_amount;
  end if;
  raise notice 'OK 4.4 — vue des soldes : 2 000 remboursés, 8 000 nets, reste 0';

  -- 4.5 Un second remboursement ne peut pas dépasser le net.
  v_refus := false;
  begin
    perform public.record_refund(
      'dddddddd-0000-4000-8000-0000000000d1', 9000,
      'Deuxième remboursement hors plafond');
  exception
    when invalid_parameter_value then
      v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 4.5 — remboursement au-delà du net accepté.';
  end if;
  raise notice 'OK 4.5 — plafond des remboursements respecté';

  -- 4.6 Motif trop court refusé.
  v_refus := false;
  begin
    perform public.record_refund(
      'dddddddd-0000-4000-8000-0000000000d1', 500, 'Geste');
  exception
    when invalid_parameter_value then
      v_refus := true;
  end;

  if not v_refus then
    raise exception 'ÉCHEC 4.6 — remboursement sans motif suffisant accepté.';
  end if;
  raise notice 'OK 4.6 — motif de remboursement exigé';
end;
$$;

-- =============================================================================
-- 5. CLÔTURE DE CAISSE — LE REMBOURSEMENT SORT DU TIROIR
-- =============================================================================
do $$
declare
  v_session public.cash_sessions;
begin
  v_session := public.close_cash_session(
    (now() at time zone 'Africa/Abidjan')::date, 8000, 'Journée avec remboursement');

  if v_session.expected_total <> 8000 then
    raise exception 'ÉCHEC 5.1 — attendu % au lieu de 8 000.', v_session.expected_total;
  end if;
  if v_session.refunded_total <> 2000 then
    raise exception 'ÉCHEC 5.1 — remboursé % au lieu de 2 000.', v_session.refunded_total;
  end if;
  if v_session.difference <> 0 then
    raise exception 'ÉCHEC 5.1 — écart % au lieu de 0.', v_session.difference;
  end if;
  raise notice 'OK 5.1 — clôture : 8 000 attendus (10 000 encaissés − 2 000 remboursés)';
end;
$$;

-- =============================================================================
-- 6. MOTIF D'UNE TRANSITION DE STATUT
-- =============================================================================
do $$
declare
  v_motif   text;
  v_residuel text;
begin
  -- 6.1 Avancement sans motif : l'historique reste muet, rien n'est inventé.
  update public.orders
  set    status = 'sorting'
  where  id = 'dddddddd-0000-4000-8000-0000000000d1';

  select reason into v_motif
  from   public.order_status_history
  where  order_id = 'dddddddd-0000-4000-8000-0000000000d1'
    and  status = 'sorting'
  order  by changed_at desc
  limit  1;

  if v_motif is not null then
    raise exception 'ÉCHEC 6.1 — motif inventé : %.', v_motif;
  end if;
  raise notice 'OK 6.1 — avancement sans motif : historique cohérent';

  -- 6.2 Le motif accompagne l'annulation puis disparaît de la commande.
  update public.orders
  set    status = 'cancelled',
         status_reason = 'Client absent depuis trois semaines, vêtements rendus au dépôt'
  where  id = 'dddddddd-0000-4000-8000-0000000000d1';

  select reason into v_motif
  from   public.order_status_history
  where  order_id = 'dddddddd-0000-4000-8000-0000000000d1'
    and  status = 'cancelled'
  order  by changed_at desc
  limit  1;

  select status_reason into v_residuel
  from   public.orders
  where  id = 'dddddddd-0000-4000-8000-0000000000d1';

  if v_motif is null or char_length(v_motif) < 10 then
    raise exception 'ÉCHEC 6.2 — motif d''annulation non journalisé.';
  end if;
  if v_residuel is not null then
    raise exception 'ÉCHEC 6.2 — le motif est resté collé à la commande.';
  end if;
  raise notice 'OK 6.2 — motif d''annulation journalisé puis effacé de la commande';
end;
$$;

reset role;

rollback;
