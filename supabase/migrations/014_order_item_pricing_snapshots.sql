-- =============================================================================
-- 014_order_item_pricing_snapshots.sql — quantités, unités et prix figés
-- =============================================================================
-- Les montants historiques restent inchangés. Les nouvelles lignes sont
-- recalculées et vérifiées par PostgreSQL avec la même règle que l'application.
-- Une ligne conserve la quantité observée, la quantité facturée, le prix unitaire,
-- le tarif catalogue de référence et les conditions en vigueur à sa création.
-- =============================================================================

begin;

alter table public.order_items
  add column if not exists quantity numeric(12, 3) not null default 1;
alter table public.order_items
  add column if not exists billed_quantity numeric(12, 3) not null default 1;
alter table public.order_items
  add column if not exists billing_unit text not null default 'PIECE';
alter table public.order_items
  add column if not exists unit_price integer;
alter table public.order_items
  add column if not exists pricing_mode text not null default 'FIXED';
alter table public.order_items
  add column if not exists price_status text not null default 'CONFIRMED';
alter table public.order_items
  add column if not exists family_name_snapshot text;
alter table public.order_items
  add column if not exists catalog_unit_price_snapshot integer;
alter table public.order_items
  add column if not exists minimum_quantity_snapshot numeric(12, 3);
alter table public.order_items
  add column if not exists billing_increment_snapshot numeric(12, 3);
alter table public.order_items
  add column if not exists minimum_charge_snapshot integer;
alter table public.order_items
  add column if not exists conditions_snapshot text;

-- Un devis est un montant final confirmé, pas un tarif à multiplier par une
-- mesure. Sa seule unité cohérente est donc le forfait.
update public.catalog_entries
   set billing_unit = 'FLAT'
 where pricing_mode = 'QUOTE' and billing_unit <> 'FLAT';
alter table public.catalog_entries
  drop constraint if exists catalog_entries_quote_flat_check;
alter table public.catalog_entries
  add constraint catalog_entries_quote_flat_check
  check (pricing_mode <> 'QUOTE' or billing_unit = 'FLAT');

-- Supprimer un ancien tarif efface uniquement sa FK : l'ID de tenant ne doit
-- jamais être mis à NULL par l'action SET NULL sur la clé composite.
alter table public.order_items drop constraint if exists order_items_catalog_fk;
alter table public.order_items
  add constraint order_items_catalog_fk
  foreign key (catalog_entry_id, tenant_id)
  references public.catalog_entries (id, tenant_id)
  on delete set null (catalog_entry_id);

-- Reprise sans recalculer les anciennes factures : 1 pièce, un prix unitaire égal
-- au total historiquement stocké, sans inventer de poids ni de famille.
update public.order_items
   set unit_price = price
 where unit_price is null;

alter table public.order_items
  drop constraint if exists order_items_quantity_positive_check,
  drop constraint if exists order_items_billed_quantity_positive_check,
  drop constraint if exists order_items_billing_unit_check,
  drop constraint if exists order_items_unit_price_nonnegative_check,
  drop constraint if exists order_items_pricing_mode_check,
  drop constraint if exists order_items_price_status_check,
  drop constraint if exists order_items_minimum_quantity_snapshot_check,
  drop constraint if exists order_items_billing_increment_snapshot_check,
  drop constraint if exists order_items_minimum_charge_snapshot_check,
  drop constraint if exists order_items_discrete_quantity_check,
  drop constraint if exists order_items_flat_quantity_check;

