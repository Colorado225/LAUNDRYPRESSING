-- =============================================================================
-- audit.sql — journal des actions sensibles (palier 5)
-- =============================================================================
-- Vérifie sur une vraie base que le journal :
--   1. s'écrit tout seul sur les tables surveillées ;
--   2. ne s'écrit pas quand rien ne change ;
--   3. échappe au client : ni insertion, ni modification, ni suppression ;
--   4. ne se lit que par le propriétaire du pressing concerné ;
--   5. survit à la suppression d'un pressing sans violer de clé étrangère.
--
-- ⚠ Test LOCAL : après `00_bootstrap.sql`, les migrations et `seed.sql`
--   (voir `scripts/db.mjs verifier`). Tout se termine par ROLLBACK.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Comptes de test
-- -----------------------------------------------------------------------------
-- `actor_email` est figé à l'écriture : il faut des comptes réels pour vérifier
-- que le journal dit bien QUI a agi.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000c5', 'patron.cocody@test.local'),
  ('00000000-0000-4000-8000-0000000000c6', 'gerant.yopougon@test.local'),
  -- Compte rattaché en cours de test (section 6) : il doit exister dans
  -- `auth.users`, sinon la clé étrangère refuse le rattachement.
  ('00000000-0000-4000-8000-0000000000a1', 'atelier.cocody@test.local')
on conflict (id) do nothing;

insert into public.tenant_users (user_id, tenant_id, role) values
  ('00000000-0000-4000-8000-0000000000c5', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('00000000-0000-4000-8000-0000000000c6', '22222222-2222-4222-8222-222222222222', 'owner')
on conflict (user_id, tenant_id) do nothing;

-- =============================================================================
-- 1. UNE MODIFICATION DU PRESSING EST JOURNALISÉE
-- =============================================================================
do $$
declare
  v_ligne public.audit_log;
  v_avant integer;
begin
  select count(*) into v_avant from public.audit_log
  where tenant_id = '11111111-1111-4111-8111-111111111111' and action = 'tenants.update';

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '00000000-0000-4000-8000-0000000000c5',
      'role', 'authenticated',
      'app_metadata', jsonb_build_object(
        'tenant_id', '11111111-1111-4111-8111-111111111111',
        'tenant_role', 'owner'
      )
    )::text,
    true
  );
  set local role authenticated;

  update public.tenants
  set    phone = '+225 07 00 00 00 09'
  where  id = '11111111-1111-4111-8111-111111111111';

  reset role;

  select * into v_ligne from public.audit_log
  where tenant_id = '11111111-1111-4111-8111-111111111111' and action = 'tenants.update'
  order by created_at desc, id desc
  limit 1;

  if v_ligne.id is null then
    raise exception 'ECHEC 1.1 — la modification du pressing n''a pas été journalisée';
  end if;
  raise notice 'OK 1.1 — modification du pressing journalisée.';

  if not (v_ligne.details ? 'phone') then
    raise exception 'ECHEC 1.2 — la colonne modifiée (phone) ne figure pas dans le détail';
  end if;
  raise notice 'OK 1.2 — le détail nomme la colonne réellement modifiée.';

  if v_ligne.details -> 'phone' ->> 'apres' is distinct from '+225 07 00 00 00 09' then
    raise exception 'ECHEC 1.3 — la nouvelle valeur n''est pas enregistrée (%)',
      v_ligne.details -> 'phone' ->> 'apres';
  end if;
  raise notice 'OK 1.3 — valeur après modification conservée.';

  if v_ligne.actor_email is distinct from 'patron.cocody@test.local'
     or v_ligne.actor_role is distinct from 'owner'
  then
    raise exception 'ECHEC 1.4 — auteur mal identifié (% / %)',
      v_ligne.actor_email, v_ligne.actor_role;
  end if;
  raise notice 'OK 1.4 — auteur et rôle figés au moment de l''action.';
end $$;

-- =============================================================================
-- 2. RIEN NE CHANGE : AUCUNE LIGNE
-- =============================================================================
do $$
declare
  v_avant integer;
  v_apres integer;
