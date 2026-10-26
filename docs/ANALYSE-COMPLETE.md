# Analyse complète du projet — Pressing Pro

**Date :** 26 octobre 2026
**Branche analysée :** `arena/d6937c32-laundrypressing` (base `9a2f5d3` de `main`)
**Méthode :** lecture du code et de la documentation, mesures automatisées
(comptage, recherche de motifs), exécution réelle de la chaîne qualité
(`typecheck`, `lint`, `test`, `build`, `npm audit`) dans l'environnement.

> Ce document **complète** [`AUDIT-COURANT.md`](AUDIT-COURANT.md) (état vérifié
> de la révision précédente) sans le remplacer. Deux constats de la présente
> analyse ont été corrigés dans la même révision — voir §10.1 et §10.2.

---

## 1. Vue d'ensemble

**Pressing Pro** est un SaaS multi-tenant de gestion de pressing, conçu pour
le marché ivoirien (Abidjan) : PWA installable ciblant téléphones et tablettes
Android, interface entièrement en français, fonctionnement **offline-first**
pensé pour les connexions intermittentes, encaissement espèces et Mobile
Money via CinetPay.

Le produit a dépassé le stade MVP initial (commandes + QR + offline +
paiement) pour devenir un petit ERP métier : atelier, caisse, clients, stock,
dépenses, rapports, abonnements, audit et console de supervision plateforme.
Le catalogue tarifaire et les modèles commerciaux (au kilo / forfaits) ont été
**retirés** par la migration 020 : les lignes de commande sont désormais
saisies librement (libellé, quantité, prix unitaire).

### Chiffres clés (mesurés)

| Indicateur | Valeur |
|---|---|
| Fichiers du dépôt (hors `.git`, `node_modules`) | 275 |
| Code applicatif `src/` (hors tests) | ≈ 26 600 lignes (105 `.ts`, 66 `.tsx`) |
| Tests TypeScript | ≈ 11 100 lignes, 62 fichiers, **663 tests** |
| Migrations SQL | 26 fichiers, ≈ 7 850 lignes |
| Tests SQL (PostgreSQL) | ≈ 6 740 lignes, 28 fichiers |
| Edge Functions (Deno) | ≈ 1 030 lignes, 2 fonctions + 3 modules partagés |
| Scripts d'exploitation | ≈ 2 700 lignes (+ leurs tests) |
| Documentation | 16 fichiers Markdown, ≈ 4 460 lignes |
| Historique Git | **1 seul commit** (`9a2f5d3`) : l'historique fin est perdu, le `CHANGELOG.md` tient lieu de journal |

Ratio tests / code applicatif ≈ **0,55** en incluant les tests SQL — niveau
élevé pour un projet de cette taille.

---

## 2. Stack technique

| Couche | Choix | Remarque |
|---|---|---|
| UI | React 19.2, TypeScript 6 (strict renforcé), Tailwind CSS 4 | `noUnusedLocals`, `noPropertyAccessFromIndexSignature`, etc. |
| Build / PWA | Vite 8, `vite-plugin-pwa` 2 (Workbox, `autoUpdate`) | Manifeste complet : icônes PNG 192/512 + maskable, raccourcis Android |
| Routage | React Router 7, pages en `React.lazy` | 22 pages, ~25 routes |
| État | Zustand 5 (3 stores : tenant, sync, abonnement via contextes) | Usage ciblé, pas d'état global tentaculaire |
| Données locales | Dexie 4 / IndexedDB, schéma versionné v1→v15 | 12 tables locales |
| Validation | Zod 4 (`src/schemas/order.ts`) | Schémas commande, lignes, téléphone CI |
| Backend | Supabase : Auth, PostgreSQL + RLS, Edge Functions Deno | `@supabase/supabase-js` 2.118 épinglé |
| Paiement | CinetPay (Wave, Orange Money, MTN MoMo, Moov Money) | Init + webhook côté Edge, jamais côté client |
| QR | `qrcode` (génération), `html5-qrcode` (scan caméra) | Le scan explique le gros chunk Atelier |
| Divers | `framer-motion` (3 écrans), `lucide-react` (41 fichiers), `react-hot-toast` (22 fichiers) | — |
| Tests | Vitest 5 + jsdom + `fake-indexeddb` ; tests SQL rejoués sur PostgreSQL 16 | CI GitHub Actions à 2 jobs |
| Déploiement | Vercel (`vercel.json`, SPA rewrite), Supabase hébergé | `main` seule déploie |

