-- =============================================================================
-- 025_crud_complet.sql — complète les opérations d'écriture des modules de gestion
-- =============================================================================
-- Plusieurs écrans ne permettaient que la création ou la lecture. Cette
-- migration ajoute les écritures manquantes, sans changer les décisions de
-- conception existantes :
--
--   1. **Clients** — une fiche naissait d'une commande et ne pouvait plus être
--      supprimée. Le comptoir peut désormais créer une fiche à l'avance (un
--      client qui vient déposer sans commande, une livraison à venir), la
--      modifier entièrement, et le propriétaire seul peut la supprimer.
--   2. **Stock et fournisseurs** — la suppression est refusée quand elle
--      détruirait l'historique (mouvements, dépenses). Il faut archiver
--      (`is_active = false`) : le journal reste la source de vérité.
--   3. **Support** — le pressing peut clôturer sa propre demande, ou retirer
--      une demande encore ouverte (erreur de saisie).
--   4. **Équipe** — le propriétaire gère ses membres depuis les paramètres :
--      rattacher un compte existant par e-mail, changer un rôle ou un nom
--      affiché, détacher un membre. Le dernier propriétaire est protégé.
--
-- La RLS reste l'autorité : chaque politique et chaque fonction `security
-- definer` re-vérifie le rôle et le pressing. Les triggers de version et
-- d'abonnement (007) continuent de s'appliquer.
-- =============================================================================

-- =============================================================================
-- 1. CLIENTS
-- =============================================================================

-- `phone_key` est la clé de rapprochement du comptoir (voir `normalize_phone`,
-- migration 006). Elle était seulement calculée par le déclencheur des
-- commandes ; toute écriture directe doit la produire de la même façon, sinon
-- « +225 07 00 00 00 21 » et « 0700000021 » créeraient deux fiches.
create or replace function public.prepare_customer_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text;
begin
  new.name  := btrim(new.name);
  new.phone := btrim(new.phone);
  v_key     := public.normalize_phone(new.phone);

  if v_key = '' then
    raise exception 'Numéro de téléphone invalide : indiquez au moins quelques chiffres.'
      using errcode = '22023';
  end if;

  new.phone_key  := v_key;
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.prepare_customer_row() is
  'Normalise le téléphone et la clé de rapprochement d''une fiche client.';

drop trigger if exists customers_prepare_row on public.customers;
create trigger customers_prepare_row
  before insert or update on public.customers
  for each row execute function public.prepare_customer_row();

-- Le comptoir crée une fiche pour un client qui n'a pas encore de commande.
drop policy if exists customers_insert_counter on public.customers;
create policy customers_insert_counter on public.customers
  for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() in ('owner', 'receptionist')
  );

-- Suppression réservée au propriétaire. Les commandes conservent le nom et le
-- téléphone saisis ; seul le lien `customer_id` est remis à NULL.
drop policy if exists customers_delete_owner on public.customers;
create policy customers_delete_owner on public.customers
  for delete to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  );

grant insert, delete on public.customers to authenticated;

-- =============================================================================
-- 2. STOCK ET FOURNISSEURS — protéger l'historique
-- =============================================================================

-- La clé étrangère des mouvements est `on delete cascade` : supprimer un
-- article mouvementé effacerait des sorties déjà imputées à des commandes.
-- On refuse, et l'interface propose l'archivage.
create or replace function public.guard_stock_item_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Écriture serveur (purge d'un pressing, service_role) : rien à contrôler.
  if auth.uid() is null then
    return old;
  end if;

  if exists (select 1 from public.stock_movements where item_id = old.id) then
    raise exception 'Cet article a des mouvements : archivez-le au lieu de le supprimer.'
      using errcode = '23503';
  end if;

  return old;
end;
$$;

comment on function public.guard_stock_item_delete() is
  'Empêche la suppression d''un article de stock déjà mouvementé.';

drop trigger if exists stock_items_guard_delete on public.stock_items;
create trigger stock_items_guard_delete
  before delete on public.stock_items
  for each row execute function public.guard_stock_item_delete();

-- Un fournisseur référencé par une dépense ou un mouvement ne disparaît pas :
-- la dépense perdrait son origine. On le désactive.
create or replace function public.guard_supplier_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return old;
  end if;

  if exists (select 1 from public.expenses where supplier_id = old.id)
     or exists (select 1 from public.stock_movements where supplier_id = old.id) then
    raise exception 'Ce fournisseur est utilisé : désactivez-le au lieu de le supprimer.'
      using errcode = '23503';
  end if;

  return old;
end;
$$;

comment on function public.guard_supplier_delete() is
  'Empêche la suppression d''un fournisseur déjà utilisé par une dépense ou un mouvement.';

drop trigger if exists suppliers_guard_delete on public.suppliers;
create trigger suppliers_guard_delete
  before delete on public.suppliers
  for each row execute function public.guard_supplier_delete();

-- =============================================================================
-- 3. SUPPORT — le pressing clôture ou retire sa demande
-- =============================================================================

create or replace function public.tenant_close_support_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if public.current_tenant_role() not in ('owner', 'receptionist') then
    raise exception 'Action réservée au comptoir du pressing.' using errcode = '42501';
  end if;

  update public.support_requests
  set    status = 'closed',
         response = coalesce(
           response,
           'Demande clôturée par le pressing (problème résolu sur place).'
         )
  where  id = p_id
    and  tenant_id = v_tenant;

  if not found then
    raise exception 'Demande introuvable pour ce pressing.' using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.tenant_close_support_request(uuid) is
  'Clôture une demande de support ; réservé au comptoir du pressing concerné.';

create or replace function public.tenant_delete_support_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_status text;
  v_author uuid;
  v_role   text := public.current_tenant_role();
begin
  select status, author_id into v_status, v_author
  from   public.support_requests
  where  id = p_id and tenant_id = v_tenant;

  if v_status is null then
    raise exception 'Demande introuvable pour ce pressing.' using errcode = 'P0002';
  end if;

  if v_role <> 'owner' and (v_role <> 'receptionist' or v_author is distinct from auth.uid()) then
    raise exception 'Seul l''auteur de la demande ou le propriétaire peut la retirer.'
      using errcode = '42501';
  end if;

  if v_status <> 'open' then
    raise exception 'Une demande déjà traitée ne peut pas être retirée.'
      using errcode = '22023';
  end if;

  delete from public.support_requests where id = p_id and tenant_id = v_tenant;
end;
$$;

comment on function public.tenant_delete_support_request(uuid) is
  'Retire une demande de support encore ouverte ; auteur ou propriétaire uniquement.';

-- =============================================================================
-- 4. ÉQUIPE — le propriétaire gère les membres de son pressing
-- =============================================================================

-- Annuaire de l'équipe avec l'e-mail, lisible par tout membre du pressing.
-- `tenant_users` n'accorde que `select` au rôle client : les écritures passent
-- obligatoirement par les fonctions ci-dessous.
create or replace function public.tenant_team()
returns table (
  user_id      uuid,
  email        text,
  role         text,
  display_name text,
  created_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null then
    raise exception 'Aucun pressing actif pour ce compte.' using errcode = '42501';
  end if;

  if not public.is_tenant_member(v_tenant) then
    raise exception 'Compte non rattaché à ce pressing.' using errcode = '42501';
  end if;

  return query
    select tu.user_id, u.email, tu.role, tu.display_name, tu.created_at
    from   public.tenant_users tu
    left   join auth.users u on u.id = tu.user_id
    where  tu.tenant_id = v_tenant
    order  by case tu.role when 'owner' then 0 when 'receptionist' then 1 else 2 end,
              coalesce(tu.display_name, u.email);
end;
$$;

comment on function public.tenant_team() is
  'Équipe du pressing actif, avec e-mail, pour l''écran Paramètres.';

-- Rattache ou met à jour un membre. `p_role = null` détache le compte.
create or replace function public.tenant_set_member(
  p_user         uuid,
  p_role         text,
  p_display_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_max    integer;
  v_n      integer;
  v_est_owner boolean;
begin
  if public.current_tenant_role() <> 'owner' then
    raise exception 'Seul le propriétaire gère l''équipe du pressing.' using errcode = '42501';
  end if;

  if v_tenant is null then
    raise exception 'Aucun pressing actif pour ce compte.' using errcode = '42501';
  end if;

  if not public.tenant_writable(v_tenant) then
    raise exception 'Abonnement échu : la gestion de l''équipe est suspendue.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'Compte introuvable.' using errcode = 'P0002';
  end if;

  select exists (
    select 1 from public.tenant_users
    where tenant_id = v_tenant and user_id = p_user and role = 'owner'
  ) into v_est_owner;

  select count(*) into v_n
  from   public.tenant_users
  where  tenant_id = v_tenant and role = 'owner';

  if p_role is null then
    if v_est_owner and v_n <= 1 then
      raise exception 'Impossible de détacher le dernier propriétaire du pressing.'
        using errcode = '22023';
    end if;

    delete from public.tenant_users where tenant_id = v_tenant and user_id = p_user;
    return;
  end if;

  if p_role not in ('owner', 'receptionist', 'artisan') then
    raise exception 'Rôle inconnu : %.', p_role using errcode = '22023';
  end if;

  if v_est_owner and p_role <> 'owner' and v_n <= 1 then
    raise exception 'Impossible de retirer le dernier propriétaire du pressing.'
      using errcode = '22023';
  end if;

  select p.max_users into v_max
  from   public.subscriptions s
  join   public.plans p on p.code = s.plan_code
  where  s.tenant_id = v_tenant;

  select count(*) into v_n
  from   public.tenant_users
  where  tenant_id = v_tenant and user_id <> p_user;

  if v_max is not null and v_n >= v_max then
    raise exception 'La formule de ce pressing est limitée à % compte(s).', v_max
      using errcode = '22023';
  end if;

  insert into public.tenant_users (user_id, tenant_id, role, display_name)
  values (
    p_user,
    v_tenant,
    p_role,
    nullif(btrim(coalesce(p_display_name, '')), '')
  )
  on conflict (user_id, tenant_id) do update
    set role = excluded.role,
        display_name = coalesce(excluded.display_name, public.tenant_users.display_name);
end;
$$;

comment on function public.tenant_set_member(uuid, text, text) is
  'Rattache, met à jour ou détache un membre ; propriétaire du pressing uniquement.';

-- Rattachement par e-mail : le propriétaire n'a pas à connaître les UUID.
-- Seuls les comptes déjà créés sont acceptés (aucune création de mot de passe
-- depuis le navigateur, conformément au reste du projet).
create or replace function public.tenant_attach_member_by_email(
  p_email        text,
  p_role         text,
  p_display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if public.current_tenant_role() <> 'owner' then
    raise exception 'Seul le propriétaire gère l''équipe du pressing.' using errcode = '42501';
  end if;

  if btrim(coalesce(p_email, '')) = '' then
    raise exception 'Indiquez l''e-mail du collègue.' using errcode = '22023';
  end if;

  select id into v_user
  from   auth.users
  where  lower(email) = lower(btrim(p_email))
  limit  1;

  if v_user is null then
    raise exception 'Aucun compte ne porte cet e-mail. Le collègue doit d''abord créer son compte.'
      using errcode = 'P0002';
  end if;

  perform public.tenant_set_member(v_user, p_role, p_display_name);
  return v_user;
end;
$$;

comment on function public.tenant_attach_member_by_email(text, text, text) is
  'Rattache un compte existant au pressing actif à partir de son e-mail.';

create or replace function public.tenant_remove_member(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.tenant_set_member(p_user, null, null);
end;
$$;

comment on function public.tenant_remove_member(uuid) is
  'Détache un membre du pressing actif ; le dernier propriétaire est protégé.';

-- =============================================================================
-- 5. COMMANDES — supprimer sans effacer la trace financière
-- =============================================================================

-- La politique `orders_delete_owner` (001) autorise le propriétaire à
-- supprimer une commande. Les clés étrangères de `payment_transactions` et
-- `payment_refunds` sont en `on delete cascade` : une suppression emportait
-- donc en silence les encaissements Mobile Money et les remboursements.
-- On refuse la suppression dès qu'un mouvement financier existe ; l'interface
-- propose alors l'annulation (statut 'cancelled'), qui garde l'historique.
create or replace function public.guard_order_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Écriture serveur (purge RGPD d'un pressing, service_role) : rien à contrôler.
  if auth.uid() is null then
    return old;
  end if;

  if exists (select 1 from public.payment_transactions where order_id = old.id) then
    raise exception 'Cette commande a des encaissements : annulez-la au lieu de la supprimer.'
      using errcode = '23503';
  end if;

  if exists (select 1 from public.payment_refunds where order_id = old.id) then
    raise exception 'Cette commande a des remboursements : annulez-la au lieu de la supprimer.'
      using errcode = '23503';
  end if;

  return old;
end;
$$;

comment on function public.guard_order_delete() is
  'Empêche la suppression d''une commande déjà encaissée ou remboursée (cascade financière).';

drop trigger if exists orders_guard_delete on public.orders;
create trigger orders_guard_delete
  before delete on public.orders
  for each row execute function public.guard_order_delete();
