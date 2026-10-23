# Audit courant — Pressing Pro

**Date :** 23 octobre 2026
**Révision auditée :** branche `arena/17b0abba-laundrypressing`, palier 4
(après fusion de la PR #1 et des paliers 0 à 4)
**Méthode :** inventaire automatisé du code (analyse des imports, comptage des
tables, politiques et tests), puis lecture ciblée des zones sensibles
(authentification, synchronisation, paiement, RLS).
**Périmètre :** application `src/`, `supabase/`, `scripts/`, outillage.

> Ce document décrit l'état **actuel**. L'audit de phase 0, qui décrit le point
> de départ (commit `ae2903f`), est archivé dans [`AUDIT.md`](AUDIT.md).
> La feuille de route et la vérification de l'audit externe sont dans
> [`../MAJ.md`](../MAJ.md).

---

## 1. Chiffres clés

| Élément | Valeur |
| --- | --- |
| Fichiers TypeScript / TSX dans `src/` | 78 (dont 10 de test) |
| Lignes de code applicatif | 13 477 (hors dossier `src/test/`) |
| Migrations | 7 (`001_init` → `007_palier4`) |
| Tables PostgreSQL | 20 + 3 vues (`expense_totals`, `order_balances`, vues de synthèse) |
| Politiques RLS | 66 (dont 30 restrictives posées par le palier 4) |
| Fonctions SQL | 31 (dont `current_tenant_id`, `guard_order_update`, `record_cash_payment`, `close_cash_session`, `attach_customer_to_order`, `apply_stock_movement`, `subscription_state`, `tenant_writable`, `platform_set_subscription`) |
| Déclencheurs | 18 |
| Edge Functions | 2 (`cinetpay-init`, `cinetpay-webhook`) + 3 modules `_shared` |
| Scripts d'installation, de recette et de base | 5 (`scripts/setup.mjs`, `scripts/lib/config.mjs`, `scripts/sql-verify.sh`, `scripts/recette.mjs`, `scripts/db.mjs`) |
| Fichiers de tests | 23 (17 sous `src/`, 4 pour les scripts, 2 fichiers SQL de tests) |
| Tests automatisés | 334 |
| Contrôles SQL exécutés | 123 (isolations, rôles, paliers 1 à 4) |
| Intégration continue | 1 workflow (deux jobs : application et SQL réel) |
| Code mort | 0 fichier (voir §3) |

---

## 2. Inventaire de ce qui est actif

### 2.1 Application

Point d'entrée : `src/main.tsx` → `src/App.tsx` → `src/components/AuthGate.tsx`
→ `src/components/AppLayout.tsx`.

| Route | Écran | Chargement |
| --- | --- | --- |
| `/` | redirection vers `/commandes` | — |
| `/commandes` | `Orders.tsx` — liste, recherche, filtres | différé |
| `/commandes/nouvelle` | `OrderForm.tsx` — création hors ligne | différé |
| `/commandes/:orderId` | `OrderDetail.tsx` — fiche, QR, statut, paiement | différé |
| `/atelier` | `Atelier.tsx` — scan caméra | différé (html5-qrcode) |
| `/offline` | `Offline.tsx` — écran de repli | différé |
| `/catalogue` | `Catalogue.tsx` — prestations et tarifs (propriétaire) | différé |
| `/caisse` | `Caisse.tsx` — encaissements et clôture journalière | différé |
| `/commandes/:orderId/recu` | `Receipt.tsx` — reçu 80 mm imprimable | différé |
| `/tableau-de-bord` | `TableauDeBord.tsx` — indicateurs du propriétaire | différé |
| `/clients` | `Clients.tsx` — fiches et historique (offline pour l'historique) | différé |
| `/stock` | `Stock.tsx` — articles, mouvements, fournisseurs | différé |
| `/depenses` | `Depenses.tsx` — dépenses du propriétaire | différé |
| `/abonnement` | `Abonnement.tsx` — formule, échéance, droits (propriétaire) | différé |
| `/support` | `Support.tsx` — demandes d'assistance du pressing | différé |
| `/supervision` | `Supervision.tsx` — console de l'éditeur | différé |
| `/parametres` | `Parametres.tsx` — compte, pressing, synchronisation | différé |
| `/reinitialisation` | `Reinitialisation.tsx` — nouveau mot de passe (avant `AuthGate`) | différé |
| `/paiement/retour` | `PaymentReturn.tsx` — retour CinetPay, lecture seule | différé |
| `/payment/return` | alias redirigé (anciens liens) | — |

### 2.2 Données locales et synchronisation

| Fichier | Rôle |
| --- | --- |
| `src/db/localDb.ts` | schéma Dexie : `orders` (version serveur, conflits), `orderItems`, `payments`, `cashSessions`, `issues`, `refunds`, catalogue local |
| `src/db/ordersRepository.ts` | CRUD local, mapping vers Supabase **sans les champs de paiement** |
| `src/db/hooks.ts` | `useLocalOrders`, `useCreateOrder`, `useUpdateOrderStatus` et lectures d'agrégats (`useAllLocalItems`, `useAllCashPayments`) |
| `src/sync/syncEngine.ts` | `insert` idempotent (23505 = réponse perdue) puis `update … eq('version')` ; verrou `runId` |
| `src/services/orderConflictService.ts` | arbitrage : garder la version locale ou adopter celle du serveur |
| `src/components/ConflictBanner.tsx` | bandeau d'arbitrage dans la fiche commande |
| `src/stores/syncStore.ts` | état de synchronisation, dont le nombre de conflits (Zustand) |

### 2.3 Sécurité et multi-tenant

| Fichier | Rôle |
| --- | --- |
| `supabase/migrations/001_init.sql` | 5 tables, 12 politiques RLS, clés composites |
| `supabase/migrations/002_payments.sql` | `payment_transactions`, index, 1 politique de lecture |
| `supabase/migrations/003_palier1.sql` | `version`, `previous_status`/`reason`, `guard_order_update`, index de guichet unique |
| `supabase/migrations/004_palier2.sql` | catalogue, prix historisé, caisse, clôture, 22 contrôles associés |
| `supabase/migrations/005_palier2_complement.sql` | attribution, réclamations, remboursements, motif de transition |
| `supabase/migrations/006_palier3.sql` | clients, fournisseurs, stock + grand livre, dépenses, vue `expense_totals` |
| `supabase/migrations/007_palier4.sql` | formules et abonnements, lecture seule, multi-boutiques, supervision, support |
| `supabase/tests/palier4.sql` | 28 contrôles : abonnement, grâce, blocage d'écriture, en-tête de boutique, console, support |
| `supabase/tests/isolation.sql` | rejoue PostgREST (`request.jwt.claims`) et exige `42501` |
| `supabase/tests/roles.sql` | 11 contrôles de la matrice de rôles côté serveur |
| `supabase/tests/palier1.sql` | verrou optimiste, historique, guichet unique |
| `supabase/tests/palier3.sql` | 17 contrôles clients, stock et dépenses |
| `src/lib/permissions.ts` | matrice `Capability` / `can` / `canSeeAmounts` |
| `src/lib/tenantContext.ts` | pressing courant (Zustand + persistance) |
| `src/components/AuthGate.tsx` | restauration de session, mode hors ligne |
| `src/services/authService.ts` | connexion, déconnexion, messages d'erreur en français |

### 2.4 Gestion (palier 2 et 3)

| Fichier | Rôle |
| --- | --- |
| `src/pages/Catalogue.tsx` + `src/services/catalogService.ts` | prestations, tarifs, prix historisé |
| `src/pages/Caisse.tsx` + `src/services/cashService.ts` | encaissements, solde, clôture |
| `src/pages/Receipt.tsx` | reçu 80 mm |
| `src/pages/Clients.tsx` + `src/services/customerService.ts` | fiche par téléphone, historique local, coordonnées serveur |
| `src/pages/Stock.tsx` + `src/services/stockService.ts` | articles, seuils, mouvements, fournisseurs |
| `src/pages/Depenses.tsx` + `src/services/expenseService.ts` | dépenses catégorisées (propriétaire) |
| `src/pages/TableauDeBord.tsx` + `src/services/dashboardService.ts` | agrégats locaux, compléments serveur |
| `src/lib/permissions.ts` | 14 capacités, matrice propriétaire / réceptionniste / artisan |

### 2.5 Paiement

| Fichier | Rôle |
| --- | --- |
| `supabase/functions/cinetpay-init/index.ts` | initiation : montant relu en base, multiple de 5, **guichet unique** (réutilisation 15 min), artisan refusé |
| `supabase/functions/cinetpay-webhook/index.ts` | notification : HMAC **obligatoire en production**, **toujours** reconfirmée auprès de CinetPay, mise à jour compare-and-set |
| `supabase/functions/_shared/cinetpay.ts` | client HTTP, signature, vérification, arrondi |
| `src/services/paymentService.ts` | appel de la fonction, redirection, lecture du statut |

### 2.6 Outillage

| Fichier | Rôle |
| --- | --- |
| `scripts/setup.mjs` | provisionnement complet depuis `.env` (6 étapes, idempotent) |
| `scripts/lib/config.mjs` | lecture et validation pure du `.env` (`APP_ENV` inclus) |
| `scripts/sql-verify.sh` | rejoue migrations et tests SQL sur un PostgreSQL jetable |
| `scripts/recette.mjs` | 7 contrôles **en lecture seule** sur un projet déployé (`npm run recette`) |
| `src/lib/pagination.ts` | découpe locale (commandes) **et** curseur serveur (dépenses), testés |
| `src/lib/reporting.ts` | calculs purs des rapports : bornes de période, séries, variations, export CSV |
| `src/lib/parametres.ts` | validation du pressing, tailles lisibles, règle de purgeabilité |
| `src/db/maintenance.ts` | résumé, export JSON et purge des commandes synchronisées |
| `scripts/db.mjs` | `db:etat` / `db:push` / `db:verifier` sur une base PostgreSQL gérée (Neon) — voir `docs/NEON.md` |
| `.github/workflows/ci.yml` | job application (`npm ci`, types, style, tests, build) + job SQL réel |
| `vitest.config.ts` | tests `src/` **et** `scripts/` |

---

## 3. Code mort

Analyse de reachability depuis `src/main.tsx`, imports statiques **et** différés
(`React.lazy`) inclus :

- 65 fichiers atteignables (tous les écrans `lazy` compris) ;
- 10 fichiers de test sous `src/` (exécutés par Vitest, non importés) ;
- 1 fichier de déclarations de types (`src/vite-env.d.ts`).

**Aucun composant, service ou utilitaire orphelin.** Les seuls fichiers non
atteignables sont les tests et les déclarations, ce qui est attendu.

---

## 4. Ce qui manque par rapport au modèle cible

| Domaine | État | Palier prévu |
| --- | --- | --- |
| Catalogue (articles, prestations, prix) | **Livré** — catalogue article × prestation, prix historisé, dérogation motivée | Fait |
| Encaissement espèces, acomptes, solde dû | **Livré** — encaissement idempotent, solde recalculé | Fait |
| Reçus imprimables, clôture de caisse | **Livré** — reçu 80 mm, clôture quotidienne, remboursements déduits | Fait |
| Workflow complet (tri, séchage, contrôle qualité) | **Livré** — 8 étapes, transitions contrôlées, attribution, réclamations | Fait |
| Date de livraison promise, alertes de retard | **Livré** — `orders.due_date`, badge « En retard » | Fait |
| Clients (fiche, historique) | **Livré** — fiche par téléphone, historique, total dépensé, coordonnées | Fait |
| Stocks, fournisseurs, dépenses | **Livré** — articles, seuils, grand livre immuable, fournisseurs, dépenses propriétaire | Fait |
| Tableau de bord propriétaire | **Livré** — activité, chiffre d'affaires, encours, retards, alertes, dépenses | Fait |
| Abonnement, multi-boutiques | Absent | Palier 4 |
| Navigation et actions par rôle | **Livré** — 14 capacités, navigation filtrée, garde-fou SQL | Fait |
| Verrou optimiste sur les commandes | Absent — `upsert` sans `version` | Palier 1 |
| Journal d'audit des actions sensibles | Absent | Palier 1 |
| Intégration continue | **Ajoutée** au palier 0 | Fait |

---

## 5. Défauts et risques constatés

| # | Gravité | Constat | Référence | Traitement |
| --- | --- | --- | --- | --- |
| 1 | **Élevée** | Double paiement possible : chaque appel d'initiation crée un `transaction_id` neuf ; la garde `already_paid` n'agit qu'après encaissement | `cinetpay-init` | **Corrigé** (guichet unique + index partiel) |
| 2 | **Élevée** | Écrasement silencieux entre deux tablettes : `upsert` sans comparaison de version | `syncEngine` | **Corrigé** (verrou optimiste + arbitrage) |
| 3 | Moyenne | Signature HMAC facultative si `CINETPAY_SECRET_KEY` est absente | `cinetpay-webhook` | **Corrigé** (refus 503 en production) |
| 4 | Moyenne | Aucun rôle appliqué à la navigation ni aux actions | `tenantContext` | **Corrigé** (matrice + garde-fou SQL) |
| 5 | Moyenne | Historique sans ancien statut ni motif | `001_init.sql:86-97` | **Corrigé** : `previous_status` et motif transporté puis journalisé (`005`) |
| 6 | Faible | Documentation : 16 politiques annoncées pour 13 réelles | `CHANGELOG.md` | **Corrigé** |
| 7 | Faible | Audit de phase 0 présenté comme l'état courant | `docs/AUDIT.md` | **Archivé** |
| 8 | Faible | Aucun contrôle automatique avant fusion | `.github/` absent | **Corrigé** |

Les sept défauts constatés sont corrigés. Le **motif** d'une transition est
transporté par `orders.status_reason`, recopié dans l'historique par le
déclencheur puis effacé : l'écran d'annulation le propose, et le palier 2 a
ajouté le motif obligatoire du tarif dérogatoire et du remboursement.

La **recette sur un projet Supabase réel** (provisionnement, Edge Functions,
paiement de bout en bout) n'a pas pu être faite : aucun identifiant dans
l'environnement de développement. En revanche, le schéma, les 13 politiques
RLS, les 5 déclencheurs et les 11 règles de rôle ont été **réellement exécutés**
sur PostgreSQL 16.2 (voir §6) — ce n'est plus une simple analyse syntaxique.

---

## 6. Vérifications automatisées

| Contrôle | Commande | Couverture |
| --- | --- | --- |
| Types | `npm run typecheck` | `src/` (les scripts `.mjs` ne sont pas typés) |
| Style | `npm run lint` | `src/`, tests, scripts `.mjs`, configuration |
| Tests | `npm test` | 227 tests : QR, synchronisation, rôles, caisse, soldes, retard, clients, stock, dépenses, tableau de bord, abonnement, langue, création de commande, isolation statique, configuration, provisionnement |
| Build | `npm run build` | compilation TypeScript + PWA (précache 81 fichiers, 1 369 KiB) |
| SQL réel | `npm run sql:verify` | migrations `001`→`007`, jeu de démonstration, 123 contrôles (isolation, rôles, verrou optimiste, guichet unique, catalogue, caisse, attribution, réclamations, remboursements, clients, stock, dépenses, abonnement, multi-boutiques, supervision, support) sur un PostgreSQL 16 jetable |
| Intégration continue | GitHub Actions | deux jobs (application + SQL réel) sur chaque PR et sur `main` |

`sql:verify` crée une base jetable, y applique `supabase/tests/local/00_bootstrap.sql`
(qui recrée les rôles et le schéma `auth` de Supabase), puis rejoue les tests.
Il ne demande ni Supabase ni Docker ; seul `psql` 15+ est nécessaire.

**Ce que ces contrôles ne couvrent pas :** provisionnement d'un vrai projet
Supabase, Edge Functions déployées, webhook CinetPay de bout en bout,
comportement sur tablette Android physique, relecture multi-appareil des
réclamations et des remboursements (seul l'état des commandes est rapatrié).

Les modules des paliers 3 et 4 ont une limite supplémentaire **assumée** : le
stock, les dépenses, l'abonnement, le support et la console de supervision sont
des écrans de bureau, utilisables **en ligne** uniquement. L'historique client
et les commandes, eux, restent consultables hors ligne car ils sont dérivés des
données locales.

---

## 7. Ce qui n'est pas vérifiable dans cet environnement

1. Provisionnement réel d'un projet Supabase (aucun identifiant disponible).
2. Déploiement des Edge Functions et appel réel de l'API CinetPay (aucun compte marchand).
3. Lighthouse (aucun navigateur Chrome/Chromium installable).
4. Installation PWA sur un appareil Android physique.

Les migrations et la sécurité **ne sont plus dans cette liste** : elles sont
exécutées à chaque intégration continue sur PostgreSQL 16 (§6).
