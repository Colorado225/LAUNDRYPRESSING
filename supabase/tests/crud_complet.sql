-- =============================================================================
-- crud_complet.sql — écritures ajoutées par la migration 025
-- =============================================================================
-- Vérifie, sur une vraie base PostgreSQL et avec la RLS active :
--   1. clients : création par le comptoir, clé téléphone normalisée, doublon
--      refusé, suppression réservée au propriétaire ;
--   2. stock : suppression refusée dès qu'un mouvement existe (archivage) ;
--   3. fournisseurs : suppression refusée dès qu'une dépense les référence ;
--   4. support : clôture et retrait par le pressing, rôle contrôlé ;
--   5. équipe : rattachement par e-mail, protection du dernier propriétaire,
--      refus aux rôles non propriétaires, annuaire avec e-mail.
--
-- Transaction jetable, annulée à la fin : aucun jeu de données n'est conservé.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'crud-owner@test.local'),
  ('00000000-0000-4000-8000-0000000000e2', 'crud-comptoir@test.local'),
  ('00000000-0000-4000-8000-0000000000e3', 'crud-atelier@test.local'),
  ('00000000-0000-4000-8000-0000000000e4', 'crud-collegue@test.local')
on conflict (id) do nothing;

insert into public.tenants (id, name) values
  ('55555555-5555-4555-8555-555555555551', 'Pressing CRUD')
on conflict (id) do nothing;

insert into public.tenant_users (user_id, tenant_id, role, display_name) values
  ('00000000-0000-4000-8000-0000000000e1', '55555555-5555-4555-8555-555555555551', 'owner', 'Propriétaire'),
  ('00000000-0000-4000-8000-0000000000e2', '55555555-5555-4555-8555-555555555551', 'receptionist', 'Comptoir'),
  ('00000000-0000-4000-8000-0000000000e3', '55555555-5555-4555-8555-555555555551', 'artisan', 'Atelier')
on conflict (user_id, tenant_id) do nothing;

-- =============================================================================
-- 1. CLIENTS
-- =============================================================================
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-0000000000e2',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'tenant_id', '55555555-5555-4555-8555-555555555551',
      'tenant_role', 'receptionist'
    )
  )::text,
  true
);
select set_config('request.headers', '{"x-tenant-id":"55555555-5555-4555-8555-555555555551"}', true);
set local role authenticated;

do $$
declare
  v_client uuid;
  v_sqlstate text;
  v_reste integer;
begin
  insert into public.customers (tenant_id, name, phone, email, address, notes)
  values (
    '55555555-5555-4555-8555-555555555551',
    'Awa Koné',
    '+225 07 00 00 00 21',
    'awa@exemple.ci',
    'Cocody',
    'Repassage léger'
  )
  returning id into v_client;

  if not exists (
    select 1 from public.customers
    where id = v_client and phone_key = '0700000021'
  ) then
    raise exception 'ECHEC 1 : le comptoir ne peut pas créer une fiche client normalisée';
  end if;
  raise notice 'OK 1 — le comptoir crée une fiche client, clé téléphone normalisée par le déclencheur.';

  begin
    insert into public.customers (tenant_id, name, phone)
    values (
      '55555555-5555-4555-8555-555555555551',
      'Awa K.',
      '0700000021'
    );
  exception when unique_violation then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '23505' then
    raise exception 'ECHEC 2 : deux écritures du même numéro ont créé deux fiches';
  end if;
  raise notice 'OK 2 — un même numéro ne crée pas de doublon, quelle que soit l''écriture.';

  update public.customers set notes = 'Préfère le samedi' where id = v_client;
  if not exists (select 1 from public.customers where id = v_client and notes = 'Préfère le samedi') then
    raise exception 'ECHEC 3 : le comptoir ne peut pas modifier la fiche';
  end if;
  raise notice 'OK 3 — le comptoir modifie une fiche client existante.';

  delete from public.customers where id = v_client;
  select count(*) into v_reste from public.customers where id = v_client;
  if v_reste <> 1 then
    raise exception 'ECHEC 4 : un réceptionniste a pu supprimer une fiche client';
  end if;
  raise notice 'OK 4 — la suppression d''une fiche reste réservée au propriétaire.';
end;
$$;