Dépendances directes : 16 runtime + 15 dev. `npm audit` : **0 vulnérabilité**
(26/10/2026). Aucun `any`, `@ts-ignore` ou `console.*` dans `src/` hors tests ;
aucun `TODO/FIXME` réel.

---

## 3. Architecture

### 3.1 Frontend (`src/`)

```
main.tsx → App.tsx → AuthGate → TenantOnboardingGate → AppLayout → pages (lazy)
```

| Dossier | Rôle |
|---|---|
| `pages/` | 22 écrans métier (voir §4) |
| `components/` | 17 composants métier + 5 primitives UI (`ui/`) |
| `services/` | 21 services d'accès métier/Supabase (≈ 4 330 lignes) |
| `db/` | Dexie (`localDb.ts`), repositories (commandes, caisse, réclamations, notifications), hooks, maintenance |
| `sync/` | Moteur de synchronisation offline-first (834 lignes) |
| `lib/` | 24 modules de règles pures : permissions, tarification de ligne, facturation, impression, reporting, formatage, contexte tenant… |
| `schemas/`, `constants/`, `stores/`, `hooks/`, `types/` | Validation Zod, référentiels (statuts, vêtements), stores Zustand, bouton retour Android, types base (1 225 lignes) |

Séparation nette et respectée : les règles pures vivent dans `lib/` (testées
sans DOM), les accès données dans `services/`/`db/`, l'affichage dans
`pages/`/`components/`. Les pages sont les fichiers les plus volumineux
(`Stock.tsx` 1 170 lignes, `Login.tsx` 1 098, `Parametres.tsx` 933) — voir §10.4.

### 3.2 Offline-first et synchronisation (`src/sync/syncEngine.ts`)

C'est le cœur technique du produit. Principes, tous vérifiables dans le code :

1. **Écriture locale d'abord** : la commande naît dans IndexedDB avec un UUID
   client, puis est poussée (`syncOrderNow` immédiat + boucle de fond 60 s,
   événements `online`/`visibilitychange`).
2. **Idempotence** : insert initial par UUID ; un doublon `23505` signifie
   « déjà reçu », on relit la version serveur au lieu d'échouer.
3. **Verrou optimiste** : les mises à jour exigent `version = serverVersion` ;
   0 ligne touchée ⇒ **conflit** marqué, arbitrage humain explicite
   (`ConflictBanner`, `orderConflictService`), jamais d'écrasement silencieux.
4. **Ordre des files** : commandes → encaissements espèces → réclamations →
   notifications « client prévenu » (les paiements exigent la commande côté
   serveur). Un échec sur une ligne ne bloque pas les autres ; l'erreur est
   mémorisée en français sur la ligne.
5. **Lecture descendante prudente** : rapatrie les états modifiés ailleurs
   (paiement Mobile Money, autre tablette) sans jamais toucher une commande
   ayant du travail local en attente.
6. **Traçabilité** : journal d'envoi et « sonde » de poste (`client_sync_events`,
   migration 026) pour diagnostiquer les tablettes en production.

### 3.3 Backend Supabase

- **26 migrations** numérotées, rejouables de bout en bout (`sql-verify.sh`)
  sur un PostgreSQL jetable grâce à un bootstrap qui simule l'environnement
  Supabase (`auth.uid()`, rôles) — testé en CI sur PostgreSQL 16 réel.
- **41 tables créées** au fil des migrations, dont **17 supprimées** par la
  migration 020 (catalogue et modèles commerciaux) : il reste ≈ 24 tables
  actives (tenants, tenant_users, orders, order_items, historique de statuts,
  transactions, remboursements, sessions de caisse, clients, fournisseurs,
  stock et mouvements, dépenses, plans, abonnements, admins plateforme,
  support, audit, notifications, services/activités tenant, événements de sync…).
