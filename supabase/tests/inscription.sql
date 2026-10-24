-- =============================================================================
-- inscription.sql — garde-fous de `create_tenant_for_user`
-- =============================================================================
-- Vérifie sur une vraie base que l'inscription libre ne peut pas servir à
-- s'offrir un pressing : anonyme refusé, compte déjà rattaché refusé, nom et
-- téléphone validés, et une création réussie produit bien un propriétaire et un
-- essai.
--
-- ⚠ Test LOCAL : à exécuter après `00_bootstrap.sql` et les migrations
--   (voir `scripts/db.mjs verifier`). Tout se termine par ROLLBACK.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Comptes de test
-- -----------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a7', 'nouveau@test.local'),
  ('00000000-0000-4000-8000-0000000000b8', 'dejainscrit@test.local')
on conflict (id) do nothing;

-- Ce second compte est déjà membre d'un pressing : il ne doit pas pouvoir s'en
-- créer un autre.
insert into public.tenant_users (user_id, tenant_id, role)
values ('00000000-0000-4000-8000-0000000000b8', '11111111-1111-4111-8111-111111111111', 'receptionist')
on conflict (user_id, tenant_id) do nothing;

-- =============================================================================
-- 1. ANONYME : refusé
-- =============================================================================
do $$
begin
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.create_tenant_for_user('Pressing Fantôme');
    raise exception 'ECHEC 1.1 : un anonyme a pu créer un pressing';
  exception
    when insufficient_privilege then
      raise notice 'OK 1.1 — création refusée à un visiteur non connecté.';
  end;
end $$;

-- =============================================================================
-- 2. COMPTE DÉJÀ RATTACHÉ : refusé
-- =============================================================================
do $$
declare v_restants integer;
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', '00000000-0000-4000-8000-0000000000b8', 'role', 'authenticated')::text,
    true
  );
  begin
    perform public.create_tenant_for_user('Pressing Parallèle');
    raise exception 'ECHEC 2.1 : un membre a pu créer un second pressing';
  exception
    when unique_violation then
      raise notice 'OK 2.1 — un compte déjà rattaché ne peut pas créer de pressing.';
  end;

  select count(*) into v_restants
  from public.tenants
  where name = 'Pressing Parallèle';
  if v_restants <> 0 then
    raise exception 'ECHEC 2.2 : un pressing a été créé malgré le refus';
  end if;
  raise notice 'OK 2.2 — aucun pressing orphelin laissé derrière le refus.';
end $$;

-- =============================================================================
-- 3. NOM ET TÉLÉPHONE VALIDÉS
-- =============================================================================
do $$
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', '00000000-0000-4000-8000-0000000000a7', 'role', 'authenticated')::text,
    true
  );

  begin
    perform public.create_tenant_for_user(' A ');
    raise exception 'ECHEC 3.1 : un nom trop court a été accepté';
  exception
    when invalid_parameter_value then
      raise notice 'OK 3.1 — nom trop court refusé.';
  end;

  begin
    perform public.create_tenant_for_user('Pressing Ok', '07 07');
    raise exception 'ECHEC 3.2 : un téléphone incomplet a été accepté';
  exception
    when invalid_parameter_value then
      raise notice 'OK 3.2 — téléphone incomplet refusé.';
  end;
end $$;

-- =============================================================================
-- 4. CRÉATION RÉUSSIE
-- =============================================================================
do $$
declare
  v_tenant uuid;
  v_role   text;
  v_essai  text;
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', '00000000-0000-4000-8000-0000000000a7', 'role', 'authenticated')::text,
    true
  );

  v_tenant := public.create_tenant_for_user('  Pressing Adjamé  ', '+225 07 00 00 00 09');

  if v_tenant is null then
    raise exception 'ECHEC 4.1 : aucun pressing retourné';
  end if;

  select tu.role into v_role
  from public.tenant_users tu
  where tu.user_id = '00000000-0000-4000-8000-0000000000a7'
    and tu.tenant_id = v_tenant;

  if v_role is distinct from 'owner' then
    raise exception 'ECHEC 4.2 : rôle % au lieu de owner', coalesce(v_role, 'aucun');
  end if;
  raise notice 'OK 4.1 — inscription : pressing créé et compte rattaché comme propriétaire.';

  if (select name from public.tenants where id = v_tenant) <> 'Pressing Adjamé' then
    raise exception 'ECHEC 4.3 : le nom n''a pas été nettoyé';
  end if;
  raise notice 'OK 4.2 — nom nettoyé (espaces de bord retirés).';

  if (select phone from public.tenants where id = v_tenant) <> '0700000009' then
    raise exception 'ECHEC 4.4 : téléphone mal normalisé (%)',
      (select phone from public.tenants where id = v_tenant);
  end if;
  raise notice 'OK 4.3 — téléphone normalisé (indicatif retiré).';

  select s.status into v_essai
  from public.subscriptions s
  where s.tenant_id = v_tenant;

  if v_essai is not null and v_essai <> 'trial' then
    raise exception 'ECHEC 4.5 : statut d''essai inattendu (%)', v_essai;
  end if;
  raise notice 'OK 4.4 — essai ouvert (14 jours) ou absence de formule assumée.';

  -- Seconde tentative du même compte : refusée.
  begin
    perform public.create_tenant_for_user('Pressing Bis');
    raise exception 'ECHEC 4.6 : le même compte a créé deux pressings';
  exception
    when unique_violation then
      raise notice 'OK 4.5 — un compte ne crée qu''un pressing par inscription.';
  end;
end $$;

-- =============================================================================
-- 5. ISOLATION : le nouveau pressing ne voit pas les données des autres
-- =============================================================================
do $$
declare n integer;
begin
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', '00000000-0000-4000-8000-0000000000a7', 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;

  -- `current_tenant_id()` lit l'en-tête de boutique ; sans en-tête, il retombe
  -- sur le seul rattachement du compte, c'est-à-dire le pressing créé.
  select count(*) into n from public.orders;
  if n <> 0 then
    raise exception 'ECHEC 5.1 : le nouveau pressing voit % commandes', n;
  end if;
  raise notice 'OK 5.1 — le nouveau pressing ne voit aucune commande des autres.';
end $$;

rollback;