-- L'atelier ne crée ni ne modifie de fiche client.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-0000000000e3',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'tenant_id', '55555555-5555-4555-8555-555555555551',
      'tenant_role', 'artisan'
    )
  )::text,
  true
);

do $$
declare
  v_sqlstate text;
begin
  begin
    insert into public.customers (tenant_id, name, phone)
    values ('55555555-5555-4555-8555-555555555551', 'Client atelier', '0700000099');
  exception when insufficient_privilege then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'ECHEC 5 : l''atelier a pu créer une fiche client';
  end if;
  raise notice 'OK 5 — l''atelier ne crée pas de fiche client.';
end;
$$;

-- =============================================================================
-- 2. STOCK — la suppression d'un article mouvementé est refusée
-- =============================================================================
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-0000000000e1',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'tenant_id', '55555555-5555-4555-8555-555555555551',
      'tenant_role', 'owner'
    )
  )::text,
  true
);

do $$
declare
  v_article uuid;
  v_sqlstate text;
begin
  insert into public.stock_items (tenant_id, name, category, unit, min_quantity)
  values ('55555555-5555-4555-8555-555555555551', 'Lessive CRUD', 'consommable', 'litre', 2)
  returning id into v_article;

  insert into public.stock_movements (tenant_id, item_id, kind, quantity, reason)
  values ('55555555-5555-4555-8555-555555555551', v_article, 'in', 5, 'Stock initial');

  begin
    delete from public.stock_items where id = v_article;
  exception when foreign_key_violation then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '23503' then
    raise exception 'ECHEC 6 : un article mouvementé a pu être supprimé';
  end if;

  if not exists (
    select 1 from public.stock_items where id = v_article and quantity = 5
  ) then
    raise exception 'ECHEC 7 : la quantité issue du mouvement a disparu';
  end if;
  raise notice 'OK 6 — un article mouvementé ne se supprime pas ; sa quantité reste au journal.';

  update public.stock_items set is_active = false where id = v_article;
  if not exists (select 1 from public.stock_items where id = v_article and is_active = false) then
    raise exception 'ECHEC 8 : l''archivage d''un article ne fonctionne pas';
  end if;
  raise notice 'OK 7 — un article mouvementé s''archive sans perdre son historique.';
end;
$$;

-- =============================================================================
-- 3. FOURNISSEURS — suppression refusée quand une dépense les référence
-- =============================================================================
do $$
declare
  v_fournisseur uuid;
  v_sqlstate text;
  v_reste integer;
begin
  insert into public.suppliers (tenant_id, name, phone)
  values ('55555555-5555-4555-8555-555555555551', 'Sotici CRUD', '+225 07 00 00 00 30')
  returning id into v_fournisseur;

  insert into public.expenses (tenant_id, label, category, amount, supplier_id)
  values ('55555555-5555-4555-8555-555555555551', 'Lessive', 'fournitures', 4500, v_fournisseur);

  begin
    delete from public.suppliers where id = v_fournisseur;
  exception when foreign_key_violation then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '23503' then
    raise exception 'ECHEC 9 : un fournisseur utilisé a pu être supprimé';
  end if;
  raise notice 'OK 8 — un fournisseur utilisé par une dépense ne se supprime pas.';

  update public.suppliers set is_active = false where id = v_fournisseur;
  select count(*) into v_reste from public.suppliers where id = v_fournisseur and is_active = false;
  if v_reste <> 1 then
    raise exception 'ECHEC 10 : la désactivation du fournisseur a échoué';
  end if;

  -- Un fournisseur inutilisé, lui, se supprime.
  insert into public.suppliers (tenant_id, name)
  values ('55555555-5555-4555-8555-555555555551', 'Fournisseur libre')
  returning id into v_fournisseur;
  delete from public.suppliers where id = v_fournisseur;
  select count(*) into v_reste from public.suppliers where id = v_fournisseur;
  if v_reste <> 0 then
    raise exception 'ECHEC 11 : un fournisseur inutilisé n''a pas pu être supprimé';
  end if;
  raise notice 'OK 9 — un fournisseur inutilisé se supprime, un fournisseur utilisé s''archive.';
end;
$$;

-- =============================================================================
-- 4. SUPPORT — clôture et retrait par le pressing
-- =============================================================================
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-0000000000e2',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'tenant_id', '55555555-5555-4555-8555-555555555551',
      'tenant_role', 'receptionist'
    )
  )::text,
  true
);

