-- =============================================================================
-- 005_palier2_complement.sql — finitions du cœur ERP (V1.1)
-- =============================================================================
-- Complète la migration 004 avec les quatre mécanismes du palier 2 qui
-- manquaient encore :
--   1. attribution d'une commande à un employé (et non plus à « l'atelier ») ;
--   2. protection du prix des lignes : un artisan ne facture pas, un tarif
--      dérogatoire exige un motif et laisse une trace ;
--   3. réclamations et vêtements abîmés constatés à la réception, pendant le
--      traitement ou à la remise ;
--   4. remboursements, réservés au propriétaire, déduits de la caisse du jour.
--
-- Règle de conception commune : toute écriture sensible passe par un contrôle
-- côté base (`security definer`), jamais par la seule interface. L'interface
-- masque les boutons, la base refuse les requêtes forgées.
-- =============================================================================

-- =============================================================================
-- 1. ATTRIBUTION D'UNE COMMANDE À UN EMPLOYÉ
-- =============================================================================
alter table public.orders
  add column if not exists assigned_to uuid;

alter table public.orders
  drop constraint if exists orders_assigned_to_fk;
alter table public.orders
  add constraint orders_assigned_to_fk
  foreign key (assigned_to) references auth.users (id) on delete set null;

alter table public.orders
  add column if not exists assigned_at timestamptz;

-- Index partiel : la majorité des commandes ne sont pas attribuées, inutile de
-- les stocker dans l'index.
create index if not exists orders_assigned_idx
  on public.orders (tenant_id, assigned_to)
  where assigned_to is not null;

-- Nom affiché dans l'interface (le propriétaire, puis les comptes invités).
-- L'absence de nom n'est pas bloquante : l'interface retombe sur le rôle.
alter table public.tenant_users
  add column if not exists display_name text
    check (display_name is null or char_length(btrim(display_name)) between 1 and 80);

