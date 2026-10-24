-- =============================================================================
-- 013_catalogue_model.sql — catalogue multi-tenant structuré et tarification
-- =============================================================================
-- La migration conserve `catalog_entries` comme grille tarifaire existante :
-- aucune donnée n'est supprimée et les libellés restent disponibles pour les
-- anciennes versions de l'application. Les familles, articles et prestations
-- deviennent des référentiels propres à chaque pressing.
--
-- Les tarifs déjà présents sont conservés, mais signalés `requires_review` :
-- le dépôt ne permet pas de distinguer sûrement une valeur de démonstration
-- d'une valeur saisie par le propriétaire. Ils ne seront pas proposés aux
-- nouvelles commandes avant confirmation explicite du propriétaire.
-- =============================================================================

begin;

-- Normalisation commune aux noms : casse ignorée, espaces de bord retirés,
-- suites d'espaces ramenées à un seul espace.
create or replace function public.catalog_name_key(p_name text)
returns text
language sql
immutable
parallel safe
as $$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g'));
$$;

-- La migration ne fusionne jamais silencieusement deux tarifs historiques.
-- Si deux libellés ne diffèrent que par la casse ou les espaces, elle s'arrête
-- avant toute modification afin que le propriétaire puisse trancher.
do $$
declare
  v_doublon record;
begin
  select tenant_id,
         public.catalog_name_key(article) as article_key,
         public.catalog_name_key(service) as service_key,
         count(*) as nombre
    into v_doublon
    from public.catalog_entries
   group by tenant_id,
            public.catalog_name_key(article),
            public.catalog_name_key(service)
  having count(*) > 1
   limit 1;

  if found then
    raise exception
      'Catalogue non migré : % tarifs dupliqués (article « % », prestation « % ») pour le pressing %. Corrigez ces doublons avant de relancer la migration.',
      v_doublon.nombre, v_doublon.article_key, v_doublon.service_key, v_doublon.tenant_id
      using errcode = '23505';
  end if;
end;
$$;

-- Familles configurables par pressing.
create table if not exists public.catalog_families (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 2 and 80),
  description text,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint catalog_families_id_tenant_key unique (id, tenant_id)
);

create unique index if not exists catalog_families_name_key
  on public.catalog_families (tenant_id, public.catalog_name_key(name));
create index if not exists catalog_families_active_sort_idx
  on public.catalog_families (tenant_id, is_active, sort_order);

-- Articles personnalisés. L'unité par défaut ne remplace jamais l'unité du
-- tarif appliqué : un même article peut avoir plusieurs modes de facturation.
create table if not exists public.catalog_articles (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  family_id        uuid not null,
  name             text not null check (char_length(btrim(name)) between 2 and 60),
  description      text,
  care_instructions text,
  default_unit     text not null default 'PIECE'
                     check (default_unit in ('PIECE', 'PAIR', 'SET', 'KG', 'M2', 'METER', 'PACKAGE', 'FLAT')),
  is_active        boolean not null default true,
  sort_order       integer not null default 0,
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint catalog_articles_id_tenant_key unique (id, tenant_id),
  constraint catalog_articles_family_fk
    foreign key (family_id, tenant_id)
    references public.catalog_families (id, tenant_id)
    on delete no action deferrable initially deferred
);

create unique index if not exists catalog_articles_name_key
  on public.catalog_articles (tenant_id, public.catalog_name_key(name));
create index if not exists catalog_articles_family_active_sort_idx
  on public.catalog_articles (tenant_id, family_id, is_active, sort_order);

-- Prestations indépendantes des articles : traitement, option ou logistique.
-- `application_scope='order'` représente une prestation calculée au niveau de
-- la commande (ex. collecte), sans faux article métier.
create table if not exists public.catalog_services (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) on delete cascade,
  name              text not null check (char_length(btrim(name)) between 2 and 60),
  service_type      text not null default 'treatment'
                      check (service_type in ('treatment', 'option', 'logistics', 'other')),
  application_scope text not null default 'article'
                      check (application_scope in ('article', 'order')),
  description       text,
  is_active         boolean not null default true,
  sort_order        integer not null default 0,
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint catalog_services_id_tenant_key unique (id, tenant_id)
);

create unique index if not exists catalog_services_name_key
  on public.catalog_services (tenant_id, public.catalog_name_key(name));
create index if not exists catalog_services_active_sort_idx
  on public.catalog_services (tenant_id, is_active, sort_order);

