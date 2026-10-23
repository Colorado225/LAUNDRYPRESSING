# Audit courant — Pressing Pro

**Date :** 23 octobre 2026
**Révision auditée :** `main` à `23551c7` (fusion de la PR #1)
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
| Fichiers TypeScript / TSX dans `src/` | 39 (dont 6 de test) |
| Lignes de code applicatif | 5 697 |
| Tables PostgreSQL | 6 |
| Politiques RLS | 13 (12 dans `001_init.sql`, 1 dans `002_payments.sql`) |
| Fonctions SQL | 4 (`current_tenant_id`, `current_tenant_role`, `update_updated_at_column`, `log_order_status_change`) |
| Déclencheurs | 3 (deux sur `orders`, un sur `payment_transactions`) |
| Edge Functions | 2 (`cinetpay-init`, `cinetpay-webhook`) + 3 modules `_shared` |
| Scripts d'installation | 2 (`scripts/setup.mjs`, `scripts/lib/config.mjs`) |
| Fichiers de tests | 7 |
| Tests automatisés | 111 |
| Intégration continue | 1 workflow (ajouté au palier 0) |
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
| `/paiement/retour` | `PaymentReturn.tsx` — retour CinetPay, lecture seule | différé |
| `/payment/return` | alias redirigé (anciens liens) | — |

### 2.2 Données locales et synchronisation

| Fichier | Rôle |
| --- | --- |
| `src/db/localDb.ts` | schéma Dexie : `orders`, `orderItems`, `pendingPayments` (version 2) |
| `src/db/ordersRepository.ts` | CRUD local, mapping vers les lignes Supabase |
| `src/db/hooks.ts` | `useLocalOrders`, `useCreateOrder`, `useUpdateOrderStatus` |
| `src/sync/syncEngine.ts` | envoi idempotent (`upsert` sur `id`), verrou `runId`, reprise |
| `src/stores/syncStore.ts` | état de synchronisation (Zustand) |

### 2.3 Sécurité et multi-tenant

| Fichier | Rôle |
| --- | --- |
| `supabase/migrations/001_init.sql` | 5 tables, 12 politiques RLS, 4 fonctions, clés composites |
| `supabase/migrations/002_payments.sql` | `payment_transactions`, index, 1 politique de lecture |
| `supabase/tests/isolation.sql` | rejoue PostgREST (`request.jwt.claims`) et exige `42501` |
| `src/lib/tenantContext.ts` | pressing courant (Zustand + persistance) |
| `src/components/AuthGate.tsx` | restauration de session, mode hors ligne |
| `src/services/authService.ts` | connexion, déconnexion, messages d'erreur en français |

### 2.4 Paiement

| Fichier | Rôle |
| --- | --- |
| `supabase/functions/cinetpay-init/index.ts` | initiation : montant relu en base, montant multiple de 5 |
| `supabase/functions/cinetpay-webhook/index.ts` | notification : HMAC si configuré, **toujours** reconfirmée auprès de CinetPay |
| `supabase/functions/_shared/cinetpay.ts` | client HTTP, signature, vérification, arrondi |
| `src/services/paymentService.ts` | appel de la fonction, redirection, lecture du statut |

### 2.5 Outillage

| Fichier | Rôle |
| --- | --- |
| `scripts/setup.mjs` | provisionnement complet depuis `.env` (6 étapes, idempotent) |
| `scripts/lib/config.mjs` | lecture et validation pure du `.env` |
| `.github/workflows/ci.yml` | `npm ci`, `typecheck`, `lint`, `test`, `build` |
| `vitest.config.ts` | tests `src/` **et** `scripts/` |

---

## 3. Code mort

Analyse de reachability depuis `src/main.tsx`, imports statiques **et** différés
(`React.lazy`) inclus :

- 32 fichiers atteignables ;
- 6 fichiers de test (exécutés par Vitest, non importés) ;
- 1 fichier de déclarations de types (`src/vite-env.d.ts`).

**Aucun composant, service ou utilitaire orphelin.** Les seuls fichiers non
atteignables sont les tests et les déclarations, ce qui est attendu.

---

## 4. Ce qui manque par rapport au modèle cible

| Domaine | État | Palier prévu |
| --- | --- | --- |
| Catalogue (articles, prestations, prix) | Absent — prix saisi librement | Palier 2 |
| Encaissement espèces, acomptes, solde dû | Absent — `cash` n'est qu'un libellé, jamais enregistré | Palier 2 |
| Reçus imprimables, clôture de caisse | Absent | Palier 2 |
| Workflow complet (tri, séchage, contrôle qualité) | Partiel — 6 statuts, sans date de livraison ni motif | Palier 2 |
| Clients (fiche, historique) | Absent — nom et téléphone sont recopiés sur chaque commande | Palier 3 |
| Stocks, fournisseurs, dépenses | Absent | Palier 3 |
| Tableau de bord propriétaire | Absent | Palier 3 |
| Abonnement, multi-boutiques | Absent | Palier 4 |
| Navigation et actions par rôle | Absent — rôle stocké mais non exploité | Palier 1 |
| Verrou optimiste sur les commandes | Absent — `upsert` sans `version` | Palier 1 |
| Journal d'audit des actions sensibles | Absent | Palier 1 |
| Intégration continue | **Ajoutée** au palier 0 | Fait |

---

## 5. Défauts et risques constatés

| # | Gravité | Constat | Référence | Traitement |
| --- | --- | --- | --- | --- |
| 1 | **Élevée** | Double paiement possible : chaque appel d'initiation crée un `transaction_id` neuf ; la garde `already_paid` n'agit qu'après encaissement | `cinetpay-init/index.ts:116` | Palier 1 |
| 2 | **Élevée** | Écrasement silencieux entre deux tablettes : `upsert` sans comparaison de version | `syncEngine.ts:98` | Palier 1 |
| 3 | Moyenne | Signature HMAC facultative si `CINETPAY_SECRET_KEY` est absente | `cinetpay-webhook/index.ts:70` | Palier 1 |
| 4 | Moyenne | Aucun rôle appliqué à la navigation ni aux actions | `tenantContext.ts:22` | Palier 1 |
| 5 | Moyenne | Historique sans ancien statut ni motif | `001_init.sql:86-97` | Palier 1 |
| 6 | Faible | Documentation : 16 politiques annoncées pour 13 réelles | `CHANGELOG.md` | **Corrigé** |
| 7 | Faible | Audit de phase 0 présenté comme l'état courant | `docs/AUDIT.md` | **Archivé** |
| 8 | Faible | Aucun contrôle automatique avant fusion | `.github/` absent | **Corrigé** |

Aucun défaut bloquant n'a été trouvé dans le code applicatif : `typecheck`,
`lint`, `test` et `build` passent, et l'analyse d'imports ne révèle aucun code
mort.

---

## 6. Vérifications automatisées

| Contrôle | Commande | Couverture |
| --- | --- | --- |
| Types | `npm run typecheck` | `src/` (les scripts `.mjs` ne sont pas typés) |
| Style | `npm run lint` | `src/`, tests, scripts `.mjs`, configuration |
| Tests | `npm test` | 111 tests : QR, synchronisation, création de commande, isolation, configuration, provisionnement |
| Build | `npm run build` | compilation TypeScript + PWA (précache 39 fichiers) |
| Intégration continue | GitHub Actions | les quatre contrôles sur chaque PR et sur `main` |

**Ce que ces contrôles ne couvrent pas :** exécution réelle des migrations,
RLS sur une base vivante, webhook de bout en bout, comportement sur tablette
Android physique.

---

## 7. Ce qui n'est pas vérifiable dans cet environnement

1. Provisionnement réel d'un projet Supabase (aucun identifiant disponible).
2. Paiement CinetPay réel (aucun compte marchand).
3. Lighthouse (aucun navigateur Chrome/Chromium installable).
4. Installation PWA sur un appareil Android physique.
