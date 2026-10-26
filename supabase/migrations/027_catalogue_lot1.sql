-- =============================================================================
-- 027_catalogue_lot1.sql — Catalogue : articles, catégories et matrice de prix
-- =============================================================================
-- Lot 1 du cahier des charges « Catalogue, Prestations, Types de vêtements et
-- Tarification » (26/10/2026), adapté à l'architecture Supabase du dépôt :
--
--  - les PRESTATIONS existent déjà (`tenant_services`, migrations 021-023) :
--    on les étend (code stable, délai, express, archivage) au lieu de créer
--    une table `services` concurrente ;
--  - nouveautés : `garment_categories`, `garment_types` (bibliothèque système
--    en lecture seule + copies indépendantes par pressing) et
--    `service_garment_prices` (matrice prestation × article) ;
--  - le seed système livre les références SANS aucun prix : l'absence de
--    ligne de prix signifie « non configuré », jamais 0 FCFA ;
--  - `install_catalog_reference()` clone la bibliothèque pour le pressing
--    courant, de façon idempotente (aucun doublon au second appel) ;
--  - dès qu'un pressing a installé son catalogue, le déclencheur
--    `guard_order_item_catalog` rend le catalogue obligatoire pour les
--    nouvelles lignes à la pièce et refuse tout prix différent de la grille
--    sans motif d'au moins 10 caractères (dérogation tracée). Les commandes
--    historiques et les lignes au kilo ne sont pas touchées.
--
-- Migration ADDITIVE : aucune table ni donnée existante n'est supprimée.
-- À appliquer AVANT le frontend correspondant.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Catégories d'articles (système + copies par pressing)
-- ---------------------------------------------------------------------------
create table public.garment_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9_]{2,40}$'),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  sort_order integer not null default 0 check (sort_order >= 0),
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Invariance spec : système ⇒ bibliothèque partagée (tenant nul) ;
  -- copie de pressing ⇒ toujours rattachée à un tenant.
  constraint garment_categories_system_tenant_check check (
    (is_system and tenant_id is null) or (not is_system and tenant_id is not null)
  ),
  constraint garment_categories_id_tenant_unique unique (id, tenant_id)
);

create unique index garment_categories_system_code_unique
  on public.garment_categories (code) where tenant_id is null;
create unique index garment_categories_tenant_code_unique
  on public.garment_categories (tenant_id, code) where tenant_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Types de vêtements / articles
-- ---------------------------------------------------------------------------
create table public.garment_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  category_id uuid not null references public.garment_categories(id),
  code text not null check (code ~ '^[A-Z0-9_]{2,40}$'),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  icon_key text not null default 'shirt',
  default_unit text not null default 'PIECE'
    check (default_unit in ('PIECE', 'PAIR', 'SET', 'KG', 'M2', 'METER', 'PACKAGE', 'FLAT')),
  is_delicate boolean not null default false,
  is_system boolean not null default false,
  is_active boolean not null default true,
  archived_at timestamptz,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint garment_types_system_tenant_check check (
    (is_system and tenant_id is null) or (not is_system and tenant_id is not null)
  ),
  constraint garment_types_id_tenant_unique unique (id, tenant_id)
);

create unique index garment_types_system_code_unique
  on public.garment_types (code) where tenant_id is null;
create unique index garment_types_tenant_code_unique
  on public.garment_types (tenant_id, code) where tenant_id is not null;
create index garment_types_tenant_active_idx
  on public.garment_types (tenant_id, is_active, category_id);

-- La catégorie d'un article de pressing doit appartenir au même pressing
-- (ou être une catégorie système, pour les lignes de la bibliothèque).
create or replace function public.guard_garment_category_tenant()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_category_tenant uuid;
begin
  select tenant_id into v_category_tenant
    from public.garment_categories where id = new.category_id;
  if v_category_tenant is not null and v_category_tenant is distinct from new.tenant_id then
    raise exception 'La catégorie appartient à un autre pressing.' using errcode = '23503';
  end if;
  if new.tenant_id is not null and v_category_tenant is null then
    raise exception 'Un article de pressing exige une catégorie du même pressing (installez d''abord le catalogue de référence).'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger trg_garment_types_guard_category
  before insert or update of category_id, tenant_id on public.garment_types
  for each row execute function public.guard_garment_category_tenant();