alter table public.order_items
  add constraint order_items_quantity_positive_check check (quantity > 0),
  add constraint order_items_billed_quantity_positive_check check (billed_quantity > 0),
  add constraint order_items_billing_unit_check
    check (billing_unit in ('PIECE', 'PAIR', 'SET', 'KG', 'M2', 'METER', 'PACKAGE', 'FLAT')),
  add constraint order_items_unit_price_nonnegative_check check (unit_price is null or unit_price >= 0),
  add constraint order_items_pricing_mode_check
    check (pricing_mode in ('FIXED', 'FROM', 'QUOTE', 'UNCONFIGURED')),
  add constraint order_items_price_status_check check (price_status in ('CONFIRMED', 'ESTIMATED')),
  add constraint order_items_minimum_quantity_snapshot_check
    check (minimum_quantity_snapshot is null or minimum_quantity_snapshot > 0),
  add constraint order_items_billing_increment_snapshot_check
    check (billing_increment_snapshot is null or billing_increment_snapshot > 0),
  add constraint order_items_minimum_charge_snapshot_check
    check (minimum_charge_snapshot is null or minimum_charge_snapshot >= 0),
  add constraint order_items_discrete_quantity_check
    check (
      billing_unit not in ('PIECE', 'PAIR', 'SET', 'PACKAGE')
      or (quantity = trunc(quantity) and billed_quantity = trunc(billed_quantity))
    ),
  add constraint order_items_flat_quantity_check
    check (billing_unit <> 'FLAT' or quantity = 1);

-- Calcul de quantité facturée partagé par la garde serveur et les requêtes SQL.
create or replace function public.catalog_billable_quantity(
  p_quantity numeric,
  p_unit text,
  p_minimum_quantity numeric,
  p_increment numeric
)
returns numeric
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_base numeric;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'La quantité doit être supérieure à zéro.' using errcode = '22023';
  end if;
  if p_unit not in ('PIECE', 'PAIR', 'SET', 'KG', 'M2', 'METER', 'PACKAGE', 'FLAT') then
    raise exception 'Unité de facturation inconnue.' using errcode = '22023';
  end if;
  if p_unit in ('PIECE', 'PAIR', 'SET', 'PACKAGE') then
    if p_quantity <> trunc(p_quantity)
       or (p_minimum_quantity is not null and p_minimum_quantity <> trunc(p_minimum_quantity))
       or (p_increment is not null and p_increment <> trunc(p_increment)) then
      raise exception 'Cette unité, son minimum et son incrément se facturent en quantités entières.'
        using errcode = '22023';
    end if;
  end if;
  if p_unit = 'FLAT' and p_quantity <> 1 then
    raise exception 'Une prestation forfaitaire se facture une seule fois.' using errcode = '22023';
  end if;
  if p_minimum_quantity is not null and p_minimum_quantity <= 0 then
    raise exception 'La quantité minimum doit être supérieure à zéro.' using errcode = '22023';
  end if;
  if p_increment is not null and p_increment <= 0 then
    raise exception 'L''incrément de facturation doit être supérieur à zéro.' using errcode = '22023';
  end if;

  v_base := greatest(p_quantity, coalesce(p_minimum_quantity, 0));
  if p_increment is not null then
    return round(ceil(v_base / p_increment) * p_increment, 3);
  end if;
  return round(v_base, 3);
end;
$$;

create or replace function public.catalog_line_total(
  p_billed_quantity numeric,
  p_unit_price integer,
  p_minimum_charge integer
)
returns integer
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_amount numeric;
begin
  if p_billed_quantity is null or p_billed_quantity <= 0 then
    raise exception 'La quantité facturable doit être supérieure à zéro.' using errcode = '22023';
  end if;
  if p_unit_price is null or p_unit_price <= 0 then
    raise exception 'Le prix unitaire doit être supérieur à zéro.' using errcode = '22023';
  end if;
  if p_minimum_charge is not null and p_minimum_charge < 0 then
    raise exception 'Le minimum de facturation ne peut pas être négatif.' using errcode = '22023';
  end if;

  v_amount := greatest(round(p_billed_quantity * p_unit_price), coalesce(p_minimum_charge, 0));
  if v_amount > 2147483647 then
    raise exception 'Le total calculé dépasse la limite de facturation.' using errcode = '22003';
  end if;
  return v_amount::integer;
end;
$$;

