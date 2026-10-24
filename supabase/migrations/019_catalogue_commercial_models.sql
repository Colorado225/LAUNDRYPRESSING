-- =============================================================================
-- 019_catalogue_commercial_models.sql — modèles de catalogue et forfaits famille
-- =============================================================================
-- Référentiel éditable par tenant, sans prix de départ. Les modèles de base
-- sont des exemples réutilisables, copiés à la demande et jamais liés par FK
-- aux données du pressing. Les commandes gardent leurs propres instantanés.
-- =============================================================================

begin;

-- Opérations d'atelier attachables à une prestation commerciale.
create table public.catalog_operation_definitions (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  sort_order integer not null default 0
);

insert into public.catalog_operation_definitions (code, name, sort_order) values
  ('WASH', 'Lavage', 10),
  ('DRY', 'Séchage', 20),
  ('IRON', 'Repassage', 30),
  ('STAIN_TREATMENT', 'Détachage', 40),
  ('FOLD', 'Pliage', 50),
  ('DRY_CLEAN', 'Nettoyage à sec', 60),
  ('REPAIR', 'Réparation', 70),
  ('PACK', 'Emballage', 80)
on conflict (code) do update set name = excluded.name, sort_order = excluded.sort_order;

create table public.catalog_template_installations (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  imported_at timestamptz not null default now(),
  imported_by uuid references auth.users(id) on delete set null
);

create table public.catalog_model_templates (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,59}$'),
  template_kind text not null check (template_kind in ('FAMILY', 'ARTICLE', 'SERVICE')),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  parent_code text references public.catalog_model_templates(code) on delete cascade,
  description text,
  default_unit text check (default_unit is null or default_unit in
    ('PIECE', 'PAIR', 'SET', 'KG', 'M2', 'METER', 'PACKAGE', 'FLAT')),
  service_type text check (service_type is null or service_type in ('treatment', 'option', 'logistics', 'other')),
  application_scope text check (application_scope is null or application_scope in ('article', 'order')),
  operation_codes text[] not null default '{}',
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint catalog_model_templates_parent_kind check (
    (template_kind = 'FAMILY' and parent_code is null and default_unit is null
      and service_type is null and application_scope is null)
    or (template_kind = 'ARTICLE' and parent_code is not null and default_unit is not null
      and service_type is null and application_scope is null)
    or (template_kind = 'SERVICE' and parent_code is null and default_unit is null
      and service_type is not null and application_scope is not null)
  )
);

-- Codes d'exemple génériques, non tarifés et non contractuels.
insert into public.catalog_model_templates
  (code, template_kind, name, parent_code, default_unit, sort_order)
values
  ('family_clothing', 'FAMILY', 'Vêtements', null, null, 10),
  ('family_household', 'FAMILY', 'Linge de maison', null, null, 20),
  ('family_accessories', 'FAMILY', 'Accessoires', null, null, 30),
  ('family_professional', 'FAMILY', 'Textile professionnel', null, null, 40)
on conflict (code) do nothing;

insert into public.catalog_model_templates
  (code, template_kind, name, parent_code, default_unit, sort_order)
values
  ('article_shirt', 'ARTICLE', 'Chemise', 'family_clothing', 'PIECE', 10),
  ('article_trousers', 'ARTICLE', 'Pantalon', 'family_clothing', 'PIECE', 20),
  ('article_dress', 'ARTICLE', 'Robe', 'family_clothing', 'PIECE', 30),
  ('article_suit', 'ARTICLE', 'Costume', 'family_clothing', 'SET', 40),
  ('article_jacket', 'ARTICLE', 'Veste', 'family_clothing', 'PIECE', 50),
  ('article_skirt', 'ARTICLE', 'Jupe', 'family_clothing', 'PIECE', 60),
  ('article_boubou', 'ARTICLE', 'Boubou', 'family_clothing', 'PIECE', 70),
  ('article_sheet', 'ARTICLE', 'Drap', 'family_household', 'PIECE', 10),
  ('article_duvet', 'ARTICLE', 'Couette', 'family_household', 'PIECE', 20),
  ('article_curtain', 'ARTICLE', 'Rideau', 'family_household', 'M2', 30),
  ('article_towel', 'ARTICLE', 'Serviette', 'family_household', 'PIECE', 40),
  ('article_tie', 'ARTICLE', 'Cravate', 'family_accessories', 'PIECE', 10),
  ('article_scarf', 'ARTICLE', 'Écharpe', 'family_accessories', 'PIECE', 20),
  ('article_uniform', 'ARTICLE', 'Uniforme', 'family_professional', 'PIECE', 10),
  ('article_overall', 'ARTICLE', 'Combinaison de travail', 'family_professional', 'PIECE', 20)
on conflict (code) do nothing;

insert into public.catalog_model_templates
  (code, template_kind, name, service_type, application_scope, operation_codes, sort_order)
values
  ('service_wash_iron', 'SERVICE', 'Lavage et repassage', 'treatment', 'article', array['WASH','DRY','IRON','FOLD'], 10),
  ('service_wash', 'SERVICE', 'Lavage', 'treatment', 'article', array['WASH','DRY','FOLD'], 20),
  ('service_iron', 'SERVICE', 'Repassage', 'treatment', 'article', array['IRON','FOLD'], 30),
  ('service_dry_clean', 'SERVICE', 'Nettoyage à sec', 'treatment', 'article', array['DRY_CLEAN','IRON','FOLD'], 40),
  ('service_stain', 'SERVICE', 'Détachage', 'option', 'article', array['STAIN_TREATMENT'], 50),
  ('service_repair', 'SERVICE', 'Réparation', 'option', 'article', array['REPAIR'], 60),
  ('service_delivery', 'SERVICE', 'Collecte et livraison', 'logistics', 'order', array[]::text[], 70)
on conflict (code) do nothing;

-- Bibliothèque de modèles professionnels réutilisables. Elle ne contient
-- volontairement aucune colonne de prix : chaque pressing saisit son propre tarif.
create table public.laundry_model_templates (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{1,59}$'),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text,
  model_type text not null check (model_type in ('PER_KG', 'WEIGHT_PACKAGE', 'FAMILY_PACKAGE')),
  pricing_basis text not null check (pricing_basis in ('KG', 'PIECE')),
  included_weight_kg numeric(10,3),
  included_pieces integer,
  conditions text,
  exclusions text,
  turnaround_days integer,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint laundry_model_templates_parameters check (
    (model_type = 'PER_KG' and pricing_basis = 'KG' and included_weight_kg is null and included_pieces is null)
    or (model_type = 'WEIGHT_PACKAGE' and pricing_basis = 'KG' and included_weight_kg is not null
      and included_weight_kg > 0 and included_pieces is null)
    or (model_type = 'FAMILY_PACKAGE' and pricing_basis = 'PIECE' and included_weight_kg is null
      and (included_pieces is null or included_pieces between 1 and 1000))
  )
);
create table public.laundry_model_template_services (
  template_code text not null references public.laundry_model_templates(code) on delete cascade,
  service_template_code text not null references public.catalog_model_templates(code) on delete no action,
  inclusion_mode text not null check (inclusion_mode in ('INCLUDED', 'EXTRA')),
  sort_order integer not null default 0,
  primary key (template_code, service_template_code)
);
create table public.laundry_model_template_families (
  template_code text not null references public.laundry_model_templates(code) on delete cascade,
  family_template_code text not null references public.catalog_model_templates(code) on delete no action,
  primary key (template_code, family_template_code)
);

insert into public.laundry_model_templates
  (code, name, description, model_type, pricing_basis, included_weight_kg, included_pieces, sort_order)
