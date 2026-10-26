-- =============================================================================
-- 029_modeles_forfaits.sql — Modèles de blanchisserie et forfaits commerciaux
-- =============================================================================
-- Lot 2 (partie modèles/forfaits) du cahier des charges :
--
--  - `laundry_profiles` : modèles système (`system_template`, bibliothèque
--    lecture seule) et modèles personnalisés par pressing (`custom`) ;
--    `laundry_profile_items` : articles (référence + code, pour rester
--    portable entre la bibliothèque et les copies) et codes de prestations
--    conseillés. Un modèle regroupe et présente ; il ne porte AUCUN prix —
--    les tarifs restent dans la grille et les règles au kilo du pressing.
--  - `duplicate_laundry_profile()` : copie indépendante d'un modèle (système
--    ou propre) pour le pressing courant ; les articles sont re-rattachés
--    par code aux copies du pressing quand elles existent.
--  - `commercial_packages` + `commercial_package_items` : forfaits vendables
--    (prix global + composition indicative). La VENTE d'un forfait en caisse
--    (ligne de commande dédiée) fait l'objet du lot suivant.
--
-- Migration additive.
-- =============================================================================

begin;

create table public.laundry_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9_]{2,40}$'),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text,
  profile_kind text not null check (profile_kind in ('system_template', 'custom')),
  is_default boolean not null default false,
  is_active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint laundry_profiles_kind_tenant_check check (
    (profile_kind = 'system_template' and tenant_id is null)
    or (profile_kind = 'custom' and tenant_id is not null)
  ),
  constraint laundry_profiles_id_tenant_unique unique (id, tenant_id)
);

create unique index laundry_profiles_system_code_unique
  on public.laundry_profiles (code) where tenant_id is null;
create unique index laundry_profiles_tenant_code_unique
  on public.laundry_profiles (tenant_id, code) where tenant_id is not null;
create unique index laundry_profiles_one_default_per_tenant
  on public.laundry_profiles (tenant_id) where is_default and tenant_id is not null;

create table public.laundry_profile_items (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.laundry_profiles(id) on delete cascade,
  garment_type_id uuid references public.garment_types(id) on delete set null,
  garment_code text,
  service_code text,
  sort_order integer not null default 0 check (sort_order >= 0),
  constraint laundry_profile_items_ref_check check (
    garment_type_id is not null or garment_code is not null or service_code is not null
  )
);

create index laundry_profile_items_profile_idx
  on public.laundry_profile_items (profile_id, sort_order);

-- Bibliothèque de modèles (sans prix, comme le catalogue).
insert into public.laundry_profiles (tenant_id, code, name, description, profile_kind) values
  (null, 'PRESSING_CLASSIQUE', 'Pressing classique', 'Lavage et repassage à la pièce pour la clientèle quotidienne.', 'system_template'),
  (null, 'BLANCHISSERIE_KILO', 'Blanchisserie au kilo', 'Linge courant et linge de maison facturés au poids.', 'system_template'),
  (null, 'OFFRE_PREMIUM', 'Offre premium', 'Pièces délicates et tenues de cérémonie, finitions soignées.', 'system_template'),
  (null, 'LINGE_PROFESSIONNEL', 'Linge professionnel', 'Uniformes et linge d’entreprise en volume.', 'system_template')
on conflict (code) where tenant_id is null do nothing;

