-- =============================================================================
-- 016_laundry_models.sql — modèles commerciaux au kilo et au forfait
-- =============================================================================
-- Références indépendantes des tarifs à la pièce : poids, minimum, incrément,
-- inclusion ou supplément, conditions et prestations associées. Les montants
-- sont configurés par pressing ; cette migration n'est pas appliquée à distance.
-- =============================================================================

begin;

create table public.laundry_models (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants (id) on delete cascade,
  name                  text not null check (char_length(btrim(name)) between 2 and 80),
  description           text,
  model_type            text not null check (model_type in ('PER_KG', 'WEIGHT_PACKAGE')),
  audience              text not null default 'ALL' check (audience in ('ALL', 'INDIVIDUAL', 'PROFESSIONAL')),
  price_per_kg          numeric(12,0),
  package_price         numeric(12,0),
  included_weight_kg    numeric(10,3),
  overage_price_per_kg  numeric(12,0),
  minimum_weight_kg     numeric(10,3),
  billing_increment_kg  numeric(10,3) default 0.100,
  minimum_charge        numeric(12,0),
  conditions            text,
  exclusions            text,
  pickup_delivery_terms text,
  turnaround_days      integer,
  is_active             boolean not null default true,
  sort_order            integer not null default 0,
  created_by            uuid references auth.users (id) on delete set null default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint laundry_models_id_tenant_key unique (id, tenant_id),
  constraint laundry_models_per_kg_fields check (
    (model_type = 'PER_KG'
      and price_per_kg is not null and price_per_kg between 1 and 10000000
      and package_price is null
      and included_weight_kg is null
      and overage_price_per_kg is null)
    or
    (model_type = 'WEIGHT_PACKAGE'
      and price_per_kg is null
      and package_price is not null and package_price between 1 and 10000000
      and included_weight_kg is not null and included_weight_kg > 0
      and minimum_weight_kg is null
      and (overage_price_per_kg is null or overage_price_per_kg between 0 and 10000000))
  ),
  constraint laundry_models_weight_values check (
    (minimum_weight_kg is null or minimum_weight_kg > 0)
    and (billing_increment_kg is null or billing_increment_kg > 0)
    and (minimum_charge is null or minimum_charge between 0 and 10000000)
    and (turnaround_days is null or turnaround_days between 0 and 365)
  ),
  constraint laundry_models_text_lengths check (
    (description is null or char_length(description) <= 1000)
    and (conditions is null or char_length(conditions) <= 1000)
    and (exclusions is null or char_length(exclusions) <= 2000)
    and (pickup_delivery_terms is null or char_length(pickup_delivery_terms) <= 1000)
  )
);

create unique index laundry_models_name_key
  on public.laundry_models (tenant_id, public.catalog_name_key(name));
create index laundry_models_active_sort_idx
  on public.laundry_models (tenant_id, is_active, sort_order, name);

create table public.laundry_model_services (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  model_id       uuid not null,
  service_id     uuid not null,
  inclusion_mode text not null check (inclusion_mode in ('INCLUDED', 'EXTRA')),
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  constraint laundry_model_services_unique unique (tenant_id, model_id, service_id),
  constraint laundry_model_services_model_fk
    foreign key (model_id, tenant_id)
    references public.laundry_models (id, tenant_id) on delete cascade,
  constraint laundry_model_services_service_fk
    foreign key (service_id, tenant_id)
    references public.catalog_services (id, tenant_id)
    on delete no action deferrable initially deferred
);

create index laundry_model_services_service_idx
  on public.laundry_model_services (tenant_id, service_id);

alter table public.laundry_models enable row level security;
alter table public.laundry_model_services enable row level security;

create policy laundry_models_select_tenant on public.laundry_models
  for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy laundry_model_services_select_tenant on public.laundry_model_services
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

revoke all on public.laundry_models, public.laundry_model_services from public, anon, authenticated;
grant select on public.laundry_models, public.laundry_model_services to authenticated;
grant all on public.laundry_models, public.laundry_model_services to service_role;

-- Une opération atomique évite qu'un modèle soit enregistré avec seulement une
-- partie de ses prestations. L'identifiant du tenant est toujours dérivé du JWT.
create or replace function public.save_laundry_model(p_model json, p_services json default '[]'::json)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_id uuid := nullif(p_model ->> 'id', '')::uuid;
  v_type text := p_model ->> 'model_type';
  v_name text := btrim(coalesce(p_model ->> 'name', ''));
  v_audience text := coalesce(nullif(p_model ->> 'audience', ''), 'ALL');
  v_service_ids uuid[];
  v_bad_service boolean;