values
  ('pro_linen_per_kg', 'Linge professionnel au kilo', 'Base réutilisable pour le linge courant des entreprises.', 'PER_KG', 'KG', null, null, 10),
  ('pro_uniform_weight_package', 'Forfait linge professionnel au poids', 'Forfait de poids à personnaliser par le pressing.', 'WEIGHT_PACKAGE', 'KG', 10, null, 20),
  ('pro_uniform_piece_package', 'Forfait textile professionnel par pièce', 'Forfait au nombre de pièces, composition à préciser à la réception.', 'FAMILY_PACKAGE', 'PIECE', null, null, 30)
on conflict (code) do nothing;
insert into public.laundry_model_template_services (template_code, service_template_code, inclusion_mode, sort_order) values
  ('pro_linen_per_kg', 'service_wash_iron', 'INCLUDED', 0),
  ('pro_uniform_weight_package', 'service_wash_iron', 'INCLUDED', 0),
  ('pro_uniform_piece_package', 'service_wash_iron', 'INCLUDED', 0)
on conflict do nothing;
insert into public.laundry_model_template_families (template_code, family_template_code) values
  ('pro_uniform_weight_package', 'family_professional'),
  ('pro_uniform_piece_package', 'family_professional')
on conflict do nothing;

-- Identifiants optionnels reliant les copies du tenant à leur modèle source.
alter table public.catalog_families add column template_code text;
alter table public.catalog_articles add column template_code text;
alter table public.catalog_services add column template_code text;

alter table public.catalog_families
  add constraint catalog_families_template_fk
  foreign key (template_code) references public.catalog_model_templates(code) on delete set null;
alter table public.catalog_articles
  add constraint catalog_articles_template_fk
  foreign key (template_code) references public.catalog_model_templates(code) on delete set null;
alter table public.catalog_services
  add constraint catalog_services_template_fk
  foreign key (template_code) references public.catalog_model_templates(code) on delete set null;

create unique index catalog_families_template_tenant_key
  on public.catalog_families (tenant_id, template_code) where template_code is not null;
create unique index catalog_articles_template_tenant_key
  on public.catalog_articles (tenant_id, template_code) where template_code is not null;
create unique index catalog_services_template_tenant_key
  on public.catalog_services (tenant_id, template_code) where template_code is not null;

-- Synonymes contextuels : un alias ne devient jamais une catégorie ou un tarif.
create table public.catalog_article_aliases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  article_id uuid not null,
  alias text not null check (char_length(btrim(alias)) between 2 and 80),
  alias_key text generated always as (public.catalog_name_key(alias)) stored,
  created_at timestamptz not null default now(),
  constraint catalog_article_aliases_article_fk foreign key (article_id, tenant_id)
    references public.catalog_articles(id, tenant_id) on delete cascade,
  constraint catalog_article_aliases_name_unique unique (tenant_id, alias_key)
);
create index catalog_article_aliases_article_idx
  on public.catalog_article_aliases (tenant_id, article_id);

create table public.catalog_service_operations (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_id uuid not null,
  operation_code text not null references public.catalog_operation_definitions(code),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (tenant_id, service_id, operation_code),
  constraint catalog_service_operations_service_fk foreign key (service_id, tenant_id)
    references public.catalog_services(id, tenant_id) on delete cascade
);

-- Une prestation répétée sur la même ligne commerciale n'est facturée qu'une
-- fois ; son détail d'atelier reste consultable dans la table associée.
alter table public.order_items
  add column service_operations_snapshot jsonb not null default '[]'::jsonb;
alter table public.order_items
  add constraint order_items_service_operations_snapshot_array
  check (jsonb_typeof(service_operations_snapshot) = 'array');

create or replace function public.snapshot_catalog_service_operations()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.catalog_entry_id is not distinct from old.catalog_entry_id then
    return new;
  end if;
  new.service_operations_snapshot := '[]'::jsonb;
  if new.catalog_entry_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('code', d.code, 'name', d.name)
                              order by so.sort_order, d.sort_order, d.code), '[]'::jsonb)
      into new.service_operations_snapshot
      from public.catalog_entries ce
      join public.catalog_service_operations so
        on so.tenant_id = ce.tenant_id and so.service_id = ce.service_id
      join public.catalog_operation_definitions d on d.code = so.operation_code
     where ce.tenant_id = new.tenant_id and ce.id = new.catalog_entry_id;
  end if;
  return new;
end;
$$;
create trigger trg_order_items_snapshot_service_operations
  before insert or update on public.order_items
  for each row execute function public.snapshot_catalog_service_operations();

create or replace function public.snapshot_laundry_model_operations()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if new.laundry_model_id is not distinct from old.laundry_model_id then
      new.service_operations_snapshot := old.service_operations_snapshot;
      return new;
    end if;
    if new.laundry_model_id is null and old.laundry_model_id is not null then
      new.service_operations_snapshot := old.service_operations_snapshot;
      return new;
    end if;
  end if;
  if new.laundry_model_id is null then return new; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'service_id', cs.id,
      'service_name', cs.name,
      'inclusion_mode', lms.inclusion_mode,
      'operation_code', op.code,
      'operation_name', op.name
    ) order by lms.sort_order, so.sort_order, op.sort_order, op.code), '[]'::jsonb)
    into new.service_operations_snapshot
    from public.laundry_model_services lms
    join public.catalog_services cs on cs.id = lms.service_id and cs.tenant_id = lms.tenant_id
    join public.catalog_service_operations so on so.service_id = cs.id and so.tenant_id = cs.tenant_id
    join public.catalog_operation_definitions op on op.code = so.operation_code
   where lms.tenant_id = new.tenant_id and lms.model_id = new.laundry_model_id;
  return new;
end;
$$;
create trigger trg_order_items_zz_model_operations
  before insert or update on public.order_items
  for each row execute function public.snapshot_laundry_model_operations();

-- Catalogue métier initialement vide côté tenant : aucun montant ni tarif
-- n'est créé par cette migration.
create or replace function public.apply_catalog_model_templates()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_family_count integer := 0;
  v_article_count integer := 0;
  v_service_count integer := 0;
  v_alias_count integer := 0;
  v_operation_count integer := 0;
