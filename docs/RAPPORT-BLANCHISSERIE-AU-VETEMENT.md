# Blanchisserie facturée au vêtement

**Date :** 27 octobre 2026
**Branche :** `arena/b47084c6-laundrypressing`
**Migration :** `supabase/migrations/027_prix_prestation_a_la_piece.sql` — appliquée au projet `Pressing_Pro` (`phjstsydxvggtduohfrl`), version en historique **`20261027124654`**.

---

## 1. Le défaut signalé

Le parcours de commande facturait **toute** la blanchisserie au kilo : une seule
ligne `billingUnit: 'KG'`, `quantity` = poids, `unitPrice` = tarif/kg, et la
composition du linge rangée dans `garmentDetails`.

Or le pressing ne pèse pas le linge : il **compte les vêtements** et applique le
forfait par article (drap 500 FCFA, serviette 300 FCFA…). Deux conséquences
visibles au comptoir :

1. Le réceptionniste devait inventer un poids pour un lot de draps, donc un
   montant faux ou négocié à la main ;
2. le prix par article ne pouvait pas être configuré du tout : la contrainte
   `tenant_services_unit_price_check` **interdisait** tout `unit_price` sur une
   prestation `PIECE` (`billing_unit = 'PIECE' AND unit_price IS NULL`).

## 2. Ce qui a été décidé

| Question | Décision retenue |
| --- | --- |
| Modèle de prix | **Un prix par pièce, défini par article** (`PIECE` + `unit_price`) |
| Le kilo | **Conservé en option** : une prestation configurée `KG` reste facturable au poids |
| Schéma | **Migration additive** : on relâche une contrainte, aucune donnée touchée |

Un « forfait » n'est pas une nouvelle table : c'est une prestation `PIECE`
nommée comme l'article (« Drap », « Serviette »), portant son prix. La migration
020 avait supprimé `laundry_models` et le catalogue d'articles ; on ne les
recrée pas.

## 3. Migration 027 — additive, sans risque sur les données

```sql
alter table public.tenant_services
  drop constraint if exists tenant_services_unit_price_check;

alter table public.tenant_services
  add constraint tenant_services_unit_price_check
  check (unit_price is null or unit_price between 1 and 10000000);
```

- Aucune table, colonne ni ligne créée, modifiée ou supprimée ;
- la nouvelle contrainte est **plus faible** que l'ancienne : toute ligne
  existante la satisfait, la migration ne peut pas échouer sur les données en place ;
- `NULL` garde son sens : **prix saisi au comptoir** ;
- commentaires de colonnes mis à jour (`billing_unit`, `unit_price`).

**Vérification faite après application**, sur la base réelle :

```text
tenant_services_unit_price_check
CHECK (((unit_price IS NULL) OR ((unit_price >= 1) AND (unit_price <= 10000000))))
```

## 4. Configuration — « Services & activités »

Fichiers : `src/services/tenantServices.ts`, `src/pages/ServicesPressing.tsx`.

- Un prix est désormais accepté pour **les deux unités** ; la validation métier
  est la même (entier, 1 … 10 000 000 FCFA) avec un message adapté à l'unité
  (« prix par pièce » / « tarif au kilo ») ;
- le champ est proposé à la création comme à la modification, avec pour libellés
  « Prix par pièce (FCFA, facultatif) » et « Tarif par kilo (FCFA, facultatif) » ;
- l'aide sous le champ dit ce que signifie un champ vide : « Laisser vide : le
  prix sera saisi au comptoir » ;
- la liste affiche `500 FCFA/pièce`, `1 500 FCFA/kg` ou `prix saisi au comptoir`.

## 5. Réception — la facturation au vêtement

Fichiers : `src/lib/orderServices.ts` (règles pures), `src/pages/OrderForm.tsx`
(écran), sans toucher au moteur d'enregistrement.

