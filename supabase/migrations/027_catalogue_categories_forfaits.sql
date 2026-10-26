-- =============================================================================
-- 027_catalogue_categories_forfaits.sql
-- =============================================================================
-- Catalogue commercial configurable par pressing, strictement additif :
--   1. catégories de prestations par activité ;
--   2. prestations enrichies (catégorie, mode de tarification, prix de
--      référence toutes unités, forfaits poids, devis, état actif) ;
--   3. paliers de poids forfaitaires (ex. 10/15/20 kg) ;
--   4. instantané de forfait et nom de catégorie figés sur les lignes de
--      commande, sans toucher aux lignes libres existantes ;
--   5. élargissement des types de vêtements détaillés d'un lot au kilo.
--
-- Aucune table ni colonne n'est supprimée. Les anciennes prestations et
-- commandes restent valides grâce aux valeurs par défaut et aux champs
-- facultatifs.
-- =============================================================================

begin;

-- -------------------------------------------------------------------------
-- 1. Catégories de prestations, rattachées à une activité d'un pressing.
-- -------------------------------------------------------------------------
create table public.tenant_service_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  activity_id uuid not null,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  sort_order integer not null default 0 check (sort_order >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_service_categories_id_tenant_unique unique (id, tenant_id),
  constraint tenant_service_categories_activity_fk
    foreign key (activity_id, tenant_id)
    references public.tenant_activities (id, tenant_id) on delete cascade
);

create unique index tenant_service_categories_name_unique
  on public.tenant_service_categories (tenant_id, activity_id, lower(btrim(name)));
create index tenant_service_categories_order_idx
  on public.tenant_service_categories (tenant_id, activity_id, sort_order, name);

create trigger tenant_service_categories_updated_at
  before update on public.tenant_service_categories
  for each row execute function public.update_updated_at_column();

alter table public.tenant_service_categories enable row level security;

create policy tenant_service_categories_select_member
  on public.tenant_service_categories for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy tenant_service_categories_insert_owner
  on public.tenant_service_categories for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  );

create policy tenant_service_categories_update_owner
  on public.tenant_service_categories for update to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  );

create policy tenant_service_categories_delete_owner
  on public.tenant_service_categories for delete to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  );

revoke all on public.tenant_service_categories from anon;
revoke all on public.tenant_service_categories from public;
grant select, insert, update, delete on public.tenant_service_categories to authenticated;

-- -------------------------------------------------------------------------
-- 2. Enrichissement des prestations configurées.
-- -------------------------------------------------------------------------
alter table public.tenant_services
  add column category_id uuid,
  add column pricing_mode text not null default 'FIXED',
  add column is_active boolean not null default true,
  add column description text,
  add column duration_minutes integer;

alter table public.tenant_services
  add constraint tenant_services_category_fk
    foreign key (category_id, tenant_id)
    references public.tenant_service_categories (id, tenant_id)
    on delete set null,
  add constraint tenant_services_pricing_mode_check
    check (pricing_mode in ('FIXED', 'FROM', 'QUOTE')),
  add constraint tenant_services_description_check
    check (description is null or char_length(btrim(description)) between 2 and 200),
  add constraint tenant_services_duration_minutes_check
    check (duration_minutes is null or duration_minutes between 1 and 1440);

-- Ouverture des unités : pièce, paire, ensemble, kilo, forfait poids, devis.
alter table public.tenant_services
  drop constraint if exists tenant_services_billing_unit_check;
alter table public.tenant_services
  add constraint tenant_services_billing_unit_check
    check (billing_unit in ('PIECE', 'PAIR', 'SET', 'KG', 'PACKAGE', 'FLAT'));

-- Le prix de référence devient possible pour TOUTES les unités, pas seulement
-- le kilo. Il reste facultatif : une prestation peut continuer à être tarifiée
-- librement au comptoir.
alter table public.tenant_services
  drop constraint if exists tenant_services_unit_price_check;