begin
  if v_tenant is null or public.current_tenant_role() <> 'owner' then
    raise exception 'Seul le propriétaire du pressing peut gérer les modèles commerciaux.'
      using errcode = '42501';
  end if;
  if v_type is null or v_type not in ('PER_KG', 'WEIGHT_PACKAGE') then
    raise exception 'Choisissez un modèle au kilo ou au forfait.' using errcode = '22023';
  end if;
  if char_length(v_name) not between 2 and 80 then
    raise exception 'Le nom doit contenir entre 2 et 80 caractères.' using errcode = '22023';
  end if;
  if v_audience not in ('ALL', 'INDIVIDUAL', 'PROFESSIONAL') then
    raise exception 'La clientèle indiquée n''est pas valide.' using errcode = '22023';
  end if;
  if json_typeof(coalesce(p_services, '[]'::json)) <> 'array' then
    raise exception 'La liste des prestations doit être un tableau.' using errcode = '22023';
  end if;
  if exists (
    select 1 from json_array_elements(coalesce(p_services, '[]'::json)) s
    group by (s ->> 'service_id')
    having count(*) > 1
  ) then
    raise exception 'Une prestation ne peut apparaître qu''une fois par modèle.' using errcode = '23505';
  end if;
  if exists (
    select 1 from json_array_elements(coalesce(p_services, '[]'::json)) s
    where coalesce(s ->> 'inclusion_mode', '') not in ('INCLUDED', 'EXTRA')
       or coalesce(s ->> 'service_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) then
    raise exception 'Une prestation sélectionnée ou son mode est invalide.' using errcode = '22023';
  end if;
  select array_agg((s ->> 'service_id')::uuid) into v_service_ids
    from json_array_elements(coalesce(p_services, '[]'::json)) s;
  select exists (
    select 1
      from unnest(coalesce(v_service_ids, array[]::uuid[])) selected(service_id)
      left join public.catalog_services cs
        on cs.id = selected.service_id
       and cs.tenant_id = v_tenant
       and cs.is_active
     where cs.id is null
  ) into v_bad_service;
  if v_bad_service then
    raise exception 'Chaque prestation doit être active et appartenir à ce pressing.'
      using errcode = '23503';
  end if;

  if v_id is not null and not exists (
    select 1 from public.laundry_models lm where lm.id = v_id and lm.tenant_id = v_tenant
  ) then
    raise exception 'Ce modèle n''existe pas dans le pressing courant.' using errcode = 'P0002';
  end if;

  if v_id is null then
    insert into public.laundry_models (
      tenant_id, name, description, model_type, audience,
      price_per_kg, package_price, included_weight_kg, overage_price_per_kg,
      minimum_weight_kg, billing_increment_kg, minimum_charge,
      conditions, exclusions, pickup_delivery_terms, turnaround_days,
      is_active, sort_order, created_by
    ) values (
      v_tenant, v_name, nullif(btrim(p_model ->> 'description'), ''), v_type, v_audience,
      nullif(p_model ->> 'price_per_kg', '')::numeric,
      nullif(p_model ->> 'package_price', '')::numeric,
      nullif(p_model ->> 'included_weight_kg', '')::numeric,
      nullif(p_model ->> 'overage_price_per_kg', '')::numeric,
      nullif(p_model ->> 'minimum_weight_kg', '')::numeric,
      nullif(p_model ->> 'billing_increment_kg', '')::numeric,
      nullif(p_model ->> 'minimum_charge', '')::numeric,
      nullif(btrim(p_model ->> 'conditions'), ''),
      nullif(btrim(p_model ->> 'exclusions'), ''),
      nullif(btrim(p_model ->> 'pickup_delivery_terms'), ''),
      nullif(p_model ->> 'turnaround_days', '')::integer,
      coalesce((p_model ->> 'is_active')::boolean, true),
      coalesce(nullif(p_model ->> 'sort_order', '')::integer, 0),
      auth.uid()
    ) returning id into v_id;
  else
    update public.laundry_models set
      name = v_name,
      description = nullif(btrim(p_model ->> 'description'), ''),
      model_type = v_type,
      audience = v_audience,
      price_per_kg = nullif(p_model ->> 'price_per_kg', '')::numeric,
      package_price = nullif(p_model ->> 'package_price', '')::numeric,
      included_weight_kg = nullif(p_model ->> 'included_weight_kg', '')::numeric,
      overage_price_per_kg = nullif(p_model ->> 'overage_price_per_kg', '')::numeric,
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

  delete from public.laundry_model_services
   where model_id = v_id and tenant_id = v_tenant;
  insert into public.laundry_model_services (tenant_id, model_id, service_id, inclusion_mode, sort_order)
  select v_tenant, v_id, (s ->> 'service_id')::uuid,
         s ->> 'inclusion_mode', coalesce(nullif(s ->> 'sort_order', '')::integer, 0)
    from json_array_elements(coalesce(p_services, '[]'::json)) s;

  return v_id;
end;
$$;

revoke all on function public.save_laundry_model(json, json) from public, anon;
grant execute on function public.save_laundry_model(json, json) to authenticated;

create trigger trg_laundry_models_updated_at
  before update on public.laundry_models
  for each row execute function public.update_updated_at_column();
create trigger trg_audit_laundry_models
  after insert or update or delete on public.laundry_models
  for each row execute function public.audit_row_change();
create trigger trg_audit_laundry_model_services
  after insert or update or delete on public.laundry_model_services
  for each row execute function public.audit_row_change();

comment on table public.laundry_models is
  'Modèles commerciaux au kilo et au forfait, propres à chaque pressing.';
comment on function public.save_laundry_model(json, json) is
  'Enregistre atomiquement un modèle commercial et ses prestations incluses ou facturées en supplément.';

commit;