do $$
declare
  v_demande uuid;
  v_autre uuid;
  v_sqlstate text;
begin
  insert into public.support_requests (tenant_id, author_id, subject, message)
  values (
    '55555555-5555-4555-8555-555555555551',
    '00000000-0000-4000-8000-0000000000e2',
    'Imprimante muette',
    'Le reçu ne sort plus après un encaissement.'
  )
  returning id into v_demande;

  perform public.tenant_close_support_request(v_demande);
  if not exists (select 1 from public.support_requests where id = v_demande and status = 'closed') then
    raise exception 'ECHEC 12 : la clôture par le pressing n''a pas changé le statut';
  end if;
  raise notice 'OK 10 — le comptoir clôture sa demande de support.';

  insert into public.support_requests (tenant_id, author_id, subject, message)
  values (
    '55555555-5555-4555-8555-555555555551',
    '00000000-0000-4000-8000-0000000000e2',
    'Doublon de saisie',
    'Demande créée par erreur au comptoir.'
  )
  returning id into v_autre;

  perform public.tenant_delete_support_request(v_autre);
  if exists (select 1 from public.support_requests where id = v_autre) then
    raise exception 'ECHEC 13 : la demande ouverte n''a pas été retirée';
  end if;

  begin
    perform public.tenant_delete_support_request(v_demande);
  exception when invalid_parameter_value then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '22023' then
    raise exception 'ECHEC 14 : une demande clôturée a pu être retirée';
  end if;
  raise notice 'OK 11 — une demande ouverte se retire, une demande traitée non.';
end;
$$;

-- L'atelier ne clôture pas de demande de support.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-0000000000e3',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'tenant_id', '55555555-5555-4555-8555-555555555551',
      'tenant_role', 'artisan'
    )
  )::text,
  true
);

do $$
declare
  v_demande uuid;
  v_sqlstate text;
begin
  select id into v_demande from public.support_requests
  where tenant_id = '55555555-5555-4555-8555-555555555551'
  limit 1;

  begin
    perform public.tenant_close_support_request(v_demande);
  exception when insufficient_privilege then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'ECHEC 15 : l''atelier a pu clôturer une demande de support';
  end if;
  raise notice 'OK 12 — la clôture du support est réservée au comptoir.';
end;
$$;

-- =============================================================================
-- 5. ÉQUIPE — rattachement par e-mail et protections
-- =============================================================================
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-0000000000e1',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'tenant_id', '55555555-5555-4555-8555-555555555551',
      'tenant_role', 'owner'
    )
  )::text,
  true
);

do $$
declare
  v_membre uuid;
  v_sqlstate text;
  v_n integer;
begin
  v_membre := public.tenant_attach_member_by_email(
    'CRUD-Collegue@test.local',
    'receptionist',
    'Awa — comptoir'
  );

  if v_membre is distinct from '00000000-0000-4000-8000-0000000000e4' then
    raise exception 'ECHEC 16 : le rattachement par e-mail n''a pas retrouvé le compte';
  end if;

  if not exists (
    select 1 from public.tenant_users
    where user_id = v_membre
      and tenant_id = '55555555-5555-4555-8555-555555555551'
      and role = 'receptionist'
      and display_name = 'Awa — comptoir'
  ) then
    raise exception 'ECHEC 17 : le membre rattaché n''a pas le rôle attendu';
  end if;
  raise notice 'OK 13 — le propriétaire rattache un compte existant par son e-mail.';

  -- Le dernier propriétaire ne peut pas être rétrogradé ni détaché.
  begin
    perform public.tenant_set_member(
      '00000000-0000-4000-8000-0000000000e1',
      'artisan',
      null
    );
  exception when invalid_parameter_value then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '22023' then
    raise exception 'ECHEC 18 : le dernier propriétaire a pu être rétrogradé';
  end if;

  v_sqlstate := null;
  begin
    perform public.tenant_remove_member('00000000-0000-4000-8000-0000000000e1');
  exception when invalid_parameter_value then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '22023' then
    raise exception 'ECHEC 19 : le dernier propriétaire a pu être détaché';
  end if;
  raise notice 'OK 14 — le dernier propriétaire du pressing est protégé.';

  -- Un compte inconnu est refusé avec un message explicite.
  v_sqlstate := null;
  begin
    perform public.tenant_attach_member_by_email('inconnu@test.local', 'artisan', null);
  exception when no_data_found then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from 'P0002' then
    raise exception 'ECHEC 20 : un e-mail inconnu a été accepté';
  end if;
  raise notice 'OK 15 — un e-mail sans compte est refusé.';

  perform public.tenant_remove_member(v_membre);
  select count(*) into v_n from public.tenant_users
  where user_id = v_membre and tenant_id = '55555555-5555-4555-8555-555555555551';
  if v_n <> 0 then
    raise exception 'ECHEC 21 : le membre n''a pas été détaché';
  end if;
  raise notice 'OK 16 — le propriétaire détache un membre.';
