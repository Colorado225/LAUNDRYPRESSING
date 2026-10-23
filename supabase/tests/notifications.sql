-- =============================================================================
-- notifications.sql — prévenir le client (migration 010)
-- =============================================================================
-- Vérifie sur une vraie base que le journal des sollicitations :
--   1. s'écrit depuis le comptoir et déduit l'auteur du jeton ;
--   2. reste cloisonné : un pressing ne voit ni n'écrit chez l'autre ;
--   3. refuse l'atelier (seul le comptoir parle au client) ;
--   4. est immuable : ni modification ni suppression, même au propriétaire ;
--   5. ne peut pas désigner la commande d'un autre pressing ;
--   6. se ferme à l'écriture quand l'abonnement est échu, sans fermer la
--      lecture.
--
-- ⚠ Test LOCAL : après `00_bootstrap.sql`, les migrations et `seed.sql`
--   (voir `scripts/db.mjs verifier`). Tout se termine par ROLLBACK.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000d1', 'patron.cocody@test.local'),
  ('00000000-0000-4000-8000-0000000000d2', 'atelier.cocody@test.local'),
  ('00000000-0000-4000-8000-0000000000d3', 'patron.yopougon@test.local')
on conflict (id) do nothing;

insert into public.tenant_users (user_id, tenant_id, role) values
  ('00000000-0000-4000-8000-0000000000d1', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('00000000-0000-4000-8000-0000000000d2', '11111111-1111-4111-8111-111111111111', 'artisan'),
  ('00000000-0000-4000-8000-0000000000d3', '22222222-2222-4222-8222-222222222222', 'owner')
on conflict (user_id, tenant_id) do nothing;

-- =============================================================================
-- 1. LE COMPTOIR PRÉVIENT, L'AUTEUR VIENT DU JETON
-- =============================================================================
do $$
declare
  v_ligne public.notifications;
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '00000000-0000-4000-8000-0000000000d1',
      'role', 'authenticated',
      'app_metadata', jsonb_build_object(
        'tenant_id', '11111111-1111-4111-8111-111111111111',
        'tenant_role', 'owner'
      )
    )::text,
    true
  );
  set local role authenticated;

  insert into public.notifications
    (tenant_id, order_id, channel, reason, customer_name, customer_phone, message, sent_by)
  values
    ('11111111-1111-4111-8111-111111111111',
     'aaaaaaaa-0000-4000-8000-000000000002',
     'whatsapp', 'pret', 'Ibrahim Traoré', '+2250700000002',
     'Bonjour Ibrahim, votre linge est prêt.',
     -- Auteur forgé : le déclencheur doit l'écraser par le jeton.
     '00000000-0000-4000-8000-0000000000d3')
  returning * into v_ligne;

  reset role;

  if v_ligne.sent_by <> '00000000-0000-4000-8000-0000000000d1' then
    raise exception 'ÉCHEC 1.1 — l''auteur n''est pas déduit du jeton (%).', v_ligne.sent_by;
  end if;

  raise notice 'OK 1.1 — notification enregistrée, auteur déduit du jeton';
end $$;

-- =============================================================================
-- 2. CLOISONNEMENT ENTRE PRESSINGS
-- =============================================================================
do $$
declare
  v_vues integer;
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '00000000-0000-4000-8000-0000000000d3',
      'role', 'authenticated',
      'app_metadata', jsonb_build_object(
        'tenant_id', '22222222-2222-4222-8222-222222222222',
        'tenant_role', 'owner'
      )
    )::text,
    true
  );
  set local role authenticated;

  select count(*) into v_vues from public.notifications;
  reset role;

  if v_vues <> 0 then
    raise exception 'ÉCHEC 2.1 — le pressing B voit % notification(s) du pressing A.', v_vues;
  end if;

  raise notice 'OK 2.1 — un pressing ne voit jamais les notifications d''un autre';
end $$;

-- =============================================================================
-- 3. L'ATELIER NE PARLE PAS AU CLIENT
-- =============================================================================
do $$
declare
  v_refus boolean := false;
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '00000000-0000-4000-8000-0000000000d2',
      'role', 'authenticated',
      'app_metadata', jsonb_build_object(
        'tenant_id', '11111111-1111-4111-8111-111111111111',
        'tenant_role', 'artisan'
      )
    )::text,
    true
  );
  set local role authenticated;

  begin
    insert into public.notifications
      (tenant_id, order_id, channel, reason, customer_name, customer_phone, message)
    values
      ('11111111-1111-4111-8111-111111111111',
       'aaaaaaaa-0000-4000-8000-000000000002',
       'appel', 'pret', 'Ibrahim Traoré', '+2250700000002', 'Bonjour.');
  exception
    when insufficient_privilege then v_refus := true;
  end;

  reset role;

  if not v_refus then
    raise exception 'ÉCHEC 3.1 — un artisan a pu notifier un client.';
  end if;

  raise notice 'OK 3.1 — un artisan ne peut pas notifier un client';