-- Références structurées et propriétés tarifaires. `article` / `service` sont
-- conservés comme colonnes de compatibilité et sont synchronisés par trigger.
alter table public.catalog_entries
  add column if not exists article_id uuid;
alter table public.catalog_entries
  add column if not exists service_id uuid;
alter table public.catalog_entries
  add column if not exists pricing_mode text not null default 'FIXED';
alter table public.catalog_entries
  add column if not exists billing_unit text not null default 'PIECE';
alter table public.catalog_entries
  add column if not exists minimum_quantity numeric(12, 3);
alter table public.catalog_entries
  add column if not exists billing_increment numeric(12, 3);
alter table public.catalog_entries
  add column if not exists minimum_charge integer;
alter table public.catalog_entries
  add column if not exists conditions text;
alter table public.catalog_entries
  add column if not exists requires_review boolean not null default false;

-- Les FK sont posées avant la reprise des lignes ; elles sont différées pour
-- permettre la suppression ultérieure d'un tenant complet, sans autoriser la
-- suppression isolée d'une référence utilisée.
alter table public.catalog_entries
  drop constraint if exists catalog_entries_article_tenant_fk,
  drop constraint if exists catalog_entries_service_tenant_fk;
alter table public.catalog_entries
  add constraint catalog_entries_article_tenant_fk
  foreign key (article_id, tenant_id)
  references public.catalog_articles (id, tenant_id)
  on delete no action deferrable initially deferred;
alter table public.catalog_entries
  add constraint catalog_entries_service_tenant_fk
  foreign key (service_id, tenant_id)
  references public.catalog_services (id, tenant_id)
  on delete no action deferrable initially deferred;

-- Chaque pressing qui possède un ancien catalogue reçoit une famille neutre,
-- puis les textes existants sont normalisés en référentiels indépendants.
insert into public.catalog_families (tenant_id, name, description)
select distinct ce.tenant_id, 'À classer', 'Famille créée lors de la reprise du catalogue existant.'
  from public.catalog_entries ce
 where not exists (
   select 1 from public.catalog_families cf
    where cf.tenant_id = ce.tenant_id
      and public.catalog_name_key(cf.name) = public.catalog_name_key('À classer')
 );

with anciens_articles as (
  select distinct on (ce.tenant_id, public.catalog_name_key(ce.article))
         ce.tenant_id,
         btrim(ce.article) as name,
         ce.created_at,
         ce.id
    from public.catalog_entries ce
   order by ce.tenant_id, public.catalog_name_key(ce.article), ce.created_at, ce.id
)
insert into public.catalog_articles (tenant_id, family_id, name, default_unit)
select a.tenant_id, f.id, a.name, 'PIECE'
  from anciens_articles a
  join public.catalog_families f
    on f.tenant_id = a.tenant_id
   and public.catalog_name_key(f.name) = public.catalog_name_key('À classer')
 where not exists (
   select 1 from public.catalog_articles ca
    where ca.tenant_id = a.tenant_id
      and public.catalog_name_key(ca.name) = public.catalog_name_key(a.name)
 );

with anciennes_prestations as (
  select distinct on (ce.tenant_id, public.catalog_name_key(ce.service))
         ce.tenant_id,
         btrim(ce.service) as name,
         ce.created_at,
         ce.id
    from public.catalog_entries ce
   order by ce.tenant_id, public.catalog_name_key(ce.service), ce.created_at, ce.id
)
insert into public.catalog_services (tenant_id, name, service_type, application_scope)
select p.tenant_id, p.name, 'treatment', 'article'
  from anciennes_prestations p
 where not exists (
   select 1 from public.catalog_services cs
    where cs.tenant_id = p.tenant_id
      and public.catalog_name_key(cs.name) = public.catalog_name_key(p.name)
 );

update public.catalog_entries ce
   set article = ca.name,
       service = cs.name,
       article_id = ca.id,
       service_id = cs.id,
       pricing_mode = case when ce.price = 0 then 'UNCONFIGURED' else 'FIXED' end,
       billing_unit = 'PIECE',
       requires_review = true
  from public.catalog_articles ca,
       public.catalog_services cs
 where ca.tenant_id = ce.tenant_id
   and public.catalog_name_key(ca.name) = public.catalog_name_key(ce.article)
   and cs.tenant_id = ce.tenant_id
   and public.catalog_name_key(cs.name) = public.catalog_name_key(ce.service)
   and (ce.article_id is null or ce.service_id is null);

