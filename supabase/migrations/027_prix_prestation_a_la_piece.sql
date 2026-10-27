-- =============================================================================
-- 027_prix_prestation_a_la_piece.sql
-- Autorise un tarif unitaire sur une prestation facturée à la pièce.
-- =============================================================================
-- Contexte métier : la blanchisserie d'un pressing ne se facture pas
-- uniquement au kilo. Chez beaucoup de praticiens, elle se compte **au nombre
-- de vêtements**, chaque article portant un prix défini une fois pour toutes
-- (drap 500 FCFA, serviette 300 FCFA…).
--
-- Jusqu'ici, `tenant_services_unit_price_check` interdisait tout `unit_price`
-- sur une prestation `PIECE` : le prix d'un article ne pouvait donc pas être
-- configuré, et le comptoir devait le ressaisir à chaque commande.
--
-- Cette migration **relâche** une contrainte. Elle est strictement additive :
--   * aucune table créée ni supprimée ;
--   * aucune colonne modifiée ;
--   * aucune donnée lue, déplacée ou supprimée ;
--   * la nouvelle contrainte est plus faible que l'ancienne : toute ligne
--     existante la satisfait déjà, la migration ne peut pas échouer sur des
--     données en place.
--
-- Le tarif reste facultatif (NULL = prix saisi au comptoir), y compris au kilo.
-- =============================================================================

begin;

alter table public.tenant_services
  drop constraint if exists tenant_services_unit_price_check;

alter table public.tenant_services
  add constraint tenant_services_unit_price_check
  check (unit_price is null or unit_price between 1 and 10000000);

comment on column public.tenant_services.billing_unit is
  'Unité appliquée à la prestation : PIECE (nombre de vêtements) ou KG (poids total).';

comment on column public.tenant_services.unit_price is
  'Tarif unitaire facultatif en FCFA, par pièce ou par kilo selon billing_unit. NULL : le prix est saisi au comptoir.';

commit;