alter table public.tenant_services
  add constraint tenant_services_unit_price_check
    check (unit_price is null or unit_price between 1 and 10000000);

-- Cohérence des modes de tarification :
--  - un devis est une ligne forfaitaire unique, sans prix de référence ;
--  - l'unité FLAT est réservée aux devis ;
--  - un forfait poids est un tarif fixe dont les paliers portent les prix.
alter table public.tenant_services
  add constraint tenant_services_quote_mode_check
    check (
      pricing_mode <> 'QUOTE'
      or (billing_unit = 'FLAT' and unit_price is null)
    ),
  add constraint tenant_services_flat_unit_check
    check (billing_unit <> 'FLAT' or pricing_mode = 'QUOTE'),
  add constraint tenant_services_package_mode_check
    check (billing_unit <> 'PACKAGE' or pricing_mode = 'FIXED');

create index tenant_services_category_idx
  on public.tenant_services (tenant_id, category_id)
  where category_id is not null;
create index tenant_services_active_idx
  on public.tenant_services (tenant_id, is_active, sort_order);

-- -------------------------------------------------------------------------
-- 3. Paliers de poids forfaitaires (ex. « 10 kg → 15 000 FCFA »).
-- -------------------------------------------------------------------------
create table public.tenant_weight_tiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tenant_service_id uuid not null,
  label text not null check (char_length(btrim(label)) between 1 and 40),
  weight_kg numeric(7, 2) not null check (weight_kg > 0 and weight_kg <= 10000),
  price_fcfa integer not null check (price_fcfa between 1 and 10000000),
  is_active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  constraint weight_tiers_id_tenant_unique unique (id, tenant_id),
  constraint weight_tiers_service_fk
    foreign key (tenant_service_id, tenant_id)
    references public.tenant_services (id, tenant_id) on delete cascade,
  constraint weight_tiers_service_weight_unique
    unique (tenant_service_id, weight_kg)
);

create index weight_tiers_service_order_idx
  on public.tenant_weight_tiers (tenant_id, tenant_service_id, sort_order, weight_kg);

-- Un palier ne peut se rattacher qu'à une prestation facturée en forfait
-- poids, dans le même pressing. La cohérence est garantie côté serveur, pas
-- seulement dans le formulaire.
create or replace function public.guard_weight_tier_parent()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_unit text;
begin
  select billing_unit
    into v_unit
    from public.tenant_services
   where id = new.tenant_service_id
     and tenant_id = new.tenant_id;

  if not found then
    raise exception 'La prestation parente est introuvable dans ce pressing.'
      using errcode = '23503';
  end if;
  if v_unit <> 'PACKAGE' then
    raise exception 'Un palier de poids ne se rattache qu''à une prestation en forfait poids.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger weight_tiers_guard_parent
  before insert or update on public.tenant_weight_tiers
  for each row execute function public.guard_weight_tier_parent();

-- Protection inverse : impossible de changer l'unité d'une prestation qui
-- porte encore des paliers (il faut d'abord les supprimer).
create or replace function public.guard_tenant_service_unit_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.billing_unit is distinct from old.billing_unit
     and exists (
       select 1 from public.tenant_weight_tiers tier
        where tier.tenant_service_id = new.id
          and tier.tenant_id = new.tenant_id
     ) then
    raise exception 'Supprimez d''abord les paliers de poids de cette prestation.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger tenant_services_guard_unit_change
  before update on public.tenant_services
  for each row execute function public.guard_tenant_service_unit_change();

alter table public.tenant_weight_tiers enable row level security;

create policy weight_tiers_select_member
  on public.tenant_weight_tiers for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy weight_tiers_insert_owner
  on public.tenant_weight_tiers for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  );

create policy weight_tiers_update_owner
  on public.tenant_weight_tiers for update to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  );

create policy weight_tiers_delete_owner
  on public.tenant_weight_tiers for delete to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  );