- **76 politiques RLS**, RLS activée sur les tables, **~50 déclencheurs** et
  **88 mentions `security definer`** : la logique sensible (garde des prix de
  lignes, transitions de statut, clôture de caisse, remboursements,
  rattachement client automatique, audit générique, fonctions `platform_*`)
  vit en base, pas dans le navigateur.
- **Contrat client ↔ serveur explicite** : par ex. `guard_order_item_price`
  exige un motif ≥ 10 caractères pour une ligne libre ; le client génère ce
  motif (`src/lib/orderPricing.ts`) et bloque en amont avec le même message.

### 3.4 Paiements CinetPay (Edge Functions)

- `cinetpay-init` (352 lignes) : crée la transaction, journalise, renvoie
  l'URL de paiement. `cinetpay-webhook` (262 lignes) : reçoit la notification.
- Webhook défensif, vérifié à la lecture : signature **HMAC `x-token`**
  obligatoire en production (refus `503` si `CINETPAY_SECRET_KEY` absent,
  tolérance limitée aux modes dev/test), **reconfirmation systématique** du
  statut auprès de l'API CinetPay (une notification forgée ne suffit pas),
  finalisation atomique en base (`finalize_cinetpay_payment`, migration 012),
  réponses calibrées pour la politique de relance de CinetPay (200 si
  transaction inconnue, 503 si vérification indisponible).
- Un **simulateur local** (`scripts/cinetpay-simule.mjs`) permet de jouer le
  parcours sans compte marchand — mais le paiement réel de bout en bout reste
  non vérifié (§10.5).

---

## 4. Périmètre fonctionnel

| Module | Route(s) | Contenu |
|---|---|---|
| Commandes | `/commandes`, `/nouvelle`, `/:orderId` | CRUD, lignes libres, échéance, attribution, mesures au poids, annulation motivée, suppression encadrée |
| Atelier | `/atelier` | File de traitement, scan QR caméra, avancement par statut |
| Caisse | `/caisse` | Sessions, espèces, acomptes, remboursements, clôture |
| Documents | `/:orderId/recu`, `/facture` | Reçu 80 mm, étiquette QR, facture A4, partage WhatsApp/impression (nouveau) |
| Clients | `/clients` | Fiches CRUD complet, suggestions au comptoir, normalisation téléphone CI |
| Stock | `/stock` | Articles, fournisseurs, mouvements, imputation des consommables aux lignes, coûts figés |
| Dépenses | `/depenses` | CRUD, pagination serveur par curseur |
| Pilotage | `/tableau-de-bord`, `/rapports` | Trésorerie, marges, comparaison de périodes, charge par employé, exports CSV |
| Administration | `/parametres`, `/audit`, `/abonnement`, `/support` | Équipe et rôles, journal d'audit, état d'abonnement, demandes de support |
| Plateforme | `/supervision` | Console opérateur SaaS : pressings, abonnements, membres, support (réservée `is_platform_admin()`) |
| Transverses | `/bienvenue`, `/prestations`, `/offline`, `/reinitialisation`, `/paiement/retour` | Onboarding des prestations tenant, repli hors ligne, reset mot de passe, retour CinetPay |

**Workflow commande** : 9 statuts (`received → sorting → washing → drying →
ironing → quality_check → ready → delivered`, + `cancelled`), machine à états
doublée côté serveur (rang de statut, motifs), historique horodaté.

**Rôles** (`owner`, `receptionist`, `artisan`) : matrice de 19 capacités dans
`src/lib/permissions.ts`, alignée sur la RLS et les déclencheurs. Décisions
métier notables : l'artisan ne voit **pas les montants** ; seul le
propriétaire supprime, gère l'équipe et voit trésorerie/audit ; la supervision
plateforme est un axe séparé (admin unique, migration 011).

---

## 5. Sécurité

