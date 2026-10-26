-- =============================================================================
-- kilogram_services.sql — tarif personnalisé au kilo et détail des vêtements
-- =============================================================================
-- À exécuter après 023. Transaction jetable, annulée à la fin.
-- =============================================================================

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000d1', 'kilo-owner@test.local')
on conflict (id) do nothing;
insert into public.tenants (id, name) values
  ('44444444-4444-4444-8444-444444444441', 'Pressing Kilo')
on conflict (id) do nothing;
insert into public.tenant_users (user_id, tenant_id, role) values
  ('00000000-0000-4000-8000-0000000000d1', '44444444-4444-4444-8444-444444444441', 'owner')
on conflict (user_id, tenant_id) do nothing;

select set_config(
  'request.jwt.claims',
  jsonb_build_object('sub', '00000000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text,
  true
);
select set_config('request.headers', '{"x-tenant-id":"44444444-4444-4444-8444-444444444441"}', true);
set local role authenticated;

do $$
declare
  v_activity uuid;
  v_service uuid;
  v_sqlstate text;
begin
  insert into public.tenant_activities (tenant_id, name)
  values ('44444444-4444-4444-8444-444444444441', 'Blanchisserie')
  returning id into v_activity;

  insert into public.tenant_services (tenant_id, activity_id, service_name)
  values ('44444444-4444-4444-8444-444444444441', v_activity, 'Repassage à la pièce');
  if not exists (
    select 1 from public.tenant_services
     where service_name = 'Repassage à la pièce'
       and billing_unit = 'PIECE' and unit_price is null
  ) then
    raise exception 'ECHEC 1 : un service historique doit rester à la pièce sans prix par défaut';
  end if;
  raise notice 'OK 1 — les services historiques restent sans tarif prédéfini.';

  insert into public.tenant_services (
    tenant_id, activity_id, service_name, billing_unit, unit_price
  ) values (
    '44444444-4444-4444-8444-444444444441', v_activity,
    'Lavage et repassage au kilo', 'KG', 1500
  ) returning id into v_service;

  if not exists (
    select 1 from public.tenant_services
     where id = v_service and billing_unit = 'KG' and unit_price = 1500
  ) then
    raise exception 'ECHEC 2 : tarif personnalisé de 1 500 FCFA/kg non conservé';
  end if;
  raise notice 'OK 2 — une prestation au kilo conserve son tarif personnalisé.';

  begin
    insert into public.tenant_services (
      tenant_id, activity_id, service_name, billing_unit, unit_price
    ) values (
      '44444444-4444-4444-8444-444444444441', v_activity,
      'Tarif kilo invalide', 'KG', 0
    );
  exception when check_violation then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '23514' then
    raise exception 'ECHEC 3 : la base a accepté un tarif au kilo nul';
  end if;
  raise notice 'OK 3 — la base refuse un tarif au kilo nul.';

  if not public.valid_order_garment_details('[{"type":"CHEMISE","quantity":3},{"type":"PANTALON","quantity":2}]'::jsonb) then
    raise exception 'ECHEC 4 : une composition de vêtements valide a été rejetée';
  end if;
  if public.valid_order_garment_details('[{"type":"INCONNU","quantity":2}]'::jsonb)
     or public.valid_order_garment_details('[{"type":"JEAN","quantity":0}]'::jsonb)
     or public.valid_order_garment_details('{"type":"JEAN","quantity":1}'::jsonb) then
    raise exception 'ECHEC 5 : une composition de vêtements invalide a été acceptée';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.order_items'::regclass
       and conname = 'order_items_garment_details_check'
  ) then
    raise exception 'ECHEC 6 : la validation du détail des vêtements manque sur order_items';
  end if;
  raise notice 'OK 4 — la composition JSON est validée et protégée par une contrainte SQL.';

  insert into public.orders (
    id, tenant_id, customer_name, customer_phone, qr_code, total_amount
  ) values (
    '44444444-4444-4444-8444-444444444442',
    '44444444-4444-4444-8444-444444444441',
    'Client test', '0700000001', 'CMD-KILO-SNAPSHOT', 1500
  );
  insert into public.order_items (
    id, order_id, tenant_id, label, price, quantity, billed_quantity,
    billing_unit, unit_price, pricing_mode, price_status, service_name,
    tenant_service_id, activity_name_snapshot
  ) values (
    '44444444-4444-4444-8444-444444444443',
    '44444444-4444-4444-8444-444444444442',
    '44444444-4444-4444-8444-444444444441',
    'Lavage et repassage au kilo', 1500, 1, 1,
    'KG', 1500, 'FIXED', 'CONFIRMED', 'Lavage et repassage au kilo',
    v_service, 'Blanchisserie'
  );
  delete from public.tenant_services where id = v_service;
  if not exists (
    select 1 from public.order_items
     where id = '44444444-4444-4444-8444-444444444443'
       and tenant_service_id is null
       and service_name = 'Lavage et repassage au kilo'
       and activity_name_snapshot = 'Blanchisserie'
  ) then
    raise exception 'ECHEC 7 : la suppression de la prestation a détruit l’instantané de commande';
  end if;
  raise notice 'OK 5 — la commande conserve service et activité après suppression de la configuration.';
end $$;

rollback;
