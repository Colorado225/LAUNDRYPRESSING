-- =============================================================================
-- 001_init.sql — Schéma initial multi-tenant « Pressing Pro »
-- =============================================================================
-- Cible : Supabase / PostgreSQL 15+
--
-- Principes de sécurité :
--  1. TOUTES les tables métier portent un `tenant_id NOT NULL`.
--  2. L'isolation repose sur la RLS PostgreSQL, jamais sur le frontend.
--  3. Le tenant courant est lu depuis le JWT (`app_metadata.tenant_id`) via la
--     fonction `current_tenant_id()`. On évite ainsi la sous-requête
--     `(select tenant_id from tenant_users ...)` qui échoue dès qu'un
--     utilisateur appartient à deux pressings.
--  4. Les politiques sont explicites (`using` + `with check`).
--
-- ⚠ La clé `service_role` contourne la RLS : elle ne doit être utilisée que
--   par les Edge Functions (webhook CinetPay, invitations).
-- =============================================================================

-- Extension nécessaire à gen_random_uuid()
create extension if not exists "pgcrypto";

-- =============================================================================
-- 1. TABLES
-- =============================================================================

-- Pressings (tenants)
create table if not exists public.tenants (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text,
  created_at  timestamptz not null default now()
);

-- Utilisateurs rattachés à un pressing
create table if not exists public.tenant_users (
  user_id    uuid not null references auth.users (id) on delete cascade,
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  role       text not null check (role in ('owner', 'receptionist', 'artisan')),
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

-- Commandes
create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) on delete cascade,
  customer_name     text not null check (length(trim(customer_name)) > 0),
  customer_phone    text not null check (length(trim(customer_phone)) > 0),
  status            text not null default 'received'
                      check (status in ('received', 'washing', 'ironing', 'ready', 'delivered', 'cancelled')),
  qr_code           text not null,
  photo_url         text,
  total_amount      integer not null check (total_amount >= 0), -- en FCFA, entier
  payment_status    text not null default 'pending'
                      check (payment_status in ('pending', 'paid', 'partial')),
  payment_method    text
                      check (payment_method in ('wave', 'orange_money', 'mtn_momo', 'moov_money', 'cash')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  synced_from_local boolean not null default false,

  -- Le code QR doit être unique DANS un pressing (pas globalement : deux
  -- pressings peuvent générer la même chaîne à la même milliseconde).
  constraint orders_qr_code_tenant_unique unique (tenant_id, qr_code),
  -- Requis par la clé étrangère composite des tables filles.
  constraint orders_id_tenant_unique unique (id, tenant_id)
);

-- Lignes de commande (un vêtement)
create table if not exists public.order_items (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null,
  tenant_id            uuid not null references public.tenants (id) on delete cascade,
  label                text not null check (length(trim(label)) > 0), -- ex. « Costume 3 pièces »
  fabric_type          text,                                          -- ex. « Basin », « Wax »
  special_instructions text,                                          -- ex. « Empèsage fort », « Broderie fragile »
  price                integer not null check (price >= 0),           -- en FCFA, entier

  -- FK composite : garantit qu'une ligne ne peut pas pointer vers une
  -- commande d'un autre pressing (corrige la faille d'isolation de la v1).
  constraint order_items_order_tenant_fk
    foreign key (order_id, tenant_id) references public.orders (id, tenant_id) on delete cascade
);

-- Historique des changements de statut
create table if not exists public.order_status_history (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null,
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  status     text not null
               check (status in ('received', 'washing', 'ironing', 'ready', 'delivered', 'cancelled')),
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now(),

  constraint order_status_history_order_tenant_fk
    foreign key (order_id, tenant_id) references public.orders (id, tenant_id) on delete cascade
);

-- =============================================================================
-- 2. INDEX
-- =============================================================================
create index if not exists idx_orders_tenant_created   on public.orders (tenant_id, created_at desc);
create index if not exists idx_orders_tenant_status    on public.orders (tenant_id, status);
create index if not exists idx_orders_qr_code          on public.orders (qr_code);
create index if not exists idx_order_items_order       on public.order_items (order_id);
create index if not exists idx_order_items_tenant      on public.order_items (tenant_id);
create index if not exists idx_history_order           on public.order_status_history (order_id, changed_at desc);
create index if not exists idx_history_tenant          on public.order_status_history (tenant_id);
create index if not exists idx_tenant_users_tenant     on public.tenant_users (tenant_id);

-- =============================================================================
-- 3. FONCTIONS UTILITAIRES
-- =============================================================================

-- Tenant courant.
--  1. Priorité au JWT (`app_metadata.tenant_id`) : c'est la source officielle,
--     définie à la création de l'utilisateur (voir README, section « Provisionner
--     un utilisateur »).
--  2. Repli sur la table `tenant_users` : indispensable en développement, tant
--     que les claims personnalisés ne sont pas encore posés. Le `limit 1` évite
--     l'erreur « more than one row returned by a subquery » de la v1.
--     (MVP : un utilisateur = un pressing. Le multi-pressing est en V2.)
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')::uuid),
    (select tu.tenant_id
       from public.tenant_users tu
      where tu.user_id = auth.uid()
      order by tu.created_at
      limit 1)
  );