begin
  select count(*) into v_avant from public.audit_log;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '00000000-0000-4000-8000-0000000000c5',
      'role', 'authenticated',
      'app_metadata', jsonb_build_object(
        'tenant_id', '11111111-1111-4111-8111-111111111111',
        'tenant_role', 'owner'
      )
    )::text,
    true
  );
  set local role authenticated;

  -- Même valeur : PostgreSQL écrit la ligne, le déclencheur ne doit rien
  -- journaliser. Sans ce filtre, le journal doublerait à chaque enregistrement
  -- d'un formulaire où l'utilisateur n'a rien changé.
  update public.tenants
  set    name = name
  where  id = '11111111-1111-4111-8111-111111111111';

  reset role;

  select count(*) into v_apres from public.audit_log;

  if v_apres <> v_avant then
    raise exception 'ECHEC 2.1 — % ligne(s) journalisée(s) sans modification réelle', v_apres - v_avant;
  end if;
  raise notice 'OK 2.1 — une écriture sans changement ne journalise rien.';
end $$;

-- =============================================================================
-- 3. LES COLONNES TECHNIQUES SONT IGNORÉES
-- =============================================================================
do $$
declare
  v_details jsonb;
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '00000000-0000-4000-8000-0000000000c5',
      'role', 'authenticated',
      'app_metadata', jsonb_build_object(
        'tenant_id', '11111111-1111-4111-8111-111111111111',
        'tenant_role', 'owner'
      )
    )::text,
    true
  );
  set local role authenticated;

  -- Le catalogue appartient au propriétaire ; `updated_at` bouge à chaque
  -- écriture et n'apprend rien : il doit être exclu du détail.
  insert into public.catalog_entries (tenant_id, article, service, price)
  values ('11111111-1111-4111-8111-111111111111', 'Chemise', 'Repassage', 1000);

  update public.catalog_entries
  set    price = 1500
  where  tenant_id = '11111111-1111-4111-8111-111111111111'
    and  article = 'Chemise'
    and  service = 'Repassage';

  reset role;

  select details into v_details from public.audit_log
  where tenant_id = '11111111-1111-4111-8111-111111111111'
    and action = 'catalog_entries.update'
  order by created_at desc, id desc
  limit 1;

  if v_details is null or not (v_details ? 'price') then
    raise exception 'ECHEC 3.1 — le changement de tarif n''est pas journalisé';
  end if;
  raise notice 'OK 3.1 — changement de tarif journalisé.';

  if v_details ? 'updated_at' or v_details ? 'version' then
    raise exception 'ECHEC 3.2 — une colonne technique figure dans le détail (%)', v_details;
  end if;
  raise notice 'OK 3.2 — les colonnes techniques (updated_at, version) sont exclues.';
end $$;

-- =============================================================================
-- 4. LE CLIENT NE PEUT PAS ÉCRIRE DANS LE JOURNAL
-- =============================================================================
do $$
declare
  v_id uuid;
begin
  select id into v_id from public.audit_log
  where tenant_id = '11111111-1111-4111-8111-111111111111'
  limit 1;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '00000000-0000-4000-8000-0000000000c5',
      'role', 'authenticated',
      'app_metadata', jsonb_build_object(
        'tenant_id', '11111111-1111-4111-8111-111111111111',
        'tenant_role', 'owner'
      )
    )::text,
    true
  );
  set local role authenticated;

  -- 4.1 Insertion : privilège refusé.
  begin
    insert into public.audit_log (tenant_id, action, entity)
    values ('11111111-1111-4111-8111-111111111111', 'faux.evenement', 'tenants');
    raise exception 'ECHEC 4.1 — un client a pu écrire dans le journal';
  exception
    when insufficient_privilege then
      raise notice 'OK 4.1 — insertion refusée au client (42501).';
  end;

  -- 4.2 Modification : impossible, même par le propriétaire.
  begin
    update public.audit_log set details = '{}'::jsonb where id = v_id;
    raise exception 'ECHEC 4.2 — un client a pu modifier une ligne du journal';
  exception
    when insufficient_privilege then
      raise notice 'OK 4.2 — modification refusée au client (42501).';
  end;

  -- 4.3 Suppression : impossible.
  begin
    delete from public.audit_log where id = v_id;
    raise exception 'ECHEC 4.3 — un client a pu supprimer une ligne du journal';
  exception
    when insufficient_privilege then
      raise notice 'OK 4.3 — suppression refusée au client (42501).';
  end;

  reset role;
end $$;

-- =============================================================================
-- 5. LECTURE : PROPRIÉTAIRE SEULEMENT
-- =============================================================================
do $$
declare
  n integer;
