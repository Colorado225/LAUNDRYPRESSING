# Rapport final — catalogue multi-activités et forfaits poids

> Livraison du 26 octobre 2026, branche `arena/b9750e79-laundrypressing`
> (commit `aee4bbd`). Évolution de l’application unique existante, sans
> reconstruction ni suppression de fonctionnalité.

## 1. Synthèse

L’application gère désormais un **catalogue propriétaire par établissement**
structuré en Activités → Catégories → Prestations → Tarification/options, avec
deux activités configurables (Pressing, Blanchisserie), six unités de facturation
et trois modes de tarification (prix fixe à la pièce/quantité, kilo linéaire,
forfait à paliers de poids), ainsi que les devis et les options. Chaque ligne de
commande fige un **snapshot immuable** : les changements ultérieurs de tarifs ou
la désactivation d’une prestation ne touchent jamais l’historique, en ligne comme
hors ligne.

## 2. Traçabilité des critères d’acceptation

| # | Critère | Réalisation | Preuve |
|---|---------|-------------|--------|
| 1 | Une seule application, évolution sans reconstruction | Mêmes stack, routes et conventions ; écrans existants modifiés en place | diff du commit, 656 tests de base préservés |
| 2 | Hiérarchie établissement → activités → catégories → prestations → tarification | Tables `tenant_activities`, `tenant_service_categories`, `tenant_services`, `tenant_weight_tiers` avec FK composites et cascades | migration `027`, tests SQL `catalogue_prestations.sql` |
| 3 | Deux activités configurables (Pressing + Blanchisserie) | CRUD complet des activités, sélecteur d’activité dans la commande | `ServicesPressing.tsx`, `tenantServices.ts` |
| 4 | Tarification pièce, kg linéaire, forfait/paliers, quantité, options, devis | `pricing_mode` FIXED/FROM/QUOTE, `billing_unit` PIECE/PAIR/SET/PACKAGE/KG/L/M3 ; paliers uniquement PACKAGE ; QUOTE ⇒ prix nul | schémas Zod, contraintes CHECK SQL |
| 5 | Paliers 10/15/20 kg (15 000/22 000/28 500 et 12 000/16 000/20 000 FCFA) | Reproduits comme **suggestions importables**, non imposées | `laundryCatalogSuggestions.ts` |
| 6 | Réceptionniste : uniquement les prestations de l’activité choisie | Filtrage par `activityId` et optgroups par catégorie dans le formulaire | `OrderForm.tsx`, `catalogueCommande.test.tsx` |
| 7 | Le réceptionniste ne peut pas modifier les tarifs de référence | Garde `can(role, 'tenant.manage')` côté UI ; écritures owner-only côté RLS ; prix de référence pré-remplis mais non éditables comme référence | `ServicesPressing.tsx`, politiques RLS migration 027 |
| 8 | Snapshots immuables par commande | Nom d’activité, catégorie, prestation et `package_snapshot` figés à la création ; Zod refuse toute ligne PACKAGE sans snapshot ou à prix falsifié | `ordersRepository.ts`, `schemas/order.ts`, `catalogueLocal.test.ts` |
| 9 | Prestation désactivée reste lisible dans l’historique | Les écrans lisent les snapshots, jamais le catalogue vivant ; `is_active` ne filtre que les nouveaux choix | `OrderDetail.tsx`, `Receipt.tsx`, `Facture.tsx` |
| 10 | Lignes libres historiques conservées | Ligne libre `__free__` toujours disponible ; aucune donnée ancienne migrée ni supprimée | `OrderForm.tsx`, tests de base inchangés |
| 11 | Migrations strictement additives | Aucun DROP, aucune colonne retirée ; migration 020 intouchée | `027_catalogue_categories_forfaits.sql` |
| 12 | Validation serveur des prix | CHECK prix entiers 1..10 000 000, durée 1..1 440, poids unique par service, trigger PL/pgSQL de cohérence des snapshots/paliers | migration 027 + tests SQL de refus |
| 13 | RLS et rôles (owner seul gère le catalogue) | Politiques owner-only en écriture sur les 4 tables ; membres en lecture | migration 027, 17 vérifications PGlite |
| 14 | Isolation multi-tenant | Toutes les clés primaires composites incluent `tenant_id` ; politiques `current_tenant_id()` | migration 027 |
| 15 | Offline-first avec migration Dexie | Dexie v16 : 4 stores catalogue dont `tenantServices` indexé `categoryId` ; cache online/offline | `localDb.ts`, `catalogueLocal.test.ts` |
| 16 | Commandes hors ligne jamais recalculées ; conflits explicites | Les lignes lues hors ligne conservent leurs snapshots ; le moteur de synchro existant (compare-and-set par version) reste inchangé | `syncEngine.ts` (non modifié), `catalogueCommande.test.tsx` |
| 17 | Suggestions tarifaires jamais imposées | Import manuel, idempotent par nom normalisé, online + offline, avec résumé `{created, skipped}` | `importSuggestedCatalog`, tests dédiés |