insert into public.laundry_profile_items (profile_id, garment_type_id, garment_code, sort_order)
select p.id, g.id, g.code, x.ordre
  from (values
    ('PRESSING_CLASSIQUE', 'SHIRT', 10),
    ('PRESSING_CLASSIQUE', 'TROUSERS', 20),
    ('PRESSING_CLASSIQUE', 'SUIT_2P', 30),
    ('PRESSING_CLASSIQUE', 'DRESS_LONG', 40),
    ('PRESSING_CLASSIQUE', 'JACKET', 50),
    ('BLANCHISSERIE_KILO', 'WASH_BAG_KG', 10),
    ('BLANCHISSERIE_KILO', 'BED_SHEET', 20),
    ('BLANCHISSERIE_KILO', 'TOWEL_BATH', 30),
    ('OFFRE_PREMIUM', 'EVENING_DRESS', 10),
    ('OFFRE_PREMIUM', 'WEDDING_DRESS', 20),
    ('OFFRE_PREMIUM', 'BAZIN', 30),
    ('OFFRE_PREMIUM', 'LEATHER_JACKET', 40),
    ('OFFRE_PREMIUM', 'SUIT_3P', 50),
    ('LINGE_PROFESSIONNEL', 'UNIFORM', 10),
    ('LINGE_PROFESSIONNEL', 'LAB_COAT', 20),
    ('LINGE_PROFESSIONNEL', 'CHEF_JACKET', 30),
    ('LINGE_PROFESSIONNEL', 'WORKWEAR', 40),
    ('LINGE_PROFESSIONNEL', 'TABLECLOTH', 50)
  ) as x(profile_code, garment_code, ordre)
  join public.laundry_profiles p on p.code = x.profile_code and p.tenant_id is null
  join public.garment_types g on g.code = x.garment_code and g.tenant_id is null
where not exists (
  select 1 from public.laundry_profile_items i
   where i.profile_id = p.id and i.garment_code = x.garment_code
);

insert into public.laundry_profile_items (profile_id, service_code, sort_order)
select p.id, 'WASH_KG', 5
  from public.laundry_profiles p
 where p.code = 'BLANCHISSERIE_KILO' and p.tenant_id is null
   and not exists (
     select 1 from public.laundry_profile_items i
      where i.profile_id = p.id and i.service_code = 'WASH_KG'
   );

-- Copie indépendante d'un modèle pour le pressing courant (propriétaire).
create or replace function public.duplicate_laundry_profile(
  p_profile uuid,
  p_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_source public.laundry_profiles%rowtype;
  v_new_id uuid;
  v_code text;
  v_candidate text;
  v_suffix integer := 1;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  if public.current_tenant_role() <> 'owner' then
    raise exception 'Seul le propriétaire peut dupliquer un modèle.' using errcode = '42501';
  end if;

  select * into v_source from public.laundry_profiles
   where id = p_profile and (tenant_id is null or tenant_id = v_tenant);
  if not found then
    raise exception 'Modèle introuvable pour ce pressing.' using errcode = '42501';
  end if;

  v_code := v_source.code;
  if v_source.tenant_id is not null then
    v_candidate := v_code || '_COPIE';
    while exists (
      select 1 from public.laundry_profiles
       where tenant_id = v_tenant and code = v_candidate
    ) loop
      v_suffix := v_suffix + 1;
      v_candidate := v_code || '_COPIE_' || v_suffix;
    end loop;
    v_code := v_candidate;
  elsif exists (
    select 1 from public.laundry_profiles
     where tenant_id = v_tenant and code = v_code
  ) then
    raise exception 'Ce modèle est déjà installé pour ce pressing.' using errcode = '23505';
  end if;

  insert into public.laundry_profiles
    (tenant_id, code, name, description, profile_kind, is_active)
  values (
    v_tenant,
    left(v_code, 40),
    coalesce(nullif(btrim(p_name), ''), v_source.name),
    v_source.description,
    'custom',
    true
  )
  returning id into v_new_id;

  insert into public.laundry_profile_items
    (profile_id, garment_type_id, garment_code, service_code, sort_order)
  select v_new_id,
         coalesce(tg.id, i.garment_type_id),
         i.garment_code,
         i.service_code,
         i.sort_order
    from public.laundry_profile_items i
    left join public.garment_types tg
      on tg.tenant_id = v_tenant and tg.code = i.garment_code
   where i.profile_id = v_source.id;

  return v_new_id;
end;
$$;

revoke all on function public.duplicate_laundry_profile(uuid, text) from public, anon;
grant execute on function public.duplicate_laundry_profile(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Forfaits commerciaux
-- ---------------------------------------------------------------------------
create table public.commercial_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9_]{2,40}$'),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text,
  price_xof integer not null check (price_xof between 1 and 10000000),
  is_active boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commercial_packages_tenant_code_unique unique (tenant_id, code),
  constraint commercial_packages_id_tenant_unique unique (id, tenant_id)
);

