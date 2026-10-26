-- =============================================================================
-- 023_kilogram_services_and_garment_details.sql
-- Tarif au kilo configurable par pressing et composition des lots pesés.
-- =============================================================================
-- Les anciens services restent facturés à la pièce sans tarif prérempli.
-- Un tarif au kilo est facultatif : le réceptionniste pourra le saisir à la
-- commande lorsqu'il n'est pas défini pour le service.
-- =============================================================================

begin;

alter table public.tenant_services
  add column billing_unit text not null default 'PIECE',
  add column unit_price integer;

alter table public.tenant_services
  add constraint tenant_services_billing_unit_check
    check (billing_unit in ('PIECE', 'KG')),
  add constraint tenant_services_unit_price_check
    check (
      (billing_unit = 'KG' and (unit_price is null or unit_price between 1 and 10000000))
      or (billing_unit = 'PIECE' and unit_price is null)
    );

alter table public.order_items
  add column garment_details jsonb not null default '[]'::jsonb;

create or replace function public.valid_order_garment_details(p_details jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when jsonb_typeof(p_details) <> 'array' then false
    else not exists (
      select 1
        from jsonb_array_elements(p_details) as garment(value)
       where jsonb_typeof(garment.value) <> 'object'
          or coalesce(garment.value ->> 'type', '') not in (
            'CHEMISE', 'T_SHIRT', 'PANTALON', 'JEAN', 'ROBE', 'JUPE',
            'VESTE', 'COSTUME', 'BOUBOU', 'DRAP', 'SERVIETTE', 'AUTRE'
          )
          or coalesce(garment.value ->> 'quantity', '') !~ '^([1-9][0-9]{0,2}|1000)$'
    )
  end;
$$;

alter table public.order_items
  add constraint order_items_garment_details_check
  check (public.valid_order_garment_details(garment_details));

comment on column public.tenant_services.billing_unit is
  'Unité appliquée à la prestation : pièce ou kilogramme.';
comment on column public.tenant_services.unit_price is
  'Tarif optionnel propre au pressing, en FCFA par unité (actuellement au kilo).';
comment on column public.order_items.garment_details is
  'Types et quantités de vêtements détaillés pour un lot pesé au kilo.';

commit;