| Sujet | État constaté |
|---|---|
| Secrets dans le code | Aucun. Scan du dépôt : seules des mentions documentaires et des clés fictives de test. `.env` absent du dépôt, `.gitignore` correct |
| Clé `service_role` | Jamais côté client ; garde-fous automatisés dans les scripts de config + test « bundle » dédié |
| Isolation multi-tenant | RLS + `tenant_id` partout ; le choix d'atelier dans l'UI n'est explicitement **pas** une frontière de sécurité ; tests SQL d'isolation et de rôles dédiés |
| Autorisation fine | RLS (insertions réservées) + déclencheurs de garde (un artisan ne peut modifier ni montants ni coordonnées, même via l'API) |
| Webhook paiement | HMAC + reconfirmation API + finalisation atomique (§3.4) |
| Injection HTML | React échappe partout ; **une exception** introduite par le dernier commit (générateur de reçu HTML par interpolation) — corrigée pendant cette analyse (§10.2) |
| Audit | Journal générique par déclencheur sur les tables sensibles, consultable par le propriétaire |
| Configuration | `env.ts` distingue `ok / demo / incomplete` sans écran blanc ; les URLs affichées sont masquées |
| Dépendances | `npm audit` : 0 vulnérabilité ; versions épinglées ou bornées, `npm ci` en CI |

Point de vigilance structurel : la base distante `Pressing_Pro` est alignée
jusqu'à la migration **025** selon l'audit du 26/10 ; la migration **026**
(`client_sync_events`, présente dans le dépôt) doit être confirmée comme
appliquée avant de déployer un frontend qui journalise les envois.

---

## 6. Qualité et tests — résultats exécutés le 26/10/2026

| Contrôle | Avant correction (§10.1) | Après correction |
|---|---|---|
| `npm run typecheck` | ❌ 2 erreurs (`OrderDetail.tsx:438,450`) | ✅ |
| `npm run lint` | ✅ | ✅ |
| `npm test` | ✅ 656 tests / 61 fichiers | ✅ **663 tests / 62 fichiers** |
| `npm run build` | ❌ (bloqué par `tsc`) | ✅ (avertissement chunk > 500 kB) |
| `npm audit` | ✅ 0 vulnérabilité | ✅ |
| `npm run sql:verify` | Non exécuté ici (`psql` absent de l'environnement) — rejoué par la CI sur PostgreSQL 16 | idem |

Caractéristiques de la suite : tests de règles pures, tests de composants
(jsdom), tests de repositories sur `fake-indexeddb`, tests des scripts
d'exploitation, tests SQL réels (RLS, rôles, verrou optimiste, recette
deux pressings / trois comptes). Durée locale ≈ 50 s, dont ~70 % de création
d'environnements jsdom (piste `pool: 'vmThreads'` signalée par Vitest).

Limites connues et assumées (déjà documentées dans `BACKLOG.md`) : pas de
mesure de couverture (`@vitest/coverage-v8` absent), pas de `deno check` sur
les Edge Functions, pas de Lighthouse automatisé, pas de test E2E navigateur.

---

## 7. Performance et PWA

Build de production mesuré (après correction) :

| Chunk | Minifié | gzip | Commentaire |
|---|---|---|---|
| `index` (principal) | 615 kB | 190 kB | ⚠ dépasse le seuil Vite de 500 kB |
| `Atelier` | 389 kB | 114 kB | `html5-qrcode`, chargé à la demande — acceptable |
| `tenantContext` | 231 kB | 61 kB | Contient vraisemblablement Supabase JS ; dans le chemin initial |
| `localDb` | 101 kB | 32 kB | Dexie + repositories |
| 20 autres pages | 6–78 kB | 2–19 kB | Découpage par route efficace |

Précache PWA : 69 entrées, ≈ 1,8 Mio. Les appels Supabase sont en
`NetworkOnly` (la vérité hors ligne est Dexie, pas le cache HTTP) — choix
correct. Sur réseau mobile ivoirien, le premier chargement (~190 kB gzip +
dépendances partagées) reste le point à optimiser (§11).

---

## 8. Documentation et exploitation

- **Documentation abondante mais stratifiée** : `README` et `AUDIT-COURANT`
  font foi ; `CHANGELOG` (1 048 lignes), `MAJ.md`, `AUDIT.md`,
  `RESTRUCTURATION.md` et plusieurs rapports sont de l'**historique** qui
  décrit encore l'ancien catalogue. Les en-têtes le signalent, mais le risque
  de lire un document périmé est réel (§10.3).
- **Outillage d'exploitation complet** : `setup.mjs` (provisionnement avec
  mode `--dry-run`), `db.mjs` (état/push/vérification des migrations),
  `recette.mjs` (7 contrôles sur le projet déployé), `deploy-fonctions.mjs`,
  simulateur CinetPay — tous testés unitairement, fait rare.