create table public.commercial_package_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  package_id uuid not null,
  garment_type_id uuid,
  tenant_service_id uuid,
  label text,
  quantity integer not null default 1 check (quantity between 1 and 1000),
  sort_order integer not null default 0 check (sort_order >= 0),
  constraint commercial_package_items_package_fk
    foreign key (package_id, tenant_id)
    references public.commercial_packages (id, tenant_id) on delete cascade,
  constraint commercial_package_items_garment_fk
    foreign key (garment_type_id, tenant_id)
    references public.garment_types (id, tenant_id) on delete set null (garment_type_id),
  constraint commercial_package_items_service_fk
    foreign key (tenant_service_id, tenant_id)
    references public.tenant_services (id, tenant_id) on delete set null (tenant_service_id)
);

create index commercial_package_items_package_idx
  on public.commercial_package_items (package_id, sort_order);

create trigger trg_laundry_profiles_updated_at
  before update on public.laundry_profiles
  for each row execute function public.update_updated_at_column();
create trigger trg_commercial_packages_updated_at
  before update on public.commercial_packages
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.laundry_profiles enable row level security;
alter table public.laundry_profile_items enable row level security;
alter table public.commercial_packages enable row level security;
alter table public.commercial_package_items enable row level security;

create policy laundry_profiles_select_member
  on public.laundry_profiles for select to authenticated
  using (tenant_id is null or tenant_id = public.current_tenant_id());
create policy laundry_profiles_insert_owner
  on public.laundry_profiles for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner');
create policy laundry_profiles_update_owner
  on public.laundry_profiles for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner');
create policy laundry_profiles_delete_owner
  on public.laundry_profiles for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner');

create policy laundry_profile_items_select_member
  on public.laundry_profile_items for select to authenticated
  using (exists (
    select 1 from public.laundry_profiles p
     where p.id = profile_id
       and (p.tenant_id is null or p.tenant_id = public.current_tenant_id())
  ));
create policy laundry_profile_items_insert_owner
  on public.laundry_profile_items for insert to authenticated
  with check (
    public.current_tenant_role() = 'owner'
    and exists (
      select 1 from public.laundry_profiles p
       where p.id = profile_id and p.tenant_id = public.current_tenant_id()
    )
  );
create policy laundry_profile_items_update_owner
  on public.laundry_profile_items for update to authenticated
  using (
    public.current_tenant_role() = 'owner'
    and exists (
      select 1 from public.laundry_profiles p
       where p.id = profile_id and p.tenant_id = public.current_tenant_id()
    )
  )
  with check (
    public.current_tenant_role() = 'owner'
    and exists (
      select 1 from public.laundry_profiles p
       where p.id = profile_id and p.tenant_id = public.current_tenant_id()
    )
  );
create policy laundry_profile_items_delete_owner
  on public.laundry_profile_items for delete to authenticated
  using (
    public.current_tenant_role() = 'owner'
    and exists (
      select 1 from public.laundry_profiles p
       where p.id = profile_id and p.tenant_id = public.current_tenant_id()
    )
  );

create policy commercial_packages_select_member
  on public.commercial_packages for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy commercial_packages_insert_owner
  on public.commercial_packages for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner');
create policy commercial_packages_update_owner
  on public.commercial_packages for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner');
create policy commercial_packages_delete_owner
  on public.commercial_packages for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner');

create policy commercial_package_items_select_member
  on public.commercial_package_items for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy commercial_package_items_insert_owner
  on public.commercial_package_items for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner');
create policy commercial_package_items_update_owner
  on public.commercial_package_items for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner');
create policy commercial_package_items_delete_owner
  on public.commercial_package_items for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner');

revoke all on public.laundry_profiles, public.laundry_profile_items,
  public.commercial_packages, public.commercial_package_items from anon, public;
grant select, insert, update, delete on public.laundry_profiles, public.laundry_profile_items,
  public.commercial_packages, public.commercial_package_items to authenticated;

comment on table public.laundry_profiles is
  'Modèles de blanchisserie : bibliothèque système sans prix et copies personnalisées par pressing.';
comment on table public.commercial_packages is
  'Forfaits commerciaux (prix global) ; la vente en caisse fait l’objet d’un lot ultérieur.';

commit;
