-- =============================================================================
-- 017_laundry_model_order_lines.sql — instantanés des modèles sur les commandes
-- =============================================================================
-- Une ligne de commande conserve les paramètres du modèle réellement appliqué.
-- Le serveur recalcule le montant au moment de l'insertion : un cache hors ligne
-- périmé ou un montant modifié par le client ne peut pas fausser la vente.
-- =============================================================================

begin;

alter table public.order_items
  add column laundry_model_id uuid,
  add column laundry_model_name_snapshot text,
  add column laundry_model_type_snapshot text,
  add column laundry_weight_kg numeric(10,3),
  add column laundry_price_breakdown_snapshot text,
  add column laundry_services_snapshot text,
  add column laundry_price_per_kg_snapshot integer,
  add column laundry_package_price_snapshot integer,
  add column laundry_included_weight_kg_snapshot numeric(10,3),
  add column laundry_overage_price_per_kg_snapshot integer,
  add column laundry_minimum_weight_kg_snapshot numeric(10,3),
  add column laundry_billing_increment_kg_snapshot numeric(10,3),
  add column laundry_minimum_charge_snapshot integer,
  add constraint order_items_laundry_model_fk
    foreign key (laundry_model_id, tenant_id)
    references public.laundry_models (id, tenant_id)
    on delete no action deferrable initially deferred,
  add constraint order_items_laundry_model_type_check
    check (laundry_model_type_snapshot is null or laundry_model_type_snapshot in ('PER_KG', 'WEIGHT_PACKAGE')),
  add constraint order_items_laundry_model_snapshot_check check (
    (laundry_model_id is null
      and laundry_model_name_snapshot is null
      and laundry_model_type_snapshot is null
      and laundry_weight_kg is null
      and laundry_price_breakdown_snapshot is null
      and laundry_services_snapshot is null
      and laundry_price_per_kg_snapshot is null
      and laundry_package_price_snapshot is null
      and laundry_included_weight_kg_snapshot is null
      and laundry_overage_price_per_kg_snapshot is null
      and laundry_minimum_weight_kg_snapshot is null
      and laundry_billing_increment_kg_snapshot is null
      and laundry_minimum_charge_snapshot is null)
    or
    (laundry_model_id is not null
      and laundry_model_name_snapshot is not null
      and laundry_model_type_snapshot is not null
      and laundry_weight_kg is not null and laundry_weight_kg > 0
      and laundry_price_breakdown_snapshot is not null
      and laundry_services_snapshot is not null)
  );

create index order_items_laundry_model_idx
  on public.order_items (tenant_id, laundry_model_id)
  where laundry_model_id is not null;

-- Ce trigger s'exécute après `trg_order_items_guard_price` (ordre alphabétique
-- des noms des triggers BEFORE). Le garde existant vérifie déjà la ligne de
-- transport forfaitaire ; ici on vérifie le poids et le calcul commercial réel.
create or replace function public.guard_laundry_model_order_item()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_model record;
  v_inserted boolean := tg_op = 'INSERT' or new.laundry_model_id is distinct from old.laundry_model_id;
  v_billable_weight numeric(10,3);
  v_extra_weight numeric(10,3);
  v_expected integer;
  v_breakdown text;
  v_services text;