- **CI** : deux jobs (qualité applicative ; SQL réel sur PostgreSQL 16),
  `npm ci`, annulation des runs obsolètes, `permissions: contents: read`.
- **Déploiement** : Vercel sur `main`, Supabase hébergé (`eu-west-1`).
  Procédures écrites (`DEPLOIEMENT-FONCTIONS.md`, `RECETTE-SUPABASE.md`).

---

## 9. Points forts

1. **Offline-first abouti** : idempotence, verrou optimiste, conflits
   arbitrés par l'humain, files ordonnées, erreurs en français sur la ligne.
2. **Sécurité en profondeur réelle** : RLS + déclencheurs de garde + fonctions
   `security definer` contrôlées par rôle ; l'UI ne fait que masquer.
3. **Discipline de test inhabituelle** : 663 tests TS + suite SQL rejouée sur
   PostgreSQL réel en CI, y compris pour les scripts d'exploitation.
4. **Code propre et commenté en français** : 0 `any`, 0 `console`, 0 TODO ;
   les commentaires expliquent les *pourquoi* métier et terrain.
5. **Adaptation au contexte** : numéros CI normalisés, Mobile Money local,
   bouton retour Android, impression 80 mm/A4, messages d'erreur exploitables
   au comptoir, mode démo sans backend.
6. **Paiement traité sérieusement** : webhook signé + reconfirmé, écriture
   atomique, simulateur pour développer sans compte marchand.

---

## 10. Risques, dette et constats

### 10.1 🔴 Build cassé sur `main` — **corrigé pendant cette analyse**

Le dernier commit (« génération de reçus WhatsApp + impression ») a introduit
`receiptService.ts` et son panneau dans `OrderDetail.tsx` en passant
`tenantName: string | null` à des fonctions attendant `string` :
`npm run typecheck` et donc `npm run build` échouaient (2 erreurs TS2345),
contrairement à l'état « réussi » consigné dans `AUDIT-COURANT.md` (qui
décrit la révision précédente). Les tests passaient car Vitest ne vérifie pas
les types. **Correction** : `tenantName ?? 'Pressing'` aux deux appels,
conformément à la convention déjà utilisée dans `Receipt.tsx`,
`Facture.tsx` et `QrCodeDisplay.tsx`. Chaîne complète revérifiée verte (§6).
*Leçon : rendre la CI obligatoire (protection de branche) — elle aurait
bloqué ce commit.*

### 10.2 🟠 Injection HTML dans le reçu imprimable — **corrigée pendant cette analyse**

`generatePrintableReceipt` interpolait sans échappement nom du client,
téléphone, libellés d'articles, QR et nom du pressing dans un HTML écrit par
`document.write` (fenêtre de même origine avec `opener`) : un libellé
contenant du HTML cassait le reçu, voire exécutait du script. Tous les
autres documents passent par React (échappement par défaut). **Correction** :
fonction `escapeHtml` appliquée aux cinq valeurs saisies + 7 tests ajoutés
(`src/test/receiptService.test.ts`) — le nouveau service n'en avait aucun,
en rupture avec la discipline du reste du code.

### 10.3 🟡 Documentation historique volumineuse

Sur 16 documents, la majorité décrit des états superseded (catalogue
supprimé, anciens paliers). Les avertissements en en-tête limitent le risque,
mais un archivage explicite (`docs/historique/`) réduirait les erreurs de
lecture. De même, l'historique Git tient en **un seul commit** : toute
l'archéologie repose sur `CHANGELOG.md`.

### 10.4 🟡 Gros fichiers et vestiges post-migration 020

