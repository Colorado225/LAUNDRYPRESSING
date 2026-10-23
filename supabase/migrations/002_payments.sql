-- =============================================================================
-- 002_payments.sql — Suivi des transactions Mobile Money (CinetPay)
-- =============================================================================
-- Pourquoi une table dédiée plutôt que des colonnes sur `orders` ?
--   1. Une commande peut faire l'objet de plusieurs tentatives de paiement
--      (échec, nouvel essai avec un autre opérateur).
--   2. L'idempotence du webhook repose sur `transaction_id` : il faut pouvoir
--      rejouer une notification sans effet de bord.
--   3. Le schéma `orders` imposé par le cahier des charges reste inchangé.
--
-- Écriture : uniquement par les Edge Functions (`service_role`), qui
-- contournent la RLS. Le client ne peut que LIRE ses propres transactions.
-- =============================================================================

create table if not exists public.payment_transactions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  order_id         uuid not null,

  -- Identifiant transmis à CinetPay (unique, généré par l'Edge Function)
  transaction_id   text not null unique,

  -- Montant réellement débité (multiple de 5) et montant de la commande
  amount           integer not null check (amount > 0),
  order_amount     integer not null check (order_amount >= 0),
  currency         text not null default 'XOF' check (currency in ('XOF', 'XAF')),

  status           text not null default 'pending'
                     check (status in ('pending', 'initiated', 'paid', 'refused', 'cancelled', 'error')),
  provider         text not null default 'cinetpay',
  payment_method   text
                     check (payment_method in ('wave', 'orange_money', 'mtn_momo', 'moov_money', 'cash')),
  operator_label   text,          -- libellé brut renvoyé par CinetPay (ex. « WAVE »)
  payment_url      text,

  -- `signature_verified` = false signale une notification validée uniquement
  -- par l'API de vérification (HMAC absent ou non configuré).
  signature_verified boolean not null default false,
  provider_payload jsonb,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  paid_at          timestamptz,

  constraint payment_transactions_order_tenant_fk
    foreign key (order_id, tenant_id) references public.orders (id, tenant_id) on delete cascade
);

create index if not exists idx_payments_order      on public.payment_transactions (order_id, created_at desc);
create index if not exists idx_payments_tenant     on public.payment_transactions (tenant_id, created_at desc);
create index if not exists idx_payments_status     on public.payment_transactions (status);

drop trigger if exists trg_payments_updated_at on public.payment_transactions;
create trigger trg_payments_updated_at
  before update on public.payment_transactions
  for each row
  execute function public.update_updated_at_column();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.payment_transactions enable row level security;

-- Lecture seule pour les membres du pressing concerné.
drop policy if exists payments_select_tenant on public.payment_transactions;
create policy payments_select_tenant on public.payment_transactions
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

-- Aucune politique d'écriture : les INSERT/UPDATE sont faits par les Edge
-- Functions avec la clé `service_role` (qui contourne la RLS).

revoke all on public.payment_transactions from anon;
grant select on public.payment_transactions to authenticated;

-- =============================================================================
-- Vue pratique : dernière tentative de paiement par commande
-- =============================================================================
create or replace view public.order_latest_payment
with (security_invoker = true)
as
select distinct on (order_id)
  order_id,
  tenant_id,
  transaction_id,
  status,
  payment_method,
  operator_label,
  amount,
  created_at,
  paid_at
from public.payment_transactions
order by order_id, created_at desc;

comment on view public.order_latest_payment is
  'Dernière transaction Mobile Money connue pour chaque commande (lecture seule).';
