-- Fixture locale exécutée après les migrations 001–012 et avant 013.
-- Elle représente un pressing existant avec tarifs texte uniquement.
insert into public.tenants (id, name, phone)
values ('33333333-3333-4333-8333-333333333333', 'Pressing catalogue historique', '+2250700000033')
on conflict (id) do nothing;

insert into public.catalog_entries (id, tenant_id, article, service, price, is_active, sort_order)
values
  ('33333333-3333-4333-8333-333333333301', '33333333-3333-4333-8333-333333333333', 'Chemise', 'Lavage', 1500, true, 1),
  ('33333333-3333-4333-8333-333333333302', '33333333-3333-4333-8333-333333333333', '  CHEMISE  ', 'Repassage', 800, false, 2),
  ('33333333-3333-4333-8333-333333333303', '33333333-3333-4333-8333-333333333333', 'Pantalon', 'Lavage', 0, true, 3)
on conflict (id) do nothing;