- Pages > 900 lignes (`Stock`, `Login`, `Parametres`) : candidates à
  l'extraction de sous-composants/hooks, sans urgence fonctionnelle.
- Vestiges assumés du catalogue côté client (`catalogPricing`,
  `laundryModelPricing`, tables Dexie `catalogEntries`/`laundryModels`,
  snapshots dans les types) : nécessaires à la lecture des anciennes données
  locales, mais ils entretiennent une double vérité tant qu'aucune purge
  planifiée n'est datée.
- Trois mécanismes de « reçu » coexistent désormais (`Receipt.tsx` +
  `impression.ts`, étiquette `QrCodeDisplay`, nouveau `receiptService`) :
  convergence à planifier pour éviter les divergences de contenu.

### 10.5 🟡 Non vérifié en conditions réelles (déjà connu, toujours vrai)

Paiement CinetPay de bout en bout avec compte marchand, Edge Functions
déployées avec leurs secrets, comportement sur tablette physique (scan,
impression, coupures réseau longues), migration 020 sur une base contenant
des données commerciales (destructive : sauvegarde obligatoire), application
de la migration 026 sur `Pressing_Pro`. La recette locale ne couvre aucun de
ces points — la procédure manuelle existe (`RECETTE-SUPABASE.md`).

### 10.6 ⚪ Divers

- Chunk principal de 615 kB (§7) ; `framer-motion` embarqué pour 3 écrans.
- Pas de `LICENSE`, `version: 0.0.0`, `metadata.json` orphelin (artefact
  d'un générateur) à la racine.
- Pas de pagination serveur des commandes (lecture Dexie paginée au rendu) :
  suffisant aujourd'hui, à reconsidérer au-delà de quelques milliers de
  commandes par appareil ; rapports calculés depuis IndexedDB (visibilité
  limitée aux données synchronisées sur l'appareil).

---

## 11. Recommandations priorisées

| Priorité | Action | Effort |
|---|---|---|
| **P0** | Protéger `main` : CI (types + lint + tests + build + SQL) obligatoire avant fusion — aurait empêché §10.1 | Faible |
| **P0** | Confirmer l'application des migrations **020** (après sauvegarde) et **026** sur le projet Supabase de production ; aligner frontend déployé et schéma | Faible |
| **P0** | Recette CinetPay réelle : secrets Edge, paiement test de bout en bout, webhook, remboursement espèces | Moyen |
| **P1** | Réduire le chunk principal : analyser le graphe (`tenantContext` 231 kB), différer `framer-motion`, viser < 500 kB pour le premier chargement mobile | Moyen |
| **P1** | Converger les trois mécanismes de reçus vers `impression.ts` (React + `@page`) et supprimer le `document.write` | Moyen |
| **P1** | Archiver la documentation superseded dans `docs/historique/` ; garder README + AUDIT-COURANT + guides d'exploitation en première ligne | Faible |
| **P2** | Mesure de couverture Vitest avec seuil en CI ; `deno check` des Edge Functions ; Lighthouse sur l'URL déployée | Faible-Moyen |
| **P2** | Plan de purge des vestiges catalogue (Dexie v16 sans tables mortes, retrait des snapshots) une fois le parc de tablettes migré | Moyen |
| **P2** | Découper `Stock.tsx` / `Login.tsx` / `Parametres.tsx` ; ajouter `LICENSE` et une vraie version | Faible |

---

## 12. Verdict

Projet **mature et sain** pour un produit métier de cette ampleur : socle
offline-first rigoureux, sécurité serveur réelle, couverture de test
supérieure à la moyenne, documentation d'exploitation exploitable. L'état
livré sur `main` comportait une régression bloquante mais triviale (build
cassé par le dernier commit, sans protection de branche pour l'arrêter),
corrigée et re-testée pendant cette analyse avec la faille d'injection
associée. Les risques restants sont **opérationnels** (recette réelle
CinetPay/Supabase/tablette, application des migrations 020/026) plus que
logiciels. Priorité immédiate : verrouiller la CI sur `main`, puis exécuter
la recette de production déjà écrite.