-- L'équipe doit pouvoir se voir pour s'attribuer des commandes.
-- ⚠ Ne PAS passer par `current_tenant_id()` ici : cette fonction interroge
-- `tenant_users` et la politique entrerait en récursion infinie. On lit
-- directement la revendication du jeton, comme le fait la fonction.
drop policy if exists tenant_users_select_tenant on public.tenant_users;
create policy tenant_users_select_tenant on public.tenant_users
  for select
  using (
    auth.uid() is not null
    and tenant_id = nullif(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')::uuid
  );

create or replace function public.guard_order_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  role_courant text := public.current_tenant_role();
begin
  -- Écriture serveur (migration, tâche planifiée) : rien à contrôler.
  if auth.uid() is null then
    return new;
  end if;

  if new.assigned_to is not distinct from old.assigned_to then
    return new;
  end if;

  -- Un artisan peut prendre une commande en charge, mais pas l'attribuer à
  -- quelqu'un d'autre (sinon il pourrait se défausser d'un travail abîmé).
  if role_courant = 'artisan' and new.assigned_to is distinct from auth.uid() then
    raise exception 'Un artisan ne peut prendre en charge que ses propres commandes.'
      using errcode = '42501';
  end if;

  -- L'employé désigné doit réellement travailler dans ce pressing : sans ce
  -- contrôle, un UUID d'un autre pressing suffirait à créer une référence
  -- orpheline visible dans les vues.
  if new.assigned_to is not null
     and not exists (
       select 1 from public.tenant_users
       where user_id = new.assigned_to
         and tenant_id = new.tenant_id
     )
  then
    raise exception 'Cet employé n''appartient pas à ce pressing.'
      using errcode = '22023';
  end if;

  new.assigned_at := now();
  return new;
end;
$$;

drop trigger if exists trg_orders_guard_assignment on public.orders;
create trigger trg_orders_guard_assignment
  before update of assigned_to on public.orders
  for each row execute function public.guard_order_assignment();

-- =============================================================================
-- 2. PRIX DES LIGNES — RÔLE HABILITÉ ET DÉROGATION MOTIVÉE
-- =============================================================================
-- `order_items.price` est le montant facturé. La politique d'origine
-- (`order_items_update_tenant`) laissait un artisan modifier ce prix : la
-- matrice de rôles du palier 1 est donc complétée ici, côté base.
drop policy if exists order_items_update_tenant on public.order_items;
create policy order_items_update_tenant on public.order_items
  for update to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() in ('owner', 'receptionist')
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() in ('owner', 'receptionist')
  );

alter table public.order_items
  add column if not exists price_reason text;

alter table public.order_items
  add column if not exists created_by uuid default auth.uid();

create or replace function public.guard_order_item_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  role_courant text := public.current_tenant_role();
  prix_catalogue integer;
begin
  if auth.uid() is null then
    return new;  -- tâche serveur : pas de rôle à contrôler
  end if;

  if role_courant not in ('owner', 'receptionist') then
    raise exception 'Votre rôle ne permet pas de modifier les prestations facturées.'
      using errcode = '42501';
  end if;

  -- Sur une modification, un prix inchangé (libellé, instructions…) n'exige
  -- évidemment aucun motif.
  if tg_op = 'UPDATE' and new.price is not distinct from old.price then
    return new;
  end if;

  -- Tarif dérogatoire : la ligne est rattachée au catalogue mais facturée à un
  -- autre prix (geste commercial, tache à repasser…). Le motif est exigé pour
  -- que la trace reste exploitable des mois plus tard.
  if new.catalog_entry_id is not null then
    select price into prix_catalogue
    from public.catalog_entries
    where id = new.catalog_entry_id and tenant_id = new.tenant_id;

    if prix_catalogue is not null and new.price <> prix_catalogue then
      if new.price_reason is null or char_length(btrim(new.price_reason)) < 10 then
        raise exception 'Un tarif dérogatoire exige un motif de 10 caractères minimum.'
          using errcode = '22023';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_order_items_guard_price on public.order_items;
create trigger trg_order_items_guard_price
  before insert or update on public.order_items
  for each row execute function public.guard_order_item_price();

-- Journal des changements de prix : qui, quand, de combien à combien, pourquoi.
-- Sans lui, une facture corrigée après coup ne laisserait aucune trace côté
-- serveur (le client hors ligne réécrit simplement la ligne).
create table if not exists public.order_price_history (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete cascade,
  order_id      uuid not null,
  order_item_id uuid not null,
  previous_price integer not null,
  new_price      integer not null,
  reason         text,
  changed_by     uuid references auth.users (id) on delete set null,
  changed_at     timestamptz not null default now(),

  constraint order_price_history_order_fk
    foreign key (order_id, tenant_id) references public.orders (id, tenant_id) on delete cascade
);

alter table public.order_price_history enable row level security;

drop policy if exists price_history_select_tenant on public.order_price_history;
create policy price_history_select_tenant on public.order_price_history
  for select
  using (tenant_id = public.current_tenant_id());

grant select on public.order_price_history to authenticated;

create or replace function public.log_order_item_price_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.price is distinct from old.price then
    insert into public.order_price_history
      (tenant_id, order_id, order_item_id, previous_price, new_price, reason, changed_by)
    values
      (new.tenant_id, new.order_id, new.id, old.price, new.price, new.price_reason, auth.uid());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_order_items_price_history on public.order_items;
create trigger trg_order_items_price_history
  after update on public.order_items
  for each row execute function public.log_order_item_price_change();

-- =============================================================================
-- 3. RÉCLAMATIONS ET VÊTEMENTS ABÎMÉS
-- =============================================================================
-- Un vêtement taché ou déchiré est constaté **au moment de la réception**, sous
-- les yeux du client : c'est la seule façon d'éviter le litige à la remise.
-- Le même mécanisme sert pendant le traitement (tache apparue au lavage) et à
-- la livraison (bouton manquant).
alter table public.order_items
  drop constraint if exists order_items_id_tenant_unique;
alter table public.order_items
  add constraint order_items_id_tenant_unique unique (id, tenant_id);

create table if not exists public.order_issues (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  order_id        uuid not null,
  order_item_id   uuid,

  kind            text not null
                    check (kind in ('stained', 'torn', 'discoloured', 'missing', 'other')),
  severity        text not null default 'minor'
                    check (severity in ('minor', 'major')),
  stage           text not null default 'reception'
                    check (stage in ('reception', 'treatment', 'delivery')),
  description     text not null
                    check (char_length(btrim(description)) between 5 and 500),

  reported_by     uuid default auth.uid() references auth.users (id) on delete set null,
  resolution      text check (resolution is null or resolution in ('repaired', 'compensated', 'rejected')),
  resolution_note text,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),

  constraint order_issues_order_fk
    foreign key (order_id, tenant_id) references public.orders (id, tenant_id) on delete cascade,

  -- FK composite : une réclamation ne peut pas désigner la ligne d'un autre
  -- pressing, même en forgeant la requête.
  -- `on delete set null (order_item_id)` : seule la référence à la ligne est
  -- effacée, `tenant_id` reste indispensable à la politique RLS.
  constraint order_issues_item_fk
    foreign key (order_item_id, tenant_id) references public.order_items (id, tenant_id)
    on delete set null (order_item_id)
);

