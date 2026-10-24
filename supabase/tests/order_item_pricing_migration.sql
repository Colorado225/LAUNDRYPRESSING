-- Vérifie la reprise d'une ligne de facture déjà présente avant la migration 014.
do $$
begin
  if not exists (
    select 1 from public.order_items
     where id = '33333333-3333-4333-8333-333333333341'
       and price = 1500 and quantity = 1 and billed_quantity = 1
       and billing_unit = 'PIECE' and unit_price = 1500
       and pricing_mode = 'FIXED' and price_status = 'CONFIRMED'
       and family_name_snapshot is null
  ) then
    raise exception 'La reprise a altéré le montant ou l''unité d''une ancienne ligne.';
  end if;
  raise notice 'OK reprise historique des lignes de commande sans changement de total';
end;
$$;