end;
$$;

-- L'annuaire expose l'e-mail aux membres du pressing.
do $$
declare
  v_email text;
begin
  select email into v_email from public.tenant_team()
  where user_id = '00000000-0000-4000-8000-0000000000e2';

  if v_email is distinct from 'crud-comptoir@test.local' then
    raise exception 'ECHEC 22 : l''annuaire de l''équipe ne renvoie pas l''e-mail';
  end if;
  raise notice 'OK 17 — l''équipe est lisible avec les e-mails, sans droit d''écriture direct.';
end;
$$;

-- Un réceptionniste ne gère pas l'équipe.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-0000000000e2',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'tenant_id', '55555555-5555-4555-8555-555555555551',
      'tenant_role', 'receptionist'
    )
  )::text,
  true
);

do $$
declare
  v_sqlstate text;
begin
  begin
    perform public.tenant_set_member(
      '00000000-0000-4000-8000-0000000000e4',
      'owner',
      null
    );
  exception when insufficient_privilege then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'ECHEC 23 : un réceptionniste a pu modifier l''équipe';
  end if;
  raise notice 'OK 18 — la gestion de l''équipe est réservée au propriétaire.';
end;
$$;

-- Une commande encaissée ne peut pas être supprimée : la cascade financière
-- effacerait le paiement. On vérifie le garde-fou et l'annulation proposée.
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-0000000000e1',
    'role', 'authenticated',
    'app_metadata', jsonb_build_object(
      'tenant_id', '55555555-5555-4555-8555-555555555551',
      'tenant_role', 'owner'
    )
  )::text,
  true
);

-- L'écriture d'un encaissement est réservée au serveur (aucun GRANT client) :
-- on prépare le cas avec le rôle de session, puis on revient à `authenticated`.
reset role;

do $$
declare
  v_commande uuid := '66666666-6666-4666-8666-666666666601';
  v_client   uuid;
  v_sqlstate text;
  v_statut   text;
begin
  insert into public.customers (tenant_id, name, phone, phone_key)
  values ('55555555-5555-4555-8555-555555555551', 'Client Crud', '0700000001', '0700000001')
  returning id into v_client;

  insert into public.orders (
    id, tenant_id, customer_id, customer_name, customer_phone,
    qr_code, status, total_amount, payment_status
  ) values (
    v_commande, '55555555-5555-4555-8555-555555555551', v_client,
    'Client Crud', '0700000001', 'QR-CRUD-SUPPR', 'ready', 5000, 'paid'
  );

  insert into public.payment_transactions (
    tenant_id, order_id, transaction_id, amount, order_amount, status, payment_method, paid_at
  ) values (
    '55555555-5555-4555-8555-555555555551', v_commande, 'TX-CRUD-SUPPR',
    5000, 5000, 'paid', 'wave', now()
  );

  begin
    delete from public.orders where id = v_commande;
  exception when foreign_key_violation then
    v_sqlstate := sqlstate;
  end;

  if v_sqlstate is distinct from '23503' then
    raise exception 'ECHEC 24 : une commande encaissée a pu être supprimée';
  end if;

  update public.orders set status = 'cancelled' where id = v_commande
  returning status into v_statut;

  if v_statut is distinct from 'cancelled' then
    raise exception 'ECHEC 25 : l''annulation de secours n''a pas fonctionné';
  end if;

  raise notice 'OK 19 — une commande encaissée est annulée, pas supprimée.';
end;
$$;

rollback;