create index if not exists order_issues_order_idx
  on public.order_issues (order_id, created_at desc);

alter table public.order_issues enable row level security;

drop policy if exists order_issues_select_tenant on public.order_issues;
create policy order_issues_select_tenant on public.order_issues
  for select
  using (tenant_id = public.current_tenant_id());

-- L'atelier peut déclarer un dommage constaté pendant le traitement.
drop policy if exists order_issues_insert_staff on public.order_issues;
create policy order_issues_insert_staff on public.order_issues
  for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() in ('owner', 'receptionist', 'artisan')
  );

drop policy if exists order_issues_resolve_counter on public.order_issues;
create policy order_issues_resolve_counter on public.order_issues
  for update to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() in ('owner', 'receptionist')
  )
  with check (tenant_id = public.current_tenant_id());

drop policy if exists order_issues_delete_owner on public.order_issues;
create policy order_issues_delete_owner on public.order_issues
  for delete to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  );

grant select, insert, update, delete on public.order_issues to authenticated;

-- L'auteur d'une réclamation ne se déclare pas : il est déduit du jeton.
create or replace function public.stamp_issue_author()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    new.reported_by := auth.uid();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_order_issues_author on public.order_issues;
create trigger trg_order_issues_author
  before insert on public.order_issues
  for each row execute function public.stamp_issue_author();

create or replace function public.stamp_issue_resolution()
returns trigger
language plpgsql
as $$
begin
  if new.resolution is null then
    new.resolved_at := null;
  elsif new.resolution is distinct from old.resolution or new.resolved_at is null then
    new.resolved_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_order_issues_resolution on public.order_issues;
create trigger trg_order_issues_resolution
  before update on public.order_issues
  for each row execute function public.stamp_issue_resolution();

-- =============================================================================
-- 4. REMBOURSEMENTS
-- =============================================================================
create table if not exists public.payment_refunds (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  order_id    uuid not null,
  payment_id  uuid references public.payment_transactions (id) on delete set null,

  amount      integer not null check (amount > 0),
  channel     text not null default 'cash' check (channel in ('cash', 'mobile_money')),
  reason      text not null check (char_length(btrim(reason)) >= 10),
  refunded_by uuid default auth.uid() references auth.users (id) on delete set null,
  refunded_at timestamptz not null default now(),

  constraint payment_refunds_order_fk
    foreign key (order_id, tenant_id) references public.orders (id, tenant_id) on delete cascade
);

create index if not exists payment_refunds_order_idx
  on public.payment_refunds (order_id, refunded_at desc);

alter table public.payment_refunds enable row level security;

drop policy if exists payment_refunds_select_tenant on public.payment_refunds;
create policy payment_refunds_select_tenant on public.payment_refunds
  for select
  using (tenant_id = public.current_tenant_id());

-- Aucune politique d'écriture : un remboursement ne s'insère que par la
-- fonction ci-dessous, qui vérifie le rôle et plafonne le montant. Une simple
-- politique RLS ne pourrait pas connaître les encaissements déjà remboursés.
grant select on public.payment_refunds to authenticated;

