-- Fixture locale exécutée après la migration 013 et avant 014.
-- Représente une ligne déjà facturée, avec seulement les colonnes historiques.
insert into public.orders (
  id, tenant_id, customer_name, customer_phone, qr_code, total_amount
) values (
  '33333333-3333-4333-8333-333333333340',
  '33333333-3333-4333-8333-333333333333',
  'Client historique', '+2250700000033',
  'order-item-legacy-333333333340', 1500
) on conflict (id) do nothing;

insert into public.order_items (
  id, order_id, tenant_id, label, price, catalog_entry_id, article_name, service_name
) values (
  '33333333-3333-4333-8333-333333333341',
  '33333333-3333-4333-8333-333333333340',
  '33333333-3333-4333-8333-333333333333',
  'Chemise — Lavage', 1500,
  '33333333-3333-4333-8333-333333333301', 'Chemise', 'Lavage'
) on conflict (id) do nothing;
