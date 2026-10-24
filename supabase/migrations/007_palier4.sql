-- =============================================================================
-- 007_palier4.sql — SaaS : abonnements, multi-boutiques, supervision, support
-- =============================================================================
-- Quatre briques, volontairement séparées des modules métier :
--   1. `plans` et `subscriptions` : l'abonnement d'un pressing. Aucun montant
--      n'est facturé en ligne ici — le règlement se fait hors application et
--      l'éditeur enregistre la période réglée (décision documentée) ;
--   2. multi-boutiques : un compte peut être rattaché à plusieurs pressings.
--      La boutique active voyage dans l'en-tête `x-tenant-id`, validée contre
--      `tenant_users` — un en-tête forgé ne donne aucun accès ;
--   3. supervision : table `platform_admins` (réservée à l'éditeur) et
--      fonctions `security definer` de lecture / renouvellement / suspension ;
--   4. support : demandes des pressings, lues et clôturées par l'éditeur.
--
-- ⚠ Décision de blocage : un abonnement échu ou suspendu passe le pressing en
-- **lecture seule**. Les lectures restent possibles (les données du client lui
-- appartiennent), les écritures sont refusées par des politiques RLS
-- *restrictives* et par un déclencheur pour les fonctions `security definer`.
-- Un pressing sans ligne d'abonnement — compte historique — reste inscriptible :
-- la migration ne coupe jamais un client existant.
-- =============================================================================

-- =============================================================================
-- 1. FORMULES ET ABONNEMENTS
-- =============================================================================
create table if not exists public.plans (
  code          text primary key,
  name          text not null,
  description   text not null default '',
  price_fcfa    integer not null check (price_fcfa >= 0),
  duration_days integer not null default 30 check (duration_days > 0),
  -- `null` = illimité.
  max_users     integer check (max_users is null or max_users > 0),
  max_shops     integer not null default 1 check (max_shops > 0),
  is_active     boolean not null default true,
  sort_order    integer not null default 0
);

comment on table public.plans is
  'Formules d''abonnement vendues par l''éditeur. Lecture seule pour les pressings.';

insert into public.plans (code, name, description, price_fcfa, duration_days, max_users, max_shops, sort_order)
values
  ('essentiel', 'Essentiel',
   'Une boutique, trois comptes, caisse et reçus.', 15000, 30, 3, 1, 1),
  ('pro', 'Pro',
   'Trois boutiques, dix comptes, stock, dépenses et tableau de bord.', 35000, 30, 10, 3, 2),
  ('reseau', 'Réseau',
   'Jusqu''à dix boutiques et comptes illimités pour une franchise.', 75000, 30, null, 10, 3)
on conflict (code) do nothing;

create table if not exists public.subscriptions (
  tenant_id           uuid primary key references public.tenants(id) on delete cascade,
  plan_code           text not null references public.plans(code),
  -- `trial`, `active`, `grace`, `expired`, `suspended`.
  -- `grace` et la date de fin se déduisent aussi des dates : le statut stocké
  -- garde la décision de l'éditeur, `subscription_state()` fait le calcul.
  status              text not null default 'trial'
                      check (status in ('trial', 'active', 'grace', 'expired', 'suspended')),
  started_on          date not null default current_date,
  current_period_end  date not null,
  trial_ends_on       date,
  grace_days          integer not null default 7 check (grace_days >= 0),
  suspended_reason    text,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.subscriptions is
  'Abonnement d''un pressing. Aucune écriture cliente : l''éditeur seul le modifie.';

drop trigger if exists subscriptions_updated_at on public.subscriptions;
create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.update_updated_at_column();

create index if not exists idx_subscriptions_period_end
  on public.subscriptions (current_period_end);

-- `platform_admins` : liste blanche de l'éditeur. Aucune politique RLS, donc
-- aucun accès via PostgREST avec une clé anon/authenticated : seules les
-- fonctions `security definer` la lisent, et le provisionnement l'écrit.
create table if not exists public.platform_admins (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

comment on table public.platform_admins is
  'Comptes de supervision de l''éditeur. Aucune politique RLS : accès uniquement via service_role ou fonctions definer.';

-- =============================================================================
-- 2. SUPPORT
-- =============================================================================
create table if not exists public.support_requests (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  author_name text,
  subject     text not null check (char_length(btrim(subject)) between 2 and 120),
  message     text not null check (char_length(btrim(message)) between 5 and 2000),
  status      text not null default 'open' check (status in ('open', 'in_progress', 'closed')),
  response    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.support_requests is
  'Demandes d''assistance d''un pressing, traitées par l''éditeur.';

create index if not exists idx_support_requests_tenant
  on public.support_requests (tenant_id, created_at desc);

drop trigger if exists support_requests_updated_at on public.support_requests;
create trigger support_requests_updated_at
  before update on public.support_requests
  for each row execute function public.update_updated_at_column();

-- =============================================================================
-- 3. MULTI-BOUTIQUES : SÉLECTION VALIDÉE DE LA BOUTIQUE
-- =============================================================================
-- Un en-tête `x-tenant-id` n'est accepté que si le compte est réellement
-- rattaché à ce pressing. Le contrôle passe par une fonction `security definer`
-- pour ne pas dépendre de la RLS de `tenant_users` (récursion).
create or replace function public.is_tenant_member(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_tenant is not null
     and exists (
       select 1
       from   public.tenant_users tu
       where  tu.user_id = auth.uid()
         and  tu.tenant_id = p_tenant
     );
$$;

comment on function public.is_tenant_member(uuid) is
  'Vrai si le compte connecté est rattaché au pressing demandé.';

create or replace function public.current_tenant_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_entete text;
  v_tenant uuid;
begin
  -- 1) Boutique choisie dans l'interface. L'en-tête est du JSON PostgREST :
  --    une valeur absente ou mal formée retombe silencieusement sur la suite.
  begin
    v_entete := nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-tenant-id';
  exception
    when others then
      v_entete := null;
  end;

  if v_entete ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_tenant := v_entete::uuid;
    if public.is_tenant_member(v_tenant) then
      return v_tenant;
    end if;
  end if;

  -- 2) Claim posée au provisionnement.
  v_tenant := nullif(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')::uuid;
  if v_tenant is not null then
    return v_tenant;
  end if;

  -- 3) Premier rattachement (comportement historique, une seule boutique).
  select tu.tenant_id
  into   v_tenant
  from   public.tenant_users tu
  where  tu.user_id = auth.uid()
  order  by tu.created_at
  limit  1;

  return v_tenant;
end;
$$;

-- Le rôle suit la boutique active : un gérant peut être propriétaire d'une
-- boutique et simple réceptionniste d'une autre. La claim `tenant_role` ne
-- sert plus que de repli quand `tenant_users` n'a pas la ligne.
create or replace function public.current_tenant_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select tu.role
       from public.tenant_users tu
      where tu.user_id = auth.uid()
        and tu.tenant_id = public.current_tenant_id()
      limit 1),
    (select nullif(auth.jwt() -> 'app_metadata' ->> 'tenant_role', ''))
  );
$$;

-- =============================================================================
-- 4. ÉTAT DE L'ABONNEMENT
-- =============================================================================
-- Aucune ligne = compte historique : « actif » et inscriptible. C'est ce qui
-- garantit qu'une migration ne met jamais un client existant en lecture seule.
create or replace function public.subscription_state(p_tenant uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select case
               when s.status in ('suspended', 'expired') then s.status
               when current_date > s.current_period_end + coalesce(s.grace_days, 0) then 'expired'
               when current_date > s.current_period_end then 'grace'
               else s.status
             end
      from   public.subscriptions s
      where  s.tenant_id = p_tenant
    ),
    'active'
  );