-- Vide les vérifications différées de FK avant de poursuivre le DDL de la
-- migration ; en fin de transaction, les contraintes retrouvent leur mode
-- initialement différé.
set constraints all immediate;

alter table public.catalog_entries
  alter column service_id set not null;

alter table public.catalog_entries
  drop constraint if exists catalog_entries_pricing_mode_check,
  drop constraint if exists catalog_entries_price_mode_amount_check,
  drop constraint if exists catalog_entries_billing_unit_check,
  drop constraint if exists catalog_entries_minimum_quantity_check,
  drop constraint if exists catalog_entries_billing_increment_check,
  drop constraint if exists catalog_entries_minimum_charge_check;

alter table public.catalog_entries
  add constraint catalog_entries_pricing_mode_check
  check (pricing_mode in ('FIXED', 'FROM', 'QUOTE', 'UNCONFIGURED'));

alter table public.catalog_entries
  add constraint catalog_entries_price_mode_amount_check
  check (
    (pricing_mode in ('FIXED', 'FROM') and price > 0)
    or (pricing_mode in ('QUOTE', 'UNCONFIGURED') and price = 0)
  );

alter table public.catalog_entries
  add constraint catalog_entries_billing_unit_check
  check (billing_unit in ('PIECE', 'PAIR', 'SET', 'KG', 'M2', 'METER', 'PACKAGE', 'FLAT'));

alter table public.catalog_entries
  add constraint catalog_entries_minimum_quantity_check
  check (minimum_quantity is null or minimum_quantity > 0);

alter table public.catalog_entries
  add constraint catalog_entries_billing_increment_check
  check (billing_increment is null or billing_increment > 0);

alter table public.catalog_entries
  add constraint catalog_entries_minimum_charge_check
  check (minimum_charge is null or minimum_charge >= 0);

create unique index if not exists catalog_entries_article_service_key
  on public.catalog_entries (tenant_id, article_id, service_id)
  where article_id is not null;

create unique index if not exists catalog_entries_order_service_key
  on public.catalog_entries (tenant_id, service_id)
  where article_id is null;

-- Mise à jour automatique des horodatages et journalisation (migration 009).
do $$
declare
  v_table text;
begin
  foreach v_table in array array['catalog_families', 'catalog_articles', 'catalog_services'] loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', v_table, v_table);
    execute format(
      'create trigger trg_%I_updated_at before update on public.%I for each row execute function public.update_updated_at_column()',
      v_table, v_table
    );
    execute format('drop trigger if exists trg_audit_%I on public.%I', v_table, v_table);
    execute format(
      'create trigger trg_audit_%I after insert or update or delete on public.%I for each row execute function public.audit_row_change()',
      v_table, v_table
    );
  end loop;
end;
$$;

-- RLS et droits : consultation par les membres du tenant ; écritures par le
-- propriétaire uniquement. Les contraintes composites protègent aussi les FK.
drop policy if exists catalog_families_select_tenant on public.catalog_families;
drop policy if exists catalog_families_write_owner on public.catalog_families;
drop policy if exists catalog_articles_select_tenant on public.catalog_articles;
drop policy if exists catalog_articles_write_owner on public.catalog_articles;
drop policy if exists catalog_services_select_tenant on public.catalog_services;
drop policy if exists catalog_services_write_owner on public.catalog_services;

create policy catalog_families_select_tenant on public.catalog_families
  for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy catalog_families_write_owner on public.catalog_families
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner');

create policy catalog_articles_select_tenant on public.catalog_articles
  for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy catalog_articles_write_owner on public.catalog_articles
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner');

create policy catalog_services_select_tenant on public.catalog_services
  for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy catalog_services_write_owner on public.catalog_services
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner')
  with check (tenant_id = public.current_tenant_id() and public.current_tenant_role() = 'owner');

alter table public.catalog_families enable row level security;
alter table public.catalog_articles enable row level security;
alter table public.catalog_services enable row level security;

revoke all on public.catalog_families, public.catalog_articles, public.catalog_services from public, anon;
grant select, insert, update, delete on public.catalog_families to authenticated;
grant select, insert, update, delete on public.catalog_articles to authenticated;
grant select, insert, update, delete on public.catalog_services to authenticated;
grant all on public.catalog_families, public.catalog_articles, public.catalog_services to service_role;