end $$;

-- =============================================================================
-- 4. ANONYME : NI LECTURE NI ÉCRITURE
-- =============================================================================
do $$
declare
  v_lecture boolean := false;
  v_ecriture boolean := false;
begin
  set local role anon;

  begin
    perform count(*) from public.notifications;
  exception
    when insufficient_privilege then v_lecture := true;
  end;

  begin
    insert into public.notifications
      (tenant_id, order_id, channel, reason, customer_name, customer_phone, message)
    values
      ('11111111-1111-4111-8111-111111111111',
       'aaaaaaaa-0000-4000-8000-000000000002',
       'whatsapp', 'pret', 'X', '+2250700000000', 'X');
  exception
    when insufficient_privilege then v_ecriture := true;
  end;

  reset role;

  if not v_lecture or not v_ecriture then
    raise exception 'ÉCHEC 4.1 — l''anonyme garde un accès (lecture %, écriture %).',
      v_lecture, v_ecriture;
  end if;

  raise notice 'OK 4.1 — l''anonyme n''a ni lecture ni écriture';
end $$;

-- =============================================================================
-- 5. JOURNAL IMMUABLE
-- =============================================================================
do $$
begin
  if has_table_privilege('authenticated', 'public.notifications', 'UPDATE')
     or has_table_privilege('authenticated', 'public.notifications', 'DELETE') then
    raise exception 'ÉCHEC 5.1 — le client peut modifier ou supprimer une notification.';
  end if;

  raise notice 'OK 5.1 — aucune modification ni suppression possible côté client';
end $$;

-- =============================================================================
-- 6. UNE COMMANDE D'UN AUTRE PRESSING EST REFUSÉE
-- =============================================================================
do $$
declare
  v_refus boolean := false;
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '00000000-0000-4000-8000-0000000000d3',
      'role', 'authenticated',
      'app_metadata', jsonb_build_object(
        'tenant_id', '22222222-2222-4222-8222-222222222222',
        'tenant_role', 'owner'
      )
    )::text,
    true
  );
  set local role authenticated;

  begin
    -- Commande du pressing A, mentionnée par un compte du pressing B.
    insert into public.notifications
      (tenant_id, order_id, channel, reason, customer_name, customer_phone, message)
    values
      ('22222222-2222-4222-8222-222222222222',
       'aaaaaaaa-0000-4000-8000-000000000002',
       'whatsapp', 'pret', 'Ibrahim Traoré', '+2250700000002', 'Bonjour.');
  exception
    when foreign_key_violation then v_refus := true;
  end;

  reset role;

  if not v_refus then
    raise exception 'ÉCHEC 6.1 — une notification a pu désigner la commande d''un autre pressing.';
  end if;

  raise notice 'OK 6.1 — la FK composite interdit la commande d''un autre pressing';
end $$;

-- =============================================================================
-- 7. ABONNEMENT ÉCHU : ÉCRITURE FERMÉE, LECTURE OUVERTE
-- =============================================================================
-- Un essai (`trial`) reste inscriptible quelles que soient les dates : il faut
-- donc une formule payante dont la période est dépassée, grâce comprise.
insert into public.subscriptions
  (tenant_id, plan_code, status, started_on, current_period_end, grace_days)
values
  ('11111111-1111-4111-8111-111111111111', 'pro', 'active', current_date - 60, current_date - 30, 7)
on conflict (tenant_id) do update
  set status = 'active',
      current_period_end = excluded.current_period_end,
      grace_days = excluded.grace_days;

do $$
declare
  v_refus boolean := false;
  v_lues integer;
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '00000000-0000-4000-8000-0000000000d1',
      'role', 'authenticated',
      'app_metadata', jsonb_build_object(
        'tenant_id', '11111111-1111-4111-8111-111111111111',
        'tenant_role', 'owner'
      )
    )::text,
    true
  );
  set local role authenticated;

  select count(*) into v_lues from public.notifications;

  begin
    insert into public.notifications
      (tenant_id, order_id, channel, reason, customer_name, customer_phone, message)
    values
      ('11111111-1111-4111-8111-111111111111',
       'aaaaaaaa-0000-4000-8000-000000000002',
       'whatsapp', 'relance', 'Ibrahim Traoré', '+2250700000002', 'Bonjour.');
  exception
    when insufficient_privilege then v_refus := true;
  end;

  reset role;

  if not v_refus then
    raise exception 'ÉCHEC 7.1 — un abonnement échu autorise encore une notification.';
  end if;

  if v_lues = 0 then
    raise exception 'ÉCHEC 7.2 — la lecture du journal est fermée alors qu''elle doit rester ouverte.';
  end if;

  raise notice 'OK 7.1 — abonnement échu : écriture fermée, lecture ouverte';
end $$;

rollback;