-- ---------------------------------------------------------------------------
-- 3. Matrice de prix : une prestation × un article → un prix courant
--    (l'historisation vit dans les snapshots des lignes de commande)
-- ---------------------------------------------------------------------------
create table public.service_garment_prices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tenant_service_id uuid not null,
  garment_type_id uuid not null,
  price_xof integer not null check (price_xof between 1 and 10000000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_garment_prices_service_fk
    foreign key (tenant_service_id, tenant_id)
    references public.tenant_services (id, tenant_id) on delete cascade,
  constraint service_garment_prices_garment_fk
    foreign key (garment_type_id, tenant_id)
    references public.garment_types (id, tenant_id) on delete cascade,
  constraint service_garment_prices_unique
    unique (tenant_id, tenant_service_id, garment_type_id)
);

create index service_garment_prices_tenant_service_idx
  on public.service_garment_prices (tenant_id, tenant_service_id);

-- ---------------------------------------------------------------------------
-- 4. Extension des prestations existantes (`tenant_services`)
-- ---------------------------------------------------------------------------
alter table public.tenant_services
  add column code text,
  add column description text,
  add column estimated_turnaround_hours integer,
  add column is_express boolean not null default false,
  add column is_active boolean not null default true,
  add column archived_at timestamptz,
  add column updated_at timestamptz not null default now();

alter table public.tenant_services
  add constraint tenant_services_code_check
    check (code is null or code ~ '^[A-Z0-9_]{2,40}$'),
  add constraint tenant_services_turnaround_check
    check (estimated_turnaround_hours is null or estimated_turnaround_hours >= 0);

create unique index tenant_services_tenant_code_unique
  on public.tenant_services (tenant_id, code) where code is not null;

-- ---------------------------------------------------------------------------
-- 5. Lien ligne de commande → article du catalogue
-- ---------------------------------------------------------------------------
alter table public.order_items
  add column garment_type_id uuid;

alter table public.order_items
  add constraint order_items_garment_type_fk
    foreign key (garment_type_id, tenant_id)
    references public.garment_types (id, tenant_id)
    on delete set null (garment_type_id);

create index order_items_garment_type_idx
  on public.order_items (tenant_id, garment_type_id)
  where garment_type_id is not null;

comment on column public.order_items.garment_type_id is
  'Article du catalogue choisi au dépôt ; devient nul si le pressing le supprime (les libellés figés restent).';

-- ---------------------------------------------------------------------------
-- 6. Garde serveur : catalogue obligatoire après installation + prix de grille
-- ---------------------------------------------------------------------------
create or replace function public.guard_order_item_catalog()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_price integer;
begin
  if new.garment_type_id is not null then
    if new.tenant_service_id is null then
      raise exception 'Une ligne catalogue exige une prestation configurée.'
        using errcode = '23514';
    end if;
    select price_xof into v_price
      from public.service_garment_prices
     where tenant_id = new.tenant_id
       and tenant_service_id = new.tenant_service_id
       and garment_type_id = new.garment_type_id
       and is_active;
    if v_price is null then
      raise exception 'Tarif non configuré pour cet article et cette prestation : définissez-le dans le catalogue avant de vendre.'
        using errcode = '23514';
    end if;
    if new.unit_price <> v_price
       and char_length(btrim(coalesce(new.price_reason, ''))) < 10 then
      raise exception 'Le prix diffère du tarif catalogue (% FCFA) : un motif d''au moins 10 caractères est exigé pour déroger.', v_price
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- Catalogue obligatoire (décision produit) : dès que le pressing a des
  -- articles actifs, une ligne à la pièce sans article est refusée. Avant
  -- installation, l'ancien comportement reste possible pour ne bloquer
  -- aucun pressing existant le jour du déploiement.
  if coalesce(new.billing_unit, 'PIECE') <> 'KG'
     and exists (
       select 1 from public.garment_types
        where tenant_id = new.tenant_id and is_active
     ) then
    raise exception 'Catalogue obligatoire : choisissez un article du catalogue pour chaque ligne à la pièce.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger trg_order_items_guard_catalog
  before insert on public.order_items
  for each row execute function public.guard_order_item_catalog();

-- ---------------------------------------------------------------------------
-- 7. Horodatage automatique
-- ---------------------------------------------------------------------------
create trigger trg_garment_categories_updated_at
  before update on public.garment_categories
  for each row execute function public.update_updated_at_column();
create trigger trg_garment_types_updated_at
  before update on public.garment_types
  for each row execute function public.update_updated_at_column();
create trigger trg_service_garment_prices_updated_at
  before update on public.service_garment_prices
  for each row execute function public.update_updated_at_column();
create trigger trg_tenant_services_updated_at
  before update on public.tenant_services
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- 8. RLS — même patron que `tenant_activities` (migration 022)
-- ---------------------------------------------------------------------------
alter table public.garment_categories enable row level security;
alter table public.garment_types enable row level security;
alter table public.service_garment_prices enable row level security;

create policy garment_categories_select_member
  on public.garment_categories for select to authenticated
  using (tenant_id is null or tenant_id = public.current_tenant_id());
create policy garment_categories_insert_owner
  on public.garment_categories for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  );