begin
  if v_tenant is null or public.current_tenant_role() <> 'owner' then
    raise exception 'Seul le propriétaire peut importer les modèles de catalogue.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text, 19));
  insert into public.catalog_template_installations (tenant_id, imported_by)
    values (v_tenant, auth.uid()) on conflict (tenant_id) do nothing;

  insert into public.catalog_families (tenant_id, name, description, sort_order, template_code)
  select v_tenant, t.name, 'Modèle modifiable — aucun tarif par défaut.', t.sort_order, t.code
    from public.catalog_model_templates t
   where t.template_kind = 'FAMILY' and t.is_active
     and not exists (select 1 from public.catalog_families f
                      where f.tenant_id = v_tenant
                        and (f.template_code = t.code or public.catalog_name_key(f.name) = public.catalog_name_key(t.name)));
  get diagnostics v_family_count = row_count;

  update public.catalog_families f set template_code = t.code
    from public.catalog_model_templates t
   where f.tenant_id = v_tenant and f.template_code is null and t.template_kind = 'FAMILY'
     and public.catalog_name_key(f.name) = public.catalog_name_key(t.name)
     and not exists (select 1 from public.catalog_families other
                      where other.tenant_id = v_tenant and other.template_code = t.code);

  insert into public.catalog_articles (tenant_id, family_id, name, default_unit, sort_order, template_code)
  select v_tenant, f.id, a.name, a.default_unit, a.sort_order, a.code
    from public.catalog_model_templates a
    join public.catalog_model_templates ft on ft.code = a.parent_code
    join public.catalog_families f on f.tenant_id = v_tenant and f.template_code = ft.code
   where a.template_kind = 'ARTICLE' and a.is_active
     and not exists (select 1 from public.catalog_articles ca where ca.tenant_id = v_tenant
                      and (ca.template_code = a.code or public.catalog_name_key(ca.name) = public.catalog_name_key(a.name)));
  get diagnostics v_article_count = row_count;

  update public.catalog_articles ca set template_code = a.code
    from public.catalog_model_templates a
   where ca.tenant_id = v_tenant and ca.template_code is null and a.template_kind = 'ARTICLE'
     and public.catalog_name_key(ca.name) = public.catalog_name_key(a.name)
     and exists (select 1 from public.catalog_families f
                  where f.id = ca.family_id and f.tenant_id = v_tenant and f.template_code = a.parent_code)
     and not exists (select 1 from public.catalog_articles other
                      where other.tenant_id = v_tenant and other.template_code = a.code);

  insert into public.catalog_services (tenant_id, name, service_type, application_scope, description, sort_order, template_code)
  select v_tenant, t.name, t.service_type, t.application_scope,
         'Modèle modifiable — aucun tarif par défaut.', t.sort_order, t.code
    from public.catalog_model_templates t
   where t.template_kind = 'SERVICE' and t.is_active
     and not exists (select 1 from public.catalog_services s where s.tenant_id = v_tenant
                      and (s.template_code = t.code or public.catalog_name_key(s.name) = public.catalog_name_key(t.name)));
  get diagnostics v_service_count = row_count;

  update public.catalog_services s set template_code = t.code
    from public.catalog_model_templates t
   where s.tenant_id = v_tenant and s.template_code is null and t.template_kind = 'SERVICE'
     and public.catalog_name_key(s.name) = public.catalog_name_key(t.name)
     and not exists (select 1 from public.catalog_services other
                      where other.tenant_id = v_tenant and other.template_code = t.code);

  insert into public.catalog_article_aliases (tenant_id, article_id, alias)
  select v_tenant, ca.id, alias_value.alias
    from public.catalog_model_templates t
    join public.catalog_articles ca on ca.tenant_id = v_tenant and ca.template_code = t.code
    cross join lateral unnest(case t.code
      when 'article_shirt' then array['Chemisette','Chemise homme','Chemise femme']::text[]
      when 'article_trousers' then array['Pantalon homme','Pantalon femme']::text[]
      when 'article_boubou' then array['Boubou traditionnel']::text[]
      when 'article_duvet' then array['Couverture','Édredon']::text[]
      else array[]::text[] end) as alias_value(alias)
   where not exists (select 1 from public.catalog_article_aliases aa
                      where aa.tenant_id = v_tenant
                        and aa.alias_key = public.catalog_name_key(alias_value.alias))
     and not exists (select 1 from public.catalog_articles other
                      where other.tenant_id = v_tenant
                        and public.catalog_name_key(other.name) = public.catalog_name_key(alias_value.alias));
  get diagnostics v_alias_count = row_count;

  insert into public.catalog_service_operations (tenant_id, service_id, operation_code, sort_order)
  select v_tenant, s.id, op.code, op.ordinality::integer
    from public.catalog_model_templates t
    join public.catalog_services s on s.tenant_id = v_tenant and s.template_code = t.code
    cross join lateral unnest(t.operation_codes) with ordinality as op(code, ordinality)
   where not exists (select 1 from public.catalog_service_operations old
                      where old.tenant_id = v_tenant and old.service_id = s.id and old.operation_code = op.code);
  get diagnostics v_operation_count = row_count;

  return jsonb_build_object('families', v_family_count, 'articles', v_article_count,
    'services', v_service_count, 'aliases', v_alias_count, 'operations', v_operation_count);
end;
$$;
revoke all on function public.apply_catalog_model_templates() from public, anon;
grant execute on function public.apply_catalog_model_templates() to authenticated;

create or replace function public.initialize_catalog_model_templates()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_result jsonb;
begin
  if v_tenant is null or public.current_tenant_role() <> 'owner' then
    raise exception 'Seul le propriétaire peut initialiser les modèles de catalogue.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text, 19));
  if exists (select 1 from public.catalog_template_installations i where i.tenant_id = v_tenant) then
    return jsonb_build_object('initialized', true, 'imported', false);
  end if;
  if exists (select 1 from public.catalog_families f where f.tenant_id = v_tenant)
     or exists (select 1 from public.catalog_articles a where a.tenant_id = v_tenant)
     or exists (select 1 from public.catalog_services s where s.tenant_id = v_tenant) then
    insert into public.catalog_template_installations (tenant_id, imported_by)
      values (v_tenant, auth.uid()) on conflict (tenant_id) do nothing;
    return jsonb_build_object('initialized', true, 'imported', false, 'reason', 'catalogue_existant');
  end if;
  v_result := public.apply_catalog_model_templates();
  return v_result || jsonb_build_object('initialized', true, 'imported', true);
end;
$$;
revoke all on function public.initialize_catalog_model_templates() from public, anon;
grant execute on function public.initialize_catalog_model_templates() to authenticated;

