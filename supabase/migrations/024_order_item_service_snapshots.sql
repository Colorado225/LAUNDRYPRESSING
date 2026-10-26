-- =============================================================================
-- 024_order_item_service_snapshots.sql
-- Relie les lignes de commande au service configuré et fige son activité.
-- =============================================================================
-- Le lien au service reste facultatif pour les commandes historiques/libres.
-- À la suppression d'un service, seule la FK est effacée : les noms figés dans
-- la commande restent disponibles sur les reçus, factures et historiques.
-- La FK composite empêche une ligne de commande de pointer vers un autre
-- pressing.
-- =============================================================================

begin;

alter table public.order_items
  add column tenant_service_id uuid,
  add column activity_name_snapshot text;

alter table public.order_items
  add constraint order_items_tenant_service_fk
    foreign key (tenant_service_id, tenant_id)
    references public.tenant_services (id, tenant_id)
    on delete set null (tenant_service_id),
  add constraint order_items_service_snapshot_check
    check (
      tenant_service_id is null
      or (activity_name_snapshot is not null and service_name is not null)
    );

create index order_items_tenant_service_idx
  on public.order_items (tenant_id, tenant_service_id)
  where tenant_service_id is not null;

comment on column public.order_items.tenant_service_id is
  'Référence vers la prestation choisie; devient nulle si le pressing la supprime.';
comment on column public.order_items.activity_name_snapshot is
  'Nom de l’activité figé au dépôt, indépendant des renommages ultérieurs.';

commit;