-- Complète le garde existant : il prend une photographie lors de l'ajout d'une
-- référence, puis n'interroge plus le tarif courant quand une commande ancienne
-- est modifiée. Le serveur recalcule toujours le total et refuse les valeurs
-- incohérentes envoyées par un client.
create or replace function public.guard_order_item_price()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry record;
  v_family_name text;
  v_new_reference boolean;
  v_expected_total integer;
  v_base_price integer;
begin
  if auth.uid() is not null
     and public.current_tenant_role() not in ('owner', 'receptionist') then
    raise exception 'Votre rôle ne permet pas de modifier les prestations facturées.'
      using errcode = '42501';
  end if;

  v_new_reference := tg_op = 'INSERT'
    or new.catalog_entry_id is distinct from old.catalog_entry_id;

  if v_new_reference and new.catalog_entry_id is not null then
    select ce.id, ce.tenant_id, ce.article_id, ce.article, ce.service_id, ce.service,
           ce.price, ce.pricing_mode, ce.billing_unit, ce.minimum_quantity,
           ce.billing_increment, ce.minimum_charge, ce.conditions, ce.requires_review,
           cs.application_scope, ca.family_id
      into v_entry
      from public.catalog_entries ce
      join public.catalog_services cs on cs.id = ce.service_id and cs.tenant_id = ce.tenant_id
      left join public.catalog_articles ca on ca.id = ce.article_id and ca.tenant_id = ce.tenant_id
     where ce.id = new.catalog_entry_id and ce.tenant_id = new.tenant_id;

    if not found then
      raise exception 'Tarif absent du catalogue de ce pressing.' using errcode = '23503';
    end if;
    if v_entry.requires_review then
      raise exception 'Ce tarif doit être vérifié par le propriétaire avant utilisation.'
        using errcode = '22023';
    end if;
    if v_entry.pricing_mode = 'UNCONFIGURED' then
      raise exception 'Ce tarif est à configurer avant de créer une commande.' using errcode = '22023';
    end if;

    new.pricing_mode := v_entry.pricing_mode;
    new.billing_unit := v_entry.billing_unit;
    new.catalog_unit_price_snapshot := v_entry.price;
    new.minimum_quantity_snapshot := v_entry.minimum_quantity;
    new.billing_increment_snapshot := v_entry.billing_increment;
    new.minimum_charge_snapshot := v_entry.minimum_charge;
    new.conditions_snapshot := v_entry.conditions;
    new.article_name := case when v_entry.application_scope = 'article' then v_entry.article else null end;
    new.service_name := v_entry.service;
    if v_entry.family_id is not null then
      select cf.name into v_family_name
        from public.catalog_families cf
       where cf.id = v_entry.family_id and cf.tenant_id = new.tenant_id;
    end if;
    new.family_name_snapshot := v_family_name;

    -- Les clients antérieurs ne connaissent pas unit_price. Leur tarif n'est
    -- compatible que pour une pièce ; le poids ne doit jamais être interprété
    -- silencieusement comme « 1 kg ».
    if new.unit_price is null then
      if v_entry.billing_unit <> 'PIECE' or new.quantity <> 1 then
        raise exception 'Mettez à jour le formulaire pour saisir cette unité de facturation.'
          using errcode = '22023';
      end if;
      new.unit_price := case when new.price > 0 then new.price else v_entry.price end;
    end if;
  elsif v_new_reference and new.catalog_entry_id is null then
    new.pricing_mode := 'FIXED';
    new.billing_unit := coalesce(new.billing_unit, 'PIECE');
    new.catalog_unit_price_snapshot := null;
    new.minimum_quantity_snapshot := null;
    new.billing_increment_snapshot := null;
    new.minimum_charge_snapshot := null;
    new.conditions_snapshot := null;
    new.family_name_snapshot := null;
    if new.unit_price is null then
      if new.quantity <> 1 or new.billing_unit <> 'PIECE' then
        raise exception 'Saisissez le prix unitaire de la ligne libre.' using errcode = '22023';
      end if;
      new.unit_price := new.price;
    end if;
  elsif tg_op = 'UPDATE' and old.catalog_entry_id is not null then
    -- Les références et paramètres d'un tarif sont immuables sur une commande
    -- existante, même si le propriétaire change ensuite le catalogue.
    new.pricing_mode := old.pricing_mode;
    new.billing_unit := old.billing_unit;
    new.catalog_unit_price_snapshot := old.catalog_unit_price_snapshot;
    new.minimum_quantity_snapshot := old.minimum_quantity_snapshot;
    new.billing_increment_snapshot := old.billing_increment_snapshot;
    new.minimum_charge_snapshot := old.minimum_charge_snapshot;
    new.conditions_snapshot := old.conditions_snapshot;
    new.family_name_snapshot := old.family_name_snapshot;
    new.article_name := old.article_name;
    new.service_name := old.service_name;
    -- Les clients qui précèdent la migration n'envoient pas encore unit_price.
    -- Sur une ligne déjà créée, ne pas écraser cet instantané avec le NULL du payload.
    new.unit_price := coalesce(new.unit_price, old.unit_price);
  else
    new.pricing_mode := 'FIXED';
    new.catalog_unit_price_snapshot := null;
    new.minimum_quantity_snapshot := null;
    new.billing_increment_snapshot := null;
    new.minimum_charge_snapshot := null;
    new.conditions_snapshot := null;
    new.family_name_snapshot := null;
  end if;

  if new.unit_price is null or new.unit_price <= 0 then
    raise exception 'Saisissez un prix unitaire supérieur à zéro.' using errcode = '22023';
  end if;
  if new.billing_unit = 'FLAT' and new.quantity <> 1 then
    raise exception 'Une prestation forfaitaire se facture une seule fois.' using errcode = '22023';
  end if;
  if new.pricing_mode = 'QUOTE' and new.price_status <> 'CONFIRMED' then
    raise exception 'Un devis doit être confirmé avant validation de la commande.' using errcode = '22023';
  end if;

  if new.catalog_entry_id is null then
    if new.price_reason is null or char_length(btrim(new.price_reason)) < 10 then
      raise exception 'Une ligne libre exige un motif de 10 caractères minimum.' using errcode = '22023';
    end if;
  elsif new.pricing_mode in ('FIXED', 'FROM') then
    v_base_price := new.catalog_unit_price_snapshot;
    if v_base_price is not null then
      if new.pricing_mode = 'FROM' and new.unit_price < v_base_price then
        raise exception 'Le prix unitaire ne peut pas être inférieur au tarif « à partir de ».'
          using errcode = '22023';
      end if;
      if new.unit_price <> v_base_price
         and (new.price_reason is null or char_length(btrim(new.price_reason)) < 10) then
        raise exception 'Un tarif dérogatoire exige un motif de 10 caractères minimum.'
          using errcode = '22023';
      end if;
    end if;
  end if;

  new.billed_quantity := public.catalog_billable_quantity(
    new.quantity, new.billing_unit, new.minimum_quantity_snapshot, new.billing_increment_snapshot
  );
  v_expected_total := public.catalog_line_total(
    new.billed_quantity, new.unit_price, new.minimum_charge_snapshot
  );
  if new.price is distinct from v_expected_total then
    raise exception 'Le total de ligne est incohérent avec la quantité et le tarif unitaire (% FCFA attendus).',
      v_expected_total using errcode = '22023';
  end if;

  return new;
end;
$$;

-- Historique des changements de prix élargi aux quantités et aux paramètres
-- figés. Les états de paiement de la commande ne sont jamais modifiés ici.
alter table public.order_price_history
  add column if not exists previous_snapshot jsonb not null default '{}'::jsonb;
alter table public.order_price_history
  add column if not exists new_snapshot jsonb not null default '{}'::jsonb;

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
    'conditions', old.conditions_snapshot
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
    'conditions', new.conditions_snapshot
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

commit;
