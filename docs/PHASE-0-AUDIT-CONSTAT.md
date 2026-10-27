# Phase 0 — Audit du dépôt LAUNDRYPRESSING (état constaté)

**Date :** 27 octobre 2026
**Commit audité :** `9a2f5d3` — *feat: ajouter fonction de génération de reçus (WhatsApp + impression)*
**Branche :** `arena/ae1d1223-laundrypressing` (remote `origin` = `Colorado225/LAUNDRYPRESSING`)
**Référentiel :** `RESTRUCTURATION.md` (prompt master, phases 0 → 6)

> Ce rapport **remplace** `docs/AUDIT.md`, qui décrivait le point de départ (`ae2903f`) avant la Phase 1.
> Il constate l'état **aujourd'hui**, et le compare au périmètre imposé par `RESTRUCTURATION.md`.

---

## 0. Synthèse exécutive

**Le projet n'est plus au stade de template : les 6 phases ont été exécutées**, puis largement
dépassées. Le dépôt contient un ERP de pressing complet (`src/` : **35 940 lignes** TypeScript,
**164 fichiers**, **61 fichiers de test / 656 tests**) adossé à **26 migrations SQL** (7 845 lignes).

| Constat | Verdict |
|---|---|
| Les 4 modules imposés (commandes, QR, offline, Mobile Money) | ✅ Implémentés et testés |
| Multi-tenant + RLS | ✅ Corrigé et durci depuis `001_init.sql` (fonctions `current_tenant_id()`, FK composites) |
| Hors périmètre MVP | ❌ **Massivement dépassé** : caisse, stock, dépenses, rapports, clients, abonnement, supervision, support, audit, facturation, réception, réclamations, mesures |
| Chaîne de vérification | ⚠️ **Rouge** : `typecheck` et `build` échouent (2 erreurs), `lint` échoue (478 erreurs) |
| Documentation d'audit | ⚠️ **Inexacte** : `AUDIT-COURANT.md` déclare typecheck/lint/build « Réussi » |

**Verdict global :** la dette n'est plus technique — elle est de **périmètre** et de **fiabilité de la vérification**.
Le travail de Phase 0 consiste donc moins à planifier une construction qu'à **recadrer** et **réparer la CI**.

---

## 1. Méthode

