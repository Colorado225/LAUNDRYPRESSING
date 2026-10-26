# Catalogue — Lot 2 : kilo par tranches, modèles, forfaits

Migrations **028** et **029**, écran `/catalogue` (onglets « Au kilo »,
« Modèles », « Forfaits »). Suite logique du Lot 1
(`docs/CATALOGUE-LOT1.md`), mêmes partis pris : le serveur reste autorité,
aucun prix pré-rempli, l'historique n'est jamais recalculé.

## 1. Tarification au kilo par tranches (028)

Tables : `pricing_rules` (une règle **active par prestation** au kilo) et
`pricing_rule_tiers` (intervalles `[min_kg, max_kg[` au niveau FCFA/kg).

Deux modes, calculés **par le serveur** (`compute_weight_price`) — jamais
par le client seul :

| Mode | Exemple (12 kg) | Résultat |
|---|---|---|
| `flat_rate` (palier) | tranche ≥ 10 kg à 600 FCFA/kg → 12 × 600 | **7 200 FCFA** |
| `progressive_tiers` | 5×700 + 5×600 + 2×500 | **7 500 FCFA** |

Le poids facturé (`billed_quantity`) dérive du poids déposé selon
l'arrondi de la règle (`ceil` / `nearest` / `exact`, pas `step_kg`) puis du
minimum facturable ; les exemples de la spec sont joués des deux côtés
(SQL `catalogue_lot2.sql`, Vitest `prixKilo.test.ts` — miroir client
`src/lib/prixKilo.ts` utilisé hors-ligne et par le simulateur).

Protections serveur :

- **chevauchement de tranches refusé** (trigger, `23514`) ;
- tariKilo tarif/kg strictement positif (un 0 FCFA = erreur, jamais gratuit par défaut) ;
- **garde kg** étendue : sur une prestation à règle active, `total_price`
  doit égaler le devis serveur (ou un motif de dérogation ≥ 10 caractères —
  aucun total arbitraire) ; sans règle active, comportement historique de
  la migration 023 ;
- la pesée modifiée hors dépôt (fiche commande) **recalcule le devis** dans
  `updateOrderItemMeasurementLocal`, fige `conditions_snapshot`
  (« 12 kg facturés — 5 kg × 700 + 5 kg × 600 + 2 kg × 500 FCFA/kg ») ; le
  garde serveur (désormais déclenché aussi en UPDATE) revérifie.

Hors-ligne : les règles sont lues depuis le cache Dexie (v17,
`catalogPricingRules`) ; leur **édition exige le réseau**, comme le reste
de la configuration.

Le RPC `quote_weight_price(prestation, poids)` expose le même calcul au
simulateur de l'écran `/catalogue` et pourra servir à l'espace client.

## 2. Modèles de blanchisserie (029)

`laundry_profiles` / `laundry_profile_items` : une sélection d'articles
présentée au comptoir — **sans prix** (un modèle arrange, il ne tarife
pas). Quatre gabarits système : Pressing classique, Blanchisserie au kilo,
Offre premium, Linge professionnel. `duplicate_laundry_profile(id)` en
crée une copie indépendante par pressing (idempotent par code), les
articles du modèle sont raccordés aux copies du pressing quand elles
existent. Un modèle archivé n'apparaît plus au comptoir.

## 3. Forfaits commerciaux (029)

`commercial_packages` (prix global en FCFA, devise du pressing) +
`commercial_package_items` (composition indicative — articles/pièces incluses).
L'écran permet de créer/archiver les forfaits ; **la vente d'un forfait au
comptoir** (ligne de commande portant le prix global) est prévue au
Lot 3, en réutilisant les instantanés existants.

## 4. Alignements comptoir

- `OrderItemsEditor` (ajout de pièce sur une commande existante) propose
  les **sélecteurs article × prestation du catalogue** et propose le tarif
  de grille modifiable avec motif — même garde serveur que le dépôt ; le
  mode libre historique reste pour les pressings sans catalogue actif.
- Le dépôt (`OrderForm`) verrouille le prix unitaire des lignes au kilo
  avec règle active : le montant vient du devis, affiché à l'opérateur.

## 5. Déploiement

La base `Pressing_Pro` reçoit 028 puis 029 **avant** le déploiement du
front (même procédure que le Lot 1) ; le front devient compatible dès la
PR fusionnée. Clients < v17 : la migration du cache est automatique
(Dexie monte en version sans réécrire les commandes).
