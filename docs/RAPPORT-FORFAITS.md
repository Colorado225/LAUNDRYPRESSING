# Forfaits commerciaux — packs multi-articles

**Date :** 27 octobre 2026
**Branche :** `arena/b47084c6-laundrypressing`
**Migrations :** `028_forfaits_commerciaux.sql` (dépôt), appliquée au projet `Pressing_Pro` (`phjstsydxvggtduohfrl`) sous le nom `forfaits_commerciaux_reproductibles`.

---

## 1. Ce qui existait déjà (et ce qui manquait)

L'audit préalable a changé le plan de départ. **Le modèle « forfait » existait
déjà en production**, hérité d'une migration distante (`20261026193632`
« catalogue_lot1 ») qui ne figure dans **aucune migration du dépôt** :

| Objet | État constaté en base | État dans le dépôt |
| --- | --- | --- |
| `commercial_packages` | 0 ligne, RLS en place (lecture membre, écriture propriétaire) | **absent** |
| `commercial_package_items` | 0 ligne, même RLS | **absent** |
| `garment_types` | 46 types système | **absent** |
| `order_items.commercial_package_id` / `package_line_id` | colonnes + contraintes `package_role`, `package_detail_price`, `package_quantity` | **absentes du typage TypeScript** |
| Code applicatif | — | **zéro référence** : jamais lu, jamais vendu |

Deux défauts réels : le dépôt ne reproduisait pas la production, et une
fonctionnalité payante dormait en base sans interface.

## 2. Décisions arbitrées (27/10/2026)

| Question | Réponse retenue |
| --- | --- |
| Composition d'un forfait | **Libre** : « 10 vêtements au choix ». Le comptoir touche le linge réellement déposé. |
| Dépassement | **Supplément par pièce** (`PER_EXTRA_ITEM`) ou **refus net** (`REJECT_OVER_LIMIT`). Les deux autres politiques stockées en base ne sont pas proposées. |
| Périmètre | **Pressing et blanchisserie**, dans les deux parcours. |
| Migration | **Oui**, additive et idempotente. |

## 3. Lot 1 — Schéma reproductible (migration 028)

`create table if not exists` pour les deux tables, avec **exactement** les
colonnes, valeurs par défaut et contraintes constatées en production
(`code`, `name`, `price_xof` 1…10 000 000, `garments_included` 1…10 000,
`overflow_policy` à quatre valeurs, `overflow_unit_price_xof`, `is_active`,
`archived_at`), les index, les politiques RLS recréées à l'identique et les
déclencheurs d'audit ajoutés seulement s'ils manquent.

Deux précautions :

- la clé étrangère vers `garment_types` est posée **conditionnellement**
  (`to_regclass`) : la table n'étant pas créée par ce dépôt, la migration reste
  rejouable sur une base reconstruite ici ;
- index supplémentaire `commercial_packages_tenant_active_idx` pour la lecture
  du comptoir (filtre `tenant_id` + `is_active`).

**Preuve d'innocuité après application** : `0` forfait, `0` ligne de
composition, `8` politiques, `12` contraintes — identique à l'état d'avant.

## 4. Lot 2 — Configuration (Services & activités → Forfaits)

| Fichier | Rôle |
| --- | --- |
| `src/lib/packagePricing.ts` | Règles pures : `tariferForfait`, `nombreVetements`, `resumerForfait`, `POLITIQUES_VENDABLES` |
| `src/services/commercialPackages.ts` | Lecture (serveur ou cache), création, modification, retrait ; `validerForfait`, `codeDepuisNom` |
| `src/components/services/ForfaitManager.tsx` | Écran de gestion (propriétaire) |
| `src/pages/ServicesPressing.tsx` | Troisième onglet « Forfaits » |
| `src/db/localDb.ts` | Cache hors ligne `commercialPackages` (version Dexie 16) |

Règles appliquées :

- **rien n'est inventé** : un code technique est dérivé du nom (`PACK_10_PIECES`)
  et rendu unique, le propriétaire ne saisit jamais d'identifiant ;
- **pas de faux succès** : après chaque écriture, la liste est relue depuis la
  base ; un refus serveur s'affiche (`role="alert"`) et aucun `toast.success`
  n'est émis ;
- **pas de suppression** : un forfait se **retire** de la vente (archivage), avec
  confirmation ; les commandes déjà passées gardent leur référence ;
- **hors ligne** : les forfaits sont mis en cache, donc vendables sans réseau,
  mais se configurent en ligne (comme les prestations).

## 5. Lot 3 — Vente au comptoir

Dans `src/pages/OrderForm.tsx`, une section « Forfaits » apparaît dès qu'un
forfait est actif, dans les deux parcours.

- **un appui sur un forfait** ajoute une ligne au prix global et ouvre sa
  composition ;