## 3. Recette

| Contrôle | Résultat |
|----------|----------|
| Tests SQL PGlite (migration 027) | **17/17 vérifications vertes** (RLS, FK, cascades, CHECK, triggers, snapshots) |
| `npx tsc --noEmit` | **0 erreur** |
| `npm run lint` | **0 problème** |
| `npm test` | **63 fichiers, 673 tests verts** (656 de base + 17 nouveaux) |
| `npm run build` | **OK** (PWA, 70 entrées précachées) |

Nouveaux fichiers de tests : `catalogueLocal.test.ts` (10 tests : CRUD démo,
gardes QUOTE/PACKAGE, paliers, duplication, import idempotent, Zod anti-
falsification, mapping snake_case, types vêtements), `catalogueCommande.test.tsx`
(2 tests : forfait figé en Dexie et prix de référence pièce pré-rempli),
`servicesPressing.test.tsx` réécrit (7 tests), cas forfait ajouté à
`facturation.test.ts`.

## 4. Décisions et règles métier

- **Montants FCFA entiers** : contraintes SQL et schémas Zod imposent des entiers
  positifs ; aucun arrondi flottant introduit.
- **Forfait** : `pricing_mode = FIXED`, unité `PACKAGE`, quantité 1, prix égal au
  palier choisi ; le palier (`tierId, label, weightKg, priceFcfa, serviceName`)
  est figé dans `package_snapshot` dès la création. L’éditeur de mesure est
  désactivé sur ces lignes.
- **Devis** : unité `FLAT`, prix nul, montant à confirmer au comptoir.
- **Désactivation** : une prestation inactive disparaît des sélecteurs mais reste
  affichée dans les commandes via ses snapshots.
- **Suppression de catégorie** : les prestations orphelines sont détachées
  (`category_id = NULL`), jamais supprimées.
- Les tarifs de référence sont pré-remplis au comptoir mais restent ajustables
  (pratique commerciale habituelle) ; la **référence** du catalogue, elle, n’est
  modifiable que par le propriétaire.

## 5. Limites et suites

- La vérification SQL a été exécutée via PGlite (`psql` absent du sandbox) ;
  `npm run sql:verify` reste le chemin de recette CI sous PostgreSQL 15+. Aucun
  test de bout en bout sur un projet Supabase réel ne remplace la recette de
  déploiement habituelle (`docs/RECETTE-SUPABASE.md`).
- Aucun secret n’est introduit côté frontend ; le client Supabase et la RLS
  existants sont réutilisés sans contournement.
- **Hors périmètre de cette itération** (non demandé) : abonnements mensuels et
  ramassage à domicile. Les grilles fournies les mentionnant sont reproduites
  dans `docs/PROJET-BLANCHISSERIE.md` §2 pour une phase ultérieure.
- `@electric-sql/pglite` a été installé temporairement `--no-save` pour la
  recette SQL locale ; le runner temporaire a été supprimé et `package.json`
  n’est pas modifié.

## 6. Livraison Git

Branche dédiée `arena/b9750e79-laundrypressing`, commit `aee4bbd`
(23 fichiers, +3 972 / −340), poussée sur `origin`.
