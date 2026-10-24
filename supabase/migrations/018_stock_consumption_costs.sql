-- =============================================================================
-- 018_stock_consumption_costs.sql — relier les consommables aux lignes vendues
-- =============================================================================
-- Les sorties de stock restent immuables. Une sortie peut désormais être
-- associée à une ligne de commande ; le coût unitaire est figé à la date de la
-- sortie pour éviter que le prix actuel de l'article réécrive l'historique.
-- Les mouvements anciens ne sont pas recalculés : leur coût est inconnu.

alter table public.stock_movements
  add column if not exists order_item_id uuid;

alter table public.stock_movements
  drop constraint if exists stock_movements_order_item_fk;
alter table public.stock_movements
  add constraint stock_movements_order_item_fk
  foreign key (order_item_id, tenant_id)
  references public.order_items (id, tenant_id)
  on delete set null (order_item_id);

alter table public.stock_movements
  drop constraint if exists stock_movements_order_item_kind_check;
alter table public.stock_movements
  add constraint stock_movements_order_item_kind_check
  check (order_item_id is null or kind = 'out');

create index if not exists stock_movements_order_item_cost_idx
  on public.stock_movements (tenant_id, order_item_id)
  where kind = 'out' and order_item_id is not null;

-- Le coût d'une sortie est la dernière valeur connue de l'article. Le coût est
-- capturé une seule fois dans le mouvement et n'est jamais rattrapé a posteriori.
create or replace function public.snapshot_stock_movement_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit_cost integer;
begin
  if new.kind = 'in' and new.unit_cost is not null
     and public.current_tenant_role() <> 'owner' then
    raise exception 'Seul le propriétaire peut définir le coût unitaire du stock.'
      using errcode = '42501';
  end if;

  if new.order_item_id is not null then
    if new.kind <> 'out' then
      raise exception 'Seule une sortie de stock peut être liée à une commande.'
        using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.order_items oi
       where oi.id = new.order_item_id and oi.tenant_id = new.tenant_id
    ) then
      raise exception 'Ligne de commande introuvable dans ce pressing.'
        using errcode = '23503';
    end if;
  end if;

  if new.kind = 'out' then
    select si.unit_cost into v_unit_cost
      from public.stock_items si
     where si.id = new.item_id and si.tenant_id = new.tenant_id;
    -- Le serveur est la source de vérité : le client ne peut pas gonfler ou
    -- réduire artificiellement les coûts en choisissant un prix de sortie.
    new.unit_cost := v_unit_cost;
  end if;

  return new;
end;
$$;

revoke all on function public.snapshot_stock_movement_cost() from public, anon, authenticated;

drop trigger if exists trg_stock_movement_cost_snapshot on public.stock_movements;
create trigger trg_stock_movement_cost_snapshot
  before insert on public.stock_movements
  for each row execute function public.snapshot_stock_movement_cost();

-- Une sortie consomme le coût figé dans son mouvement sans modifier le coût
-- courant de réapprovisionnement de l'article. Seules les entrées font évoluer
-- cette valeur courante.
create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quantite numeric(10, 2);
begin
  select quantity into v_quantite
  from public.stock_items
  where id = new.item_id and tenant_id = new.tenant_id
  for update;

  if not found then
    raise exception 'Article de stock introuvable.' using errcode = 'P0002';
  end if;

  if new.kind = 'out' and v_quantite < new.quantity then
    raise exception 'Stock insuffisant : % en stock, % demandé(s).', v_quantite, new.quantity
      using errcode = '22023';
  end if;

  update public.stock_items
     set quantity = case when new.kind = 'in'
                         then quantity + new.quantity
                         else quantity - new.quantity
                    end,
         unit_cost = case when new.kind = 'in' then coalesce(new.unit_cost, unit_cost)
                          else unit_cost end,
         updated_at = now()
   where id = new.item_id and tenant_id = new.tenant_id;

  return new;
end;
$$;

revoke all on function public.apply_stock_movement() from public, anon, authenticated;

-- Rapport d'usage : la fonction n'expose que les coûts des lignes du pressing
-- actif, et uniquement aux propriétaires. Les mouvements sans prix sont
-- comptés à part afin de ne pas présenter une marge incomplète comme exacte.
create or replace function public.report_stock_consumption_costs(p_order_item_ids uuid[])
returns table (
  order_item_id uuid,
  cost_amount numeric,
  missing_cost_movements bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select sm.order_item_id,
         round(coalesce(sum(sm.quantity * sm.unit_cost) filter (where sm.unit_cost is not null), 0))::numeric,
         count(*) filter (where sm.unit_cost is null)::bigint
    from public.stock_movements sm
   where sm.tenant_id = public.current_tenant_id()
     and public.current_tenant_role() = 'owner'
     and sm.kind = 'out'
     and sm.order_item_id is not null
     and cardinality(coalesce(p_order_item_ids, '{}'::uuid[])) between 1 and 5000
     and sm.order_item_id = any(p_order_item_ids)
   group by sm.order_item_id;
$$;

revoke all on function public.report_stock_consumption_costs(uuid[]) from public, anon;
grant execute on function public.report_stock_consumption_costs(uuid[]) to authenticated;

comment on column public.stock_movements.order_item_id is
  'Ligne commerciale à laquelle la sortie est affectée ; NULL pour les mouvements non imputés.';
comment on column public.stock_movements.unit_cost is
  'Coût unitaire FCFA figé au moment du mouvement pour estimer la consommation.';
comment on function public.report_stock_consumption_costs(uuid[]) is
  'Agrégats de coûts directs des consommables liés, visibles au propriétaire du pressing actif.';
