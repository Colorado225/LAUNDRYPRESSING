-- =============================================================================
-- 028_tarification_kilo_tranches.sql — Tarification au kilo par tranches
-- =============================================================================
-- Lot 2 du cahier des charges Catalogue/Tarification :
--
--  - `pricing_rules` : une règle active par prestation au kilo — mode
--    `flat_rate` (le poids total choisit la tranche) ou `progressive_tiers`
--    (chaque tranche à son tarif), poids minimal facturable, pas de pesée
--    et mode d'arrondi (`ceil`, `nearest`, `exact`) ;
--  - `pricing_rule_tiers` : tranches [min, max) sans chevauchement (garde) ;
--  - `compute_weight_price()` : moteur serveur, source de vérité du calcul ;
--    `quote_weight_price()` l'expose au pressing courant (simulateur) ;
--  - la garde `guard_order_item_catalog` (migration 027) est étendue : pour
--    une ligne au kilo d'une prestation ayant une règle active, le serveur
--    recalcule le poids facturé et le montant, et refuse tout total différent
--    sans motif de dérogation (≥ 10 caractères). Vrai aussi en mise à jour
--    de mesure. Sans règle, le comportement 023 (tarif/kg libre) demeure.
--
-- Migration additive.
-- =============================================================================

begin;

create table public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tenant_service_id uuid not null,
  rule_name text not null check (char_length(btrim(rule_name)) between 2 and 80),
  rule_mode text not null check (rule_mode in ('flat_rate', 'progressive_tiers')),
  min_billable_kg numeric(8,3) not null default 0 check (min_billable_kg >= 0),
  step_kg numeric(8,3) not null default 0.1 check (step_kg > 0),
  rounding_mode text not null default 'ceil' check (rounding_mode in ('ceil', 'nearest', 'exact')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pricing_rules_service_fk
    foreign key (tenant_service_id, tenant_id)
    references public.tenant_services (id, tenant_id) on delete cascade,
  constraint pricing_rules_id_tenant_unique unique (id, tenant_id)
);

-- Au plus une règle active par prestation : le moteur n'a jamais à arbitrer.
create unique index pricing_rules_one_active_per_service
  on public.pricing_rules (tenant_id, tenant_service_id) where is_active;

create table public.pricing_rule_tiers (
  id uuid primary key default gen_random_uuid(),
  pricing_rule_id uuid not null references public.pricing_rules(id) on delete cascade,
  min_kg numeric(8,3) not null check (min_kg >= 0),
  max_kg numeric(8,3),
  price_per_kg_xof integer not null check (price_per_kg_xof between 1 and 10000000),
  check (max_kg is null or max_kg > min_kg),
  constraint pricing_rule_tiers_unique_min unique (pricing_rule_id, min_kg)
);

create index pricing_rule_tiers_rule_idx on public.pricing_rule_tiers (pricing_rule_id, min_kg);

-- Tranches [min, max) : tout chevauchement est refusé (PRICE-006).
create or replace function public.guard_pricing_tier_overlap()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.pricing_rule_tiers t
     where t.pricing_rule_id = new.pricing_rule_id
       and t.id <> new.id
       and new.min_kg < coalesce(t.max_kg, 'infinity'::numeric)
       and coalesce(new.max_kg, 'infinity'::numeric) > t.min_kg
  ) then
    raise exception 'Les tranches de poids se chevauchent : ajustez les bornes (intervalles [début, fin)).'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trg_pricing_rule_tiers_guard_overlap
  before insert or update on public.pricing_rule_tiers
  for each row execute function public.guard_pricing_tier_overlap();

