-- =============================================================================
-- 004_palier2.sql — catalogue, caisse (espèces) et workflow complet
-- =============================================================================
-- Palier 2 de la feuille de route (`MAJ.md`) :
--   1. catalogue des prestations, avec un prix **historisé** sur chaque ligne ;
--   2. encaissement au comptoir : espèces, acomptes, solde dû, clôture ;
--   3. workflow complet du linge (tri, séchage, contrôle qualité), date de
--      livraison prévue et transitions cohérentes.
--
-- Migration idempotente : `if not exists`, `create or replace`, `drop … if
-- exists`. Elle suppose 001 → 003 appliquées.
-- =============================================================================

-- =============================================================================
-- 1. CATALOGUE DES PRESTATIONS
-- =============================================================================
-- Choix de modélisation : une seule table `catalog_entries` porte le triplet
-- (article, prestation, prix). Trois tables normalisées (articles, services,
-- prix) imposeraient trois jointures pour afficher un simple tarif et trois
-- synchronisations hors ligne ; ici, la liste des articles et celle des
-- prestations se déduisent des entrées existantes. Le couple (article,
-- prestation) est unique par pressing.
create table if not exists public.catalog_entries (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  article     text not null check (char_length(trim(article)) between 2 and 60),
  service     text not null check (char_length(trim(service)) between 2 and 60),
  price       integer not null check (price >= 0),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (tenant_id, article, service)
);

-- Nécessaire aux clés étrangères composites des lignes de commande : une ligne
-- ne peut référencer qu'une entrée du MÊME pressing. Ajout conditionnel, sans
-- quoi rejouer la migration échouerait (la clé étrangère en dépend).
do $$
begin
  if not exists (
    select 1
    from   pg_constraint
    where  conname = 'catalog_entries_id_tenant_key'
      and  conrelid = 'public.catalog_entries'::regclass
  ) then
    alter table public.catalog_entries
      add constraint catalog_entries_id_tenant_key unique (id, tenant_id);
  end if;
end;
$$;

create index if not exists idx_catalog_tenant on public.catalog_entries (tenant_id, is_active);

drop trigger if exists trg_catalog_updated_at on public.catalog_entries;
create trigger trg_catalog_updated_at
  before update on public.catalog_entries
  for each row
  execute function public.update_updated_at_column();

alter table public.catalog_entries enable row level security;

drop policy if exists catalog_select_tenant on public.catalog_entries;
create policy catalog_select_tenant on public.catalog_entries
  for select
  using (tenant_id = public.current_tenant_id());

-- Seul le propriétaire modifie les tarifs : un réceptionniste peut encaisser
-- au prix du catalogue, pas le réécrire.
drop policy if exists catalog_write_owner on public.catalog_entries;
create policy catalog_write_owner on public.catalog_entries
  for all
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner');

grant select, insert, update, delete on public.catalog_entries to authenticated;

-- =============================================================================
-- 2. PRIX HISTORISÉ SUR CHAQUE LIGNE DE COMMANDE
-- =============================================================================
-- `order_items.price` existait déjà : c'est le montant facturé, figé au moment
-- de la saisie. On ajoute la **traçabilité** de l'entrée de catalogue utilisée
-- et les libellés recopiés, pour qu'une modification ultérieure du catalogue
-- (renommage, changement de tarif) ne modifie jamais une ancienne commande.
alter table public.order_items
  add column if not exists catalog_entry_id uuid;

alter table public.order_items
  add column if not exists article_name text;

alter table public.order_items
  add column if not exists service_name text;

-- La référence au catalogue est facultative (ligne libre) et devient nulle si
-- l'entrée est supprimée : le libellé et le prix, eux, restent.
alter table public.order_items
  drop constraint if exists order_items_catalog_fk;
alter table public.order_items
  add constraint order_items_catalog_fk
  foreign key (catalog_entry_id, tenant_id)
  references public.catalog_entries (id, tenant_id)
  on delete set null;

-- =============================================================================
-- 3. WORKFLOW COMPLET
-- =============================================================================
-- Parcours : réception → tri → lavage → séchage → repassage → contrôle qualité
-- → prêt → remis. Les anciens statuts restent valides (données existantes).
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status in (
    'received', 'sorting', 'washing', 'drying', 'ironing', 'quality_check',
    'ready', 'delivered', 'cancelled'
  ));

-- L'historique porte la même contrainte : sans cet ajustement, une transition
-- vers un nouveau statut échouerait au moment d'écrire la ligne d'historique
-- (défaut détecté par supabase/tests/palier2.sql).
alter table public.order_status_history
  drop constraint if exists order_status_history_status_check;