create policy garment_categories_update_owner
  on public.garment_categories for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner');
create policy garment_categories_delete_owner
  on public.garment_categories for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner');

create policy garment_types_select_member
  on public.garment_types for select to authenticated
  using (tenant_id is null or tenant_id = public.current_tenant_id());
create policy garment_types_insert_owner
  on public.garment_types for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  );
create policy garment_types_update_owner
  on public.garment_types for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner');
create policy garment_types_delete_owner
  on public.garment_types for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner');

create policy service_garment_prices_select_member
  on public.service_garment_prices for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy service_garment_prices_insert_owner
  on public.service_garment_prices for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() = 'owner'
  );
create policy service_garment_prices_update_owner
  on public.service_garment_prices for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner');
create policy service_garment_prices_delete_owner
  on public.service_garment_prices for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner');

revoke all on public.garment_categories, public.garment_types, public.service_garment_prices from anon, public;
grant select, insert, update, delete
  on public.garment_categories, public.garment_types, public.service_garment_prices
  to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Bibliothèque système (lecture seule, SANS prix) — seed idempotent
-- ---------------------------------------------------------------------------
insert into public.garment_categories (tenant_id, code, name, sort_order, is_system) values
  (null, 'TOPS', 'Hauts', 10, true),
  (null, 'BOTTOMS', 'Bas', 20, true),
  (null, 'SUITS', 'Costumes et ensembles', 30, true),
  (null, 'DRESSES', 'Robes et tenues', 40, true),
  (null, 'OUTERWEAR', 'Vestes et manteaux', 50, true),
  (null, 'UNDERGARMENTS', 'Sous-vêtements', 60, true),
  (null, 'BEDDING', 'Literie', 70, true),
  (null, 'HOME_LINEN', 'Linge de maison', 80, true),
  (null, 'CURTAINS', 'Rideaux et décoration', 90, true),
  (null, 'ACCESSORIES', 'Accessoires', 100, true),
  (null, 'PROFESSIONAL', 'Linge professionnel', 110, true),
  (null, 'DELICATE', 'Textiles délicats', 120, true)
on conflict (code) where tenant_id is null do nothing;

