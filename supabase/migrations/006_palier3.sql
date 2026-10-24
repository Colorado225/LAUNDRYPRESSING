-- =============================================================================
-- 006_palier3.sql — clients, stocks, fournisseurs, dépenses (V1.2)
-- =============================================================================
-- Trois modules :
--   1. **Clients** — une fiche par numéro de téléphone, alimentée
--      automatiquement par les commandes (`trigger`), avec l'historique.
--   2. **Stocks** — articles consommables, mouvements d'entrée/sortie et
--      fournisseurs ; la quantité est tenue par le serveur, jamais par le
--      client.
--   3. **Dépenses** — sorties d'argent du pressing, réservées au propriétaire.
--
-- ⚠ Décision d'architecture : ces modules de **gestion** fonctionnent en ligne
--   (bureau), contrairement au comptoir qui reste hors ligne. Les rendre
--   entièrement hors ligne demanderait une seconde file de synchronisation sans
--   bénéfice opérationnel : un inventaire ou une dépense ne se saisit pas en
--   plein service. L'historique client, lui, reste consultable hors ligne car
--   il est dérivé des commandes déjà présentes sur la tablette.
-- =============================================================================

-- =============================================================================
-- 1. CLIENTS
-- =============================================================================
create table if not exists public.customers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 120),
  phone      text not null check (char_length(btrim(phone)) between 6 and 30),
  email      text check (email is null or char_length(email) <= 160),
  address    text check (address is null or char_length(address) <= 300),
  notes      text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Un même numéro ne peut désigner qu'un client par pressing. Le téléphone
  -- normalisé (`customer_phone_key`) sert de clé : sans lui, « 07 00 00 00 10 »
  -- et « +2250700000010 » créeraient deux fiches.
  phone_key  text not null,
  constraint customers_phone_unique unique (tenant_id, phone_key),
  constraint customers_id_tenant_unique unique (id, tenant_id)
);

create index if not exists customers_name_idx
  on public.customers (tenant_id, name);

alter table public.customers enable row level security;

drop policy if exists customers_select_tenant on public.customers;
create policy customers_select_tenant on public.customers
  for select
  using (tenant_id = public.current_tenant_id());

-- Le comptoir enrichit la fiche (adresse, préférences) ; le propriétaire aussi.
drop policy if exists customers_update_counter on public.customers;
create policy customers_update_counter on public.customers
  for update to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() in ('owner', 'receptionist')
  )
  with check (tenant_id = public.current_tenant_id());

-- Aucune politique d'insertion ni de suppression : la fiche naît d'une
-- commande (déclencheur ci-dessous) et ne disparaît pas tant que l'historique
-- existe.

grant select, update on public.customers to authenticated;

alter table public.orders
  add column if not exists customer_id uuid;

alter table public.orders
  drop constraint if exists orders_customer_fk;
alter table public.orders
  add constraint orders_customer_fk
  foreign key (customer_id, tenant_id)
  references public.customers (id, tenant_id)
  on delete set null (customer_id);

create index if not exists orders_customer_idx
  on public.orders (tenant_id, customer_id);

/**
 * Normalise un numéro ivoirien pour servir de clé de rapprochement.
 * On ne valide pas le format (les clients dictent parfois un numéro fixe) :
 * on ne garde que les chiffres, sans indicatif pays.
 */
create or replace function public.normalize_phone(p_phone text)
returns text
language sql
immutable
as $$
  select case
    when p_phone is null then ''
    when regexp_replace(p_phone, '\D', '', 'g') like '225%'
      and char_length(regexp_replace(p_phone, '\D', '', 'g')) > 10
      then substring(regexp_replace(p_phone, '\D', '', 'g') from 4)
    else regexp_replace(p_phone, '\D', '', 'g')
  end;
$$;

/**
 * Rattache chaque commande à une fiche client.
 *
 * `security definer` : le déclencheur écrit dans `customers` alors que
 * l'utilisateur n'a pas de droit d'insertion (la fiche naît de la commande).
 */
create or replace function public.attach_customer_to_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := public.normalize_phone(new.customer_phone);
  v_id  uuid;