1. Inventaire complet de l'arborescence (`find`, hors `node_modules`).
2. Lecture des fichiers de config (`package.json`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js`) et des audits existants.
3. Lecture des modules pivots : `src/db/localDb.ts`, `src/sync/syncEngine.ts`, `src/services/receiptService.ts`, `supabase/migrations/001_init.sql`.
4. **Exécution réelle** des 4 contrôles, sans modification du code source :

| Commande | Résultat constaté |
|---|---|
| `npm run typecheck` | ❌ **2 erreurs** (`src/pages/OrderDetail.tsx:438` et `:450`) |
| `npm run build` | ❌ **Échoue** — `build` = `tsc --noEmit && vite build`, bloqué par les mêmes 2 erreurs |
| `npm run lint` | ❌ **478 erreurs** — toutes dans `.vite/deps/*` (cache Vite non ignoré) ; `npx eslint src` est **propre** |
| `npm run test` | ✅ **61 fichiers, 656 tests, 0 échec** (7,6 s) |

---

## 2. Versions réellement installées

| Couche | Technologie | Version déclarée | Cible `RESTRUCTURATION.md` |
|---|---|---|---|
| UI | React / React DOM | `^19.2.4` | ✅ |
| Build | Vite | `^8.0.4` | ✅ |
| Langage | TypeScript | `6.0.3` (épinglé) | ✅ (déviation documentée : `typescript-eslint` ne supporte pas TS 7) |
| CSS | Tailwind CSS 4 + `@tailwindcss/vite` | `^4.2.2` | ✅ |
| Routage | react-router-dom | `^7.14.0` | ✅ |
| Local | dexie / dexie-react-hooks | `4.4.6` / `4.4.0` | ✅ |
| Cloud | @supabase/supabase-js | `2.118.0` | ✅ |
| QR | qrcode / html5-qrcode | `1.5.4` / `2.3.8` | ✅ |
| PWA | vite-plugin-pwa | `2.0.0` | ✅ |
| État | Zustand | `5.0.16` | ✅ |
| Validation | Zod | `4.6.7` | ✅ |
| UI annexe | lucide-react, react-hot-toast, **framer-motion** | `1.11` / `2.6` / `^14.6.0` | ⚠️ framer-motion (explicitement interdit par le cahier des charges) |
| Tests | vitest, jsdom, fake-indexeddb, pg | `5.0.5` etc. | ✅ |

**Interdits respectés :** aucun Firebase, aucun Redux Toolkit, aucune librairie MUI/AntD. ✅

---

## 3. Architecture constatée

```text
src/
├── App.tsx / main.tsx          # Router + AuthGate
├── components/                 # 20 composants + ui/ (button, field, input, label, select)
├── constants/                  # garmentTypes, orders
├── db/                         # localDb (Dexie v1→v15), hooks, ordersRepository,
│                               # cashRepository, issueRepository, notificationRepository, maintenance
├── hooks/                      # useAndroidBackButton
├── lib/                        # env, supabaseClient, tenantContext, permissions, formatters,
│                               # orderPricing, catalogPricing, reporting, facturation, impression…
├── pages/                      # 22 pages (voir § 6)
├── schemas/                    # order.ts (Zod)
├── services/                   # 23 services (qr, payment, receipt, audit, stock, refund, subscription…)
├── stores/                     # syncStore (Zustand)
├── sync/                       # syncEngine.ts (834 l.)
├── test/                       # 60 fichiers de test
└── types/                      # database.ts (1 225 l.)
supabase/
├── migrations/                 # 001 → 026
├── functions/                  # cinetpay-init, cinetpay-webhook, _shared/
├── tests/                      # 24 scripts SQL de contrôle
└── seed.sql
```

### 3.1 Offline-first — conforme et mature

`src/db/localDb.ts` (628 l., **15 versions Dexie**) est nettement au-delà du cahier des charges :

- Index composites `[tenantId+status]`, `[tenantId+synced]`, et **`qrCode` (v2)** — le manque que
  j'avais identifié dans l'analyse du prompt est **déjà corrigé**.
- **Verrou optimiste** : `serverVersion` + `syncConflict` (v3) — la stratégie de résolution de conflit
  absente du prompt est **implémentée** (arbitrage utilisateur via `ConflictBanner.tsx`).
- File de synchronisation par drapeau `synced: 0|1` avec `syncError`, `syncedAt`.
- Tables supplémentaires : `cashPayments`, `orderIssues`, `refunds`, `notifications`, `tenantServices`.

`src/sync/syncEngine.ts` (834 l.) dépasse largement le `syncPendingOrders()` demandé
(synchronisation immédiate `syncOrderNow`, événements de synchronisation client, gestion des conflits).

### 3.2 Modèle serveur — failles du prompt corrigées

| Point du prompt initial | État constaté |
|---|---|
| Sous-requête `(select tenant_id from tenant_users …)` instable | ✅ Remplacée par `public.current_tenant_id()` et `public.current_tenant_role()` |
| Politiques `for all` sans `with check` | ✅ `select`/`insert`/`update`/`delete` séparées, avec `with check` et contrôle de rôle |
| `tenants` modifiable par tout membre | ✅ `update` restreint à `current_tenant_role() = 'owner'` |
| `order_items` non rattaché au tenant de la commande | ✅ Contraintes FK composites `(order_id, tenant_id) references orders(id, tenant_id)` |
| `unique(qr_code)` global | ✅ Isolation par tenant en place |

### 3.3 Fonctionnalités hors périmètre implémentées

Le périmètre strict du prompt est **4 modules**. Le dépôt en contient **au moins 12** :

`Stock.tsx` (1 170 l.), `Parametres.tsx` (933 l.), `Rapports.tsx` (662 l.), `Clients.tsx` (659 l.),
`Supervision.tsx` (534 l.), `Caisse.tsx`, `Depenses.tsx`, `Abonnement.tsx`, `Support.tsx`,
`Audit.tsx`, `Facture.tsx`, `Receipt.tsx`, `Reinitialisation.tsx`, `ServicesPressing.tsx`,
`TableauDeBord.tsx` — ainsi que `cashService`, `stockService`, `expenseService`, `refundService`,
`subscriptionService`, `platformService`, `customerService`, `issueService`, `auditService`.

Les migrations SQL correspondantes : `003_palier1` → `026_client_sync_events` (26 migrations),
dont `020_suppression_tarification_et_laundry_models` (ajout puis retrait de fonctionnalités).

> Le prompt est explicite : « Toute fonctionnalité hors périmètre […] doit être **explicitement ignorée** ».
> La réalité est inverse : le périmètre a été **étendu** palier après palier.

---

## 4. Anomalies constatées (par ordre de gravité)

### P0 — bloquantes

| # | Fichier | Anomalie | Conséquence |
|---|---|---|---|
| 1 | `src/pages/OrderDetail.tsx:438` | `generateReceiptText(order, items, tenantName)` reçoit `string \| null` | `tsc` échoue → **`npm run build` échoue** → aucun déploiement Vercel possible |
| 2 | `src/pages/OrderDetail.tsx:450` | `generatePrintableReceipt(...)` reçoit `string \| null` | idem |

**Cause racine :** `useTenantStore` déclare `tenantName: string | null` alors que `receiptService`
exige `string`. Le garde d'authentification garantit un nom non nul à l'exécution — c'est un
**défaut de typage**, pas un bug fonctionnel. Correctif possible : ternaire
`tenantName ?? 'Pressing'` à l'appel, **ou** resserrer le contrat du store.

**Ces deux erreurs suffisent à faire échouer la chaîne `npm run build` : le projet n'est
actuellement pas déployable dans l'état constaté.**

### P1 — majeures

| # | Sujet | Anomalie |
|---|---|---|
| 3 | `eslint.config.js` | `globalIgnores` ne contient pas `.vite` → **478 erreurs** sur le cache de développement. `npx eslint src` est propre : la configuration est saine, l'ignore est incomplet. |
| 4 | `docs/AUDIT-COURANT.md` § « État des contrôles » | Déclare typecheck / lint / build « Réussi(s) » alors qu'ils échouent. Le document est la référence de périmètre du dépôt : **il ne peut pas être faux**. |
| 5 | `package.json` | `framer-motion@^14.6.0` en dépendance de production — **explicitement interdit** par le cahier des charges (§ Interdictions absolues). |
| 6 | `.vite/` | Dossier de cache **non ignoré par Git** (visible en `git status ?? .vite/`) et non ignoré par ESLint. |
| 7 | Périmètre | 12+ modules au-delà des 4 imposés ; `docs/BACKLOG.md` les décrit comme « hors périmètre » tout en étant **livrés dans `src/`**. |

### P2 — mineures

| # | Sujet | Anomalie |
|---|---|---|
| 8 | `src/pages/Login.tsx` | 1 098 lignes : mélange auth, inscription, démonstration, onboarding. Complexité de maintenance. |
| 9 | `src/types/database.ts` | 1 225 lignes de types générés à la main (risque de dérive avec le schéma). |
| 10 | `eslint.config.js` | `typescript-eslint` recommandé sans *type-aware linting* (`projectService`) : les règles de sûreté de types ne s'appliquent pas. |
| 11 | Dépôt | 3 documents d'audit coexistent (`AUDIT.md`, `AUDIT-COURANT.md`, `ANALYSE-PROJET-WORKFLOW.md`) avec des états contradictoires. |
| 12 | `BACKLOG.md` | « État historique — ne pas utiliser comme référence » : le document est devenu inutilisable comme source de vérité. |
| 13 | Vérification | `sql:verify` non exécutable ici (`psql` absent) ; Lighthouse non automatisé ; `cinetpay-simule` non couvert par une recette réelle. |

---

## 5. Matrice de conformité au périmètre MVP

| Module imposé | État | Détail |
|---|---|---|
| **1. Gestion des commandes** | ✅ Complet | `OrderForm.tsx` (697 l.), `Orders.tsx`, `OrderDetail.tsx`, `order.ts` (Zod), `ordersRepository.ts` (824 l.), empesage / broderie fragile via `specialInstructions` et `garmentTypes` |
| **2. QR Code** | ✅ Complet | `qrService.ts`, `QrCodeDisplay.tsx` (impression 80 mm), `QrScanner.tsx`, `Atelier.tsx` (637 l.) |
| **3. Offline-first** | ✅ Complet | Dexie 15 versions, `syncEngine` 834 l., `OfflineBadge.tsx`, `ConflictBanner.tsx`, `Offline.tsx` |
| **4. Mobile Money CinetPay** | 🟡 Codé, non recetté | `cinetpay-init`, `cinetpay-webhook`, `_shared/cinetpay.ts`, `paymentService.ts`, `PaymentReturn.tsx`, `PaymentButton.tsx` ; **transaction réelle non testée** (secrets absents) |
| Socle (Vite/TS/Tailwind/PWA/Supabase) | ✅ | PWA complète (icônes, shortcuts, runtimeCaching NetworkOnly pour Supabase) |
| Auth + multi-tenant | ✅ | `AuthGate`, `supabaseClient`, `tenantContext`, RLS durcie |
| Qualité FR / FCFA / tablette | ✅ | `lang: 'fr'`, `Intl` en XOF, `useAndroidBackButton`, cibles tactiles |
| **Respect du périmètre** | ❌ | **12+ modules hors périmètre** |
| **Chaîne de vérification** | ❌ | typecheck, build et lint en échec |

---

## 6. Ce qui est conservé tel quel

1. **Tout le socle offline-first** : `src/db/` (15 versions Dexie, verrou optimiste, conflits) — au-dessus du niveau exigé.
2. **Le moteur de synchronisation** `src/sync/syncEngine.ts` + `src/stores/syncStore.ts`.
3. **Les 4 modules MVP** : commandes, QR, offline, paiement — structure et découpage.
4. **Les migrations SQL 001 → 026** et les 24 scripts de contrôle `supabase/tests/`.
5. **La PWA** : `vite.config.ts` (manifeste, icônes, shortcuts, `NetworkOnly` pour Supabase).
6. **La configuration TypeScript stricte** et l'alias `@/*` aligné Vite/TS.
7. **Le design system maison** `src/components/ui/` (5 composants) et les tokens Tailwind 4.
8. **Les 656 tests** et l'infrastructure Vitest (`jsdom`, `fake-indexeddb`).

## 7. Ce qui est refactoré

| # | Élément | Transformation proposée |
|---|---|---|
| 1 | `OrderDetail.tsx:438-450` | Corriger le contrat `tenantName` (typage, pas de comportement) |
| 2 | `eslint.config.js` | Ajouter `.vite`, `dev-dist`, `coverage` au `globalIgnores` ; envisager le *type-aware linting* |
| 3 | `package.json` | Retirer `framer-motion` (interdit), vérifier les usages | 
| 4 | `.gitignore` | Ajouter `.vite/` |
| 5 | `docs/` | Fusionner `AUDIT.md` + `AUDIT-COURANT.md` en **un seul document de référence** ; `BACKLOG.md` recadré sur le périmètre réellement livré |
| 6 | `Login.tsx` (1 098 l.) | Découper inscription / login / démonstration |
| 7 | CI | Faire échouer la CI sur `typecheck` et `lint` (aujourd'hui `build` échoue en local sans que rien ne l'ait signalé) |

## 8. Ce qui est supprimé (si le périmètre strict est maintenu)

**Recommandation : ne rien supprimer sans arbitrage.** Le code est écrit, testé et fonctionnel ;
le supprimer serait une destruction de valeur. Deux options sont présentées au § 10.

---

## 9. Risques identifiés

| Risque | Probabilité | Impact | Parade |
|---|---|---|---|
| Déploiement impossible (build rouge) | **Certaine** | **Critique** | Corriger les 2 erreurs TS (§ 4 P0) |
| Divergence entre la doc d'audit et le code | Élevée | Élevé | Un seul document de référence, vérifié à chaque revue |
| Framer-motion interdit présent en prod | Certaine | Moyen | Retrait + remplacement par transitions CSS |
| Périmètre commercial flou (que vend-on ?) | Élevée | **Élevé** | Trancher § 10 avant toute nouvelle fonctionnalité |
| Paiement CinetPay non recetté en réel | Élevée | **Critique (fraude / non-encaissement)** | Recette sandbox obligatoire avant mise en vente |
| Absence de type-aware lint | Moyenne | Moyen | Activer `projectService` |

---

## 10. Décisions à valider avant toute suite

Le cahier des charges impose 4 modules ; le dépôt en livre **12+**. Il faut trancher :

1. **Périmètre commercial** — Que vend-on réellement ?
   - (a) **MVP strict** : retirer/archiver les 12 modules excédentaires (retour au cahier des charges) ;
   - (b) **Périmètre élargi** : assumer l'ERP complet et **réécrire** `RESTRUCTURATION.md`
     pour qu'il décrive le produit vendu (le document actuel n'est plus le bon contrat).
   - *Recommandation : (b)* — le code existe, il est testé ; le problème est documentaire, pas technique.

2. **Correction du build** — Puis-je appliquer les 2 corrections de typage et la configuration
   ESLint (points P0/P1) ? C'est un correctif de 3 fichiers, sans changement de comportement.

3. **`framer-motion`** — Suppression pure, ou conservation malgré l'interdiction ?

---

## 11. Livrable de la Phase 0

- ✅ Ce rapport (`docs/PHASE-0-AUDIT-CONSTAT.md`)
- ✅ Vérifications exécutées : `typecheck` ❌, `build` ❌, `lint` ❌, `test` ✅
- ✅ Aucun fichier source modifié
- ⏳ Commit `chore: audit initial` — **à créer après votre validation**

---

## ⛔ STOP — Phase 0 terminée

Je m'arrête ici et j'attends votre validation avant toute modification du dépôt.
Merci de répondre aux 3 décisions du § 10.
