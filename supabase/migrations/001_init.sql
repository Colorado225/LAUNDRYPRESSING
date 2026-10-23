-- Migration 001_init.sql — Schéma initial multi-tenant LAUNDRYPRESSING MVP

-- 1. Tenants (pressings)
create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  created_at timestamptz default now()
);

-- 2. Utilisateurs liés à un tenant
create table tenant_users (
  user_id uuid references auth.users(id) on delete cascade,
  tenant_id uuid references tenants(id) on delete cascade,
  role text check (role in ('owner','receptionist','artisan')) not null,
  primary key (user_id, tenant_id)
);

-- 3. Commandes
create table orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) not null,
  customer_name text not null,
  customer_phone text not null,
  status text check (status in ('received','washing','ironing','ready','delivered','cancelled')) default 'received',
  qr_code text unique not null,
  photo_url text,
  total_amount integer not null, -- en FCFA
  payment_status text check (payment_status in ('pending','paid','partial')) default 'pending',
  payment_method text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  synced_from_local boolean default false
);

-- 4. Lignes de commande (un vêtement)
create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  tenant_id uuid references tenants(id) not null,
  label text not null,             -- ex: "Costume 3 pièces"
  fabric_type text,                -- ex: "Basin", "Wax"
  special_instructions text,       -- ex: "Empesage fort", "Broderie fragile"
  price integer not null           -- en FCFA
);

-- 5. Historique des statuts
create table order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  tenant_id uuid references tenants(id) not null,
  status text not null,
  changed_by uuid references auth.users(id),
  changed_at timestamptz default now()
);

-- 6. Index pour la performance et le sync offline
create index idx_orders_tenant_id on orders(tenant_id);
create index idx_orders_status on orders(status);
create index idx_orders_synced on orders(synced_from_local);
create index idx_order_items_order_id on order_items(order_id);
create index idx_order_items_tenant_id on order_items(tenant_id);
create index idx_order_status_history_order_id on order_status_history(order_id);

-- 7. RLS — Isolation multi-tenant (Row-Level Security)
alter table tenants enable row level security;
alter table tenant_users enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_status_history enable row level security;

-- Politique tenants : un utilisateur ne voit que ses propres tenants
create policy "tenant_isolation_tenants" on tenants
  for all using (
    id in (select tenant_id from tenant_users where user_id = auth.uid())
  );

-- Politique tenant_users : un utilisateur ne voit que ses propres liaisons
create policy "tenant_isolation_tenant_users" on tenant_users
  for all using (
    user_id = auth.uid()
  );

-- Politique orders : isolation par tenant_id de l'utilisateur connecté
create policy "tenant_isolation_orders" on orders
  for all using (
    tenant_id = (select tenant_id from tenant_users where user_id = auth.uid())
  );

-- Politique order_items : même logique
create policy "tenant_isolation_order_items" on order_items
  for all using (
    tenant_id = (select tenant_id from tenant_users where user_id = auth.uid())
  );

-- Politique order_status_history : même logique
create policy "tenant_isolation_order_status_history" on order_status_history
  for all using (
    tenant_id = (select tenant_id from tenant_users where user_id = auth.uid())
  );

-- 8. Trigger updated_at sur orders
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language 'plpgsql';

create trigger update_orders_updated_at
  before update on orders
  for each row
  execute function update_updated_at_column();
