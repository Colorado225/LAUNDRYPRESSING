-- =============================================================================
-- 020_suppression_tarification_et_laundry_models.sql
-- =============================================================================
-- Suppression définitive du système de tarification (grille des tarifs) et des
-- modèles commerciaux pressing (prix au kilo / forfait).
--
-- ATTENTION : opération irréversible. Toutes les données suivantes sont perdues :
--   • Tarifs configurés dans catalog_entries (grille de départ + tarifs saisis)
--   • Articles, prestations, familles du catalogue
--   • Modèles de pressing laundry_models (PER_KG, WEIGHT_PACKAGE)
--   • Toutes les colonnes de tarification sur order_items (instantanés, modèle, etc.)
--
-- Les commandes existantes conservent leur total (order_items.price) mais
-- perdent toute référence au catalogue et au modèle de pressing.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Retirer les colonnes de tarification / modèle pressing sur order_items
--    (doit se faire AVANT la suppression des tables référencées)
-- ---------------------------------------------------------------------------

alter table public.order_items
  drop constraint if exists order_items_catalog_fk,
drop index if exists order_items_laundry_model_idx;
drop index if exists idx_catalog_tenant;

-- ---------------------------------------------------------------------------
-- 2. Supprimer toutes les tables de tarification et de modèles pressing
--    (CASCADE supprime triggers, index, contraintes, RLS associés)
-- ---------------------------------------------------------------------------

drop table if exists public.laundry_model_template_families cascade;
drop table if exists public.laundry_model_template_services cascade;
drop table if exists public.laundry_model_templates cascade;
drop table if exists public.catalog_model_templates cascade;
drop table if exists public.catalog_template_installations cascade;
drop table if exists public.catalog_operation_definitions cascade;
drop table if exists public.laundry_model_services cascade;
drop table if exists public.laundry_models cascade;
drop table if exists public.catalog_services cascade;
drop table if exists public.catalog_articles cascade;
drop table if exists public.catalog_families cascade;
drop table if exists public.catalog_entries cascade;

-- ---------------------------------------------------------------------------
-- 3. Supprimer les fonctions SQL orphelines liées au catalogue / tarification
-- ---------------------------------------------------------------------------

drop function if exists public.catalog_name_key(text) cascade;
drop function if exists public.catalog_billable_quantity(numeric, text, numeric, numeric) cascade;
drop function if exists public.catalog_line_total(numeric, integer, integer) cascade;
drop function if exists public.guard_order_item_price() cascade;
drop function if exists public.guard_catalog_service_scope() cascade;
drop function if exists public.guard_catalog_reference_archive() cascade;
drop function if exists public.guard_active_catalog_entry_references() cascade;
drop function if exists public.guard_order_item_active_catalog() cascade;
drop function if exists public.log_order_item_price_change() cascade;
drop function if exists public.save_laundry_model(json, json) cascade;
drop function if exists public.save_laundry_model(json, json, json) cascade;
drop function if exists public.guard_laundry_model_order_item() cascade;
drop function if exists public.apply_laundry_model_template(text, json, json) cascade;
drop function if exists public.count_catalog_tarifs_dependants(uuid, text, uuid, boolean) cascade;
drop function if exists public.compter_tarifs_dependants(uuid, text, uuid, boolean) cascade;

-- ---------------------------------------------------------------------------
-- 4. Nettoyer les vues qui auraient pu référencer ces tables
-- ---------------------------------------------------------------------------

drop view if exists public.order_balances cascade;

create or replace view public.order_balances
with (security_invoker = true)
as
select
  o.id                                        as order_id,
  o.tenant_id,
  o.total_amount,
  case
    when o.payment_status = 'paid' then o.total_amount
    else coalesce(sum(pt.amount) filter (where pt.status = 'paid'), 0)
  end                                         as paid_amount,
  case
    when o.payment_status = 'paid' then 0
    else greatest(
      o.total_amount - coalesce(sum(pt.amount) filter (where pt.status = 'paid'), 0),
      0
    )
  end                                         as remaining_amount,
  o.payment_status,
  o.due_date,
  o.status
from public.orders o
left join public.payment_transactions pt on pt.order_id = o.id
group by o.id, o.tenant_id, o.total_amount, o.payment_status, o.due_date, o.status;

grant select on public.order_balances to authenticated;

comment on migration 020 is
  'Suppression définitive de la grille des tarifs (catalog_*) et des modèles pressing (laundry_models_*).';

commit;

  drop constraint if exists order_items_laundry_model_fk;

alter table public.order_items
  drop column if exists catalog_entry_id,
  drop column if exists laundry_model_id,
  drop column if exists laundry_model_name_snapshot,
  drop column if exists laundry_model_type_snapshot,
  drop column if exists laundry_weight_kg,
  drop column if exists laundry_price_breakdown_snapshot,
  drop column if exists laundry_services_snapshot,
  drop column if exists laundry_price_per_kg_snapshot,
  drop column if exists laundry_package_price_snapshot,
  drop column if exists laundry_included_weight_kg_snapshot,
  drop column if exists laundry_overage_price_per_kg_snapshot,
  drop column if exists laundry_minimum_weight_kg_snapshot,
  drop column if exists laundry_billing_increment_kg_snapshot,
  drop column if exists laundry_minimum_charge_snapshot;

drop index if exists order_items_laundry_model_idx;
drop index if exists idx_catalog_tenant;