-- Guard compatibility writes from the current UI: text-only inserts are
-- resolved to tenant-owned records. Newer clients can send the normalized IDs.
create or replace function public.prepare_catalog_entry()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_article_name text;
  v_service_name text;
  v_scope text;
  v_family_id uuid;
begin
  if auth.uid() is not null and (
    new.tenant_id is distinct from public.current_tenant_id()
    or public.current_tenant_role() <> 'owner'
  ) then
    raise exception 'Seul le propriétaire du pressing courant peut gérer le catalogue.'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    -- Compatibilité avec l'ancien formulaire, qui modifie les libellés sans ID.
    if new.article is distinct from old.article
       and new.article_id is not distinct from old.article_id then
      new.article_id := null;
    end if;
    if new.service is distinct from old.service
       and new.service_id is not distinct from old.service_id then
      new.service_id := null;
    end if;
  end if;

  if new.service_id is null then
    select id, application_scope
      into new.service_id, v_scope
      from public.catalog_services
     where tenant_id = new.tenant_id
       and public.catalog_name_key(name) = public.catalog_name_key(new.service);

    if new.service_id is null then
      insert into public.catalog_services (tenant_id, name, service_type, application_scope)
      values (new.tenant_id, btrim(new.service), 'treatment', 'article')
      on conflict (tenant_id, public.catalog_name_key(name)) do nothing;

      select id, application_scope
        into new.service_id, v_scope
        from public.catalog_services
       where tenant_id = new.tenant_id
         and public.catalog_name_key(name) = public.catalog_name_key(new.service);
    end if;
  else
    select name, application_scope
      into v_service_name, v_scope
      from public.catalog_services
     where id = new.service_id and tenant_id = new.tenant_id;
    if not found then
      raise exception 'Prestation absente du catalogue de ce pressing.' using errcode = '23503';
    end if;
    new.service := v_service_name;
  end if;

  if v_scope = 'article' then
    if new.article_id is null then
      select id into new.article_id
        from public.catalog_articles
       where tenant_id = new.tenant_id
         and public.catalog_name_key(name) = public.catalog_name_key(new.article);

      if new.article_id is null then
        select id into v_family_id
          from public.catalog_families
         where tenant_id = new.tenant_id
           and public.catalog_name_key(name) = public.catalog_name_key('À classer');

        if v_family_id is null then
          insert into public.catalog_families (tenant_id, name, description)
          values (new.tenant_id, 'À classer', 'Famille créée automatiquement pour une prestation ajoutée depuis un ancien client.')
          on conflict (tenant_id, public.catalog_name_key(name)) do nothing;

          select id into v_family_id
            from public.catalog_families
           where tenant_id = new.tenant_id
             and public.catalog_name_key(name) = public.catalog_name_key('À classer');
        end if;

        insert into public.catalog_articles (tenant_id, family_id, name, default_unit)
        values (new.tenant_id, v_family_id, btrim(new.article), 'PIECE')
        on conflict (tenant_id, public.catalog_name_key(name)) do nothing;

        select id into new.article_id
          from public.catalog_articles
         where tenant_id = new.tenant_id
           and public.catalog_name_key(name) = public.catalog_name_key(new.article);
      end if;
    else
      select name into v_article_name
        from public.catalog_articles
       where id = new.article_id and tenant_id = new.tenant_id;
      if not found then
        raise exception 'Article absent du catalogue de ce pressing.' using errcode = '23503';
      end if;
      new.article := v_article_name;
    end if;
  else
    if new.article_id is not null then
      raise exception 'Une prestation de commande ne peut pas être rattachée à un article.'
        using errcode = '22023';
    end if;
    new.article := coalesce(nullif(btrim(new.article), ''), 'Service global');
  end if;

  if new.pricing_mode = 'FIXED' and new.price = 0 then
    new.pricing_mode := 'UNCONFIGURED';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_catalog_entries_prepare on public.catalog_entries;
create trigger trg_catalog_entries_prepare
  before insert or update on public.catalog_entries
  for each row execute function public.prepare_catalog_entry();

-- Un renommage dans le référentiel recopie le nouveau libellé dans les tarifs,
-- sans toucher aux instantanés historiques des commandes.
create or replace function public.sync_catalog_reference_name()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.name is distinct from old.name then
    if tg_table_name = 'catalog_articles' then
      update public.catalog_entries
         set article = new.name
       where tenant_id = new.tenant_id and article_id = new.id;
    elsif tg_table_name = 'catalog_services' then
      update public.catalog_entries
         set service = new.name
       where tenant_id = new.tenant_id and service_id = new.id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_catalog_articles_sync_name on public.catalog_articles;