revoke all on public.tenant_weight_tiers from anon;
revoke all on public.tenant_weight_tiers from public;
grant select, insert, update, delete on public.tenant_weight_tiers to authenticated;

-- -------------------------------------------------------------------------
-- 4. Snapshots commerciaux sur les lignes de commande.
-- -------------------------------------------------------------------------
alter table public.order_items
  add column category_name_snapshot text,
  add column package_snapshot jsonb;

comment on column public.order_items.category_name_snapshot is
  'Nom de la catégorie figé au dépôt, indépendant des reconfigurations ultérieures.';
comment on column public.order_items.package_snapshot is
  'Palier forfaitaire figé à la vente : identifiant, libellé, poids et prix.';

-- Valide la structure du snapshot de forfait. La fonction est immutable pour
-- pouvoir servir dans une contrainte CHECK.
create or replace function public.valid_package_snapshot(p_snapshot jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_snapshot is null then true
    when jsonb_typeof(p_snapshot) <> 'object' then false
    when coalesce(p_snapshot ->> 'tier_id', '') !~
         '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then false
    when char_length(btrim(coalesce(p_snapshot ->> 'label', ''))) not between 1 and 40 then false
    when char_length(btrim(coalesce(p_snapshot ->> 'service_name', ''))) not between 2 and 80 then false
    when not (
      (p_snapshot ->> 'weight_kg') ~ '^[0-9]+(\\.[0-9]{1,2})?$'
      and (p_snapshot ->> 'weight_kg')::numeric > 0
      and (p_snapshot ->> 'weight_kg')::numeric <= 10000
    ) then false
    when not (
      (p_snapshot ->> 'price_fcfa') ~ '^[0-9]+$'
      and (p_snapshot ->> 'price_fcfa')::integer between 1 and 10000000
    ) then false
    else true
  end;
$$;

alter table public.order_items
  add constraint order_items_package_snapshot_valid_check
    check (public.valid_package_snapshot(package_snapshot)),
  add constraint order_items_package_line_check
    check (
      package_snapshot is null
      or (
        billing_unit = 'PACKAGE'
        and quantity = 1
        and billed_quantity = 1
        and unit_price = (package_snapshot ->> 'price_fcfa')::integer
        and price = (package_snapshot ->> 'price_fcfa')::integer
      )
    );

-- -------------------------------------------------------------------------
-- 5. Élargissement des types de vêtements détaillés (lots au kilo).
-- -------------------------------------------------------------------------
create or replace function public.valid_order_garment_details(p_details jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when jsonb_typeof(p_details) <> 'array' then false
    else not exists (
      select 1
        from jsonb_array_elements(p_details) as garment(value)
       where jsonb_typeof(garment.value) <> 'object'
          or coalesce(garment.value ->> 'type', '') not in (
            'CHEMISE', 'T_SHIRT', 'PANTALON', 'JEAN', 'ROBE', 'JUPE',
            'VESTE', 'COSTUME', 'BOUBOU', 'DRAP', 'SERVIETTE', 'AUTRE',
            'COUETTE', 'POLO', 'DEBARDEUR', 'CULOTTE', 'CHAUSSETTES',
            'CHAUSSURES', 'BLOUSON', 'MANTEAU', 'ENSEMBLE', 'TAIE',
            'TAPIS', 'LINGE_DE_MAISON'
          )
          or coalesce(garment.value ->> 'quantity', '') !~ '^([1-9][0-9]{0,2}|1000)$'
    )
  end;
$$;

alter table public.order_items
  drop constraint if exists order_items_garment_details_check;
alter table public.order_items
  add constraint order_items_garment_details_check
  check (public.valid_order_garment_details(garment_details));

comment on table public.tenant_service_categories is
  'Catégories de prestations propres à un pressing et à une activité.';
comment on table public.tenant_weight_tiers is
  'Paliers de poids forfaitaires des prestations en forfait poids.';

commit;