-- ---------------------------------------------------------------------------
-- Moteur de calcul (miroir de `src/lib/prixKilo.ts`, testé des deux côtés)
-- ---------------------------------------------------------------------------
create or replace function public.compute_weight_price(
  p_tenant uuid,
  p_service uuid,
  p_weight numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_rule public.pricing_rules%rowtype;
  v_billed numeric(12,3);
  v_amount numeric;
  v_detail jsonb := '[]'::jsonb;
  r record;
  v_segment numeric;
begin
  if p_weight is null or p_weight <= 0 then
    return null;
  end if;

  select * into v_rule
    from public.pricing_rules
   where tenant_id = p_tenant and tenant_service_id = p_service and is_active;
  if not found then
    return null;
  end if;

  v_billed := case v_rule.rounding_mode
    when 'ceil' then ceil(p_weight / v_rule.step_kg) * v_rule.step_kg
    when 'nearest' then round(p_weight / v_rule.step_kg) * v_rule.step_kg
    else p_weight
  end;
  v_billed := greatest(v_billed, v_rule.min_billable_kg);

  if v_rule.rule_mode = 'flat_rate' then
    select t.price_per_kg_xof into v_amount
      from public.pricing_rule_tiers t
     where t.pricing_rule_id = v_rule.id
       and v_billed >= t.min_kg
       and (t.max_kg is null or v_billed < t.max_kg)
     order by t.min_kg desc
     limit 1;
    if v_amount is null then
      return null; -- aucune tranche ne couvre ce poids
    end if;
    v_detail := jsonb_build_array(jsonb_build_object(
      'kg', v_billed, 'tarif_par_kg', v_amount, 'sous_total', round(v_billed * v_amount)
    ));
    v_amount := round(v_billed * v_amount);
  else
    v_amount := 0;
    for r in
      select * from public.pricing_rule_tiers
       where pricing_rule_id = v_rule.id and v_billed > min_kg
       order by min_kg
    loop
      v_segment := least(v_billed, coalesce(r.max_kg, v_billed)) - r.min_kg;
      if v_segment > 0 then
        v_amount := v_amount + v_segment * r.price_per_kg_xof;
        v_detail := v_detail || jsonb_build_object(
          'de_kg', r.min_kg, 'a_kg', r.max_kg, 'kg', v_segment,
          'tarif_par_kg', r.price_per_kg_xof, 'sous_total', round(v_segment * r.price_per_kg_xof)
        );
      end if;
    end loop;
    if v_detail = '[]'::jsonb then
      return null;
    end if;
    v_amount := round(v_amount);
  end if;

  return jsonb_build_object(
    'rule_id', v_rule.id,
    'mode', v_rule.rule_mode,
    'poids_pese_kg', p_weight,
    'poids_facture_kg', v_billed,
    'montant', v_amount::integer,
    'detail', v_detail
  );
end;
$$;

create or replace function public.quote_weight_price(p_service uuid, p_weight numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_quote jsonb;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'Connexion requise.' using errcode = '42501';
  end if;
  if p_weight is null or p_weight <= 0 then
    raise exception 'Indiquez un poids supérieur à zéro.' using errcode = '22023';
  end if;
  v_quote := public.compute_weight_price(v_tenant, p_service, p_weight);
  if v_quote is null then
    raise exception 'Aucune règle de tarification au kilo ne couvre ce poids pour cette prestation.'
      using errcode = '22023';
  end if;
  return v_quote;
end;
$$;

revoke all on function public.compute_weight_price(uuid, uuid, numeric) from public, anon, authenticated;
revoke all on function public.quote_weight_price(uuid, numeric) from public, anon;
grant execute on function public.quote_weight_price(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Garde lignes : branche kilo ajoutée à la garde 027 (+ contrôle en update)
-- ---------------------------------------------------------------------------
create or replace function public.guard_order_item_catalog()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_price integer;
  v_quote jsonb;
begin
  -- Lignes au kilo avec règle active : le serveur recalcule et fige le
  -- poids facturé ; le total envoyé doit correspondre (sauf dérogation
  -- motivée, comme pour la grille catalogue).
  if coalesce(new.billing_unit, 'PIECE') = 'KG' and new.tenant_service_id is not null then
    v_quote := public.compute_weight_price(new.tenant_id, new.tenant_service_id, new.quantity);
    if v_quote is not null then
      new.billed_quantity := (v_quote ->> 'poids_facture_kg')::numeric;
      if new.price <> (v_quote ->> 'montant')::integer
         and char_length(btrim(coalesce(new.price_reason, ''))) < 10 then
        raise exception 'Le total diffère du tarif au kilo calculé (% FCFA pour % kg facturés) : un motif d''au moins 10 caractères est exigé pour déroger.',
          v_quote ->> 'montant', v_quote ->> 'poids_facture_kg'
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

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

  -- Obligation catalogue : uniquement à la création (les corrections de
  -- lignes historiques restent possibles en mise à jour).
  if TG_OP = 'INSERT'
     and coalesce(new.billing_unit, 'PIECE') <> 'KG'
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

create trigger trg_order_items_guard_catalog_update
  before update of quantity, price, unit_price, tenant_service_id, garment_type_id, billing_unit
  on public.order_items
  for each row execute function public.guard_order_item_catalog();

create trigger trg_pricing_rules_updated_at
  before update on public.pricing_rules
  for each row execute function public.update_updated_at_column();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.pricing_rules enable row level security;
alter table public.pricing_rule_tiers enable row level security;

create policy pricing_rules_select_member
  on public.pricing_rules for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy pricing_rules_insert_owner
  on public.pricing_rules for insert to authenticated
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner');
create policy pricing_rules_update_owner
  on public.pricing_rules for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner');
create policy pricing_rules_delete_owner
  on public.pricing_rules for delete to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner');

create policy pricing_rule_tiers_select_member
  on public.pricing_rule_tiers for select to authenticated
  using (exists (
    select 1 from public.pricing_rules r
     where r.id = pricing_rule_id and r.tenant_id = public.current_tenant_id()
  ));
create policy pricing_rule_tiers_insert_owner
  on public.pricing_rule_tiers for insert to authenticated
  with check (
    public.current_tenant_role() = 'owner'
    and exists (
      select 1 from public.pricing_rules r
       where r.id = pricing_rule_id and r.tenant_id = public.current_tenant_id()
    )
  );
create policy pricing_rule_tiers_update_owner
  on public.pricing_rule_tiers for update to authenticated
  using (
    public.current_tenant_role() = 'owner'
    and exists (
      select 1 from public.pricing_rules r
       where r.id = pricing_rule_id and r.tenant_id = public.current_tenant_id()
    )
  )
  with check (
    public.current_tenant_role() = 'owner'
    and exists (
      select 1 from public.pricing_rules r
       where r.id = pricing_rule_id and r.tenant_id = public.current_tenant_id()
    )
  );
create policy pricing_rule_tiers_delete_owner
  on public.pricing_rule_tiers for delete to authenticated
  using (
    public.current_tenant_role() = 'owner'
    and exists (
      select 1 from public.pricing_rules r
       where r.id = pricing_rule_id and r.tenant_id = public.current_tenant_id()
    )
  );

revoke all on public.pricing_rules, public.pricing_rule_tiers from anon, public;
grant select, insert, update, delete on public.pricing_rules, public.pricing_rule_tiers to authenticated;

comment on table public.pricing_rules is
  'Règles de tarification au kilo par prestation (une active au plus par prestation).';

commit;