insert into public.garment_types (tenant_id, category_id, code, name, default_unit, is_delicate, is_system, sort_order)
select null, c.id, g.code, g.name, g.unit, g.delicate, true, g.ordre
  from (values
    ('TOPS','SHIRT','Chemise','PIECE',false,10),
    ('TOPS','TSHIRT','T-shirt','PIECE',false,20),
    ('TOPS','POLO','Polo','PIECE',false,30),
    ('TOPS','BLOUSE','Chemisier','PIECE',false,40),
    ('TOPS','SWEATER','Pull','PIECE',false,50),
    ('BOTTOMS','TROUSERS','Pantalon','PIECE',false,10),
    ('BOTTOMS','JEANS','Jean','PIECE',false,20),
    ('BOTTOMS','SHORTS','Short','PIECE',false,30),
    ('BOTTOMS','SKIRT','Jupe','PIECE',false,40),
    ('SUITS','SUIT_2P','Costume deux pièces','PIECE',false,10),
    ('SUITS','SUIT_3P','Costume trois pièces','PIECE',false,20),
    ('SUITS','BLAZER','Veste de costume','PIECE',false,30),
    ('DRESSES','DRESS_SHORT','Robe courte','PIECE',false,10),
    ('DRESSES','DRESS_LONG','Robe longue','PIECE',false,20),
    ('DRESSES','EVENING_DRESS','Robe de soirée','PIECE',true,30),
    ('DRESSES','WEDDING_DRESS','Robe de mariée','PIECE',true,40),
    ('DRESSES','BAZIN','Tenue en bazin','PIECE',true,50),
    ('DRESSES','PAGNE','Pagne / tissu','PIECE',false,60),
    ('DRESSES','BUBU','Boubou','PIECE',false,70),
    ('DRESSES','KAFTAN','Caftan','PIECE',false,80),
    ('OUTERWEAR','JACKET','Veste','PIECE',false,10),
    ('OUTERWEAR','COAT','Manteau','PIECE',false,20),
    ('OUTERWEAR','LEATHER_JACKET','Veste en cuir','PIECE',true,30),
    ('UNDERGARMENTS','UNDERWEAR','Sous-vêtement','PIECE',false,10),
    ('UNDERGARMENTS','BRA','Soutien-gorge','PIECE',true,20),
    ('UNDERGARMENTS','SOCKS_PAIR','Paire de chaussettes','PAIR',false,30),
    ('BEDDING','BED_SHEET','Drap','PIECE',false,10),
    ('BEDDING','PILLOWCASE','Taie d''oreiller','PIECE',false,20),
    ('BEDDING','DUVET_COVER','Housse de couette','PIECE',false,30),
    ('BEDDING','BLANKET','Couverture','PIECE',false,40),
    ('BEDDING','DUVET','Couette','PIECE',false,50),
    ('BEDDING','PILLOW','Oreiller','PIECE',false,60),
    ('HOME_LINEN','TOWEL_SMALL','Petite serviette','PIECE',false,10),
    ('HOME_LINEN','TOWEL_BATH','Drap de bain','PIECE',false,20),
    ('HOME_LINEN','TABLECLOTH','Nappe','PIECE',false,30),
    ('HOME_LINEN','WASH_BAG_KG','Linge en vrac','KG',false,40),
    ('CURTAINS','CURTAIN_PANEL','Panneau de rideau','PIECE',false,10),
    ('CURTAINS','CARPET_SMALL','Petit tapis','PIECE',false,20),
    ('PROFESSIONAL','UNIFORM','Uniforme professionnel','PIECE',false,10),
    ('PROFESSIONAL','LAB_COAT','Blouse professionnelle','PIECE',false,20),
    ('PROFESSIONAL','CHEF_JACKET','Veste de cuisine','PIECE',false,30),
    ('PROFESSIONAL','WORKWEAR','Tenue de travail','PIECE',false,40),
    ('ACCESSORIES','TIE','Cravate','PIECE',true,10),
    ('ACCESSORIES','BAG_FABRIC','Sac textile','PIECE',false,20),
    ('ACCESSORIES','CAP','Casquette','PIECE',false,30),
    ('ACCESSORIES','SHOES_FABRIC','Chaussures en textile','PAIR',false,40)
  ) as g(category_code, code, name, unit, delicate, ordre)
  join public.garment_categories c
    on c.code = g.category_code and c.tenant_id is null
on conflict (code) where tenant_id is null do nothing;

-- ---------------------------------------------------------------------------
-- 10. Installation du catalogue de référence pour le pressing courant
--     Copie indépendante et idempotente ; ne crée AUCUN prix et n'écrase
--     jamais une personnalisation existante (conflit de code = déjà là).
-- ---------------------------------------------------------------------------
create or replace function public.install_catalog_reference()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_categories integer := 0;
  v_garments integer := 0;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  if public.current_tenant_role() <> 'owner' then
    raise exception 'Seul le propriétaire peut installer le catalogue de référence.'
      using errcode = '42501';
  end if;

  insert into public.garment_categories (tenant_id, code, name, sort_order, is_system)
  select v_tenant, code, name, sort_order, false
    from public.garment_categories
   where tenant_id is null and is_active
  on conflict (tenant_id, code) where tenant_id is not null do nothing;
  get diagnostics v_categories = row_count;

  insert into public.garment_types
    (tenant_id, category_id, code, name, icon_key, default_unit, is_delicate, is_system, sort_order)
  select v_tenant, tc.id, sg.code, sg.name, sg.icon_key, sg.default_unit, sg.is_delicate, false, sg.sort_order
    from public.garment_types sg
    join public.garment_categories sc on sc.id = sg.category_id and sc.tenant_id is null
    join public.garment_categories tc on tc.tenant_id = v_tenant and tc.code = sc.code
   where sg.tenant_id is null and sg.is_active
  on conflict (tenant_id, code) where tenant_id is not null do nothing;
  get diagnostics v_garments = row_count;

  return jsonb_build_object(
    'categories_creees', v_categories,
    'articles_crees', v_garments
  );
end;
$$;

revoke all on function public.install_catalog_reference() from public, anon;
grant execute on function public.install_catalog_reference() to authenticated;

comment on table public.garment_types is
  'Articles du catalogue : bibliothèque système (tenant nul, lecture seule) et copies indépendantes par pressing.';
comment on table public.service_garment_prices is
  'Prix courant par prestation et article. Absence de ligne = tarif non configuré (jamais assimilé à zéro).';

commit;