$$;

-- Rôle courant : JWT en priorité, sinon lecture dans `tenant_users`.
create or replace function public.current_tenant_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(auth.jwt() -> 'app_metadata' ->> 'tenant_role', '')),
    (select tu.role
       from public.tenant_users tu
      where tu.user_id = auth.uid()
        and tu.tenant_id = public.current_tenant_id()
      limit 1)
  );
$$;

-- Maintien automatique de orders.updated_at
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
  before update on public.orders
  for each row
  execute function public.update_updated_at_column();

-- Journalisation automatique des changements de statut.
-- `security definer` : le trigger doit écrire même si la politique d'insertion
-- de l'utilisateur est plus restrictive que la mise à jour elle-même.
create or replace function public.log_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    insert into public.order_status_history (order_id, tenant_id, status, changed_by)
    values (new.id, new.tenant_id, new.status, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_status_history on public.orders;
create trigger trg_orders_status_history
  after update of status on public.orders
  for each row
  execute function public.log_order_status_change();

-- =============================================================================
-- 4. ACTIVATION DE LA RLS
-- =============================================================================
alter table public.tenants              enable row level security;
alter table public.tenant_users         enable row level security;
alter table public.orders               enable row level security;
alter table public.order_items          enable row level security;
alter table public.order_status_history enable row level security;

-- =============================================================================
-- 5. POLITIQUES RLS
-- =============================================================================

-- ---- tenants ---------------------------------------------------------------
-- Tout membre voit son pressing.
drop policy if exists tenants_select_members on public.tenants;
create policy tenants_select_members on public.tenants
  for select to authenticated
  using (
    id = public.current_tenant_id()
    or id in (select tu.tenant_id from public.tenant_users tu where tu.user_id = auth.uid())
  );

-- Seul le propriétaire peut renommer / mettre à jour son pressing.
drop policy if exists tenants_update_owner on public.tenants;
create policy tenants_update_owner on public.tenants
  for update to authenticated
  using (id = public.current_tenant_id() and public.current_tenant_role() = 'owner')
  with check (id = public.current_tenant_id() and public.current_tenant_role() = 'owner');

-- La création d'un pressing passe par le back-office (service_role) :
-- aucune politique d'insertion n'est ouverte aux utilisateurs authentifiés.

-- ---- tenant_users ----------------------------------------------------------
-- Lecture seule pour l'utilisateur : il ne voit que SON rattachement.
-- (L'ancienne politique `for all using (user_id = auth.uid())` permettait à
--  n'importe qui de s'auto-inscrire comme « owner » d'un pressing tiers.)
drop policy if exists tenant_users_select_self on public.tenant_users;
create policy tenant_users_select_self on public.tenant_users
  for select to authenticated
  using (user_id = auth.uid());

-- Les invitations et changements de rôle sont gérés côté serveur (service_role).

-- ---- orders ----------------------------------------------------------------
drop policy if exists orders_select_tenant on public.orders;
create policy orders_select_tenant on public.orders
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists orders_insert_tenant on public.orders;
create policy orders_insert_tenant on public.orders
  for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() in ('owner', 'receptionist')
  );

drop policy if exists orders_update_tenant on public.orders;
create policy orders_update_tenant on public.orders
  for update to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() in ('owner', 'receptionist', 'artisan')
  );

-- Pas de suppression physique : une commande annulée passe en statut 'cancelled'.
drop policy if exists orders_delete_owner on public.orders;
create policy orders_delete_owner on public.orders
  for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner');

-- ---- order_items -----------------------------------------------------------
drop policy if exists order_items_select_tenant on public.order_items;
create policy order_items_select_tenant on public.order_items
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists order_items_write_tenant on public.order_items;
create policy order_items_write_tenant on public.order_items
  for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() in ('owner', 'receptionist')
  );

drop policy if exists order_items_update_tenant on public.order_items;
create policy order_items_update_tenant on public.order_items
  for update to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

drop policy if exists order_items_delete_tenant on public.order_items;
create policy order_items_delete_tenant on public.order_items
  for delete to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() in ('owner', 'receptionist')
  );

-- ---- order_status_history --------------------------------------------------
-- Lecture seule côté client : l'écriture est faite par le trigger
-- `log_order_status_change()` (security definer).
drop policy if exists history_select_tenant on public.order_status_history;
create policy history_select_tenant on public.order_status_history
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

-- =============================================================================
-- 6. DROITS
-- =============================================================================
-- On révoque l'accès des anonymes et on laisse la RLS filtrer pour `authenticated`.
revoke all on public.tenants, public.tenant_users, public.orders,
  public.order_items, public.order_status_history from anon;

grant select, insert, update, delete on public.orders to authenticated;
grant select, insert, update, delete on public.order_items to authenticated;
grant select on public.order_status_history to authenticated;
grant select, update on public.tenants to authenticated;
grant select on public.tenant_users to authenticated;

-- =============================================================================
-- 7. TEMPS RÉEL (optionnel, utile pour l'atelier multi-postes)
-- =============================================================================
-- alter publication supabase_realtime add table public.orders;
