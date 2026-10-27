-- =============================================================================
-- 028_forfaits_commerciaux.sql
-- Rendre le dépôt reproductible : forfaits commerciaux (packs multi-articles).
-- =============================================================================
-- Contexte : les tables `commercial_packages` et `commercial_package_items`
-- existent **déjà en production** (migration distante `20261026193632`
-- « catalogue_lot1 »), mais aucune migration du dépôt ne les crée. Un poste
-- reconstruit depuis ce dépôt n'aurait donc pas les forfaits, alors que la base
-- réelle les a. Cette migration comble cet écart.
--
-- Elle est **idempotente et strictement additive** :
--   * `create table if not exists` : sur la base actuelle, aucune table n'est
--     créée ni modifiée, aucune donnée n'est lue, déplacée ou supprimée ;
--   * `create index if not exists` ;
--   * politiques RLS recréées à l'identique (`drop policy if exists` puis
--     `create policy`), sans jamais assouplir ce qui existe ;
--   * déclencheurs posés seulement s'ils manquent.
--
-- Elle reflète **l'état constaté** en production le 27/10/2026, colonne par
-- colonne et contrainte par contrainte (voir docs/RAPPORT-FORFAITS.md § 1).
--
-- Modèle retenu pour la v1 : le forfait dit « 10 vêtements au choix,
-- 5 000 FCFA ». La **composition est donc facultative** ; `commercial_package_items`
-- reste disponible pour un contenu imposé, sans être utilisé par l'écran.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Forfaits
-- -----------------------------------------------------------------------------
create table if not exists public.commercial_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  price_xof integer not null,
  is_active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_service_id uuid,
  garments_included integer,
  overflow_policy text not null default 'PER_EXTRA_ITEM',
  overflow_unit_price_xof integer,
  constraint commercial_packages_code_check check (code ~ '^[A-Z0-9_]{2,40}$'),
  constraint commercial_packages_name_check check (
    char_length(btrim(name)) >= 2 and char_length(btrim(name)) <= 80
  ),
  constraint commercial_packages_price_xof_check check (price_xof between 1 and 10000000),
  constraint commercial_packages_garments_included_check check (
    garments_included is null or garments_included between 1 and 10000
  ),
  constraint commercial_packages_overflow_policy_check check (
    overflow_policy in ('PER_EXTRA_ITEM', 'REPEAT_PACKAGE', 'REJECT_OVER_LIMIT', 'MANUAL_QUOTE')
  ),
  constraint commercial_packages_overflow_unit_price_check check (
    overflow_unit_price_xof is null or overflow_unit_price_xof between 1 and 10000000
  ),
  -- Un supplément « par pièce » n'a de sens que si son prix est connu.
  constraint commercial_packages_overflow_required_check check (
    garments_included is null
    or overflow_policy <> 'PER_EXTRA_ITEM'
    or overflow_unit_price_xof is not null
  ),
  constraint commercial_packages_id_tenant_unique unique (id, tenant_id),
  constraint commercial_packages_tenant_code_unique unique (tenant_id, code),
  constraint commercial_packages_service_fk
    foreign key (tenant_service_id, tenant_id)
    references public.tenant_services(id, tenant_id)
    on delete set null (tenant_service_id)
);

comment on table public.commercial_packages is
  'Forfaits commerciaux (prix global) ; la vente en caisse fait l’objet d’un lot ultérieur.';

-- -----------------------------------------------------------------------------
-- 2. Composition facultative d'un forfait
-- -----------------------------------------------------------------------------
-- Non utilisée par l'écran de vente en v1 (composition libre). Conservée pour
-- refléter la production et permettre un contenu imposé plus tard.
create table if not exists public.commercial_package_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  package_id uuid not null,
  garment_type_id uuid,
  tenant_service_id uuid,
  label text,
  quantity integer not null default 1,
  sort_order integer not null default 0,
  constraint commercial_package_items_quantity_check check (quantity between 1 and 1000),
  constraint commercial_package_items_sort_order_check check (sort_order >= 0),
  constraint commercial_package_items_package_fk
    foreign key (package_id, tenant_id)
    references public.commercial_packages(id, tenant_id)
    on delete cascade,
  constraint commercial_package_items_service_fk
    foreign key (tenant_service_id, tenant_id)
    references public.tenant_services(id, tenant_id)
    on delete set null (tenant_service_id)
);

