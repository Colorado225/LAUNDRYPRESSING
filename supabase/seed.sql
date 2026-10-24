-- =============================================================================
-- seed.sql — Jeu de données de démonstration (2 pressings)
-- =============================================================================
-- Objectif : pouvoir tester l'isolation multi-tenant dès la Phase 2
-- (deux tenants, deux utilisateurs, des commandes distinctes).
--
-- ⚠ À exécuter UNIQUEMENT en local ou sur un projet de staging.
--
-- Prérequis : créer d'abord les utilisateurs dans Supabase Auth
-- (Dashboard > Authentication > Users, ou via l'admin API), puis remplacer
-- les UUID ci-dessous par les leurs.
-- =============================================================================

-- Reprise propre du jeu de démonstration
delete from public.order_status_history
  where tenant_id in (select id from public.tenants where name in ('Pressing Cocody', 'Pressing Yopougon'));
delete from public.order_items
  where tenant_id in (select id from public.tenants where name in ('Pressing Cocody', 'Pressing Yopougon'));
delete from public.orders
  where tenant_id in (select id from public.tenants where name in ('Pressing Cocody', 'Pressing Yopougon'));
delete from public.tenant_users
  where tenant_id in (select id from public.tenants where name in ('Pressing Cocody', 'Pressing Yopougon'));
delete from public.tenants where name in ('Pressing Cocody', 'Pressing Yopougon');

-- 1. Les deux pressings
insert into public.tenants (id, name, phone) values
  ('11111111-1111-4111-8111-111111111111', 'Pressing Cocody',  '+225 07 00 00 00 01'),
  ('22222222-2222-4222-8222-222222222222', 'Pressing Yopougon', '+225 07 00 00 00 02');

-- 2. Rattachement des utilisateurs (remplacer les UUID par ceux de Supabase Auth)
--    Exemple : le propriétaire du pressing de Cocody.
-- insert into public.tenant_users (user_id, tenant_id, role) values
--   ('00000000-0000-0000-0000-000000000001', '11111111-1111-4111-8111-111111111111', 'owner'),
--   ('00000000-0000-0000-0000-000000000002', '22222222-2222-4222-8222-222222222222', 'owner');

-- 3. Commandes de démonstration
insert into public.orders
  (id, tenant_id, customer_name, customer_phone, status, qr_code, total_amount, payment_status, payment_method)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'Aya Koné', '+2250700000001', 'washing',
   '11111111-1111-4111-8111-111111111111-aaaaaaaa-0000-4000-8000-000000000001-1750000000000',
   8500, 'pending', null),
  ('aaaaaaaa-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'Ibrahim Traoré', '+2250700000002', 'ready',
   '11111111-1111-4111-8111-111111111111-aaaaaaaa-0000-4000-8000-000000000002-1750000000001',
   12000, 'paid', 'wave'),
  ('bbbbbbbb-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
   'Fatou Diallo', '+2250700000003', 'received',
   '22222222-2222-4222-8222-222222222222-bbbbbbbb-0000-4000-8000-000000000001-1750000000002',
   5000, 'pending', null);

-- 4. Lignes de commande
insert into public.order_items (
  order_id, tenant_id, label, fabric_type, special_instructions, price, price_reason
)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'Costume 3 pièces', 'Laine froide', 'Empèsage fort', 5000, 'Prestation de démonstration.'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'Chemise', 'Coton', 'Broderie fragile', 3500, 'Prestation de démonstration.'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'Boubou brodé', 'Bazin riche', 'Broderie fragile — nettoyage à sec uniquement', 12000, 'Prestation de démonstration.'),
  ('bbbbbbbb-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
   'Pagne Wax', 'Wax', null, 5000, 'Prestation de démonstration.');