begin
  -- 5.1 Réceptionniste du même pressing : aucune ligne visible.
  perform set_config(
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

  select count(*) into n from public.audit_log
  where tenant_id = '11111111-1111-4111-8111-111111111111';
  reset role;

  if n <> 0 then
    raise exception 'ECHEC 5.1 — un artisan lit % ligne(s) du journal', n;
  end if;
  raise notice 'OK 5.1 — l''atelier ne lit pas le journal.';

  -- 5.2 Propriétaire d'un AUTRE pressing : aucune ligne visible.
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', '00000000-0000-4000-8000-0000000000c6',
      'role', 'authenticated',
      'app_metadata', jsonb_build_object(
        'tenant_id', '22222222-2222-4222-8222-222222222222',
        'tenant_role', 'owner'
      )
    )::text,
    true
  );
  set local role authenticated;

  -- Le pressing voisin a SES propres lignes (sa création, par exemple) : ce
  -- qui est interdit, c'est de lire celles du pressing d'à côté.
  select count(*) into n from public.audit_log
  where tenant_id = '11111111-1111-4111-8111-111111111111';
  reset role;

  if n <> 0 then
    raise exception 'ECHEC 5.2 — le pressing voisin lit % ligne(s) du journal', n;
  end if;
  raise notice 'OK 5.2 — le journal est cloisonné par pressing.';

  -- 5.3 Visiteur anonyme : privilège refusé.
  perform set_config('request.jwt.claims', '', true);
  set local role anon;

  begin
    select count(*) into n from public.audit_log;
    reset role;
    raise exception 'ECHEC 5.3 — un anonyme a pu lire le journal';
  exception
    when insufficient_privilege then
      reset role;
      raise notice 'OK 5.3 — lecture anonyme refusée (42501).';
  end;
end $$;

-- =============================================================================
-- 6. CHANGEMENT DE RÔLE ET REMBOURSEMENT JOURNALISÉS
-- =============================================================================
do $$
declare
  v_action text;
  v_role   text;
begin
  -- Rattachement d'un second compte, écrit par le serveur (aucune session) :
  -- c'est ce que fait la console de supervision via une fonction `definer`.
  insert into public.tenant_users (user_id, tenant_id, role) values
    ('00000000-0000-4000-8000-0000000000a1', '11111111-1111-4111-8111-111111111111', 'receptionist')
  on conflict (user_id, tenant_id) do update set role = excluded.role;

  select action, details ->> 'role' into v_action, v_role
  from public.audit_log
  where tenant_id = '11111111-1111-4111-8111-111111111111'
    and entity = 'tenant_users'
  order by created_at desc, id desc
  limit 1;

  if v_action not in ('tenant_users.insert', 'tenant_users.update') then
    raise exception 'ECHEC 6.1 — rattachement non journalisé (action = %)', v_action;
  end if;
  raise notice 'OK 6.1 — rattachement de compte journalisé (%).', v_action;

  if v_role is distinct from 'receptionist' then
    raise exception 'ECHEC 6.2 — rôle enregistré inattendu (%)', v_role;
  end if;
  raise notice 'OK 6.2 — le rôle attribué figure dans le détail.';

  -- Remboursement : sortie d'argent, donc surveillé.
  insert into public.payment_refunds (tenant_id, order_id, amount, reason)
  values ('11111111-1111-4111-8111-111111111111',
          'aaaaaaaa-0000-4000-8000-000000000002', 1000,
          'Tache constatée à la remise du linge');

  if not exists (
    select 1 from public.audit_log
    where tenant_id = '11111111-1111-4111-8111-111111111111'
      and action = 'payment_refunds.insert'
  ) then
    raise exception 'ECHEC 6.3 — remboursement non journalisé';
  end if;
  raise notice 'OK 6.3 — remboursement journalisé.';
end $$;

-- =============================================================================
-- 7. SUPPRESSION D'UN PRESSING : PAS DE VIOLATION DE CLÉ ÉTRANGÈRE
-- =============================================================================
-- La cascade supprime les comptes rattachés, ce qui déclenche le journal alors
-- que le pressing n'existe déjà plus. Le déclencheur doit s'abstenir.
do $$
declare
  v_nouveau uuid;
  v_restant integer;
begin
  insert into public.tenants (name) values ('Pressing Jetable') returning id into v_nouveau;
  insert into public.tenant_users (user_id, tenant_id, role)
  values ('00000000-0000-4000-8000-0000000000c5', v_nouveau, 'owner');

  delete from public.tenants where id = v_nouveau;

  select count(*) into v_restant from public.audit_log where tenant_id = v_nouveau;
  if v_restant <> 0 then
    raise exception 'ECHEC 7.1 — % ligne(s) de journal orpheline(s)', v_restant;
  end if;
  raise notice 'OK 7.1 — la suppression d''un pressing ne casse pas le journal.';
end $$;

select set_config('request.jwt.claims', '', true);

rollback;