$$;

comment on function public.subscription_state(uuid) is
  'État effectif : trial, active, grace, expired ou suspended. Absence = active (compte historique).';

create or replace function public.tenant_writable(p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_tenant is not null
     and public.subscription_state(p_tenant) in ('trial', 'active', 'grace');
$$;

comment on function public.tenant_writable(uuid) is
  'Faux quand le pressing est expiré ou suspendu : ses écritures sont refusées.';

-- État lisible par l'application, y compris quand l'écriture est bloquée.
create or replace function public.my_subscription()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null then
    return null;
  end if;

  return jsonb_build_object(
           'tenant_id',  v_tenant,
           'state',      public.subscription_state(v_tenant),
           'writable',   public.tenant_writable(v_tenant)
         )
         || coalesce(
              (
                select jsonb_build_object(
                         'plan_code',          s.plan_code,
                         'plan_name',          p.name,
                         'price_fcfa',         p.price_fcfa,
                         'duration_days',      p.duration_days,
                         'max_users',          p.max_users,
                         'max_shops',          p.max_shops,
                         'status',             s.status,
                         'started_on',         s.started_on,
                         'current_period_end', s.current_period_end,
                         'trial_ends_on',      s.trial_ends_on,
                         'grace_days',         s.grace_days,
                         'suspended_reason',   s.suspended_reason
                       )
                from   public.subscriptions s
                join   public.plans p on p.code = s.plan_code
                where  s.tenant_id = v_tenant
              ),
              '{}'::jsonb
            );
end;
$$;

-- =============================================================================
-- 5. LECTURE SEULE QUAND L'ABONNEMENT EST ÉCHU
-- =============================================================================
-- Politiques RESTRICTIVES : elles se combinent en ET avec les politiques
-- permissives existantes. Les lectures ne sont pas touchées ; seules les
-- écritures des rôles clients sont filtrées (le service_role les contourne,
-- ce qui laisse passer les notifications de paiement déjà engagées).
do $$
declare
  t text;
  tables text[] := array[
    'orders',
    'order_items',
    'order_issues',
    'cash_sessions',
    'catalog_entries',
    'customers',
    'suppliers',
    'stock_items',
    'stock_movements',
    'expenses'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on public.%I', 'abonnement_insert_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'abonnement_update_' || t, t);
    execute format('drop policy if exists %I on public.%I', 'abonnement_delete_' || t, t);

    execute format(
      'create policy %I on public.%I as restrictive for insert with check (public.tenant_writable(tenant_id))',
      'abonnement_insert_' || t, t
    );
    execute format(
      'create policy %I on public.%I as restrictive for update using (public.tenant_writable(tenant_id)) with check (public.tenant_writable(tenant_id))',
      'abonnement_update_' || t, t
    );
    execute format(
      'create policy %I on public.%I as restrictive for delete using (public.tenant_writable(tenant_id))',
      'abonnement_delete_' || t, t
    );
  end loop;
end;
$$;

-- Les fonctions `security definer` écrivent en tant que propriétaire et
-- contournent la RLS : sans ce déclencheur, un pressing expiré pourrait encore
-- encaisser en espèces ou mouvementer le stock. `auth.uid()` est nul pour le
-- service_role (webhook CinetPay), qui doit continuer à journaliser les
-- paiements déjà payés par le client.
create or replace function public.guard_subscription_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.tenant_writable(new.tenant_id) then
    raise exception 'Abonnement échu ou suspendu : le pressing est en lecture seule. Contactez l''éditeur pour le réactiver.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_subscription_payment on public.payment_transactions;
create trigger guard_subscription_payment
  before insert on public.payment_transactions
  for each row execute function public.guard_subscription_write();

drop trigger if exists guard_subscription_refund on public.payment_refunds;
create trigger guard_subscription_refund
  before insert on public.payment_refunds
  for each row execute function public.guard_subscription_write();

drop trigger if exists guard_subscription_stock on public.stock_movements;
create trigger guard_subscription_stock
  before insert on public.stock_movements
  for each row execute function public.guard_subscription_write();

-- =============================================================================
-- 6. SUPERVISION (ÉDITEUR)
-- =============================================================================
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = auth.uid()
  );