begin
  if tg_op = 'UPDATE' and old.laundry_model_id is not null
     and new.laundry_model_id is distinct from old.laundry_model_id then
    raise exception 'Le modèle commercial d''une ligne historique ne peut pas être remplacé.'
      using errcode = '22023';
  end if;

  if new.laundry_model_id is null then
    if tg_op = 'UPDATE' and old.laundry_model_id is not null then
      raise exception 'L''instantané du modèle commercial d''une ligne historique ne peut pas être supprimé.'
        using errcode = '22023';
    end if;
    return new;
  end if;
  if new.catalog_entry_id is not null then
    raise exception 'Une ligne de modèle commercial ne peut pas dépendre d''un tarif à la pièce.'
      using errcode = '22023';
  end if;
  if new.laundry_weight_kg is null or new.laundry_weight_kg <= 0 then
    raise exception 'Saisissez le poids réel de la prestation commerciale.' using errcode = '22023';
  end if;

  if v_inserted then
    select * into v_model
      from public.laundry_models lm
     where lm.id = new.laundry_model_id
       and lm.tenant_id = new.tenant_id
       and lm.is_active;
    if not found then
      raise exception 'Ce modèle commercial n''est plus actif dans ce pressing. Actualisez la commande.'
        using errcode = '23503';
    end if;
    if new.billing_unit <> 'FLAT' or new.quantity <> 1 or new.unit_price <> new.price then
      raise exception 'La ligne de transport du modèle commercial est invalide.' using errcode = '22023';
    end if;
  else
    select
      old.laundry_model_id as id,
      old.tenant_id as tenant_id,
      old.laundry_model_name_snapshot as name,
      old.laundry_model_type_snapshot as model_type,
      old.laundry_price_per_kg_snapshot as price_per_kg,
      old.laundry_package_price_snapshot as package_price,
      old.laundry_included_weight_kg_snapshot as included_weight_kg,
      old.laundry_overage_price_per_kg_snapshot as overage_price_per_kg,
      old.laundry_minimum_weight_kg_snapshot as minimum_weight_kg,
      old.laundry_billing_increment_kg_snapshot as billing_increment_kg,
      old.laundry_minimum_charge_snapshot as minimum_charge,
      true as is_active
    into v_model;
  end if;

  if v_model.model_type = 'PER_KG' then
    if v_model.price_per_kg is null or v_model.price_per_kg <= 0 then
      raise exception 'Le tarif au kilo de l''instantané est invalide.' using errcode = '22023';
    end if;
    v_billable_weight := public.catalog_billable_quantity(
      new.laundry_weight_kg, 'KG', v_model.minimum_weight_kg, v_model.billing_increment_kg
    );
    v_expected := public.catalog_line_total(
      v_billable_weight, v_model.price_per_kg::integer, v_model.minimum_charge::integer
    );
    if new.price <> v_expected then
      raise exception 'Montant au kilo invalide : % FCFA attendus selon le poids et le modèle.', v_expected
        using errcode = '22023';
    end if;
    new.billing_unit := 'KG';
    new.quantity := new.laundry_weight_kg;
    new.billed_quantity := v_billable_weight;
    new.unit_price := v_model.price_per_kg::integer;
    new.pricing_mode := 'FIXED';
    new.catalog_unit_price_snapshot := v_model.price_per_kg::integer;
    new.minimum_quantity_snapshot := v_model.minimum_weight_kg;
    new.billing_increment_snapshot := v_model.billing_increment_kg;
    new.minimum_charge_snapshot := v_model.minimum_charge::integer;
    v_breakdown := v_billable_weight::text || ' kg × ' || v_model.price_per_kg::text || ' FCFA/kg';
  elsif v_model.model_type = 'WEIGHT_PACKAGE' then
    if v_model.package_price is null or v_model.included_weight_kg is null then
      raise exception 'L''instantané du forfait est incomplet.' using errcode = '22023';
    end if;
    v_extra_weight := greatest(0, new.laundry_weight_kg - v_model.included_weight_kg);
    if v_extra_weight > 0 and v_model.overage_price_per_kg is null then
      if new.price_status <> 'CONFIRMED'
         or new.price < greatest(v_model.package_price::integer, coalesce(v_model.minimum_charge::integer, 0)) then
        raise exception 'Confirmez un montant au moins égal au forfait pour le poids dépassé.'
          using errcode = '22023';
      end if;
      v_expected := new.price;
      v_breakdown := 'Forfait ' || v_model.package_price::text || ' FCFA, poids supplémentaire à valider ; montant confirmé ' || new.price::text || ' FCFA';
    else
      if v_extra_weight > 0 then
        v_extra_weight := public.catalog_billable_quantity(
          v_extra_weight, 'KG', null, v_model.billing_increment_kg
        );
      end if;
      v_expected := greatest(
        round(v_model.package_price + v_extra_weight * coalesce(v_model.overage_price_per_kg, 0))::integer,
        coalesce(v_model.minimum_charge::integer, 0)
      );
      if new.price <> v_expected then
        raise exception 'Montant du forfait invalide : % FCFA attendus selon le poids et le modèle.', v_expected
          using errcode = '22023';
      end if;
      v_breakdown := v_model.package_price::text || ' FCFA le forfait'
        || case when v_extra_weight > 0
          then ' + ' || v_extra_weight::text || ' kg supplémentaire × '
            || v_model.overage_price_per_kg::text || ' FCFA/kg'
          else ' jusqu''à ' || v_model.included_weight_kg::text || ' kg'
        end;
    end if;
    new.billing_unit := 'FLAT';
    new.quantity := 1;
    new.billed_quantity := 1;
    new.unit_price := new.price;
    new.pricing_mode := 'FIXED';
    new.catalog_unit_price_snapshot := null;
    new.minimum_quantity_snapshot := null;
    new.billing_increment_snapshot := null;
    new.minimum_charge_snapshot := null;
  else
    raise exception 'Type de modèle commercial non pris en charge.' using errcode = '22023';
  end if;

  if v_inserted then
    select string_agg(
      (case when lms.inclusion_mode = 'INCLUDED' then 'Inclus : ' else 'Supplément : ' end) || cs.name,
      ', ' order by lms.sort_order, cs.name
    ) into v_services
      from public.laundry_model_services lms
      join public.catalog_services cs
        on cs.id = lms.service_id and cs.tenant_id = lms.tenant_id
     where lms.tenant_id = new.tenant_id and lms.model_id = new.laundry_model_id;

    new.laundry_model_name_snapshot := v_model.name;
    new.laundry_model_type_snapshot := v_model.model_type;
    new.laundry_price_per_kg_snapshot := v_model.price_per_kg::integer;
    new.laundry_package_price_snapshot := v_model.package_price::integer;
    new.laundry_included_weight_kg_snapshot := v_model.included_weight_kg;
    new.laundry_overage_price_per_kg_snapshot := v_model.overage_price_per_kg::integer;
    new.laundry_minimum_weight_kg_snapshot := v_model.minimum_weight_kg;
    new.laundry_billing_increment_kg_snapshot := v_model.billing_increment_kg;
    new.laundry_minimum_charge_snapshot := v_model.minimum_charge::integer;
    new.laundry_services_snapshot := coalesce(v_services, 'Aucune prestation associée');
    new.article_name := v_model.name;
    new.service_name := case when v_model.model_type = 'PER_KG' then 'Prestation au kilo' else 'Forfait de poids' end;
    new.conditions_snapshot := v_model.conditions;
  else
    new.laundry_model_name_snapshot := old.laundry_model_name_snapshot;
    new.laundry_model_type_snapshot := old.laundry_model_type_snapshot;
    new.laundry_price_per_kg_snapshot := old.laundry_price_per_kg_snapshot;
    new.laundry_package_price_snapshot := old.laundry_package_price_snapshot;
    new.laundry_included_weight_kg_snapshot := old.laundry_included_weight_kg_snapshot;
    new.laundry_overage_price_per_kg_snapshot := old.laundry_overage_price_per_kg_snapshot;
    new.laundry_minimum_weight_kg_snapshot := old.laundry_minimum_weight_kg_snapshot;
    new.laundry_billing_increment_kg_snapshot := old.laundry_billing_increment_kg_snapshot;
    new.laundry_minimum_charge_snapshot := old.laundry_minimum_charge_snapshot;
    new.laundry_services_snapshot := old.laundry_services_snapshot;
    new.article_name := old.article_name;
    new.service_name := old.service_name;
    new.conditions_snapshot := old.conditions_snapshot;
  end if;
  new.laundry_price_breakdown_snapshot := v_breakdown;
  return new;