drop trigger if exists trg_catalog_services_sync_name on public.catalog_services;
create trigger trg_catalog_articles_sync_name
  after update of name on public.catalog_articles
  for each row execute function public.sync_catalog_reference_name();
create trigger trg_catalog_services_sync_name
  after update of name on public.catalog_services
  for each row execute function public.sync_catalog_reference_name();

-- Empêche de changer le type d'application si des tarifs existants deviendraient
-- incohérents (article requis ou prestation globale devenue liée à un article).
create or replace function public.guard_catalog_service_scope()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.application_scope is distinct from old.application_scope then
    if new.application_scope = 'order' and exists (
      select 1 from public.catalog_entries
       where tenant_id = new.tenant_id and service_id = new.id and article_id is not null
    ) then
      raise exception 'Détachez les articles avant de transformer cette prestation en service de commande.'
        using errcode = '22023';
    elsif new.application_scope = 'article' and exists (
      select 1 from public.catalog_entries
       where tenant_id = new.tenant_id and service_id = new.id and article_id is null
    ) then
      raise exception 'Rattachez un article avant de transformer ce service de commande en prestation par article.'
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_catalog_services_guard_scope on public.catalog_services;
create trigger trg_catalog_services_guard_scope
  before update of application_scope on public.catalog_services
  for each row execute function public.guard_catalog_service_scope();

-- Garde serveur conservé pour les clients qui ne sont pas encore conscients
-- des nouveaux champs : ils ne peuvent pas vendre un tarif non vérifié, au
-- devis sans montant confirmé, non configuré ou exprimé dans une unité que le
-- formulaire courant ne sait pas encore calculer.
create or replace function public.guard_order_item_price()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  role_courant text := public.current_tenant_role();
  prix_catalogue integer;
  tarif_a_verifier boolean;
  mode_tarif text;
  unite_tarif text;
begin
  if auth.uid() is null then
    return new;  -- tâche serveur de confiance
  end if;

  if role_courant not in ('owner', 'receptionist') then
    raise exception 'Votre rôle ne permet pas de modifier les prestations facturées.'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
     and new.price is not distinct from old.price
     and new.catalog_entry_id is not distinct from old.catalog_entry_id then
    return new;
  end if;

  if new.catalog_entry_id is not null then
    select price, requires_review, pricing_mode, billing_unit
      into prix_catalogue, tarif_a_verifier, mode_tarif, unite_tarif
      from public.catalog_entries
     where id = new.catalog_entry_id and tenant_id = new.tenant_id;

    if found then
      if tarif_a_verifier then
        raise exception 'Ce tarif doit être vérifié par le propriétaire avant utilisation.'
          using errcode = '22023';
      end if;
      if mode_tarif = 'UNCONFIGURED' then
        raise exception 'Ce tarif est à configurer avant de créer une commande.'
          using errcode = '22023';
      end if;
      if mode_tarif = 'QUOTE' and new.price <= 0 then
        raise exception 'Un devis doit être confirmé avec un montant avant validation de la commande.'
          using errcode = '22023';
      end if;
      if unite_tarif <> 'PIECE' then
        raise exception 'Cette unité de facturation n''est pas encore prise en charge par la saisie des commandes.'
          using errcode = '22023';
      end if;
      if prix_catalogue is not null and new.price <> prix_catalogue then
        if new.price_reason is null or char_length(btrim(new.price_reason)) < 10 then
          raise exception 'Un tarif dérogatoire exige un motif de 10 caractères minimum.'
            using errcode = '22023';
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on table public.catalog_families is
  'Familles de catalogue indépendantes par pressing (tenant).';
comment on table public.catalog_articles is
  'Articles personnalisés d''un pressing, rattachés à une famille du même tenant.';
comment on table public.catalog_services is
  'Prestations configurables par pressing : traitement, option ou logistique.';
comment on column public.catalog_entries.requires_review is
  'Tarif hérité ou indicatif à vérifier par le propriétaire avant une nouvelle commande.';
comment on column public.catalog_entries.price is
  'Tarif unitaire en FCFA pour FIXED/FROM ; 0 est un marqueur non facturable pour QUOTE/UNCONFIGURED.';

commit;