$$;

create or replace function public.platform_tenants_overview()
returns table (
  tenant_id         uuid,
  tenant_name       text,
  created_at        timestamptz,
  users_count       integer,
  orders_count      integer,
  last_order_at     timestamptz,
  plan_code         text,
  plan_name         text,
  price_fcfa        integer,
  status            text,
  state             text,
  current_period_end date,
  trial_ends_on     date
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Supervision réservée à l''éditeur.' using errcode = '42501';
  end if;

  return query
    select t.id,
           t.name,
           t.created_at,
           (select count(*)::integer from public.tenant_users tu where tu.tenant_id = t.id),
           (select count(*)::integer from public.orders o where o.tenant_id = t.id),
           (select max(o.created_at) from public.orders o where o.tenant_id = t.id),
           s.plan_code,
           p.name,
           p.price_fcfa,
           s.status,
           public.subscription_state(t.id),
           s.current_period_end,
           s.trial_ends_on
    from   public.tenants t
    left   join public.subscriptions s on s.tenant_id = t.id
    left   join public.plans p on p.code = s.plan_code
    order  by t.name;
end;
$$;

create or replace function public.platform_set_subscription(
  p_tenant uuid,
  p_plan   text,
  p_days   integer default 0,
  p_status text default 'active',
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan      public.plans;
  v_duree     integer;
  v_statut    text := coalesce(p_status, 'active');
begin
  if not public.is_platform_admin() then
    raise exception 'Supervision réservée à l''éditeur.' using errcode = '42501';
  end if;

  if v_statut not in ('trial', 'active', 'grace', 'expired', 'suspended') then
    raise exception 'Statut d''abonnement inconnu : %.', v_statut using errcode = '22023';
  end if;

  select * into v_plan from public.plans where code = p_plan;
  if not found then
    raise exception 'Formule inconnue : %.', p_plan using errcode = '22023';
  end if;

  v_duree := case when coalesce(p_days, 0) > 0 then p_days else v_plan.duration_days end;

  insert into public.subscriptions as s
    (tenant_id, plan_code, status, started_on, current_period_end, trial_ends_on, suspended_reason)
  values
    (p_tenant, p_plan, v_statut, current_date, current_date + v_duree,
     case when v_statut = 'trial' then current_date + v_duree end,
     case when v_statut = 'suspended' then p_reason end)
  on conflict (tenant_id) do update
    set plan_code          = excluded.plan_code,
        status             = excluded.status,
        current_period_end = greatest(s.current_period_end, current_date) + v_duree,
        trial_ends_on      = case
                               when excluded.status = 'trial'
                                 then greatest(s.current_period_end, current_date) + v_duree
                               else s.trial_ends_on
                             end,
        suspended_reason   = case when excluded.status = 'suspended' then p_reason else null end;

  return jsonb_build_object(
    'tenant_id', p_tenant,
    'state',     public.subscription_state(p_tenant),
    'writable',  public.tenant_writable(p_tenant)
  );
end;
$$;

create or replace function public.platform_support_requests()
returns table (
  id          uuid,
  tenant_id   uuid,
  tenant_name text,
  author_name text,
  subject     text,
  message     text,
  status      text,
  response    text,
  created_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Supervision réservée à l''éditeur.' using errcode = '42501';
  end if;

  return query
    select s.id, s.tenant_id, t.name, s.author_name, s.subject, s.message,
           s.status, s.response, s.created_at
    from   public.support_requests s
    join   public.tenants t on t.id = s.tenant_id
    order  by (s.status = 'closed'), s.created_at desc;
end;
$$;

create or replace function public.platform_answer_support(
  p_id       uuid,
  p_response text,
  p_status   text default 'closed'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Supervision réservée à l''éditeur.' using errcode = '42501';
  end if;

  if p_status not in ('open', 'in_progress', 'closed') then
    raise exception 'Statut de demande inconnu : %.', p_status using errcode = '22023';
  end if;

  update public.support_requests
  set    response = nullif(btrim(p_response), ''),
         status   = p_status
  where  id = p_id;

  if not found then
    raise exception 'Demande introuvable.' using errcode = 'P0002';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 6 bis. OUVERTURE ET RATTACHEMENT D'UNE BOUTIQUE (ÉDITEUR)
-- -----------------------------------------------------------------------------
-- Une formule « Pro » couvre trois boutiques pour un même compte : la limite
-- `plans.max_shops` est donc comptée sur les pressings où ce compte est
-- propriétaire, pas sur le pressing lui-même.
create or replace function public.platform_create_shop(
  p_name  text,
  p_phone text default null,
  p_owner uuid default null,
  p_plan  text default 'pro',
  p_days  integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan    public.plans;
  v_boutiques integer;
  v_id      uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Supervision réservée à l''éditeur.' using errcode = '42501';
  end if;

  if p_name is null or char_length(btrim(p_name)) < 2 then
    raise exception 'Le nom de la boutique est trop court.' using errcode = '22023';
  end if;

  select * into v_plan from public.plans where code = p_plan and is_active;
  if not found then
    raise exception 'Formule inconnue ou inactive : %.', p_plan using errcode = '22023';
  end if;

  if p_owner is not null then
    select count(*) into v_boutiques
    from   public.tenant_users tu
    where  tu.user_id = p_owner and tu.role = 'owner';

    if v_boutiques >= v_plan.max_shops then
      raise exception 'La formule % couvre % boutique(s) : limite atteinte pour ce compte.',
        v_plan.name, v_plan.max_shops using errcode = '22023';
    end if;
  end if;

  insert into public.tenants (name, phone)
  values (btrim(p_name), nullif(btrim(coalesce(p_phone, '')), ''))
  returning id into v_id;

  if p_owner is not null then
    insert into public.tenant_users (user_id, tenant_id, role)
    values (p_owner, v_id, 'owner');
  end if;

  perform public.platform_set_subscription(
    v_id, p_plan,
    case when p_days > 0 then p_days else v_plan.duration_days end,
    'active', null
  );

  return jsonb_build_object('tenant_id', v_id, 'plan_code', p_plan);
end;
$$;

create or replace function public.platform_members()
returns table (
  tenant_id   uuid,
  tenant_name text,
  user_id     uuid,
  email       text,
  role        text,
  display_name text,
  created_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Supervision réservée à l''éditeur.' using errcode = '42501';
  end if;

  return query
    select tu.tenant_id, t.name, tu.user_id, u.email, tu.role, tu.display_name, tu.created_at
    from   public.tenant_users tu
    join   public.tenants t on t.id = tu.tenant_id
    left   join auth.users u on u.id = tu.user_id
    order  by t.name, tu.role, u.email;
end;
$$;

-- Rattache ou met à jour un membre. `p_role = null` détache le compte.
create or replace function public.platform_set_member(
  p_tenant uuid,
  p_user   uuid,
  p_role   text,
  p_display_name text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max  integer;
  v_n    integer;
  v_owner boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'Supervision réservée à l''éditeur.' using errcode = '42501';
  end if;

  if p_role is null then
    select count(*) into v_n
    from   public.tenant_users
    where  tenant_id = p_tenant and role = 'owner';

    select exists (
      select 1 from public.tenant_users
      where tenant_id = p_tenant and user_id = p_user and role = 'owner'
    ) into v_owner;

    if v_owner and v_n <= 1 then
      raise exception 'Impossible de détacher le dernier propriétaire du pressing.'
        using errcode = '22023';
    end if;

    delete from public.tenant_users where tenant_id = p_tenant and user_id = p_user;
    return;
  end if;

  if p_role not in ('owner', 'receptionist', 'artisan') then
    raise exception 'Rôle inconnu : %.', p_role using errcode = '22023';
  end if;

  if not exists (select 1 from public.tenants where id = p_tenant) then
    raise exception 'Pressing introuvable.' using errcode = 'P0002';
  end if;

  select p.max_users into v_max
  from   public.subscriptions s
  join   public.plans p on p.code = s.plan_code
  where  s.tenant_id = p_tenant;

  select count(*) into v_n
  from   public.tenant_users
  where  tenant_id = p_tenant and user_id <> p_user;

  if v_max is not null and v_n >= v_max then
    raise exception 'La formule de ce pressing est limitée à % compte(s).', v_max
      using errcode = '22023';
  end if;

  insert into public.tenant_users (user_id, tenant_id, role, display_name)
  values (p_user, p_tenant, p_role, nullif(btrim(coalesce(p_display_name, '')), ''))
  on conflict (user_id, tenant_id) do update
    set role = excluded.role,
        display_name = coalesce(excluded.display_name, public.tenant_users.display_name);
end;
$$;

-- =============================================================================
-- 7. RLS ET PRIVILÈGES DES NOUVELLES TABLES
-- =============================================================================
alter table public.plans            enable row level security;
alter table public.subscriptions    enable row level security;
alter table public.platform_admins  enable row level security;
alter table public.support_requests enable row level security;

drop policy if exists plans_select_authenticated on public.plans;
create policy plans_select_authenticated on public.plans
  for select to authenticated
  using (true);

drop policy if exists subscriptions_select_tenant on public.subscriptions;
create policy subscriptions_select_tenant on public.subscriptions
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists support_select_tenant on public.support_requests;
create policy support_select_tenant on public.support_requests
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

drop policy if exists support_insert_tenant on public.support_requests;
create policy support_insert_tenant on public.support_requests
  for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and author_id = auth.uid()
  );

grant select on public.plans to authenticated;
grant select on public.subscriptions to authenticated;
grant select, insert on public.support_requests to authenticated;

grant execute on function public.is_tenant_member(uuid) to authenticated;
grant execute on function public.subscription_state(uuid) to authenticated;
grant execute on function public.tenant_writable(uuid) to authenticated;
grant execute on function public.my_subscription() to authenticated;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.platform_tenants_overview() to authenticated;
grant execute on function public.platform_set_subscription(uuid, text, integer, text, text) to authenticated;
grant execute on function public.platform_support_requests() to authenticated;
grant execute on function public.platform_answer_support(uuid, text, text) to authenticated;
grant execute on function public.platform_create_shop(text, text, uuid, text, integer) to authenticated;
grant execute on function public.platform_members() to authenticated;
grant execute on function public.platform_set_member(uuid, uuid, text, text) to authenticated;
grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.current_tenant_role() to authenticated;