end;
$$;

revoke all on function public.guard_laundry_model_order_item() from public, anon, authenticated;
drop trigger if exists trg_order_items_z_laundry_model on public.order_items;
create trigger trg_order_items_z_laundry_model
  before insert or update on public.order_items
  for each row execute function public.guard_laundry_model_order_item();

-- Inclut le modèle et son poids dans l'historique des changements de prix.
create or replace function public.log_order_item_price_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_previous jsonb;
  v_current jsonb;
begin
  v_previous := jsonb_build_object(
    'quantity', old.quantity,
    'billed_quantity', old.billed_quantity,
    'billing_unit', old.billing_unit,
    'unit_price', old.unit_price,
    'price', old.price,
    'pricing_mode', old.pricing_mode,
    'price_status', old.price_status,
    'catalog_entry_id', old.catalog_entry_id,
    'article_name', old.article_name,
    'service_name', old.service_name,
    'family_name', old.family_name_snapshot,
    'conditions', old.conditions_snapshot,
    'laundry_model_id', old.laundry_model_id,
    'laundry_model_name', old.laundry_model_name_snapshot,
    'laundry_model_type', old.laundry_model_type_snapshot,
    'laundry_weight_kg', old.laundry_weight_kg,
    'laundry_breakdown', old.laundry_price_breakdown_snapshot
  );
  v_current := jsonb_build_object(
    'quantity', new.quantity,
    'billed_quantity', new.billed_quantity,
    'billing_unit', new.billing_unit,
    'unit_price', new.unit_price,
    'price', new.price,
    'pricing_mode', new.pricing_mode,
    'price_status', new.price_status,
    'catalog_entry_id', new.catalog_entry_id,
    'article_name', new.article_name,
    'service_name', new.service_name,
    'family_name', new.family_name_snapshot,
    'conditions', new.conditions_snapshot,
    'laundry_model_id', new.laundry_model_id,
    'laundry_model_name', new.laundry_model_name_snapshot,
    'laundry_model_type', new.laundry_model_type_snapshot,
    'laundry_weight_kg', new.laundry_weight_kg,
    'laundry_breakdown', new.laundry_price_breakdown_snapshot
  );

  if v_current is distinct from v_previous or new.price_reason is distinct from old.price_reason then
    insert into public.order_price_history (
      tenant_id, order_id, order_item_id, previous_price, new_price, reason,
      changed_by, previous_snapshot, new_snapshot
    ) values (
      new.tenant_id, new.order_id, new.id, old.price, new.price, new.price_reason,
      auth.uid(), v_previous, v_current
    );
  end if;
  return new;
end;
$$;

comment on column public.order_items.laundry_model_id is
  'Modèle commercial appliqué ; les conditions de vente sont figées dans les colonnes _snapshot.';

commit;