- **Mode par défaut déduit du catalogue**, sans état intermédiaire : dès qu'une
  prestation `PIECE` existe en blanchisserie, l'écran compte les vêtements ;
  sinon il conserve le lot pesé historique ;
- **chaque appui sur une tuile ajoute une pièce** ; le prix unitaire vient de la
  prestation du **même nom** (rapprochement sans casse ni accent, tolérant sur
  les pluriels : « Serviette » ↔ « serviettes »). Aucun rapprochement
  approximatif au-delà : un article sans forfait vaut 0 et affiche
  « prix au comptoir » ;
- un tableau **« Prix par article »** liste, avant la grille, le tarif retenu pour
  chaque article — le comptoir voit ce qui est configuré et ce qui ne l'est pas ;
- **bascule « Au kilo (linge pesé) »** : le lot réapparaît (poids + tarif/kg),
  avec le tarif au kilo configuré pré-rempli. Les deux modes ne partagent pas
  leurs lignes : changer de mode vide le panier, avec **confirmation** s'il y a
  quelque chose à perdre ;
- **article libre** également disponible en blanchisserie au vêtement ;
- l'enregistrement reste celui de l'application : lignes `PIECE`, `pricingMode:
  'FIXED'`, `priceStatus: 'CONFIRMED'`, `tenantServiceId` + `serviceName` +
  `activityNameSnapshot` conservés (le prix est historisé), quantité entière
  vérifiée par `createOrderSchema` ;
- une ligne à 0 FCFA est toujours refusée avant tout envoi (`problemeTarifaire`),
  avec le nom de l'article dans le message.

### Détail technique : pas de lot fantôme

Le lot pesé ne doit pas être créé puis abandonné quand le catalogue arrive après
l'affichage. Le mode est donc **calculé** (`modeManuel ?? modeFacturationParDefaut(...)`)
et la création du lot attend que le catalogue soit chargé (`cataloguePret`).
Sans catalogue configuré, le comportement historique est conservé : lot au kilo
immédiat.

## 6. Tests

| Fichier | Ce qui est verrouillé |
| --- | --- |
| `src/test/orderServices.test.ts` (+4 tests, 19 au total) | rapprochement article ↔ prestation (casse, pluriel), refus de rapprocher une prestation `KG`, `null` sans forfait, choix du mode par défaut |
| `src/test/orderFormBlanchisserie.test.tsx` (nouveau, 6 tests) | ouverture sur le comptage ; prix par article affichés ; 2 × Drap + 1 × Serviette = 1 300 FCFA ; enregistrement en lignes `PIECE` (quantité 2, prix 500, total 1 000, `tenantServiceId` conservé) ; refus d'un article à 0 FCFA ; bascule kilo ↔ vêtement |
| `src/test/servicesPressing.test.tsx` (+4 tests, 6 au total) | prix 500 accepté sur une prestation `PIECE`, affichage `500 FCFA/pièce` vs `prix saisi au comptoir`, refus hors bornes (99 999 999) sans appel au service |

Porte complète au moment de la livraison :

- `npx tsc --noEmit` — OK
- `npm run lint` — 0 erreur, 2 avertissements `react-refresh` préexistants
- `npm test` — **72 fichiers / 785 tests, tous verts**
- `npm run build` — OK (PWA, 93 entrées précachées)

## 7. Ce qui n'a pas été vérifié

- **Aucun navigateur dans l'environnement de développement** : pas de capture
  d'écran, et les tests Playwright n'ont pas été rejoués. Les parcours ci-dessus
  sont couverts par les tests jsdom, pas par une recette navigateur.
- **Aucune commande réelle créée en production** : la contrainte est vérifiée
  (définition SQL ci-dessus) et le chemin d'écriture testé sur IndexedDB, mais
  aucun service `PIECE` payant n'a été inséré puis supprimé en base réelle.
- La recette manuelle correspondante est à cocher dans `docs/RECETTE-BOUTONS.md`
  (§3, trois nouvelles lignes).
