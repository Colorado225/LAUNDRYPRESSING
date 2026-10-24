-- =============================================================================
-- 015_catalogue_reference_lifecycle.sql — archivage sûr des références catalogue
-- =============================================================================
-- Une famille, un article ou une prestation ne doit pas laisser un tarif actif
-- orphelin. Les tarifs utilisés doivent d'abord être archivés ; les anciennes
-- commandes conservent leurs instantanés et ne sont pas recalculées.
-- Cette migration n'est pas appliquée automatiquement à un projet distant.
-- =============================================================================

begin;

create or replace function public.guard_catalog_reference_archive()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tarifs_actifs bigint;
begin
  if old.is_active and not new.is_active then
    if tg_table_name = 'catalog_articles' then
      select count(*) into v_tarifs_actifs
        from public.catalog_entries ce
       where ce.tenant_id = old.tenant_id
         and ce.article_id = old.id
         and ce.is_active;
      if v_tarifs_actifs > 0 then
        raise exception 'Archivez d’abord les tarifs actifs de cet article.'
          using errcode = '23514';
      end if;
    elsif tg_table_name = 'catalog_services' then
      select count(*) into v_tarifs_actifs
        from public.catalog_entries ce
       where ce.tenant_id = old.tenant_id
         and ce.service_id = old.id
         and ce.is_active;
      if v_tarifs_actifs > 0 then
        raise exception 'Archivez d’abord les tarifs actifs de cette prestation.'
          using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_catalog_reference_archive() from public, anon, authenticated;

drop trigger if exists trg_catalog_articles_guard_archive on public.catalog_articles;
create trigger trg_catalog_articles_guard_archive
  before update of is_active on public.catalog_articles
  for each row execute function public.guard_catalog_reference_archive();

drop trigger if exists trg_catalog_services_guard_archive on public.catalog_services;
create trigger trg_catalog_services_guard_archive
  before update of is_active on public.catalog_services
  for each row execute function public.guard_catalog_reference_archive();

-- Une entrée tarifaire active ne peut pas pointer vers un article ou service
-- archivé, y compris si une requête SQL contourne l'interface.
create or replace function public.guard_active_catalog_entry_references()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_service_active boolean;
  v_article_active boolean;
begin
  if not new.is_active then return new; end if;

  select cs.is_active, coalesce(ca.is_active, true)
    into v_service_active, v_article_active
    from public.catalog_services cs
    left join public.catalog_articles ca
      on ca.id = new.article_id and ca.tenant_id = new.tenant_id
   where cs.id = new.service_id and cs.tenant_id = new.tenant_id;

  if not found then
    raise exception 'La prestation doit appartenir au catalogue de ce pressing.'
      using errcode = '23503';
  end if;
  if not v_service_active then
    raise exception 'Réactivez la prestation avant d’activer ce tarif.'
      using errcode = '23514';
  end if;
  if not v_article_active then
    raise exception 'Réactivez l’article avant d’activer ce tarif.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_active_catalog_entry_references() from public, anon, authenticated;

drop trigger if exists trg_catalog_entries_guard_active_references on public.catalog_entries;
create trigger trg_catalog_entries_guard_active_references
  after insert or update of is_active, article_id, service_id on public.catalog_entries
  for each row execute function public.guard_active_catalog_entry_references();

-- Un ancien cache hors ligne peut encore tenter d'ajouter une ligne après
-- l'archivage d'une référence. Le serveur refuse l'association nouvelle, mais
-- laisse intactes les lignes historiques qui ne changent pas de référence.
create or replace function public.guard_order_item_active_catalog()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry_active boolean;
  v_service_active boolean;
  v_article_active boolean;
begin
  if tg_op = 'UPDATE'
     and new.catalog_entry_id is not distinct from old.catalog_entry_id
     and new.tenant_id is not distinct from old.tenant_id then
    return new;
  end if;
  if new.catalog_entry_id is null then return new; end if;

  select ce.is_active, cs.is_active, coalesce(ca.is_active, true)
    into v_entry_active, v_service_active, v_article_active
    from public.catalog_entries ce
    join public.catalog_services cs
      on cs.id = ce.service_id and cs.tenant_id = ce.tenant_id
    left join public.catalog_articles ca
      on ca.id = ce.article_id and ca.tenant_id = ce.tenant_id
   where ce.id = new.catalog_entry_id and ce.tenant_id = new.tenant_id;

  if not found then
    raise exception 'Tarif absent du catalogue de ce pressing.' using errcode = '23503';
  end if;
  if not v_entry_active or not v_service_active or not v_article_active then
    raise exception 'Ce tarif ou sa référence a été archivé ; choisissez une entrée active du catalogue.'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_order_item_active_catalog() from public, anon, authenticated;

drop trigger if exists trg_order_items_guard_active_catalog on public.order_items;
create trigger trg_order_items_guard_active_catalog
  before insert or update of catalog_entry_id, tenant_id on public.order_items
  for each row execute function public.guard_order_item_active_catalog();

commit;