- **les appuis suivants sur la grille** comptent les vêtements déposés dans le
  forfait (composition libre, affichée `3 / 10 vêtement(s)`), sans les facturer
  une seconde fois ;
- **au-delà du nombre inclus** : `PER_EXTRA_ITEM` ajoute `n × prix` au montant
  affiché, `REJECT_OVER_LIMIT` refuse l'appui et l'explique — **aucune ligne ne
  bouge** dans ce cas ;
- **« Terminer la composition »** rend la grille au prix par article ;
- la ligne du forfait est **verrouillée** dans le panier : ni quantité ni prix
  ne s'y saisissent, c'est le comptage qui fait varier le montant.

À l'enregistrement, la ligne porte `billing_unit = 'PACKAGE'`,
`commercial_package_id` (référence historisée) et sa composition dans
`garment_details` — même mécanisme que le lot pesé, donc **aucun changement du
moteur de commande**. Le schéma Zod refuse par ailleurs une ligne à la fois
forfait et détail de forfait, miroir de `order_items_package_role_check`.

### Ce qui n'a pas été utilisé, et pourquoi

Le schéma prévoit des **lignes de détail à 0 FCFA** (`package_line_id`,
contrainte `package_detail_price`). La v1 ne les crée pas : avec une
composition libre et un prix global, une seule ligne suffit, et elle reste
lisible sur la fiche et la facture. Le mécanisme reste disponible pour un futur
détail ventilé par article.

## 6. Lot 4 — Suite de la chaîne

- `src/types/database.ts` : tables `commercial_packages` /
  `commercial_package_items` typées, colonnes de forfait ajoutées à
  `OrderItemRow` ;
- `src/schemas/order.ts` : `commercialPackageId`, `packageLineId`, cohérence
  unité/prix, composition autorisée sur un forfait ;
- `src/db/ordersRepository.ts` : persistance IndexedDB et envoi Supabase
  (`commercial_package_id`, `package_line_id`) ;
- `src/components/order/OrderBasket.tsx` : ligne verrouillée, compteur de
  forfaits ;
- `src/pages/OrderDetail.tsx` : « Forfait · N vêtement(s) · montant ».

## 7. Tests

| Fichier | Tests | Ce qui est verrouillé |
| --- | --- | --- |
| `src/test/packagePricing.test.ts` | 19 | prix dans la limite, supplément, refus, illimité, politique non prise en charge, supplément sans prix, composition, résumés, validation des saisies, unicité du code |
| `src/test/orderFormForfaits.test.tsx` | 7 | affichage, ajout au prix global, ligne verrouillée, comptage `3 / 10`, dépassement facturé `5 300`, refus sans effet, enregistrement (`PACKAGE` + référence + composition), absence si aucun forfait |
| `src/test/forfaitManager.test.tsx` | 6 | liste, création (valeurs exactes), refus serveur affiché sans faux succès, masquage du prix de dépassement, retrait avec confirmation, aucun droit pour un non-propriétaire |

Porte complète : `tsc --noEmit` OK · `tsc -p tsconfig.e2e.json` OK · `lint`
0 erreur (2 avertissements `react-refresh` préexistants) · **`npm test` 75
fichiers / 818 tests verts** · `npm run build` OK (PWA, 94 entrées).

## 8. Ce qui n'est pas vérifié

- **Aucun forfait réel n'a été créé en production** : la table est restée vide
  (0 ligne). Les écrans sont couverts par des tests jsdom avec services
  simulés, pas par une vente réelle.
- **Aucun navigateur ici** : pas de capture, tests Playwright **non rejoués** et
  aucun scénario E2E n'a été ajouté pour les forfaits (le harnais
  `e2e/helpers.ts` ne connaît pas encore les forfaits).
- **La RLS n'a pas été éprouvée depuis un compte réel** : les politiques sont
  reproduites à l'identique de la production, mais le test d'écriture par un
  compte non-propriétaire reste à faire en recette.
- **`npm run recette` / `npm run sql:verify`** : non exécutés (pas d'accès
  réseau vers Supabase depuis le bac à sable).

## 9. Recette manuelle suggérée

1. Services & activités → **Forfaits** → créer « Pack 10 pièces », 5 000 FCFA,
   10 vêtements inclus, au-delà 300 FCFA/pièce.
2. Nouvelle commande → Pressing → ajouter le forfait, toucher 3 vêtements :
   le panier doit afficher `3 / 10 vêtement(s)` et **5 000 FCFA**.
3. Toucher un 11ᵉ vêtement : le total passe à **5 300 FCFA**.
4. Passer le forfait en « refuser au-delà », recommencer : le 11ᵉ appui est
   refusé avec un message, le total reste à 5 000 FCFA.
5. Enregistrer : la fiche doit afficher `Forfait · 11 vêtement(s) · 5 300 FCFA`
   et conserver la composition.
