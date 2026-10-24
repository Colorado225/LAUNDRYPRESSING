-- =============================================================================
-- 003_palier1.sql — verrou optimiste, historique enrichi, rôles, paiements
-- =============================================================================
-- Cette migration répond aux trois risques du palier 1 :
--   1. écrasement silencieux entre deux tablettes → colonne `version` ;
--   2. historique incomplet des statuts → `previous_status` et `reason` ;
--   3. droits trop larges du rôle « artisan » → garde-fou serveur ;
--   4. double paiement concurrent → un seul guichet ouvert par commande.
--
-- Elle est idempotente (`if not exists`, `create or replace`, `drop ... if
-- exists`) : la rejouer sur une base déjà migrée ne casse rien.
-- =============================================================================

-- =============================================================================
-- 1. VERROU OPTIMISTE SUR LES COMMANDES
-- =============================================================================
-- `version` part de 1 et n'est incrémentée que si une donnée MÉTIER change.
-- Les colonnes de paiement sont volontairement exclues : le webhook CinetPay
-- met à jour `payment_status` en arrière-plan, et cette écriture ne doit pas
-- invalider le numéro de version détenu par les tablettes en atelier (sinon
-- elles verraient un conflit à chaque paiement, sans avoir rien modifié).
alter table public.orders add column if not exists version integer not null default 1;

create or replace function public.bump_order_version()
returns trigger
language plpgsql
as $$
begin
  if new.status         is distinct from old.status
     or new.customer_name  is distinct from old.customer_name
     or new.customer_phone is distinct from old.customer_phone
     or new.total_amount   is distinct from old.total_amount
     or new.qr_code        is distinct from old.qr_code
     or new.photo_url      is distinct from old.photo_url
  then
    new.version := old.version + 1;
  else
    new.version := old.version;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_version on public.orders;
create trigger trg_orders_version
  before update on public.orders
  for each row
  execute function public.bump_order_version();

-- =============================================================================
-- 2. HISTORIQUE ENRICHI
-- =============================================================================
-- L'ancien statut permet de reconstituer le parcours complet sans dépendre de
-- l'ordre d'insertion ; le motif sert aux dérogations (annulation, correction).
alter table public.order_status_history
  add column if not exists previous_status text;

alter table public.order_status_history
  add column if not exists reason text;

create or replace function public.log_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.order_status_history
      (order_id, tenant_id, status, previous_status, changed_by)
    values
      (new.id, new.tenant_id, new.status, old.status, auth.uid());
  end if;
  return new;
end;
$$;

-- =============================================================================
-- 3. GARDE-FOU DES RÔLES (appliqué côté serveur, pas seulement dans l'UI)
-- =============================================================================
-- Ce que la RLS ne sait pas exprimer : « ce rôle peut modifier la ligne, mais
-- pas toutes ses colonnes ». Trois règles, vérifiées avant chaque mise à jour :
--   a. le statut de paiement n'est modifiable que par le serveur (service_role) ;
--   b. un artisan ne touche ni aux montants ni aux coordonnées du client ;
--   c. une commande livrée ou annulée est définitive, sauf correction du
--      propriétaire.
--
-- `auth.uid()` vaut NULL pour le service_role, les migrations et les scripts :
-- ces contextes sont donc laissés passer (c'est le cas du webhook CinetPay).
create or replace function public.guard_order_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  role_courant text := public.current_tenant_role();
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.payment_status is distinct from old.payment_status
     or new.payment_method is distinct from old.payment_method
  then
    raise exception 'Le statut de paiement ne peut être modifié que par le serveur.'
      using errcode = '42501';
  end if;

  if role_courant = 'artisan' then
    if new.total_amount   is distinct from old.total_amount
       or new.customer_name  is distinct from old.customer_name
       or new.customer_phone is distinct from old.customer_phone
       or new.qr_code        is distinct from old.qr_code
       or new.photo_url      is distinct from old.photo_url
    then
      raise exception 'Un artisan ne peut pas modifier les informations de la commande.'
        using errcode = '42501';
    end if;
  end if;

  if new.status is distinct from old.status
     and old.status in ('delivered', 'cancelled')
     and coalesce(role_courant, '') <> 'owner'
  then
    raise exception 'Une commande livrée ou annulée ne peut être rouverte que par le propriétaire.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_guard_update on public.orders;
create trigger trg_orders_guard_update
  before update on public.orders
  for each row
  execute function public.guard_order_update();

-- =============================================================================
-- 4. UN SEUL GUICHET DE PAIEMENT OUVERT PAR COMMANDE
-- =============================================================================
-- Sans cette contrainte, deux clics (ou deux tablettes) créent deux
-- `transaction_id` valides chez CinetPay : le client peut payer deux fois.
-- L'index partiel autorise autant de transactions terminées que nécessaire,
-- mais une seule « pending » ou « initiated » à la fois.
--
-- Nettoyage préalable : si une base contient déjà plusieurs guichets ouverts
-- pour la même commande, on ne garde que le plus récent.
update public.payment_transactions pt
set    status = 'cancelled'
where  pt.status in ('pending', 'initiated')
  and  exists (
         select 1
         from   public.payment_transactions plus_recent
         where  plus_recent.order_id = pt.order_id
           and  plus_recent.status in ('pending', 'initiated')
           and  plus_recent.created_at > pt.created_at
       );

create unique index if not exists uniq_payment_open_per_order
  on public.payment_transactions (order_id)
  where status in ('pending', 'initiated');

-- Index de lecture pour la résolution des conflits : on retrouve la version
-- courante d'une commande par son identifiant, ce que la clé primaire couvre
-- déjà — aucun index supplémentaire n'est donc nécessaire.
