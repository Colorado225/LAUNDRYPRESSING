-- =============================================================================
-- 020_suppression_tarification_et_laundry_models.sql
-- =============================================================================
-- Retire le catalogue tarifaire et les modèles commerciaux (au kilo, forfaits
-- et forfaits famille). Les anciennes lignes de commande conservent leurs
-- libellés, quantités, prix et snapshots génériques : les reçus déjà émis ne
-- sont donc pas recalculés. Les clés et snapshots propres au catalogue/modèle
-- sont supprimés.
--
-- Migration destructive : les tarifs, références du catalogue, modèles et
-- compositions de forfaits sont définitivement supprimés.
-- =============================================================================

begin;

-- Retirer d'abord les automatismes qui consultent les tables supprimées.
drop trigger if exists trg_order_items_guard_price on public.order_items;
drop trigger if exists trg_order_items_guard_active_catalog on public.order_items;
drop trigger if exists trg_order_items_z_laundry_model on public.order_items;
drop trigger if exists trg_order_items_snapshot_service_operations on public.order_items;
drop trigger if exists trg_order_items_zz_model_operations on public.order_items;

-- Les tableaux de composition et leurs déclencheurs ne sont plus utilisés.
drop table if exists public.order_item_family_package_contents cascade;
drop table if exists public.order_item_family_packages cascade;

-- Préserver la journalisation des corrections de prix sans dépendre du
-- catalogue supprimé ni des snapshots de modèles.
create or replace function public.log_order_item_price_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.price is distinct from old.price then
    insert into public.order_price_history
      (tenant_id, order_id, order_item_id, previous_price, new_price, reason, changed_by)
    values
      (new.tenant_id, new.order_id, new.id, old.price, new.price, new.price_reason, auth.uid());
  end if;
  return new;
end;
$$;

-- Clé de catalogue et données propres aux modèles. Les snapshots tarifaires
-- génériques (quantité, unité, prix unitaire, etc.) sont préservés pour
-- compatibilité des reçus, de l'historique et des commandes hors ligne.
alter table public.order_items
  drop constraint if exists order_items_catalog_fk,
  drop constraint if exists order_items_laundry_model_fk,
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
  drop column if exists laundry_minimum_charge_snapshot,
  drop column if exists service_operations_snapshot;

drop index if exists public.order_items_laundry_model_idx;
drop index if exists public.idx_catalog_tenant;

-- Référentiels, modèles, alias et réglages commerciaux.
drop table if exists public.laundry_model_template_families cascade;
drop table if exists public.laundry_model_template_services cascade;
drop table if exists public.laundry_model_templates cascade;
drop table if exists public.catalog_model_templates cascade;
drop table if exists public.catalog_template_installations cascade;
drop table if exists public.catalog_operation_definitions cascade;
drop table if exists public.catalog_article_aliases cascade;
drop table if exists public.catalog_service_operations cascade;
drop table if exists public.laundry_model_catalog_scope cascade;
drop table if exists public.laundry_model_services cascade;
drop table if exists public.laundry_models cascade;
drop table if exists public.catalog_services cascade;
drop table if exists public.catalog_articles cascade;
drop table if exists public.catalog_families cascade;
drop table if exists public.catalog_entries cascade;

-- Les routines de ces fonctionnalités peuvent avoir des dépendances PL/pgSQL
-- non suivies automatiquement par PostgreSQL. Les retirer par famille de nom.
do $$
declare
  fonction record;
begin
  for fonction in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and (
         p.proname like 'catalog\_%' escape '\'
         or p.proname like 'laundry\_%' escape '\'
         or p.proname like 'apply_catalog\_%' escape '\'
         or p.proname like 'save_catalog\_%' escape '\'
         or p.proname like 'guard_catalog\_%' escape '\'
         or p.proname in (
           'guard_order_item_price',
           'guard_order_item_active_catalog',
           'guard_laundry_model_order_item',
           'snapshot_catalog_service_operations',
           'snapshot_laundry_model_operations',
           'prepare_family_package_snapshot',
           'prepare_family_package_content_snapshot',
           'validate_family_package_piece_count',
           'create_family_package_order_item',
           'count_catalog_tarifs_dependants',
           'compter_tarifs_dependants'
         )
       )
  loop
    execute format('drop function %s cascade', fonction.signature);
  end loop;
end;
$$;

comment on table public.order_items is
  'Lignes de commande avec prix et quantités figés ; aucun lien vers un catalogue tarifaire.';

commit;