-- `garment_types` n'est pas créée par ce dépôt (bibliothèque d'articles créée
-- à distance). On rattache l'article seulement si la table existe, pour que la
-- migration reste rejouable sur une base reconstruite depuis ce dépôt.
do $$
begin
  if to_regclass('public.garment_types') is not null
     and not exists (
       select 1 from pg_constraint
       where conname = 'commercial_package_items_garment_fk'
         and conrelid = 'public.commercial_package_items'::regclass
     )
  then
    alter table public.commercial_package_items
      add constraint commercial_package_items_garment_fk
      foreign key (garment_type_id, tenant_id)
      references public.garment_types(id, tenant_id)
      on delete set null (garment_type_id);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Index
-- -----------------------------------------------------------------------------
create index if not exists commercial_package_items_package_idx
  on public.commercial_package_items (package_id, sort_order);
create index if not exists commercial_packages_tenant_active_idx
  on public.commercial_packages (tenant_id, is_active);

-- -----------------------------------------------------------------------------
-- 4. Sécurité : lecture par les membres, écriture par le propriétaire
-- -----------------------------------------------------------------------------
alter table public.commercial_packages enable row level security;
alter table public.commercial_package_items enable row level security;

drop policy if exists commercial_packages_select_member on public.commercial_packages;
create policy commercial_packages_select_member on public.commercial_packages
  for select to authenticated
  using (tenant_id = current_tenant_id());

drop policy if exists commercial_packages_insert_owner on public.commercial_packages;
create policy commercial_packages_insert_owner on public.commercial_packages
  for insert to authenticated
  with check (tenant_id = current_tenant_id() and current_tenant_role() = 'owner');

drop policy if exists commercial_packages_update_owner on public.commercial_packages;
create policy commercial_packages_update_owner on public.commercial_packages
  for update to authenticated
  using (tenant_id = current_tenant_id() and current_tenant_role() = 'owner')
  with check (tenant_id = current_tenant_id() and current_tenant_role() = 'owner');

drop policy if exists commercial_packages_delete_owner on public.commercial_packages;
create policy commercial_packages_delete_owner on public.commercial_packages
  for delete to authenticated
  using (tenant_id = current_tenant_id() and current_tenant_role() = 'owner');

drop policy if exists commercial_package_items_select_member on public.commercial_package_items;
create policy commercial_package_items_select_member on public.commercial_package_items
  for select to authenticated
  using (tenant_id = current_tenant_id());

drop policy if exists commercial_package_items_insert_owner on public.commercial_package_items;
create policy commercial_package_items_insert_owner on public.commercial_package_items
  for insert to authenticated
  with check (tenant_id = current_tenant_id() and current_tenant_role() = 'owner');

drop policy if exists commercial_package_items_update_owner on public.commercial_package_items;
create policy commercial_package_items_update_owner on public.commercial_package_items
  for update to authenticated
  using (tenant_id = current_tenant_id() and current_tenant_role() = 'owner')
  with check (tenant_id = current_tenant_id() and current_tenant_role() = 'owner');

drop policy if exists commercial_package_items_delete_owner on public.commercial_package_items;
create policy commercial_package_items_delete_owner on public.commercial_package_items
  for delete to authenticated
  using (tenant_id = current_tenant_id() and current_tenant_role() = 'owner');

-- -----------------------------------------------------------------------------
-- 5. Journal d'audit et horodatage de mise à jour
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regproc('public.audit_row_change') is not null then
    if not exists (
      select 1 from pg_trigger
      where tgname = 'trg_audit_commercial_packages'
        and tgrelid = 'public.commercial_packages'::regclass
    ) then
      create trigger trg_audit_commercial_packages
        after insert or update or delete on public.commercial_packages
        for each row execute function public.audit_row_change();
    end if;

    if not exists (
      select 1 from pg_trigger
      where tgname = 'trg_audit_commercial_package_items'
        and tgrelid = 'public.commercial_package_items'::regclass
    ) then
      create trigger trg_audit_commercial_package_items
        after insert or update or delete on public.commercial_package_items
        for each row execute function public.audit_row_change();
    end if;
  end if;

  if to_regproc('public.update_updated_at_column') is not null
     and not exists (
       select 1 from pg_trigger
       where tgname = 'trg_commercial_packages_updated_at'
         and tgrelid = 'public.commercial_packages'::regclass
     )
  then
    create trigger trg_commercial_packages_updated_at
      before update on public.commercial_packages
      for each row execute function public.update_updated_at_column();
  end if;
end $$;

commit;