alter table public.order_status_history
  add constraint order_status_history_status_check
  check (status in (
    'received', 'sorting', 'washing', 'drying', 'ironing', 'quality_check',
    'ready', 'delivered', 'cancelled'
  ));

alter table public.orders add column if not exists due_date date;

create index if not exists idx_orders_due_date on public.orders (tenant_id, due_date)
  where status not in ('delivered', 'cancelled');

/**
 * Rang d'un statut dans le parcours linéaire.
 *
 * Sert au garde-fou : hors propriétaire, une commande ne peut qu'avancer.
 * `cancelled` n'a pas de rang (sortie de parcours, traitée à part).
 */
create or replace function public.order_status_rank(p_status text)
returns integer
language sql
immutable
as $$
  select case p_status
    when 'received'      then 1
    when 'sorting'       then 2
    when 'washing'       then 3
    when 'drying'        then 4
    when 'ironing'       then 5
    when 'quality_check' then 6
    when 'ready'         then 7
    when 'delivered'     then 8
    else null
  end;
$$;

-- Reprise du garde-fou de 003, enrichi de deux règles :
--   • le statut ne peut pas RECULER (sauf propriétaire, qui corrige une erreur) ;
--   • l'annulation est réservée au propriétaire et à la réception.
-- Le reste est inchangé : montants et coordonnées interdits à l'artisan,
-- `payment_status` réservé au serveur (ou à l'encaissement, qui pose un jeton
-- de session avant d'écrire — voir `record_cash_payment`).
create or replace function public.guard_order_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  role_courant text := public.current_tenant_role();
  ecriture_paiement boolean :=
    coalesce(current_setting('pressing.payment_writer', true), '') = 'on';
  rang_ancien integer;
  rang_nouveau integer;
begin
  if auth.uid() is null then
    return new;
  end if;

  if not ecriture_paiement
     and (new.payment_status is distinct from old.payment_status
          or new.payment_method is distinct from old.payment_method)
  then
    raise exception 'Le statut de paiement ne peut être modifié que par le serveur.'
      using errcode = '42501';
  end if;

  if role_courant = 'artisan' then
    if new.total_amount    is distinct from old.total_amount
       or new.customer_name  is distinct from old.customer_name
       or new.customer_phone is distinct from old.customer_phone
       or new.qr_code        is distinct from old.qr_code
       or new.photo_url      is distinct from old.photo_url
       or new.due_date       is distinct from old.due_date
    then
      raise exception 'Un artisan ne peut pas modifier les informations de la commande.'
        using errcode = '42501';
    end if;
  end if;

  if new.status is distinct from old.status then
    -- Une commande livrée ou annulée est définitive, sauf propriétaire.
    if old.status in ('delivered', 'cancelled') and coalesce(role_courant, '') <> 'owner' then
      raise exception 'Une commande livrée ou annulée ne peut être rouverte que par le propriétaire.'
        using errcode = '42501';
    end if;

    -- Annulation : jamais l'atelier.
    if new.status = 'cancelled' and coalesce(role_courant, '') not in ('owner', 'receptionist') then
      raise exception 'Seul le comptoir peut annuler une commande.'
        using errcode = '42501';
    end if;

    -- Marche arrière interdite hors propriétaire (contrôle qualité raté,
    -- erreur de scan…).
    if coalesce(role_courant, '') <> 'owner'
       and new.status <> 'cancelled'
       and old.status <> 'cancelled'
    then
      rang_ancien  := public.order_status_rank(old.status);
      rang_nouveau := public.order_status_rank(new.status);

      if rang_ancien is null or rang_nouveau is null then
        raise exception 'Transition de statut inconnue : % → %.', old.status, new.status
          using errcode = '22023';
      end if;

      if rang_nouveau < rang_ancien then
        raise exception 'Le statut ne peut pas revenir en arrière (% → %).', old.status, new.status
          using errcode = '42501';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- =============================================================================
-- 4. CAISSE : ENCAISSEMENT AU COMPTOIR
-- =============================================================================
-- Le registre `payment_transactions` reste la SEULE source de vérité des
-- encaissements : un paiement en espèces y entre avec `provider = 'cash'`,
-- `status = 'paid'` et un `transaction_id` préfixé `ESP-`. Le solde d'une
-- commande est donc toujours `total_amount − somme des encaissements payés`,
-- quel que soit le moyen de paiement.
alter table public.payment_transactions
  add column if not exists received_by uuid references auth.users (id) on delete set null;

alter table public.payment_transactions
  add column if not exists note text;

alter table public.payment_transactions
  add column if not exists cash_session_id uuid;

create index if not exists idx_payments_paid_at
  on public.payment_transactions (tenant_id, paid_at)
  where status = 'paid';

/**
 * Encaissement au comptoir (espèces uniquement).
 *
 * Pourquoi une fonction et pas une insertion directe ?
 *   • la RLS interdit toute écriture dans `payment_transactions` depuis un
 *     client : seul le serveur encaisse ;
 *   • le montant est vérifié contre le reste à payer RÉEL, relu en base ;
 *   • l'opération est idempotente : le client envoie l'identifiant qu'il a
 *     généré hors ligne, un renvoi ne crée pas de second encaissement.
 *
 * Le jeton `pressing.payment_writer` autorise la mise à jour de
 * `orders.payment_status`, normalement réservée au serveur.
 */
create or replace function public.record_cash_payment(
  p_order_id uuid,
  p_amount integer,
  p_payment_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant  uuid := public.current_tenant_id();
  v_role    text := public.current_tenant_role();
  v_commande public.orders;
  v_deja    integer;
  v_reste   integer;
  v_id      uuid := coalesce(p_payment_id, gen_random_uuid());
begin
  if v_tenant is null then
    raise exception 'Aucun pressing associé à ce compte.' using errcode = '42501';
  end if;

  if v_role not in ('owner', 'receptionist') then
    raise exception 'Votre rôle ne permet pas d''encaisser.' using errcode = '42501';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Le montant doit être supérieur à zéro.' using errcode = '22023';
  end if;

  select * into v_commande
  from   public.orders
  where  id = p_order_id and tenant_id = v_tenant
  for update;

  if not found then
    raise exception 'Commande introuvable pour ce pressing.' using errcode = 'P0002';
  end if;

  if v_commande.status = 'cancelled' then
    raise exception 'Impossible d''encaisser une commande annulée.' using errcode = '22023';
  end if;

  -- Renvoi après perte de réponse : l'encaissement existe déjà.
  if exists (select 1 from public.payment_transactions where id = v_id) then
    select coalesce(sum(amount), 0) into v_deja
    from   public.payment_transactions
    where  order_id = p_order_id and status = 'paid';

    return jsonb_build_object(
      'payment_id', v_id,
      'paid',      v_deja,
      'remaining', greatest(v_commande.total_amount - v_deja, 0),
      'duplicate', true
    );
  end if;

  select coalesce(sum(amount), 0) into v_deja
  from   public.payment_transactions
  where  order_id = p_order_id and status = 'paid';

  v_reste := v_commande.total_amount - v_deja;

  if v_reste <= 0 then
    raise exception 'Cette commande est déjà entièrement réglée.' using errcode = '22023';
  end if;

  if p_amount > v_reste then
    raise exception 'Le montant dépasse le reste à payer (% FCFA).', v_reste
      using errcode = '22023';
  end if;

  insert into public.payment_transactions
    (id, tenant_id, order_id, transaction_id, amount, order_amount, currency,
     status, provider, payment_method, operator_label, signature_verified,
     paid_at, received_by, note)
  values
    (v_id, v_tenant, p_order_id, 'ESP-' || v_id, p_amount, v_commande.total_amount,
     'XOF', 'paid', 'cash', 'cash', 'Espèces', false,
     now(), auth.uid(), nullif(trim(p_note), ''));

  -- Autorise la mise à jour du statut de paiement pour cette transaction.
  perform set_config('pressing.payment_writer', 'on', true);

  update public.orders
  set    payment_status = case
                            when v_deja + p_amount >= total_amount then 'paid'
                            else 'partial'
                          end,
         payment_method = 'cash',
         updated_at     = now()
  where  id = p_order_id;

  perform set_config('pressing.payment_writer', 'off', true);

  return jsonb_build_object(
    'payment_id', v_id,
    'paid',       v_deja + p_amount,
    'remaining',  v_commande.total_amount - v_deja - p_amount,
    'duplicate',  false
  );
end;
$$;

revoke all on function public.record_cash_payment(uuid, integer, uuid, text) from public;
grant execute on function public.record_cash_payment(uuid, integer, uuid, text) to authenticated;

-- =============================================================================
-- 5. CLÔTURE DE CAISSE JOURNALIÈRE
-- =============================================================================
create table if not exists public.cash_sessions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  business_date  date not null,
  expected_total integer not null check (expected_total >= 0),
  declared_total integer not null check (declared_total >= 0),
  difference     integer not null,
  notes          text,
  closed_by      uuid references auth.users (id) on delete set null,
  closed_at      timestamptz not null default now(),

  unique (tenant_id, business_date)
);

alter table public.cash_sessions enable row level security;

drop policy if exists cash_sessions_select_tenant on public.cash_sessions;
create policy cash_sessions_select_tenant on public.cash_sessions
  for select
  using (tenant_id = public.current_tenant_id());

-- Aucune politique d'écriture : la clôture passe uniquement par la fonction
-- ci-dessous, qui recalcule le montant attendu côté serveur. Un client ne peut
-- donc pas « déclarer » un total attendu qui l'arrange.
grant select on public.cash_sessions to authenticated;

alter table public.payment_transactions
  drop constraint if exists payment_transactions_cash_session_fk;
alter table public.payment_transactions
  add constraint payment_transactions_cash_session_fk
  foreign key (cash_session_id) references public.cash_sessions (id) on delete set null;

/**
 * Clôture d'une journée de caisse.
 *
 * Fuseau horaire : les encaissements sont répartis selon le jour calendaire
 * d'Abidjan (UTC+0), pas selon l'horloge de l'appareil ni UTC brut.
 *
 * La clôture est rejouable : la relancer le même jour met à jour les montants
 * (utile si un encaissement a été rattrapé après la fermeture).
 */
create or replace function public.close_cash_session(
  p_business_date date,
  p_declared_total integer,
  p_notes text default null
)
returns public.cash_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant   uuid := public.current_tenant_id();
  v_role     text := public.current_tenant_role();
  v_attendu  integer;
  v_session  public.cash_sessions;
begin
  if v_tenant is null then
    raise exception 'Aucun pressing associé à ce compte.' using errcode = '42501';
  end if;

  if v_role not in ('owner', 'receptionist') then
    raise exception 'Votre rôle ne permet pas de clôturer la caisse.' using errcode = '42501';
  end if;

  if p_declared_total is null or p_declared_total < 0 then
    raise exception 'Le montant déclaré est invalide.' using errcode = '22023';
  end if;

  if p_business_date > (now() at time zone 'Africa/Abidjan')::date then
    raise exception 'Impossible de clôturer une journée à venir.' using errcode = '22023';
  end if;

  select coalesce(sum(amount), 0) into v_attendu
  from   public.payment_transactions
  where  tenant_id = v_tenant
    and  status = 'paid'
    and  provider = 'cash'
    and  (paid_at at time zone 'Africa/Abidjan')::date = p_business_date;

  insert into public.cash_sessions
    (tenant_id, business_date, expected_total, declared_total, difference, notes, closed_by, closed_at)
  values
    (v_tenant, p_business_date, v_attendu, p_declared_total,
     p_declared_total - v_attendu, nullif(trim(p_notes), ''), auth.uid(), now())
  on conflict (tenant_id, business_date) do update
    set expected_total = excluded.expected_total,
        declared_total = excluded.declared_total,
        difference     = excluded.difference,
        notes          = excluded.notes,
        closed_by      = excluded.closed_by,
        closed_at      = excluded.closed_at
  returning * into v_session;

  -- Rattachement des encaissements de la journée à la session, pour que la
  -- réimpression d'un reçu indique à quelle clôture il appartient.
  update public.payment_transactions
  set    cash_session_id = v_session.id
  where  tenant_id = v_tenant
    and  status = 'paid'
    and  provider = 'cash'
    and  (paid_at at time zone 'Africa/Abidjan')::date = p_business_date;

  return v_session;
end;
$$;

revoke all on function public.close_cash_session(date, integer, text) from public;
grant execute on function public.close_cash_session(date, integer, text) to authenticated;

-- =============================================================================
-- 6. LECTURE DU SOLDE
-- =============================================================================
-- Vue utilitaire : évite de recalculer la somme des encaissements dans chaque
-- appel. `security_invoker` garantit que la RLS des tables sous-jacentes
-- s'applique à l'appelant (PostgreSQL 15+).
-- Règle de calcul, volontairement identique côté client
-- (`src/services/cashService.ts`) :
--   • `payment_status = 'paid'` ⇒ solde nul. Cette information fait autorité
--     même si aucune ligne de transaction n'existe (données reprises d'un
--     ancien système, jeu de démonstration, encaissement Mobile Money dont la
--     trace a été purgée) ;
--   • sinon, solde = total − somme des encaissements au statut « payé ».
create or replace view public.order_balances
with (security_invoker = true)
as
select
  o.id                                        as order_id,
  o.tenant_id,
  o.total_amount,
  case
    when o.payment_status = 'paid' then o.total_amount
    else coalesce(sum(pt.amount) filter (where pt.status = 'paid'), 0)
  end                                         as paid_amount,
  case
    when o.payment_status = 'paid' then 0
    else greatest(
      o.total_amount - coalesce(sum(pt.amount) filter (where pt.status = 'paid'), 0),
      0
    )
  end                                         as remaining_amount,
  o.payment_status,
  o.due_date,
  o.status
from public.orders o
left join public.payment_transactions pt on pt.order_id = o.id
group by o.id, o.tenant_id, o.total_amount, o.payment_status, o.due_date, o.status;

grant select on public.order_balances to authenticated;