begin
  if v_key = '' then
    return new;
  end if;

  select id into v_id
  from   public.customers
  where  tenant_id = new.tenant_id
    and  phone_key = v_key;

  if v_id is null then
    insert into public.customers (tenant_id, name, phone, phone_key)
    values (new.tenant_id, btrim(new.customer_name), btrim(new.customer_phone), v_key)
    on conflict (tenant_id, phone_key) do update
      set name = excluded.name
    returning id into v_id;
  else
    -- Le nom le plus récent fait foi : le client a pu corriger une faute.
    update public.customers
    set    name = btrim(new.customer_name),
           updated_at = now()
    where  id = v_id
      and  name is distinct from btrim(new.customer_name);
  end if;

  new.customer_id := v_id;
  return new;
end;
$$;

drop trigger if exists trg_orders_attach_customer on public.orders;
create trigger trg_orders_attach_customer
  before insert or update of customer_name, customer_phone on public.orders
  for each row execute function public.attach_customer_to_order();

-- Reprise des commandes existantes : chaque numéro connu devient une fiche.
-- Rejouable sans effet de bord (ON CONFLICT).
insert into public.customers (tenant_id, name, phone, phone_key)
select distinct on (o.tenant_id, public.normalize_phone(o.customer_phone))
       o.tenant_id,
       btrim(o.customer_name),
       btrim(o.customer_phone),
       public.normalize_phone(o.customer_phone)
from   public.orders o
where  public.normalize_phone(o.customer_phone) <> ''
order  by o.tenant_id, public.normalize_phone(o.customer_phone), o.created_at desc
on conflict (tenant_id, phone_key) do nothing;

update public.orders o
set    customer_id = c.id
from   public.customers c
where  o.tenant_id = c.tenant_id
  and  c.phone_key = public.normalize_phone(o.customer_phone)
  and  o.customer_id is null;

-- =============================================================================
-- 2. FOURNISSEURS ET STOCKS
-- =============================================================================
create table if not exists public.suppliers (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 2 and 120),
  phone      text check (phone is null or char_length(phone) <= 30),
  notes      text check (notes is null or char_length(notes) <= 500),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suppliers_name_unique unique (tenant_id, name),
  constraint suppliers_id_tenant_unique unique (id, tenant_id)
);

alter table public.suppliers enable row level security;

drop policy if exists suppliers_select_tenant on public.suppliers;
create policy suppliers_select_tenant on public.suppliers
  for select
  using (tenant_id = public.current_tenant_id());

drop policy if exists suppliers_write_owner on public.suppliers;
create policy suppliers_write_owner on public.suppliers
  for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  );

grant select, insert, update, delete on public.suppliers to authenticated;

create table if not exists public.stock_items (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 2 and 120),
  category     text not null default 'autre'
                 check (category in ('produit', 'emballage', 'consommable', 'autre')),
  unit         text not null default 'pièce'
                 check (unit in ('pièce', 'litre', 'kg', 'flacon', 'rouleau')),
  quantity     numeric(10, 2) not null default 0,
  min_quantity numeric(10, 2) not null default 0 check (min_quantity >= 0),
  unit_cost    integer check (unit_cost is null or unit_cost >= 0),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint stock_items_name_unique unique (tenant_id, name),
  constraint stock_items_id_tenant_unique unique (id, tenant_id)
);

alter table public.stock_items enable row level security;

drop policy if exists stock_items_select_tenant on public.stock_items;
create policy stock_items_select_tenant on public.stock_items
  for select
  using (tenant_id = public.current_tenant_id());

drop policy if exists stock_items_write_owner on public.stock_items;
create policy stock_items_write_owner on public.stock_items
  for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  );

grant select, insert, update, delete on public.stock_items to authenticated;

create table if not exists public.stock_movements (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  item_id     uuid not null,
  kind        text not null check (kind in ('in', 'out')),
  quantity    numeric(10, 2) not null check (quantity > 0),
  unit_cost   integer check (unit_cost is null or unit_cost >= 0),
  supplier_id uuid,
  reason      text check (reason is null or char_length(reason) <= 300),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),

  constraint stock_movements_item_fk
    foreign key (item_id, tenant_id) references public.stock_items (id, tenant_id)
    on delete cascade,
  constraint stock_movements_supplier_fk
    foreign key (supplier_id, tenant_id) references public.suppliers (id, tenant_id)
    on delete set null (supplier_id)
);

