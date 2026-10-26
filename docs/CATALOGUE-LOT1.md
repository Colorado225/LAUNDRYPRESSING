# Catalogue — Lot 1 (articles, catégories, matrice de prix)

**Date :** 26 octobre 2026 · **Migration :** `027_catalogue_lot1.sql` (additive)
**Source :** cahier des charges « Catalogue, Prestations, Types de vêtements et
Tarification » v1.0, adapté à l'architecture Supabase de ce dépôt.

## Décisions d'adaptation (validées avant implémentation)

| Sujet du cahier des charges | Réalisation dans ce dépôt |
|---|---|
| Backend Go + endpoints REST `/api/v1/catalog/...` | **Supabase** : tables + RLS + RPC `security definer`. Aucun second serveur (la spec l'interdit elle-même) |
| Table `services` | Réutilisation de **`tenant_services`** (migrations 021-023), déjà référencée par les lignes de commande ; étendue (code stable, description, délai estimé, express, archivage) |
| `service_categories` | Les **activités** (`tenant_activities`, 022) portent déjà ce regroupement ; pas de doublon au Lot 1 |
| Catalogue **obligatoire** | Obligation activée **par pressing, dès l'installation** de son catalogue (garde serveur) : aucun pressing existant n'est bloqué avant d'avoir installé et tarifé |
| Seed système | 12 catégories + 45 articles, **sans aucun prix** ; clonage par tenant via `install_catalog_reference()` (idempotent, n'écrase jamais une personnalisation) |
| Tranches au kilo, modèles, forfaits | **Lots suivants** (livraison phasée). Le kilo actuel (`tenant_services.unit_price`) reste inchangé |

Le modèle historique supprimé par la migration 020 (familles/articles/
prestations/opérations/alias/templates — voir `ARCHITECTURE_CATALOGUE.md`)
n'a **pas** été restauré tel quel : le schéma 027 est volontairement plus
simple (3 nouvelles tables) et aligné sur la spec.

## Schéma (migration 027)

- `garment_categories` — bibliothèque système (`tenant_id` nul, lecture seule,
  contrainte d'invariance système/tenant) + copies par pressing. Unicité du
  code par périmètre (index partiels).
- `garment_types` — idem, avec garde `guard_garment_category_tenant`
  (catégorie du même pressing), unité par défaut (vocabulaire du dépôt :
  `PIECE`, `PAIR`, `KG`…), délicat, archivage doux.
- `service_garment_prices` — prix **courant** unique par couple
  (pressing, prestation, article) ; FK composites `(id, tenant_id)` → aucun
  prix ne peut référencer l'article ou la prestation d'un autre pressing.
  L'historisation reste dans les snapshots des lignes (`unit_price`,
  `catalog_unit_price_snapshot`, libellés figés) : changer un tarif ne
  réécrit jamais une commande existante (HIST-001).
- `order_items.garment_type_id` — FK composite, `set null` à la suppression
  de l'article (les reçus gardent les libellés figés).
- Garde serveur `guard_order_item_catalog` (insertion) :
  - ligne avec article ⇒ prestation exigée, tarif configuré exigé ;
  - prix différent de la grille ⇒ motif d'au moins 10 caractères (dérogation
    tracée, journalisée par l'existant `order_price_history`) ;
  - pressing ayant des articles actifs ⇒ ligne libre à la pièce refusée.
  Les lignes **au kilo** et les mises à jour de lignes historiques ne sont
  pas gardées au Lot 1 (voir Limites).
- RLS : lecture membre (bibliothèque incluse), écritures **propriétaire**
  uniquement — cohérent avec la capacité `catalog.manage` de l'interface.

## Interface

- **`/catalogue`** (« Catalogue & tarifs », propriétaire) : installation du
  référentiel, onglet *Articles* (recherche, création avec code dérivé,
  archivage/réactivation), onglet *Tarifs* (prestation → prix par article,
  badge « Non configuré », progression de la grille). Les prestations se
  gèrent toujours dans « Services & activités ».
- **Formulaire de commande** : catalogue actif ⇒ sélecteur d'articles groupé
  par catégorie, prix unitaire **verrouillé** sur la grille, prestation libre
  masquée, blocage explicite si le couple n'est pas tarifé. Catalogue non
  installé ⇒ comportement actuel (saisie libre) + note d'orientation.
- **Hors ligne** : articles et prix sont mis en cache dans Dexie (v16 :
  `catalogGarments`, `catalogPrices`) à chaque chargement en ligne ; la vente
  reste possible sans connexion avec la dernière grille connue. Les
  modifications du catalogue exigent une connexion.

## Couverture des tests d'acceptation (Lot 1)

| ID | Couverture |
|---|---|
| CAT-001 | Création d'article (écran + RLS) — testé par le parcours typecheck/tests unitaires ; insertion SQL via install |
| CAT-002 | ✅ SQL (`catalogue_lot1.sql`) : code en double rejeté |
| CAT-003 | ✅ SQL : même code dans deux pressings |
| CAT-004 | ✅ SQL : prix d'un autre pressing invisibles |
| CAT-005 | ✅ SQL : bibliothèque système non modifiable |
| CAT-006 | ✅ SQL : copie indépendante à l'installation |
| CAT-007 | ✅ SQL : réinstallation sans doublon |
| PRICE-001 | ✅ Unitaire (`catalogue.test.ts`) : tarif 800 FCFA résolu par la grille |
| PRICE-005 | ✅ Contrainte `price_xof ≥ 1` + contrôle client |
| PRICE-007 | Inchangé : le kilo actuel exige déjà poids + tarif (migration 023) |
| HIST-001/002, INT-002 | ✅ Par construction (snapshots de lignes existants, archivage doux) |
| API-001 | ✅ Garde serveur : prix recalculé/contrôlé en base, refus sans tarif ou sans motif |
| UI-002 | ✅ « Non configuré » explicite partout (jamais 0) |
| INT-001 | ✅ Grille branchée au formulaire de commande |
| PRICE-002/003/004/006/008 | Lots suivants (tranches au kilo `flat_rate`/`progressive_tiers`, devis) |

Vérifications locales : `typecheck` ✅ · `lint` ✅ · **675 tests Vitest / 63
fichiers** ✅ (dont 12 nouveaux) · `build` ✅. La suite SQL complète
(migrations 001→027 + tests, dont `catalogue_lot1.sql`) est rejouée par la CI
sur PostgreSQL 16 ; `sql-verify.sh` inclut désormais aussi la migration 026,
qui y manquait.

## Déploiement

1. Sauvegarder la base cible (bonne pratique, migration additive).
2. Appliquer la migration **026** si ce n'est pas fait, puis **027**
   (`npm run db:push` ou Supabase), **avant** le frontend.
3. Déployer le frontend. Chaque propriétaire installe ensuite le catalogue
   depuis « Catalogue & tarifs » et saisit sa grille ; l'obligation
   s'active pressing par pressing à ce moment-là.
4. Activer la protection de la branche `main` (interface GitHub — l'API via
   l'intégration Arena renvoie 403) : PR obligatoire + contrôles
   « Types, style, tests et build » et « SQL réel (PostgreSQL 16) ».

## Limites connues / lots suivants

- `OrderItemsEditor` (ajout de ligne sur une commande existante) saisit
  encore librement : après installation, ces lignes seront refusées à la
  synchronisation par la garde serveur — à aligner au Lot 2.
- Pas d'historique daté des prix (`effective_from/to` de la spec) : le prix
  courant + snapshots de commande suffisent au Lot 1 ; le journal d'audit
  (migration 009) n'a pas été étendu aux nouvelles tables.
- Pas de CRUD de catégories dans l'interface (celles du référentiel sont
  clonées ; création possible en base).
- Le retour serveur → local ne re-matérialise pas `garment_type_id` sur les
  lignes créées par un autre appareil (les libellés figés s'affichent).
- Lots suivants : tarification au kilo par tranches (`flat_rate`,
  `progressive_tiers`, arrondis), modèles de blanchisserie (duplication,
  activation), forfaits commerciaux, simulateur de prix (écran 5 de la spec).