create or replace function public.record_refund(
  p_order_id uuid,
  p_amount integer,
  p_reason text,
  p_channel text default 'cash'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant    uuid := public.current_tenant_id();
  v_role      text := public.current_tenant_role();
  v_commande  public.orders%rowtype;
  v_encaisse  integer;
  v_deja      integer;
  v_net       integer;
  v_id        uuid;
begin
  if v_tenant is null then
    raise exception 'Aucun pressing associé à ce compte.' using errcode = '42501';
  end if;

  -- Le remboursement sort de l'argent : propriétaire uniquement, même si le
  -- réceptionniste tient la caisse au quotidien.
  if v_role is distinct from 'owner' then
    raise exception 'Seul le propriétaire peut enregistrer un remboursement.'
      using errcode = '42501';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Le montant remboursé doit être positif.' using errcode = '22023';
  end if;

  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'Un remboursement exige un motif de 10 caractères minimum.'
      using errcode = '22023';
  end if;

  if p_channel is null or p_channel not in ('cash', 'mobile_money') then
    raise exception 'Moyen de remboursement inconnu.' using errcode = '22023';
  end if;

  select * into v_commande
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Commande introuvable.' using errcode = 'P0002';
  end if;

  if v_commande.tenant_id is distinct from v_tenant then
    raise exception 'Cette commande appartient à un autre pressing.' using errcode = '42501';
  end if;

  if v_commande.payment_status = 'paid' then
    v_encaisse := v_commande.total_amount;
  else
    select coalesce(sum(amount), 0) into v_encaisse
    from public.payment_transactions
    where order_id = p_order_id and status = 'paid';
  end if;

  select coalesce(sum(amount), 0) into v_deja
  from public.payment_refunds
  where order_id = p_order_id;

  v_net := greatest(v_encaisse - v_deja, 0);

  if p_amount > v_net then
    raise exception 'Le remboursement dépasse les encaissements nets (% FCFA).', v_net
      using errcode = '22023';
  end if;

  insert into public.payment_refunds
    (tenant_id, order_id, amount, channel, reason, refunded_by)
  values
    (v_tenant, p_order_id, p_amount, p_channel, btrim(p_reason), auth.uid())
  returning id into v_id;

  return jsonb_build_object(
    'refund_id', v_id,
    'refunded_total', v_deja + p_amount,
    'refundable_amount', v_net - p_amount
  );
end;
$$;

revoke all on function public.record_refund(uuid, integer, text, text) from public;
grant execute on function public.record_refund(uuid, integer, text, text) to authenticated;

-- =============================================================================
-- 5. CLÔTURE DE CAISSE : LES REMBOURSEMENTS SORTENT DU TIROIR
-- =============================================================================
alter table public.cash_sessions
  add column if not exists refunded_total integer not null default 0
    check (refunded_total >= 0);

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
  v_encaisse integer;
  v_rembourse integer;
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

  select coalesce(sum(amount), 0) into v_encaisse
  from   public.payment_transactions
  where  tenant_id = v_tenant
    and  status = 'paid'
    and  provider = 'cash'
    and  (paid_at at time zone 'Africa/Abidjan')::date = p_business_date;

  -- Un remboursement en espèces vide le tiroir : il doit apparaître en moins
  -- dans le montant attendu, sinon le caissier est faussement accusé d'un
  -- manque à l'encaissement.
  select coalesce(sum(amount), 0) into v_rembourse
  from   public.payment_refunds
  where  tenant_id = v_tenant
    and  channel = 'cash'
    and  (refunded_at at time zone 'Africa/Abidjan')::date = p_business_date;

  v_attendu := greatest(v_encaisse - v_rembourse, 0);

  insert into public.cash_sessions
    (tenant_id, business_date, expected_total, declared_total, difference,
     refunded_total, notes, closed_by, closed_at)
  values
    (v_tenant, p_business_date, v_attendu, p_declared_total,
     p_declared_total - v_attendu, v_rembourse, nullif(trim(p_notes), ''), auth.uid(), now())
  on conflict (tenant_id, business_date) do update
    set expected_total = excluded.expected_total,
        declared_total = excluded.declared_total,
        difference     = excluded.difference,
        refunded_total = excluded.refunded_total,
        notes          = excluded.notes,
        closed_by      = excluded.closed_by,
        closed_at      = excluded.closed_at
  returning * into v_session;

  update public.payment_transactions
  set    cash_session_id = v_session.id
  where  tenant_id = v_tenant
    and  status = 'paid'
    and  provider = 'cash'
    and  (paid_at at time zone 'Africa/Abidjan')::date = p_business_date;

  return v_session;
end;
$$;

-- =============================================================================
-- 6. MOTIF D'UNE TRANSITION DE STATUT
-- =============================================================================
-- `order_status_history.reason` existait depuis la phase 1 mais restait vide :
-- le déclencheur n'avait aucun moyen de connaître l'intention du client.
-- `orders.status_reason` sert de **transport** : le poste l'envoie avec la mise
-- à jour, le déclencheur le recopie dans l'historique puis l'efface. La colonne
-- reste donc nulle en base, elle ne décrit pas un état mais un événement.
alter table public.orders
  add column if not exists status_reason text
    check (status_reason is null or char_length(status_reason) <= 500);

-- Le déclencheur historique était `after update` : il ne pouvait ni lire un
-- motif transporté ni l'effacer. Il est reconstruit en `before update`, ce qui
-- permet de journaliser l'événement et de nettoyer le transport dans le même
-- passage.
drop trigger if exists trg_orders_status_history on public.orders;

create or replace function public.log_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.order_status_history
      (order_id, tenant_id, status, previous_status, reason, changed_by)
    values
      (new.id, new.tenant_id, new.status, old.status,
       nullif(btrim(new.status_reason), ''), auth.uid());

    -- Le motif ne doit pas rester collé à la commande : il appartient à
    -- l'événement, pas à l'état courant.
    new.status_reason := null;
  elsif new.status_reason is not null then
    -- Colonne de transport : sans changement de statut, elle n'a rien à dire.
    new.status_reason := null;
  end if;

  return new;
end;
$$;

create trigger trg_orders_status_history
  before update of status on public.orders
  for each row execute function public.log_order_status_change();

-- =============================================================================
-- 7. SOLDES — LE REMBOURSEMENT EST UNE SORTIE, PAS UNE DETTE DU CLIENT
-- =============================================================================
-- `paid_amount` reste l'encaissement brut : c'est lui qui décide du « reste à
-- payer » affiché au comptoir. Le remboursement est exposé séparément
-- (`net_paid_amount`, `refundable_amount`) pour ne pas transformer un geste
-- commercial en facture impayée.
create or replace view public.order_balances
with (security_invoker = true)
as
with encaissements as (
  select order_id,
         coalesce(sum(amount) filter (where status = 'paid'), 0) as montant
  from   public.payment_transactions
  group  by order_id
),
remboursements as (
  select order_id, coalesce(sum(amount), 0) as montant
  from   public.payment_refunds
  group  by order_id
)
select
  o.id                                        as order_id,
  o.tenant_id,
  o.total_amount,
  case
    when o.payment_status = 'paid' then o.total_amount
    else coalesce(e.montant, 0)
  end                                         as paid_amount,
  greatest(
    o.total_amount - case
      when o.payment_status = 'paid' then o.total_amount
      else coalesce(e.montant, 0)
    end,
    0
  )                                           as remaining_amount,
  o.payment_status,
  o.due_date,
  o.status,
  coalesce(r.montant, 0)                      as refunded_amount,
  greatest(
    (case when o.payment_status = 'paid' then o.total_amount else coalesce(e.montant, 0) end)
    - coalesce(r.montant, 0),
    0
  )                                           as net_paid_amount,
  greatest(
    (case when o.payment_status = 'paid' then o.total_amount else coalesce(e.montant, 0) end)
    - coalesce(r.montant, 0),
    0
  )                                           as refundable_amount
from public.orders o
left join encaissements e on e.order_id = o.id
left join remboursements r on r.order_id = o.id;

grant select on public.order_balances to authenticated;