create index if not exists stock_movements_item_idx
  on public.stock_movements (tenant_id, item_id, created_at desc);

alter table public.stock_movements enable row level security;

drop policy if exists stock_movements_select_tenant on public.stock_movements;
create policy stock_movements_select_tenant on public.stock_movements
  for select
  using (tenant_id = public.current_tenant_id());

-- Le comptoir enregistre les sorties du quotidien (lessive, cintres) ; la
-- création d'articles reste au propriétaire (politique ci-dessus).
drop policy if exists stock_movements_insert_counter on public.stock_movements;
create policy stock_movements_insert_counter on public.stock_movements
  for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() in ('owner', 'receptionist')
  );

-- Ni modification ni suppression : le journal des mouvements est définitif.
grant select, insert on public.stock_movements to authenticated;

/**
 * Tient la quantité de l'article à jour.
 *
 * Le stock est un **grand livre** : la quantité n'est jamais écrite par le
 * client, elle est la somme des mouvements. Une sortie supérieure au stock est
 * refusée, ce qui évite un inventaire négatif impossible à expliquer.
 */
create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quantite numeric(10, 2);
begin
  select quantity into v_quantite
  from   public.stock_items
  where  id = new.item_id
    and  tenant_id = new.tenant_id
  for update;

  if not found then
    raise exception 'Article de stock introuvable.' using errcode = 'P0002';
  end if;

  if new.kind = 'out' and v_quantite < new.quantity then
    raise exception 'Stock insuffisant : % en stock, % demandé(s).', v_quantite, new.quantity
      using errcode = '22023';
  end if;

  update public.stock_items
  set    quantity = case when new.kind = 'in'
                         then quantity + new.quantity
                         else quantity - new.quantity
                    end,
         unit_cost = coalesce(new.unit_cost, unit_cost),
         updated_at = now()
  where  id = new.item_id
    and  tenant_id = new.tenant_id;

  return new;
end;
$$;

drop trigger if exists trg_stock_movements_apply on public.stock_movements;
create trigger trg_stock_movements_apply
  after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

-- =============================================================================
-- 3. DÉPENSES
-- =============================================================================
create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  label       text not null check (char_length(btrim(label)) between 2 and 120),
  category    text not null default 'autre'
                check (category in ('fournitures', 'loyer', 'salaire',
                                    'eau_electricite', 'transport', 'autre')),
  amount      integer not null check (amount > 0),
  spent_on    date not null default (now() at time zone 'Africa/Abidjan')::date,
  supplier_id uuid,
  note        text check (note is null or char_length(note) <= 500),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),

  constraint expenses_supplier_fk
    foreign key (supplier_id, tenant_id) references public.suppliers (id, tenant_id)
    on delete set null (supplier_id)
);

create index if not exists expenses_date_idx
  on public.expenses (tenant_id, spent_on desc);

alter table public.expenses enable row level security;

-- Les dépenses sont la seule vue où le propriétaire est seul : ni le
-- réceptionniste ni l'atelier n'ont à connaître la trésorerie du pressing.
drop policy if exists expenses_owner_only on public.expenses;
create policy expenses_owner_only on public.expenses
  for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  );

grant select, insert, update, delete on public.expenses to authenticated;

-- =============================================================================
-- 4. VUE DE SYNTHÈSE POUR LE TABLEAU DE BORD
-- =============================================================================
-- Le tableau de bord calcule l'essentiel sur la tablette (commandes, encours,
-- retards). Cette vue ne sert qu'aux agrégats de trésorerie, qui dépendent des
-- dépenses — donc du serveur.
create or replace view public.expense_totals
with (security_invoker = true)
as
select
  tenant_id,
  date_trunc('month', spent_on)::date as month,
  category,
  sum(amount)::integer                 as total_amount,
  count(*)::integer                    as entries
from public.expenses
group by tenant_id, date_trunc('month', spent_on)::date, category;

grant select on public.expense_totals to authenticated;