-- Modifications des détails non tarifaires par le propriétaire du tenant.
create or replace function public.save_catalog_service_operations(
  p_service_id uuid,
  p_operation_codes text[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null or public.current_tenant_role() <> 'owner' then
    raise exception 'Seul le propriétaire peut modifier les opérations d''atelier.' using errcode = '42501';
  end if;
  if p_operation_codes is null or cardinality(p_operation_codes) > 20
     or cardinality(p_operation_codes) <> (select count(distinct selected.code)
                                              from unnest(p_operation_codes) as selected(code)) then
    raise exception 'La liste des opérations est invalide ou contient des doublons.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.catalog_services s
                  where s.id = p_service_id and s.tenant_id = v_tenant) then
    raise exception 'La prestation n''existe pas dans ce pressing.' using errcode = '23503';
  end if;
  if exists (select 1 from unnest(p_operation_codes) selected(code)
             left join public.catalog_operation_definitions d on d.code = selected.code
             where d.code is null) then
    raise exception 'Une opération d''atelier sélectionnée est inconnue.' using errcode = '23503';
  end if;
  delete from public.catalog_service_operations where tenant_id = v_tenant and service_id = p_service_id;
  insert into public.catalog_service_operations (tenant_id, service_id, operation_code, sort_order)
  select v_tenant, p_service_id, selected.code, selected.ordinality::integer
    from unnest(p_operation_codes) with ordinality as selected(code, ordinality);
end;
$$;

create or replace function public.save_catalog_article_aliases(
  p_article_id uuid,
  p_aliases text[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := public.current_tenant_id();
begin
  if v_tenant is null or public.current_tenant_role() <> 'owner' then
    raise exception 'Seul le propriétaire peut modifier les alias du catalogue.' using errcode = '42501';
  end if;
  if p_aliases is null or cardinality(p_aliases) > 30
     or exists (select 1 from unnest(p_aliases) as alias_value(value)
                 where char_length(btrim(alias_value.value)) not between 2 and 80)
     or cardinality(p_aliases) <> (select count(distinct public.catalog_name_key(alias_value.value))
                                     from unnest(p_aliases) as alias_value(value)) then
    raise exception 'La liste des alias est invalide ou contient des doublons.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.catalog_articles a
                  where a.id = p_article_id and a.tenant_id = v_tenant) then
    raise exception 'L''article n''existe pas dans ce pressing.' using errcode = '23503';
  end if;
  if exists (select 1 from unnest(p_aliases) selected(alias)
             join public.catalog_articles a on a.tenant_id = v_tenant
               and public.catalog_name_key(a.name) = public.catalog_name_key(selected.alias)
               and a.id <> p_article_id) then
    raise exception 'Un alias entre en conflit avec un article du catalogue.' using errcode = '23505';
  end if;
  if exists (select 1 from unnest(p_aliases) selected(alias)
             join public.catalog_article_aliases existing on existing.tenant_id = v_tenant
               and existing.alias_key = public.catalog_name_key(selected.alias)
               and existing.article_id <> p_article_id) then
    raise exception 'Un alias est déjà utilisé par un autre article.' using errcode = '23505';
  end if;
  delete from public.catalog_article_aliases where tenant_id = v_tenant and article_id = p_article_id;
  insert into public.catalog_article_aliases (tenant_id, article_id, alias)
  select v_tenant, p_article_id, btrim(alias_value.value)
    from unnest(p_aliases) as alias_value(value);
end;
$$;
revoke all on function public.save_catalog_service_operations(uuid, text[]) from public, anon;
revoke all on function public.save_catalog_article_aliases(uuid, text[]) from public, anon;
grant execute on function public.save_catalog_service_operations(uuid, text[]) to authenticated;
grant execute on function public.save_catalog_article_aliases(uuid, text[]) to authenticated;

-- Tarifs commerciaux par kilo ou par pièce explicitement distingués.
alter table public.laundry_models
  add column pricing_basis text not null default 'KG',
  add column included_pieces integer,
  add column overage_price_per_piece numeric(12,0);
alter table public.laundry_models drop constraint laundry_models_per_kg_fields;
alter table public.laundry_models drop constraint laundry_models_model_type_check;
alter table public.laundry_models add constraint laundry_models_model_type_check
  check (model_type in ('PER_KG', 'WEIGHT_PACKAGE', 'FAMILY_PACKAGE'));
alter table public.laundry_models drop constraint if exists laundry_models_pricing_basis_check;
alter table public.laundry_models add constraint laundry_models_pricing_basis_check
  check (pricing_basis in ('KG', 'PIECE'));
alter table public.laundry_models add constraint laundry_models_per_kg_fields check (
  (model_type = 'PER_KG' and pricing_basis = 'KG'
    and price_per_kg between 1 and 10000000 and package_price is null
    and included_weight_kg is null and overage_price_per_kg is null
    and included_pieces is null and overage_price_per_piece is null)
  or
  (model_type = 'WEIGHT_PACKAGE' and pricing_basis = 'KG'
    and price_per_kg is null and package_price between 1 and 10000000
    and included_weight_kg > 0 and minimum_weight_kg is null
    and (overage_price_per_kg is null or overage_price_per_kg between 0 and 10000000)
    and included_pieces is null and overage_price_per_piece is null)
  or
  (model_type = 'FAMILY_PACKAGE' and pricing_basis = 'PIECE'
    and price_per_kg is null and package_price between 1 and 10000000
    and included_weight_kg is null and overage_price_per_kg is null
    and minimum_weight_kg is null and included_pieces between 1 and 1000
    and (overage_price_per_piece is null or overage_price_per_piece between 0 and 10000000))
);

create table public.laundry_model_catalog_scope (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  model_id uuid not null,
  family_id uuid,
  article_id uuid,
  created_at timestamptz not null default now(),
  constraint laundry_model_catalog_scope_selector check (num_nonnulls(family_id, article_id) = 1),
  constraint laundry_model_catalog_scope_model_fk foreign key (model_id, tenant_id)
    references public.laundry_models(id, tenant_id) on delete cascade,
  constraint laundry_model_catalog_scope_family_fk foreign key (family_id, tenant_id)
    references public.catalog_families(id, tenant_id) on delete no action,
  constraint laundry_model_catalog_scope_article_fk foreign key (article_id, tenant_id)
    references public.catalog_articles(id, tenant_id) on delete no action
);
create unique index laundry_model_scope_family_unique
  on public.laundry_model_catalog_scope(tenant_id, model_id, family_id) where family_id is not null;
create unique index laundry_model_scope_article_unique
  on public.laundry_model_catalog_scope(tenant_id, model_id, article_id) where article_id is not null;

-- Un seul RPC d'enregistrement conserve l'atomicité existante, et accepte en
-- plus le nouveau forfait famille et sa portée articles/familles.
drop function public.save_laundry_model(json, json);
create function public.save_laundry_model(p_model json, p_services json default '[]'::json, p_scope json default '[]'::json)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_model ->> 'id', '')::uuid;
  v_type text := p_model ->> 'model_type';
  v_basis text := coalesce(nullif(p_model ->> 'pricing_basis', ''), 'KG');
  v_name text := btrim(coalesce(p_model ->> 'name', ''));
  v_audience text := coalesce(nullif(p_model ->> 'audience', ''), 'ALL');
  v_service_ids uuid[];
begin
  if v_tenant is null or public.current_tenant_role() <> 'owner' then
    raise exception 'Seul le propriétaire du pressing peut gérer les modèles commerciaux.' using errcode = '42501';
  end if;
  if v_type not in ('PER_KG', 'WEIGHT_PACKAGE', 'FAMILY_PACKAGE')
      or (v_type = 'FAMILY_PACKAGE' and v_basis <> 'PIECE')
      or (v_type <> 'FAMILY_PACKAGE' and v_basis <> 'KG') then
    raise exception 'Le type de forfait et sa base de facturation sont incohérents.' using errcode = '22023';
  end if;
  if char_length(v_name) not between 2 and 80 then
    raise exception 'Le nom doit contenir entre 2 et 80 caractères.' using errcode = '22023';
  end if;
  if v_audience not in ('ALL', 'INDIVIDUAL', 'PROFESSIONAL') then
    raise exception 'La clientèle indiquée n''est pas valide.' using errcode = '22023';
  end if;
  if json_typeof(coalesce(p_services, '[]'::json)) <> 'array'
     or json_typeof(coalesce(p_scope, '[]'::json)) <> 'array' then
    raise exception 'Les prestations et les articles sélectionnés doivent être des tableaux.' using errcode = '22023';
  end if;
  if exists (select 1 from json_array_elements(coalesce(p_services, '[]'::json)) s
              group by s ->> 'service_id' having count(*) > 1)
     or exists (select 1 from json_array_elements(coalesce(p_services, '[]'::json)) s
                 where coalesce(s ->> 'inclusion_mode', '') not in ('INCLUDED', 'EXTRA')
                    or coalesce(s ->> 'service_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'Une prestation sélectionnée ou son mode est invalide.' using errcode = '22023';
  end if;
  if exists (select 1 from json_array_elements(coalesce(p_scope, '[]'::json)) s
              where num_nonnulls(s ->> 'family_id', s ->> 'article_id') <> 1
                 or coalesce(s ->> 'family_id', s ->> 'article_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'Chaque élément du forfait doit désigner une famille ou un article.' using errcode = '22023';
  end if;
  if exists (select 1
               from json_array_elements(coalesce(p_services, '[]'::json)) with ordinality a(value, position)
               join json_array_elements(coalesce(p_services, '[]'::json)) with ordinality b(value, position)
                 on a.position < b.position and a.value ->> 'service_id' = b.value ->> 'service_id') then
    raise exception 'Une prestation ne peut apparaître qu''une fois.' using errcode = '23505';
  end if;
  select array_agg((s ->> 'service_id')::uuid) into v_service_ids
    from json_array_elements(coalesce(p_services, '[]'::json)) s;
  if exists (select 1 from unnest(coalesce(v_service_ids, array[]::uuid[])) x(id)
             left join public.catalog_services cs on cs.id = x.id and cs.tenant_id = v_tenant and cs.is_active
             where cs.id is null) then
    raise exception 'Chaque prestation doit être active et appartenir à ce pressing.' using errcode = '23503';
  end if;
  if exists (select 1 from json_array_elements(coalesce(p_scope, '[]'::json)) s
             left join public.catalog_families f on f.id = nullif(s ->> 'family_id', '')::uuid
                                                and f.tenant_id = v_tenant and f.is_active
             left join public.catalog_articles a on a.id = nullif(s ->> 'article_id', '')::uuid
                                                and a.tenant_id = v_tenant and a.is_active
             where (s ->> 'family_id' is not null and f.id is null)
                or (s ->> 'article_id' is not null and a.id is null)) then
    raise exception 'Chaque article ou famille doit être actif et appartenir à ce pressing.' using errcode = '23503';
  end if;
  if exists (select 1
               from json_array_elements(coalesce(p_scope, '[]'::json)) with ordinality a(value, position)
               join json_array_elements(coalesce(p_scope, '[]'::json)) with ordinality b(value, position)
                 on a.position < b.position
                and coalesce(a.value ->> 'family_id', a.value ->> 'article_id')
                    = coalesce(b.value ->> 'family_id', b.value ->> 'article_id')) then
    raise exception 'Un article ou une famille ne peut apparaître qu''une fois.' using errcode = '23505';
  end if;
  if v_id is not null and not exists (select 1 from public.laundry_models where id = v_id and tenant_id = v_tenant) then
    raise exception 'Ce modèle n''existe pas dans le pressing courant.' using errcode = 'P0002';
  end if;

  if v_id is null then
    insert into public.laundry_models (
      tenant_id, name, description, model_type, audience, pricing_basis,
      price_per_kg, package_price, included_weight_kg, overage_price_per_kg,
      included_pieces, overage_price_per_piece, minimum_weight_kg, billing_increment_kg,
      minimum_charge, conditions, exclusions, pickup_delivery_terms, turnaround_days,
      is_active, sort_order, created_by
    ) values (
      v_tenant, v_name, nullif(btrim(p_model ->> 'description'), ''), v_type, v_audience, v_basis,
      nullif(p_model ->> 'price_per_kg', '')::numeric,
      nullif(p_model ->> 'package_price', '')::numeric,
      nullif(p_model ->> 'included_weight_kg', '')::numeric,
      nullif(p_model ->> 'overage_price_per_kg', '')::numeric,
      nullif(p_model ->> 'included_pieces', '')::integer,
      nullif(p_model ->> 'overage_price_per_piece', '')::numeric,
      nullif(p_model ->> 'minimum_weight_kg', '')::numeric,
      nullif(p_model ->> 'billing_increment_kg', '')::numeric,
      nullif(p_model ->> 'minimum_charge', '')::numeric,
      nullif(btrim(p_model ->> 'conditions'), ''), nullif(btrim(p_model ->> 'exclusions'), ''),
      nullif(btrim(p_model ->> 'pickup_delivery_terms'), ''),
      nullif(p_model ->> 'turnaround_days', '')::integer,
      coalesce((p_model ->> 'is_active')::boolean, true),
      coalesce(nullif(p_model ->> 'sort_order', '')::integer, 0), auth.uid()
    ) returning id into v_id;
  else
    update public.laundry_models set
      name = v_name, description = nullif(btrim(p_model ->> 'description'), ''), model_type = v_type,
      audience = v_audience, pricing_basis = v_basis,
      price_per_kg = nullif(p_model ->> 'price_per_kg', '')::numeric,
      package_price = nullif(p_model ->> 'package_price', '')::numeric,
      included_weight_kg = nullif(p_model ->> 'included_weight_kg', '')::numeric,
      overage_price_per_kg = nullif(p_model ->> 'overage_price_per_kg', '')::numeric,
      included_pieces = nullif(p_model ->> 'included_pieces', '')::integer,
      overage_price_per_piece = nullif(p_model ->> 'overage_price_per_piece', '')::numeric,
      minimum_weight_kg = nullif(p_model ->> 'minimum_weight_kg', '')::numeric,
      billing_increment_kg = nullif(p_model ->> 'billing_increment_kg', '')::numeric,
      minimum_charge = nullif(p_model ->> 'minimum_charge', '')::numeric,
      conditions = nullif(btrim(p_model ->> 'conditions'), ''),
      exclusions = nullif(btrim(p_model ->> 'exclusions'), ''),
      pickup_delivery_terms = nullif(btrim(p_model ->> 'pickup_delivery_terms'), ''),
      turnaround_days = nullif(p_model ->> 'turnaround_days', '')::integer,
      is_active = coalesce((p_model ->> 'is_active')::boolean, true),
      sort_order = coalesce(nullif(p_model ->> 'sort_order', '')::integer, 0)
    where id = v_id and tenant_id = v_tenant;
  end if;

  delete from public.laundry_model_services where model_id = v_id and tenant_id = v_tenant;
  insert into public.laundry_model_services (tenant_id, model_id, service_id, inclusion_mode, sort_order)
  select v_tenant, v_id, (s ->> 'service_id')::uuid, s ->> 'inclusion_mode',
         coalesce(nullif(s ->> 'sort_order', '')::integer, 0)
    from json_array_elements(coalesce(p_services, '[]'::json)) s;

  delete from public.laundry_model_catalog_scope where model_id = v_id and tenant_id = v_tenant;
  insert into public.laundry_model_catalog_scope (tenant_id, model_id, family_id, article_id)
  select v_tenant, v_id, nullif(s ->> 'family_id', '')::uuid, nullif(s ->> 'article_id', '')::uuid
    from json_array_elements(coalesce(p_scope, '[]'::json)) s;

  return v_id;
end;
$$;
revoke all on function public.save_laundry_model(json, json, json) from public, anon;
grant execute on function public.save_laundry_model(json, json, json) to authenticated;

create or replace function public.apply_laundry_model_template(
  p_template_code text,
  p_model json,
  p_scope json default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_template public.laundry_model_templates;
  v_model jsonb := coalesce(p_model, '{}'::json)::jsonb;
  v_services json;
  v_scope json;
  v_id uuid;
begin
  if v_tenant is null or public.current_tenant_role() <> 'owner' then
    raise exception 'Seul le propriétaire peut utiliser les modèles professionnels.' using errcode = '42501';
  end if;
  if v_model ? 'id' and nullif(v_model ->> 'id', '') is not null then
    raise exception 'Un modèle réutilisable crée une nouvelle offre; il ne modifie pas une offre existante.' using errcode = '22023';
  end if;
  select * into v_template from public.laundry_model_templates t
   where t.code = p_template_code and t.is_active;
  if not found then
    raise exception 'Modèle professionnel inconnu ou archivé.' using errcode = 'P0002';
  end if;
  if v_template.model_type = 'PER_KG' and nullif(v_model ->> 'price_per_kg', '') is null then
    raise exception 'Saisissez le prix par kilogramme de cette offre professionnelle.' using errcode = '22023';
  elsif v_template.model_type in ('WEIGHT_PACKAGE', 'FAMILY_PACKAGE')
        and nullif(v_model ->> 'package_price', '') is null then
    raise exception 'Saisissez le prix global de cette offre professionnelle.' using errcode = '22023';
  end if;
  if v_template.model_type = 'FAMILY_PACKAGE'
     and coalesce(nullif(v_model ->> 'included_pieces', '')::integer, v_template.included_pieces) is null then
    raise exception 'Indiquez le nombre de pièces comprises dans le forfait professionnel.' using errcode = '22023';
  end if;

  select coalesce(json_agg(json_build_object(
      'service_id', cs.id, 'inclusion_mode', ts.inclusion_mode, 'sort_order', ts.sort_order
    ) order by ts.sort_order), '[]'::json)
    into v_services
    from public.laundry_model_template_services ts
    join public.catalog_services cs on cs.tenant_id = v_tenant and cs.template_code = ts.service_template_code
   where ts.template_code = p_template_code and cs.is_active;
  if json_array_length(v_services) = 0 then
    raise exception 'Importez d''abord les prestations du catalogue pour utiliser ce modèle.' using errcode = '23503';
  end if;

  if p_scope is null then
    select coalesce(json_agg(json_build_object('family_id', cf.id) order by cf.sort_order), '[]'::json)
      into v_scope
      from public.laundry_model_template_families tf
      join public.catalog_families cf on cf.tenant_id = v_tenant and cf.template_code = tf.family_template_code
     where tf.template_code = p_template_code and cf.is_active;
  else
    v_scope := p_scope;
  end if;
  if p_scope is null
     and exists (select 1 from public.laundry_model_template_families tf where tf.template_code = p_template_code)
     and json_array_length(v_scope) = 0 then
    raise exception 'Importez d''abord la famille textile professionnel du catalogue.' using errcode = '23503';
  end if;

  v_model := v_model || jsonb_build_object(
    'name', coalesce(nullif(btrim(v_model ->> 'name'), ''), v_template.name),
    'model_type', v_template.model_type,
    'pricing_basis', v_template.pricing_basis,
    'audience', 'PROFESSIONAL',
    'included_weight_kg', coalesce(nullif(v_model ->> 'included_weight_kg', '')::numeric, v_template.included_weight_kg),
    'included_pieces', coalesce(nullif(v_model ->> 'included_pieces', '')::integer, v_template.included_pieces),
    'conditions', coalesce(nullif(v_model ->> 'conditions', ''), v_template.conditions),
    'exclusions', coalesce(nullif(v_model ->> 'exclusions', ''), v_template.exclusions),
    'turnaround_days', coalesce(nullif(v_model ->> 'turnaround_days', '')::integer, v_template.turnaround_days),
    'is_active', coalesce((v_model ->> 'is_active')::boolean, true)
  );
  v_id := public.save_laundry_model(v_model::json, v_services, v_scope);
  return v_id;
end;
$$;
revoke all on function public.apply_laundry_model_template(text, json, json) from public, anon;
grant execute on function public.apply_laundry_model_template(text, json, json) to authenticated;

-- Forfait famille : une ligne commerciale parent, plusieurs articles réellement
-- reçus. Les snapshots de prix, contenu et opérations ne suivent pas les edits.
create table public.order_item_family_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,
  order_item_id uuid not null,
  laundry_model_id uuid not null,
  model_name_snapshot text not null,
  package_price_snapshot numeric(12,0) not null check (package_price_snapshot between 1 and 10000000),
  included_pieces_snapshot integer not null check (included_pieces_snapshot between 1 and 1000),
  overage_price_per_piece_snapshot numeric(12,0) check
    (overage_price_per_piece_snapshot is null or overage_price_per_piece_snapshot between 0 and 10000000),
  minimum_charge_snapshot numeric(12,0),
  piece_count integer not null check (piece_count between 1 and 10000),
  scope_snapshot jsonb not null default '[]'::jsonb check (jsonb_typeof(scope_snapshot) = 'array'),
  price_breakdown_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(price_breakdown_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  constraint order_item_family_packages_item_unique unique (tenant_id, order_item_id),
  constraint order_item_family_packages_order_fk foreign key (order_id, tenant_id)
    references public.orders(id, tenant_id) on delete cascade,
  constraint order_item_family_packages_item_fk foreign key (order_item_id, tenant_id)
    references public.order_items(id, tenant_id) on delete cascade,
  constraint order_item_family_packages_model_fk foreign key (laundry_model_id, tenant_id)
    references public.laundry_models(id, tenant_id) on delete no action
);

create table public.order_item_family_package_contents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,
  order_item_id uuid not null,
  article_id uuid not null,
  article_name_snapshot text not null check (char_length(btrim(article_name_snapshot)) between 2 and 80),
  family_name_snapshot text not null check (char_length(btrim(family_name_snapshot)) between 2 and 80),
  quantity integer not null check (quantity between 1 and 1000),
  care_instructions_snapshot text,
  service_operations_snapshot jsonb not null default '[]'::jsonb
    check (jsonb_typeof(service_operations_snapshot) = 'array'),
  created_at timestamptz not null default now(),
  constraint order_item_family_package_contents_order_fk foreign key (order_id, tenant_id)
    references public.orders(id, tenant_id) on delete cascade,
  constraint order_item_family_package_contents_item_fk foreign key (order_item_id, tenant_id)
    references public.order_items(id, tenant_id) on delete cascade,
  constraint order_item_family_package_contents_article_fk foreign key (article_id, tenant_id)
    references public.catalog_articles(id, tenant_id) on delete no action
);
create index order_item_family_package_contents_item_idx
  on public.order_item_family_package_contents(tenant_id, order_item_id);

create or replace function public.prepare_family_package_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_model public.laundry_models;
  v_scope jsonb;
  v_order_line record;
begin
  select oi.order_id, oi.catalog_entry_id, oi.laundry_model_id, oi.quantity,
         oi.billing_unit, oi.price, oi.unit_price, oi.price_status
    into v_order_line
    from public.order_items oi
   where oi.id = new.order_item_id and oi.tenant_id = new.tenant_id;
  if not found or v_order_line.order_id is distinct from new.order_id
     or v_order_line.catalog_entry_id is not null or v_order_line.laundry_model_id is not null
     or v_order_line.quantity <> 1 or v_order_line.billing_unit <> 'FLAT'
     or v_order_line.price_status <> 'CONFIRMED'
     or v_order_line.price is distinct from v_order_line.unit_price then
    raise exception 'Le forfait famille doit utiliser une ligne globale confirmée et non rattachée à un autre tarif.' using errcode = '23514';
  end if;
  select * into v_model from public.laundry_models lm
   where lm.id = new.laundry_model_id and lm.tenant_id = new.tenant_id
     and lm.model_type = 'FAMILY_PACKAGE' and lm.pricing_basis = 'PIECE' and lm.is_active;
  if not found then
    raise exception 'Le modèle de forfait famille doit être actif et utiliser la facturation à la pièce.' using errcode = '23503';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'family_id', s.family_id, 'family_name', f.name,
      'article_id', s.article_id, 'article_name', a.name
    ) order by coalesce(f.sort_order, 0), coalesce(a.sort_order, 0), coalesce(f.name, a.name)), '[]'::jsonb)
    into v_scope
    from public.laundry_model_catalog_scope s
    left join public.catalog_families f on f.id = s.family_id and f.tenant_id = s.tenant_id
    left join public.catalog_articles a on a.id = s.article_id and a.tenant_id = s.tenant_id
   where s.tenant_id = new.tenant_id and s.model_id = new.laundry_model_id;
  new.model_name_snapshot := v_model.name;
  new.package_price_snapshot := v_model.package_price;
  new.included_pieces_snapshot := v_model.included_pieces;
  new.overage_price_per_piece_snapshot := v_model.overage_price_per_piece;
  new.minimum_charge_snapshot := v_model.minimum_charge;
  new.scope_snapshot := v_scope;
  new.price_breakdown_snapshot := jsonb_build_object(
    'currency', 'XOF',
    'package_price', v_model.package_price,
    'included_pieces', v_model.included_pieces,
    'piece_count', new.piece_count,
    'overage_pieces', greatest(new.piece_count - v_model.included_pieces, 0),
    'overage_price_per_piece', v_model.overage_price_per_piece,
    'minimum_charge', v_model.minimum_charge,
    'total_price', v_order_line.price
  );
  return new;
end;
$$;
create trigger trg_prepare_family_package_snapshot
  before insert on public.order_item_family_packages
  for each row execute function public.prepare_family_package_snapshot();

create or replace function public.prepare_family_package_content_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_package public.order_item_family_packages;
  v_article public.catalog_articles;
begin
  select * into v_package from public.order_item_family_packages p
   where p.tenant_id = new.tenant_id and p.order_item_id = new.order_item_id
     and p.order_id = new.order_id;
  if not found then
    raise exception 'Créez d''abord la ligne de forfait famille.' using errcode = '23503';
  end if;
  select * into v_article from public.catalog_articles a
   where a.id = new.article_id and a.tenant_id = new.tenant_id and a.is_active;
  if not found then
    raise exception 'Chaque vêtement doit être un article actif du pressing.' using errcode = '23503';
  end if;
  if exists (select 1 from public.laundry_model_catalog_scope s
              where s.tenant_id = new.tenant_id and s.model_id = v_package.laundry_model_id)
     and not exists (
       select 1 from public.laundry_model_catalog_scope s
        where s.tenant_id = new.tenant_id and s.model_id = v_package.laundry_model_id
          and (s.article_id = v_article.id or s.family_id = v_article.family_id)
     ) then
    raise exception 'Cet article n''est pas compris dans le périmètre du forfait.' using errcode = '23514';
  end if;
  new.article_name_snapshot := v_article.name;
  select f.name into new.family_name_snapshot from public.catalog_families f
   where f.id = v_article.family_id and f.tenant_id = new.tenant_id;
  new.care_instructions_snapshot := v_article.care_instructions;
  select coalesce(jsonb_agg(jsonb_build_object(
      'service_id', cs.id, 'service_name', cs.name,
      'inclusion_mode', lms.inclusion_mode,
      'operation_code', op.code, 'operation_name', op.name
    ) order by lms.sort_order, so.sort_order, op.sort_order, op.code), '[]'::jsonb)
    into new.service_operations_snapshot
    from public.laundry_model_services lms
    join public.catalog_services cs on cs.id = lms.service_id and cs.tenant_id = lms.tenant_id
    join public.catalog_service_operations so on so.service_id = cs.id and so.tenant_id = cs.tenant_id
    join public.catalog_operation_definitions op on op.code = so.operation_code
   where lms.tenant_id = new.tenant_id and lms.model_id = v_package.laundry_model_id;
  return new;
end;
$$;
create trigger trg_prepare_family_package_content_snapshot
  before insert on public.order_item_family_package_contents
  for each row execute function public.prepare_family_package_content_snapshot();

-- La composition complète et le total de pièces sont vérifiés à la fin de la
-- transaction, après insertion de la ligne parent et de ses vêtements.
create or replace function public.validate_family_package_piece_count()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item uuid;
  v_tenant uuid;
  v_package public.order_item_family_packages;
  v_piece_count integer;
  v_line_price numeric;
  v_price_status text;
  v_expected numeric;
begin
  if tg_table_name = 'order_item_family_packages' then
    v_item := coalesce(new.order_item_id, old.order_item_id);
    v_tenant := coalesce(new.tenant_id, old.tenant_id);
  else
    v_item := coalesce(new.order_item_id, old.order_item_id);
    v_tenant := coalesce(new.tenant_id, old.tenant_id);
  end if;
  select * into v_package from public.order_item_family_packages p
   where p.tenant_id = v_tenant and p.order_item_id = v_item;
  if not found then return null; end if;
  select coalesce(sum(c.quantity), 0)::integer into v_piece_count
    from public.order_item_family_package_contents c
   where c.tenant_id = v_tenant and c.order_item_id = v_item;
  if v_piece_count <> v_package.piece_count then
    raise exception 'Le forfait indique % pièce(s), mais sa composition en contient %.', v_package.piece_count, v_piece_count
      using errcode = '23514';
  end if;
  select oi.price, oi.price_status into v_line_price, v_price_status
    from public.order_items oi where oi.id = v_item and oi.tenant_id = v_tenant;
  if not found then return null; end if;
  if v_piece_count <= v_package.included_pieces_snapshot then
    v_expected := greatest(v_package.package_price_snapshot, coalesce(v_package.minimum_charge_snapshot, 0));
    if v_line_price <> v_expected then
      raise exception 'Le prix de la ligne doit être le prix global du forfait (% FCFA).', v_expected using errcode = '23514';
    end if;
  elsif v_package.overage_price_per_piece_snapshot is not null then
    v_expected := greatest(v_package.package_price_snapshot
      + (v_piece_count - v_package.included_pieces_snapshot) * v_package.overage_price_per_piece_snapshot,
      coalesce(v_package.minimum_charge_snapshot, 0));
    if v_line_price <> v_expected then
      raise exception 'Le prix total du forfait (avec dépassement) doit être de % FCFA.', v_expected using errcode = '23514';
    end if;
  elsif v_price_status <> 'CONFIRMED' or v_line_price < v_package.package_price_snapshot then
    raise exception 'Confirmez un prix global au moins égal au forfait pour les pièces supplémentaires.' using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger trg_validate_family_package_parent
  after insert or update on public.order_item_family_packages
  deferrable initially deferred for each row execute function public.validate_family_package_piece_count();
create constraint trigger trg_validate_family_package_contents
  after insert or update or delete on public.order_item_family_package_contents
  deferrable initially deferred for each row execute function public.validate_family_package_piece_count();

-- Une seule requête PostgREST crée la ligne globale et sa composition : les
-- contraintes différées peuvent ainsi valider un forfait dans la même transaction.
create or replace function public.create_family_package_order_item(
  p_order_id uuid,
  p_laundry_model_id uuid,
  p_contents json,
  p_total_price integer,
  p_price_reason text,
  p_label text default null,
  p_fabric_type text default null,
  p_special_instructions text default null,
  p_order_item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_model public.laundry_models;
  v_piece_count integer;
  v_item_id uuid := coalesce(p_order_item_id, gen_random_uuid());
  v_expected numeric;
  v_existing public.order_items;
  v_existing_package public.order_item_family_packages;
  v_existing_contents jsonb;
  v_requested_contents jsonb;
begin
  if v_tenant is null or public.current_tenant_role() not in ('owner', 'receptionist') then
    raise exception 'Votre rôle ne permet pas de créer une commande de forfait famille.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.orders o where o.id = p_order_id and o.tenant_id = v_tenant) then
    raise exception 'La commande n''existe pas dans ce pressing.' using errcode = '23503';
  end if;
  if p_total_price is null or p_total_price < 1 or p_price_reason is null
     or char_length(btrim(p_price_reason)) < 10 then
    raise exception 'Le forfait doit avoir un prix positif et un motif explicite.' using errcode = '22023';
  end if;
  if json_typeof(coalesce(p_contents, '[]'::json)) <> 'array'
     or json_array_length(coalesce(p_contents, '[]'::json)) = 0 then
    raise exception 'Ajoutez au moins un article à la composition du forfait famille.' using errcode = '22023';
  end if;
  if exists (select 1 from json_array_elements(p_contents) c
              where coalesce(c ->> 'article_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 or coalesce(c ->> 'quantity', '') !~ '^[1-9][0-9]{0,2}$') then
    raise exception 'Chaque vêtement doit avoir un identifiant et une quantité entière valide.' using errcode = '22023';
  end if;
  select sum((c ->> 'quantity')::integer)::integer into v_piece_count
    from json_array_elements(p_contents) c;
  if v_piece_count not between 1 and 10000 then
    raise exception 'La composition du forfait dépasse le nombre de pièces autorisé.' using errcode = '22023';
  end if;
  -- Un identifiant client stable rend la répétition du RPC sûre après une
  -- réponse réseau perdue, sans recréer ligne ni composition.
  perform pg_advisory_xact_lock(hashtextextended(v_item_id::text, 0));
  select * into v_existing from public.order_items oi
   where oi.id = v_item_id and oi.tenant_id = v_tenant;
  if found then
    select * into v_existing_package from public.order_item_family_packages fp
     where fp.order_item_id = v_item_id and fp.tenant_id = v_tenant;
    select coalesce(jsonb_agg(jsonb_build_object('article_id', x.article_id, 'quantity', x.quantity)
                              order by x.article_id), '[]'::jsonb)
      into v_existing_contents
      from (select c.article_id, sum(c.quantity)::integer as quantity
              from public.order_item_family_package_contents c
             where c.order_item_id = v_item_id and c.tenant_id = v_tenant
             group by c.article_id) x;
    select coalesce(jsonb_agg(jsonb_build_object('article_id', x.article_id, 'quantity', x.quantity)
                              order by x.article_id), '[]'::jsonb)
      into v_requested_contents
      from (select (c ->> 'article_id')::uuid as article_id,
                   sum((c ->> 'quantity')::integer)::integer as quantity
              from json_array_elements(p_contents) c
             group by (c ->> 'article_id')::uuid) x;
    if v_existing.order_id = p_order_id and v_existing.price = p_total_price
       and v_existing.label = coalesce(nullif(btrim(p_label), ''), v_existing.label)
       and v_existing_package.laundry_model_id = p_laundry_model_id
       and v_existing_contents = v_requested_contents then
      return v_item_id;
    end if;
    raise exception 'Cet identifiant de ligne existe déjà avec un contenu différent.' using errcode = '23505';
  end if;

  select * into v_model from public.laundry_models lm
   where lm.id = p_laundry_model_id and lm.tenant_id = v_tenant
     and lm.model_type = 'FAMILY_PACKAGE' and lm.pricing_basis = 'PIECE' and lm.is_active;
  if not found then
    raise exception 'Le forfait famille est absent, archivé ou appartient à un autre pressing.' using errcode = '23503';
  end if;
  if v_piece_count <= v_model.included_pieces then
    v_expected := greatest(v_model.package_price, coalesce(v_model.minimum_charge, 0));
    if p_total_price <> v_expected then
      raise exception 'Le prix global de cette composition doit être de % FCFA.', v_expected using errcode = '23514';
    end if;
  elsif v_model.overage_price_per_piece is not null then
    v_expected := greatest(v_model.package_price
      + (v_piece_count - v_model.included_pieces) * v_model.overage_price_per_piece,
      coalesce(v_model.minimum_charge, 0));
    if p_total_price <> v_expected then
      raise exception 'Le prix du forfait avec ses pièces supplémentaires doit être de % FCFA.', v_expected using errcode = '23514';
    end if;
  elsif p_total_price < v_model.package_price then
    raise exception 'Le prix confirmé doit au moins couvrir le forfait de base.' using errcode = '23514';
  end if;

  insert into public.order_items (
    id, order_id, tenant_id, label, fabric_type, special_instructions, price,
    quantity, billed_quantity, billing_unit, unit_price, pricing_mode, price_status, price_reason
  ) values (
    v_item_id, p_order_id, v_tenant, coalesce(nullif(btrim(p_label), ''), v_model.name),
    nullif(btrim(p_fabric_type), ''), nullif(btrim(p_special_instructions), ''), p_total_price,
    1, 1, 'FLAT', p_total_price, 'FIXED', 'CONFIRMED', btrim(p_price_reason)
  ) returning id into v_item_id;

  insert into public.order_item_family_packages (
    tenant_id, order_id, order_item_id, laundry_model_id, model_name_snapshot,
    package_price_snapshot, included_pieces_snapshot, overage_price_per_piece_snapshot,
    minimum_charge_snapshot, piece_count
  ) values (
    v_tenant, p_order_id, v_item_id, p_laundry_model_id, v_model.name,
    v_model.package_price, v_model.included_pieces, v_model.overage_price_per_piece,
    v_model.minimum_charge, v_piece_count
  );
  insert into public.order_item_family_package_contents (
    tenant_id, order_id, order_item_id, article_id, article_name_snapshot, family_name_snapshot, quantity
  )
  select v_tenant, p_order_id, v_item_id, (c ->> 'article_id')::uuid,
         'snapshot article', 'snapshot famille', (c ->> 'quantity')::integer
    from json_array_elements(p_contents) c;

  return v_item_id;
end;
$$;
revoke all on function public.create_family_package_order_item(uuid, uuid, json, integer, text, text, text, text, uuid) from public, anon;
grant execute on function public.create_family_package_order_item(uuid, uuid, json, integer, text, text, text, text, uuid) to authenticated;

-- RLS : modèles système en lecture seule; toutes les copies sont isolées par tenant.
alter table public.catalog_operation_definitions enable row level security;
alter table public.catalog_model_templates enable row level security;
alter table public.catalog_template_installations enable row level security;
alter table public.laundry_model_templates enable row level security;
alter table public.laundry_model_template_services enable row level security;
alter table public.laundry_model_template_families enable row level security;
alter table public.catalog_article_aliases enable row level security;
alter table public.catalog_service_operations enable row level security;
alter table public.laundry_model_catalog_scope enable row level security;
alter table public.order_item_family_packages enable row level security;
alter table public.order_item_family_package_contents enable row level security;

create policy catalog_operation_definitions_read on public.catalog_operation_definitions
  for select to authenticated using (true);
create policy catalog_model_templates_read on public.catalog_model_templates
  for select to authenticated using (is_active);
create policy catalog_template_installations_owner_read on public.catalog_template_installations
  for select to authenticated using (
    tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner'
  );
create policy laundry_model_templates_read on public.laundry_model_templates
  for select to authenticated using (is_active);
create policy laundry_model_template_services_read on public.laundry_model_template_services
  for select to authenticated using (exists (
    select 1 from public.laundry_model_templates t
     where t.code = template_code and t.is_active
  ));
create policy laundry_model_template_families_read on public.laundry_model_template_families
  for select to authenticated using (exists (
    select 1 from public.laundry_model_templates t
     where t.code = template_code and t.is_active
  ));
create policy catalog_article_aliases_tenant_read on public.catalog_article_aliases
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy catalog_service_operations_tenant_read on public.catalog_service_operations
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy laundry_model_catalog_scope_tenant_read on public.laundry_model_catalog_scope
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy order_item_family_packages_tenant_select on public.order_item_family_packages
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy order_item_family_packages_tenant_insert on public.order_item_family_packages
  for insert to authenticated with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() in ('owner', 'receptionist')
  );
create policy order_item_family_package_contents_tenant_select on public.order_item_family_package_contents
  for select to authenticated using (tenant_id = public.current_tenant_id());
create policy order_item_family_package_contents_tenant_insert on public.order_item_family_package_contents
  for insert to authenticated with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() in ('owner', 'receptionist')
  );

revoke all on public.catalog_operation_definitions, public.catalog_model_templates,
  public.catalog_template_installations, public.laundry_model_templates, public.laundry_model_template_services,
  public.laundry_model_template_families, public.catalog_article_aliases,
  public.catalog_service_operations, public.laundry_model_catalog_scope,
  public.order_item_family_packages, public.order_item_family_package_contents
  from public, anon, authenticated;
grant select on public.catalog_operation_definitions, public.catalog_model_templates,
  public.catalog_template_installations, public.laundry_model_templates, public.laundry_model_template_services,
  public.laundry_model_template_families to authenticated;
grant select on public.catalog_article_aliases, public.catalog_service_operations to authenticated;
grant select on public.laundry_model_catalog_scope to authenticated;
grant select, insert on public.order_item_family_packages, public.order_item_family_package_contents to authenticated;
grant all on public.catalog_operation_definitions, public.catalog_model_templates,
  public.catalog_template_installations, public.laundry_model_templates, public.laundry_model_template_services,
  public.laundry_model_template_families, public.catalog_article_aliases,
  public.catalog_service_operations, public.laundry_model_catalog_scope,
  public.order_item_family_packages, public.order_item_family_package_contents to service_role;

create trigger trg_audit_catalog_article_aliases
  after insert or update or delete on public.catalog_article_aliases
  for each row execute function public.audit_row_change();
create trigger trg_audit_catalog_service_operations
  after insert or update or delete on public.catalog_service_operations
  for each row execute function public.audit_row_change();
create trigger trg_audit_laundry_model_catalog_scope
  after insert or update or delete on public.laundry_model_catalog_scope
  for each row execute function public.audit_row_change();
create trigger trg_audit_order_item_family_packages
  after insert or update or delete on public.order_item_family_packages
  for each row execute function public.audit_row_change();
create trigger trg_audit_order_item_family_package_contents
  after insert or update or delete on public.order_item_family_package_contents
  for each row execute function public.audit_row_change();

comment on table public.catalog_model_templates is
  'Modèles génériques modifiables après copie; aucun prix ni tarif contractuel n’est fourni.';
comment on table public.catalog_article_aliases is
  'Alias de vocabulaire contextualisés par pressing, non facturables.';
comment on table public.catalog_service_operations is
  'Opérations distinctes d’atelier associées à une prestation commerciale.';
comment on table public.order_item_family_packages is
  'Instantané du prix global et des paramètres d’un forfait famille au moment de la commande.';
comment on table public.order_item_family_package_contents is
  'Articles et quantités composant un forfait famille, figés à la réception.';

commit;
