# Pressing Pro — SaaS de gestion de pressing (Côte d'Ivoire)

> MVP multi-tenant destiné à être revendu en abonnement à des pressings d'Abidjan.
> Application **strictement en français**, pensée pour des **tablettes Android d'entrée de gamme**
> et **résiliente aux coupures internet**.

**État actuel : palier 4 terminé, conformité MVP vérifiée** (abonnement, multi-boutiques, supervision de
l'éditeur, support). Les phases 1 à 6 et les paliers 0 à 4 de `MAJ.md` sont
livrés : le produit est complet au périmètre de l'audit. La correspondance avec
les douze écrans de la maquette est tenue dans
[`docs/CONFORMITE-MVP.md`](docs/CONFORMITE-MVP.md).

---

## 1. Périmètre du MVP

Le MVP couvre **quatre modules**, et rien d'autre :

| # | Module | Statut |
|---|--------|--------|
| 1 | **Gestion des commandes** (création, listing, statuts, empesage, broderie fragile) | ✅ phase 2 (base locale) |
| 2 | **QR Code** (génération par commande + scan atelier) | ✅ phase 3 |
| 3 | **Offline-first** (création sans internet, synchronisation automatique) | ✅ phase 2 |
| 4 | **Paiement Mobile Money** (CinetPay : Wave, Orange Money, MTN MoMo, Moov) | ✅ phase 4 |
| 5 | **Catalogue et caisse** (prix historisé, acomptes, reçu 80 mm, clôture) | ✅ palier 2 |
| 6 | **Workflow complet** (8 étapes, attribution, livraison promise, réclamations) | ✅ palier 2 |
| 7 | **Clients et historique** (fiche par téléphone, total dépensé, coordonnées) | ✅ palier 3 |
| 8 | **Stocks, fournisseurs et dépenses** (seuils d'alerte, mouvements, dépenses du propriétaire) | ✅ palier 3 |
| 9 | **Tableau de bord propriétaire** (activité, chiffre d'affaires, encours, alertes) | ✅ palier 3 |
| 10 | **Abonnement** (formules, échéance, période de grâce, lecture seule si échu) | ✅ palier 4 |
| 11 | **Multi-boutiques** (sélecteur de boutique, rôle par boutique, en-tête validé) | ✅ palier 4 |
| 12 | **Supervision et support** (console éditeur, demandes des pressings) | ✅ palier 4 |

Hors périmètre, volontairement reportés en V2 : livraison, fidélité, notifications WhatsApp,
statistiques avancées, gestion du personnel, facturation PDF, suivi client public,
export comptable.
Toute suppression liée à ce périmètre est **conservée dans l'historique Git** et tracée dans `docs/AUDIT.md`.

---

## 2. Stack technique

| Couche | Technologie |
|--------|-------------|
| Frontend | React 19 + Vite 8 + TypeScript 6 (strict) + Tailwind CSS v4 |
| État global | Zustand |
| Base locale (offline) | Dexie.js (IndexedDB) — phase 2 |
| Backend / DB | Supabase (PostgreSQL + Auth + RLS) |
| Paiement | CinetPay API v2 via Supabase Edge Functions — phase 4 |
| QR Code | `qrcode` (génération) / `html5-qrcode` (scan) — phase 3 |
| PWA | `vite-plugin-pwa` (Workbox) |
| Validation | Zod — phase 2 |

Contraintes respectées : pas de Firebase, pas de Redux, **aucune librairie UI lourde**
(MUI, AntD, Bootstrap proscrits) — Tailwind + composants maison uniquement.

---

## 3. Démarrage

### Prérequis

- Node.js ≥ 20 (testé avec Node 22.22.3)
- npm ≥ 10
- Un projet Supabase (Cloud) **ou** la CLI Supabase pour un environnement local

### 3.1 Installation en une commande

```bash
git clone https://github.com/Colorado225/LAUNDRYPRESSING.git
cd LAUNDRYPRESSING
npm install
cp .env.example .env
# → renseigner les valeurs dans .env (voir ci-dessous)
npm run setup
```

`npm run setup` fait tout le reste : schéma SQL, RLS, Edge Functions, secrets
CinetPay, pressing et compte propriétaire. Aucune manipulation dans le tableau
de bord Supabase n'est nécessaire au-delà de la création du projet.

> ⚠️ **Le script a besoin d'un accès réseau à Supabase** et télécharge la CLI au
> premier lancement via `npx` (aucun paquet n'est ajouté au projet). Il est
> idempotent : on peut le relancer sans créer de doublon.

### 3.2 Remplir le fichier `.env`

Cinq valeurs sont indispensables :

```env
VITE_SUPABASE_URL=https://<ref>.supabase.co        # Project Settings → API
VITE_SUPABASE_ANON_KEY=<clé anon>                  # Project Settings → API
SUPABASE_ACCESS_TOKEN=sbp_…                        # Account → Access Tokens
SUPABASE_DB_PASSWORD=<mot de passe base>           # Project Settings → Database
SUPABASE_SERVICE_ROLE_KEY=<clé service_role>       # Project Settings → API
```

Fortement recommandées :

```env
APP_URL=https://mon-pressing.vercel.app   # URL publique, sans barre finale
SEED_OWNER_EMAIL=patron@pressing.ci       # compte créé par npm run setup
SEED_OWNER_PASSWORD=<mot de passe ≥ 6 car.>
SEED_TENANT_NAME=Pressing Cocody
```

Sans `CINETPAY_API_KEY`, `CINETPAY_SITE_ID` et `CINETPAY_SECRET_KEY`, le
bouton « Payer par Mobile Money » affiche un toast de **simulation** : le
parcours est validé, mais la commande reste à régler et aucun argent n'est encaissé.
Renseignez ces identifiants pour la production, puis lancez
`npm run deploy:fonctions` (le jeton Supabase est requis).

> ⚠️ **Toute variable préfixée `VITE_` est embarquée dans le bundle et donc publique.**
> Les autres — y compris `SUPABASE_SERVICE_ROLE_KEY` et `CINETPAY_SECRET_KEY` —
> ne servent qu'à `npm run setup`, qui les pousse dans les secrets des Edge
> Functions. Ne préfixez jamais un secret par `VITE_` : le script refuse de
> démarrer si c'est le cas.

Contrôler la configuration avant d'installer :

```bash
npm run setup:check    # valide le .env et s'arrête
npm run setup:dry      # affiche les commandes sans rien exécuter
```

### 3.3 Ce que fait `npm run setup`

| Étape | Action | Idempotence |
|-------|--------|-------------|
| 1 | `supabase link` sur le projet | sans effet si déjà lié |
| 2 | `supabase db push` : migrations `001` à `009` dans l'ordre | migration déjà appliquée ignorée |
| 3 | Déploiement de `cinetpay-init` (JWT requis) et `cinetpay-webhook` (public) | redéploie la même version |
| 4 | Secrets `CINETPAY_*` et `APP_URL` côté Edge Functions | écrasés par les valeurs du `.env` |
| 5 | Création du pressing + compte propriétaire (`app_metadata.tenant_id`) + ligne `tenant_users` (+ `platform_admins` si `PLATFORM_ADMIN=true`) | pressing retrouvé par son nom, compte réutilisé |
| 6 | Contrôle : `orders` doit répondre `42501` en anonyme, webhook en ligne | lecture seule |

Options : `--skip-db`, `--skip-functions`, `--skip-account`, `--check`,
`--dry-run`, `--help`.

Remarque sur l'étape 3 : si Docker n'est pas installé, le script bascule
automatiquement sur l'empaquetage côté Supabase (`--use-api`), ce qui évite
l'erreur « Docker daemon not running » de la CLI.

### 3.4 Installation manuelle (dépannage)

Si `npm run setup` ne peut pas s'exécuter (pas de jeton personnel, réseau
restreint), voici l'équivalent :

1. Ouvrir **SQL Editor** et exécuter `supabase/migrations/001_init.sql`, puis
   `002_payments.sql` (l'ordre est impératif : la 002 référence `orders`).
2. (Optionnel) Exécuter `supabase/seed.sql` pour deux pressings de démonstration.
3. Créer le compte dans **Authentication > Users**.
4. Renseigner le pressing et le rattachement :

```sql
insert into public.tenants (name, phone)
values ('Pressing Cocody', '+225 07 00 00 00 01')
returning id;

insert into public.tenant_users (user_id, tenant_id, role)
values ('<user-uuid>', '<tenant-uuid>', 'owner');
-- role ∈ ('owner', 'receptionist', 'artisan')

update auth.users
set raw_app_meta_data =
  coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('tenant_id', '<tenant-uuid>', 'tenant_role', 'owner')
where id = '<user-uuid>';
```

Sans la dernière instruction, `current_tenant_id()` retombe sur `tenant_users` :
l'application fonctionne, mais la RLS passe par une sous-requête à chaque
lecture.

### 3.5 Lancer l'application

```bash
npm run dev
```

Ouvrir <http://localhost:5173>.

- **Supabase configuré** : se connecter avec `SEED_OWNER_EMAIL` /
  `SEED_OWNER_PASSWORD`. Le pressing est déduit de `tenant_users` — aucun UUID
  n'est saisi.
- **Configuration partielle** (une seule des deux variables `VITE_SUPABASE_*`) :
  l'écran de connexion signale la variable manquante et la commande
  `npm run setup:check`. On ne bascule **pas** en démonstration, pour éviter de
  croire à une panne du serveur.
- **Aucune configuration** : mode démonstration, l'écran demande l'identifiant
  du pressing (`11111111-1111-4111-8111-111111111111` par défaut, ou
  `VITE_DEMO_TENANT_ID`). Aucun mot de passe n'est vérifié : inutilisable en
  production.

### 3.6 Mettre le front en ligne

1. Déployer sur Vercel/Netlify avec `npm run build`, sortie `dist`.
2. Reporter l'URL publique dans `APP_URL`, puis relancer `npm run setup`
   (les redirections de paiement et `return_url` sont mises à jour).
3. Vérifier que `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` sont bien
   définies dans les variables d'environnement de l'hébergeur — le build les
   incorpore.
4. Rejouer `supabase/tests/isolation.sql` dans le SQL Editor (§6).

---

## 4. Scripts

| Commande | Rôle |
|----------|------|
| `npm run dev` | Serveur de développement (HMR), exposé sur `0.0.0.0:5173` |
| `npm run build` | Vérification TypeScript **puis** build de production (PWA incluse) |
| `npm run preview` | Sert le build de production (`0.0.0.0:4173`) |
| `npm run lint` | ESLint (`.ts`, `.tsx`, `.js`) |
| `npm run typecheck` | `tsc --noEmit` seul |
| `npm test` | Suite Vitest complète (550 tests : synchronisation, rôles, caisse, clients, stock, tableau de bord, rapports, abonnement, pagination, langue, isolation, installation, base gérée, simulateur CinetPay, assemblage des fonctions, notifications client) |
| `npm run recette` | Recette **lecture seule** d'un projet déployé (7 contrôles : API, RLS, schéma, formules, webhook) |
| `npm run setup` | Installation complète depuis `.env` (schéma, fonctions, secrets, compte) |
| `npm run simulateur` | Faux CinetPay local (`0.0.0.0:54321`) pour tester le paiement en mode `test` |
| `npm run deploy:fonctions` | Assemble et déploie les Edge Functions par l'API Supabase (`--verifier`, secrets poussés par défaut ; `--sans-secrets` pour les omettre) |
| `npm run setup:check` | Valide le `.env` puis s'arrête |
| `npm run setup:dry` | Affiche les actions d'installation sans les exécuter |
| `npm run sql:verify` | Rejoue migrations et tests SQL sur un PostgreSQL jetable (**aucun** Supabase requis) |
| `npm run db:etat` | Inventaire **lecture seule** d'une base gérée (`DATABASE_URL`) : tables, RLS, migrations |
| `npm run db:push` | Applique le socle, les migrations et le jeu de démonstration sur cette base |
| `npm run db:verifier` | Rejoue les 175 contrôles SQL sur cette base (transaction annulée) |
| `npm run test:watch` | Vitest en mode surveillance |

### Vérifier la PWA

```bash
npm run build && npm run preview
```

Le build doit produire `dist/manifest.webmanifest`, `dist/sw.js` et les icônes
`pwa-192x192.png`, `pwa-512x512.png`, `maskable-512x512.png`.
L'installation n'est proposée qu'une fois le service worker **actif** (donc en production/aperçu,
pas en `npm run dev`).

---

## 5. Structure du projet

```text
.
├── public/                       # icônes PWA (192/512/maskable/apple) + favicon
├── src/
│   ├── App.tsx                   # routeur + notifications globales
│   ├── main.tsx                  # point d'entrée React
│   ├── index.css                 # thème Tailwind v4 (@theme) + styles d'impression
│   ├── components/
│   │   ├── AppLayout.tsx         # en-tête, navigation, bandeau de synchro
│   │   ├── AuthGate.tsx          # restauration de session + garde d'accès
│   │   ├── OfflineBadge.tsx      # vert / orange / rouge + envoi manuel
│   │   ├── PaymentButton.tsx     # bouton Mobile Money + badges opérateurs
│   │   ├── QrCodeDisplay.tsx     # étiquette 80 mm imprimable
│   │   └── QrScanner.tsx         # scan caméra (html5-qrcode)
│   ├── constants/orders.ts       # statuts, libellés français, couleurs de badge
│   ├── db/
│   │   ├── localDb.ts            # schéma Dexie (orders, orderItems, pendingPayments)
│   │   ├── maintenance.ts        # résumé, export JSON et purge du cache local
│   │   ├── ordersRepository.ts   # CRUD local + mapping Supabase
│   │   └── hooks.ts              # useLocalOrders, useCreateOrder, useUpdateOrderStatus
│   ├── hooks/
│   │   └── useAndroidBackButton.ts # bouton Retour Android (sentinelle d'historique)
│   ├── lib/
│   │   ├── env.ts                # lecture des variables d'environnement
│   │   ├── supabaseClient.ts     # client Supabase (singleton paresseux)
│   │   ├── tenantContext.ts      # pressing courant (Zustand + persistance)
│   │   ├── formatters.ts         # FCFA, dates et téléphones ivoiriens
│   │   ├── pagination.ts         # pages locales + curseur serveur (dépenses)
│   │   ├── reporting.ts          # calculs purs des rapports (écran 11)
│   │   ├── parametres.ts         # validation du pressing, tailles, purgeabilité
│   │   ├── facturation.ts        # numéro, lignes, montant en lettres
│   │   ├── impression.ts         # @page A4 / 80 mm injecté à l'impression
│   │   ├── permissions.ts        # matrice des capacités par rôle
│   │   └── ids.ts                # UUID côté client + code QR
│   ├── pages/
│   │   ├── Login.tsx             # connexion, inscription, réinitialisation (mode démo)
│   │   ├── Offline.tsx           # écran de repli hors ligne
│   │   ├── Orders.tsx            # liste (recherche + filtres)
│   │   ├── OrderForm.tsx         # création hors ligne
│   │   ├── OrderDetail.tsx       # fiche + étiquette QR + avancement
│   │   ├── PaymentReturn.tsx     # retour CinetPay (lecture seule)
│   │   ├── Facture.tsx           # facture A4 imprimable (texte, sans lib PDF)
│   │   ├── Atelier.tsx           # scan QR → changement de statut
│   │   ├── Clients.tsx           # fiche client + historique (palier 3)
│   │   ├── Stock.tsx             # articles, mouvements, fournisseurs (palier 3)
│   │   ├── Depenses.tsx          # dépenses paginées côté serveur (palier 3)
│   │   ├── TableauDeBord.tsx     # indicateurs du jour (palier 3)
│   │   ├── Rapports.tsx          # courbes 7/30/90 j + export CSV (écran 11)
│   │   ├── Abonnement.tsx        # formule, échéance, droits (palier 4)
│   │   ├── Support.tsx           # demandes d'assistance (palier 4)
│   │   ├── Supervision.tsx       # console de l'éditeur (palier 4)
│   │   ├── Parametres.tsx        # pressing, compte, équipe, données locales
│   │   └── Reinitialisation.tsx  # nouveau mot de passe (lien reçu)
│   ├── services/
│   │   ├── authService.ts        # connexion, restauration de session, erreurs FR
│   │   ├── paymentService.ts     # initiation, redirection, lecture du statut
│   │   ├── customerService.ts     # clients, historique, fiche serveur
│   │   ├── tenantService.ts       # lecture / renommage du pressing (propriétaire)
│   │   ├── stockService.ts        # articles, mouvements, seuils, fournisseurs
│   │   ├── expenseService.ts      # dépenses catégorisées (propriétaire)
│   │   ├── dashboardService.ts    # calculs locaux du tableau de bord
│   │   └── qrService.ts          # génération / analyse des codes QR
│   ├── schemas/order.ts          # validation Zod (client, téléphone, vêtements)
│   ├── stores/syncStore.ts       # état de synchronisation (Zustand)
│   ├── sync/syncEngine.ts        # envoi des commandes en attente
│   ├── test/                     # tests Vitest + amorçage (jamais dans le bundle)
│   │   ├── setup.ts              # fake-indexeddb, environnement React
│   │   ├── env.test.ts           # états de configuration (ok / démo / incomplet)
│   │   ├── qrService.test.ts
│   │   ├── syncEngine.test.ts
│   │   ├── tenantIsolation.test.ts
│   │   └── useCreateOrder.test.tsx
│   └── types/database.ts         # types alignés sur le schéma SQL
├── scripts/
│   ├── setup.mjs                 # installation complète depuis .env (npm run setup)
│   ├── setup.test.mjs            # contrat du provisionnement (serveur HTTP simulé)
│   ├── recette.mjs               # 7 contrôles lecture seule du projet déployé
│   ├── db.mjs                    # schéma et contrôles SQL sur une base gérée
│   ├── db.test.mjs               # fonctions pures de db.mjs (plan, masquage…)
│   ├── config.test.mjs           # lecture et validation du .env
│   └── lib/config.mjs            # analyse du .env, validation (logique pure)
├── supabase/
│   ├── config.toml               # verify_jwt de chaque Edge Function
│   ├── functions/
│   │   ├── _shared/              # client CinetPay, CORS, clients Supabase
│   │   ├── cinetpay-init/        # initialisation du paiement (JWT requis)
│   │   └── cinetpay-webhook/     # notification serveur (sans JWT)
│   ├── migrations/001_init.sql   # schéma multi-tenant + RLS
│   ├── migrations/008_inscription.sql # inscription libre (pressing + propriétaire)
│   ├── migrations/002_payments.sql # payment_transactions + RLS lecture seule
│   ├── migrations/006_palier3.sql # clients, stock, dépenses, vue des totaux
│   ├── seed.sql                  # jeu de démonstration (2 pressings)
│   ├── tests/isolation.sql       # preuve d'isolation sur une vraie base
│   └── tests/palier3.sql         # 17 contrôles clients / stock / dépenses
├── docs/
│   ├── AUDIT.md                  # rapport de la phase 0
│   ├── BACKLOG.md                # fonctionnalités explicitement hors périmètre
│   ├── RAPPORT-FINAL.md          # bilan du MVP (fonctionne / V2 / coûts)
│   ├── RECETTE-SUPABASE.md       # marche à suivre de recette sur un vrai projet
│   ├── NEON.md                   # brancher une base gérée (db:push / db:verifier)
│   └── USER_GUIDE.md             # parcours réceptionniste / artisan / propriétaire
├── CHANGELOG.md                  # historique des versions du MVP
├── vitest.config.ts              # configuration de la suite de tests
└── RESTRUCTURATION.md            # cahier des charges du MVP
```

---

## 6. Architecture multi-tenant et sécurité

Chaque pressing est un `tenant`. **Toutes** les tables métier portent
`tenant_id uuid not null`, et l'isolation est assurée **en PostgreSQL** par Row-Level Security —
jamais uniquement par le frontend.

Points clés de `supabase/migrations/001_init.sql` :

1. **`current_tenant_id()`** lit `app_metadata.tenant_id` du JWT, avec repli documenté sur
   `tenant_users` (évite l'erreur « more than one row » sur un utilisateur multi-pressing).
2. **`tenant_users` en lecture seule** pour l'utilisateur : l'ancienne politique permettait
   à n'importe qui de s'auto-inscrire comme propriétaire d'un pressing tiers.
3. **Clés étrangères composites** `(order_id, tenant_id)` : une ligne de commande ne peut pas
   pointer vers la commande d'un autre pressing.
4. **Journal de statuts automatique** via trigger `security definer` — le client ne peut pas
   réécrire l'historique.
5. **Suppression physique interdite** sur les commandes : on passe en statut `cancelled`.

### Vérifier l'isolation (phase 6)

Créer deux tenants, deux utilisateurs, puis vérifier qu'un utilisateur de Cocody
ne voit aucune commande de Yopougon (`select * from orders;` doit ne retourner que son tenant).

---

## 7. Décisions techniques et justifications

Conformément à la règle « ne jamais modifier les fichiers de config globaux sans justification écrite » :

| Décision | Justification |
|----------|---------------|
| **TypeScript épinglé 6.0.3** (au lieu de 7.0.2) | `typescript-eslint` 8.72.0 refuse TypeScript 7 (« does not support TS 7.0 », issue #10940). Épingler en 6.0.3 permet de conserver un lint complet des `.ts/.tsx`. À réévaluer dès que le support TS 7 sort. |
| **`tsconfig.json` réécrit** | `allowJs` passé à `false` (100 % du code est désormais en `.ts/.tsx`), `noEmit: true` (le build est fait par Vite), `baseUrl` supprimé car déprécié en TS 6, `paths` conservé et **aligné** sur l'alias `@` de `vite.config.ts`. |
| **`eslint.config.js` réécrit** | L'ancienne configuration n'analysait que `**/*.{js,jsx}` : les fichiers TypeScript n'étaient jamais lintés. |
| **Suppression des écrans hors périmètre** | Landing page marketing (2 572 lignes), Services, StaffManagement, InvoiceView, TrackOrder, BillingModal, Receipt, PaymentModal. Code conservé dans Git (commit `ae2903f`). |
| **Dépendances retirées** | `axios` (backend `localhost:5000` inexistant), `framer-motion`, `html2pdf.js`, `html2canvas-pro`, `react-to-print`, `react-helmet-async`, `react-icons` (doublon de `lucide-react`). |
| **Montants en entiers XOF** | Le franc CFA n'a pas de sous-unité : aucun décimal, affichage `1 500 FCFA` via `Intl.NumberFormat('fr-CI')`. |
| **Icônes PWA en PNG** | L'ancienne icône était un sprite SVG d'icônes sociales (`icons.svg`) : Chrome refusait l'installation. Génération de `pwa-192x192.png`, `pwa-512x512.png`, `maskable-512x512.png`, `apple-touch-icon.png`. |
| **Types de lignes en `type` (et non `interface`)** | Les `interface` TypeScript ne satisfont pas `Record<string, unknown>` exigé par `postgrest-js` : le client Supabase retournait des types `never`. Les alias de type, eux, sont compatibles. |
| **`server.host = 0.0.0.0` + `allowedHosts`** | Permet l'accès depuis une tablette du pressing et depuis une URL de prévisualisation distante. |
| **Routes en `React.lazy`** | `html5-qrcode` pèse 112 Ko gzip à lui seul. Sans découpage, le bundle initial passait de 201 à 324 Ko. Avec le découpage : **61 Ko** au démarrage, la librairie de scan n'arrivant qu'à l'ouverture de l'atelier. |
| **Index Dexie `qrCode` (schéma v2)** | Rechercher une commande scannée sans index parcourrait toute la table. Dexie réindexe automatiquement les données existantes lors de la montée de version. |
| **Portail `#print-root`** | Imprimer uniquement l'étiquette : `window.print()` sur la page entière produirait une sortie illisible sur une imprimante thermique 80 mm. |

---

## 7bis. Mode offline-first (phase 2)

### Fonctionnement

1. **Toute écriture va d'abord dans IndexedDB** (Dexie). Aucune requête réseau n'est émise
   lors de la création d'une commande ou d'un changement de statut.
2. Chaque ligne possède un indicateur `synced` (`0` = à envoyer, `1` = à jour).
   Toute modification locale repasse la ligne à `0`.
3. Le moteur de synchronisation (`src/sync/syncEngine.ts`) envoie les lignes en attente :
   - au démarrage de l'application ;
   - à l'événement `online` ;
   - au retour au premier plan (`visibilitychange`) ;
   - toutes les **60 secondes** si le navigateur est en ligne.
4. L'envoi est un `upsert` sur l'UUID généré côté client : **rejouer une synchronisation
   ne crée jamais de doublon**.
5. En cas d'échec, la commande **reste en file**, l'erreur est enregistrée sur la ligne
   et le bandeau passe au rouge. Aucune donnée n'est perdue.

### Indicateur d'état (exigence du cahier des charges)

| Couleur | Signification |
|---------|---------------|
| 🟢 Vert | En ligne, tout est synchronisé |
| 🔵 Bleu | Synchronisation en cours |
| 🟠 Orange | Hors ligne — les commandes restent enregistrées localement |
| 🔴 Rouge | Au moins un envoi a échoué (message affiché au survol) |

L'indicateur est aussi lisible **sans couleur** (icône + texte) et annonce ses changements
aux lecteurs d'écran (`aria-live`).

### Test manuel du mode avion

1. Créer une commande via **Nouvelle commande**.
2. Ouvrir les DevTools → **Network** → cocher **Offline** (ou activer le mode avion de la tablette).
3. Constater :
   - le bandeau passe en **orange « Hors ligne »** ;
   - la commande reste visible dans la liste, marquée **« En attente »** ;
   - un changement de statut reste possible.
4. Revenir en ligne : la synchronisation se déclenche immédiatement (événement `online`).
5. Vérifier dans Supabase :

```sql
select id, customer_name, status, synced_from_local, updated_at
from public.orders
order by created_at desc
limit 5;
```

La commande doit apparaître **dans les 60 secondes** suivant le retour de la connexion.

### Limites connues (MVP)

- **Historique des statuts** : la RLS et le trigger serveur journalisent les changements.
  En mode avion, seul **l'état final** de la commande est transmis à la reconnexion : une
  suite `received → washing → ironing` effectuée entièrement hors ligne ne laisse qu'une
  ligne d'historique côté serveur. Le journal détaillé hors ligne est prévu en V2.
- **Suppression** : jamais physique ; une commande annulée passe au statut `cancelled`.
- **Synchronisation descendante** (récupérer les commandes créées sur un autre poste)
  n'est pas incluse dans la phase 2 : elle suppose la connexion Supabase (phase 5).
- **Un seul pressing par appareil** à la fois ; le changement de pressing vide la base locale
  (`clearLocalData`).

> Les vérifications de la phase 2 ont été exécutées sur une base IndexedDB simulée
> (`fake-indexeddb`) : 22 contrôles verts, couvrant création, calcul du total, format du
> code QR, file d'attente, changement de statut, mode avion et échec réseau. Le test
> automatisé permanent (Vitest) est prévu en phase 6.

---

## 7ter. Module QR Code (phase 3)

### Format du code

```text
TENANTID-ORDERID-TIMESTAMP
11111111-1111-4111-8111-111111111111-3f2a…-1750000000000
```

Les deux UUID mesurent 36 caractères et sont suivis d'un horodatage numérique :
l'analyse ne fait donc **jamais** un `split('-')` (ambigu), mais s'appuie sur des
groupes de longueur fixe. Un QR Code étranger (affiche publicitaire, code-barres
d'un concurrent) est ignoré proprement, sans faire planter l'atelier.

### Où le QR apparaît

| Écran | Usage |
|-------|-------|
| Fiche commande | Aperçu du QR + bouton **Imprimer l'étiquette** |
| Atelier | Bouton **Scanner un vêtement** → détail + sélecteur de statut |

### Impression de l'étiquette (80 mm)

Le bouton n'imprime pas la page : il monte une étiquette dédiée dans un portail
`#print-root` et bascule le `<body>` en mode `impression-etiquette`. Les règles
`@media print` de `src/index.css` masquent alors l'application et n'impriment que
l'étiquette, au format **80 mm** (imprimante thermique de comptoir).

### Test manuel imposé par le cahier des charges

> « imprimer une étiquette, la scanner depuis une tablette, changer le statut »

1. Créer une commande, ouvrir sa fiche, cliquer **Imprimer l'étiquette**
   (ou « Enregistrer au format PDF » pour tester sans imprimante).
2. Ouvrir **Atelier** sur une tablette (ou un ordinateur avec webcam), cliquer
   **Scanner un vêtement**, autoriser la caméra.
3. Présenter le QR imprimé : la commande s'affiche avec son détail.
4. Choisir un nouveau statut → il est écrit **localement**, puis synchronisé.

**Si la caméra est indisponible**, deux secours sont prévus :
- saisie du code complet de l'étiquette ;
- saisie de la référence courte imprimée sous le QR (`CMD-7F3A2B`).

### Sécurité et isolation

- Une étiquette appartenant à **un autre pressing** est détectée et refusée :
  aucune donnée client n'est affichée (la RLS reste la sécurité de référence).
- `parseQrString()` retourne `null` sur toute chaîne non conforme.

### Notes techniques

- Index Dexie `qrCode` ajouté en **version 2** du schéma : Dexie réindexe
  automatiquement les commandes déjà présentes, sans perte de données.
- `html5-qrcode` (~112 Ko gzip) est chargé **uniquement** à l'ouverture de
  l'atelier, grâce au découpage `React.lazy` : le bundle initial reste à 61 Ko.
- La génération d'image utilise `qrcode` (DataURL PNG, correction d'erreur `M`).
- Vérifications exécutées : **19/19** sur le service QR — dont un **décodage réel**
  de l'image PNG par un lecteur QR indépendant (`jsQR`) — et **13/13** en DOM simulé
  sur l'atelier et l'étiquette imprimable. Le passage au vert de la caméra elle-même
  reste un test manuel (matériel requis).

---

## 7quater. Paiement Mobile Money (phase 4 — CinetPay)

### Vue d'ensemble

Le module ajoute le paiement Mobile Money **Wave, Orange Money, MTN MoMo et Moov
Money** via l'API Checkout v2 de CinetPay. Aucune donnée de carte n'est manipulée :
le client est redirigé vers le guichet CinetPay, qui gère lui-même l'authentification
auprès de l'opérateur.

```
Navigateur                Edge Functions (Deno)          CinetPay
    |                            |                          |
    |-- « Payer » -------------->| cinetpay-init            |
    |                            |-- relit le montant dans `orders`
    |                            |-- POST /v2/payment ----->|
    |                            |<-- payment_url ----------|
    |<-- payment_url ------------|  (trace `pending` en base)
    |-- redirection vers le guichet CinetPay ---------------->
    |                            |                          |  paiement
    |                            |<-- POST notify_url ------|  (webhook)
    |                            |-- POST /v2/payment/check->|
    |                            |<-- statut ACCEPTED -------|
    |                            |-- orders.payment_status = 'paid'
    |<-- retour /paiement/retour?order=… (lecture seule) -----|
```

### Sécurité du montant

Le montant envoyé à CinetPay est **toujours relu dans la table `orders` côté
serveur**. Le montant fourni par le navigateur est ignoré : un client qui
modifierait la requête ne pourrait donc pas payer 100 FCFA une commande de 12 000 FCFA.

CinetPay impose un montant **multiple de 5** en XOF. La fonction
`roundToChargeableAmount()` arrondit au multiple de 5 supérieur ; l'écart maximal
est de 4 FCFA, et il est tracé (`amount` = montant débité, `order_amount` = montant
réel de la commande) pour la réconciliation comptable.

### Pourquoi une table dédiée `payment_transactions`

Une commande peut connaître plusieurs tentatives de paiement (échec Wave, nouvel
essai Orange Money). Stocker le paiement dans des colonnes de `orders` aurait fait
perdre l'historique et rendu l'idempotence impossible. La table porte une contrainte
`unique` sur `transaction_id` : rejouer une notification ne peut pas créer de doublon.

**Écritures serveur uniquement.** La RLS n'autorise que le `SELECT` pour les
utilisateurs authentifiés de leur propre pressing (`tenant_id = current_tenant_id()`).
Toutes les écritures passent par la clé `service_role` des Edge Functions : un client
malveillant ne peut donc pas s'auto-attribuer un paiement.

### Séquence de la notification (webhook)

`notify_url` est le **seul** mécanisme fiable de mise à jour : le client peut fermer
son navigateur avant la redirection. Chaque notification est traitée ainsi :

1. Lecture du corps (`application/x-www-form-urlencoded`, parfois JSON).
2. Vérification du jeton **HMAC-SHA256** de l'en-tête `x-token` si
   `CINETPAY_SECRET_KEY` est configurée — message = concaténation ordonnée de
   16 champs (voir `_shared/cinetpay.ts`).
3. Relecture du statut réel par appel serveur à `POST /v2/payment/check` :
   **une notification n'est jamais crue sur parole**.
4. Comparaison du montant encaissé avec le montant attendu. En cas d'incohérence,
   la transaction passe en `error` et la commande **n'est pas** marquée payée.
5. Mise à jour idempotente : une transaction déjà `paid` est définitive ; une
   notification tardive de refus ne peut pas annuler un paiement encaissé.

Réponses HTTP : `200` sur succès ou transaction inconnue (pour éviter les relances
infinies), `401` sur signature invalide, `503` si CinetPay est injoignable — dans ce
cas CinetPay réessaiera.

### La page de retour ne valide rien

`/paiement/retour` affiche l'état du paiement en **lisant** `payment_transactions`.
Elle n'écrit jamais en base. C'est volontaire : une URL de retour est un simple
`GET` déclenché par le navigateur, donc falsifiable. Si le webhook n'est pas encore
arrivé, la page sonde 4 fois à 3 secondes d'intervalle puis affiche « en attente »,
avec un bouton de actualisation manuelle.

### Configuration

Renseigner les trois valeurs dans `.env`, puis lancer `npm run setup` : les
secrets sont poussés côté Supabase et les deux fonctions déployées
automatiquement (§3.3).

```env
CINETPAY_API_KEY=...
CINETPAY_SITE_ID=...
CINETPAY_SECRET_KEY=...
```

L'équivalent manuel, si nécessaire :

```bash
# Secrets des Edge Functions (jamais dans le bundle Vite)
supabase secrets set \
  CINETPAY_API_KEY=... \
  CINETPAY_SITE_ID=... \
  CINETPAY_SECRET_KEY=... \
  APP_URL=https://votre-domaine.ci

# Déploiement (le webhook doit accepter les appels sans JWT)
supabase functions deploy cinetpay-init
supabase functions deploy cinetpay-webhook --no-verify-jwt
```

### Sans la CLI : script de déploiement et mode essai

```bash
npm run deploy:fonctions -- --verifier    # assemble, inspecte, ne déploie rien
npm run deploy:fonctions                  # pousse les secrets puis déploie
npm run deploy:fonctions -- --sans-secrets  # fonctions seules
```

**Mise en service :** renseignez `CINETPAY_API_KEY`, `CINETPAY_SITE_ID`,
`CINETPAY_SECRET_KEY` et votre `APP_URL` public dans `.env`, gardez
`CINETPAY_MODE=production`, puis lancez `npm run deploy:fonctions` (le jeton
`SUPABASE_ACCESS_TOKEN` doit aussi être configuré). La commande lit `.env`,
pousse les secrets et déploie les fonctions : aucun changement du script ni
réglage manuel dans le Dashboard.

**Tant qu'aucune clé n'est installée**, le bouton « Payer par Mobile Money »
n'affiche pas d'erreur : le paiement est **simulé** (référence `SIM-…`), le
message le dit, et la commande reste à régler.

Les fonctions sont assemblées en **un fichier unique** (imports `_shared`
résolus), l'API d'administration Supabase n'acceptant qu'un seul corps de
source. Pour éprouver le parcours de paiement **sans compte marchand** :

```bash
npm run simulateur     # faux CinetPay sur http://localhost:54321
# .env : CINETPAY_MODE=test, CINETPAY_BASE_URL=http://localhost:54321,
#        CINETPAY_API_KEY=simulateur-test-key, CINETPAY_SITE_ID=123456
```

En mode `production`, une clé d'essai est **refusée** au démarrage ; en mode
`test`, chaque transaction est marquée `provider_payload.mode = "test"`.
Détail des routes, du HMAC et des limites (dont `localhost` vu depuis une
fonction hébergée) : [`docs/DEPLOIEMENT-FONCTIONS.md`](docs/DEPLOIEMENT-FONCTIONS.md).

`CINETPAY_NOTIFY_URL` est déduite de l'URL du projet
(`https://<ref>.supabase.co/functions/v1/cinetpay-webhook`) et n'a donc pas à
être saisie. `SUPABASE_URL`, `SUPABASE_ANON_KEY` et
`SUPABASE_SERVICE_ROLE_KEY` sont injectées automatiquement par Supabase — ne pas
les définir manuellement.

### Limites de cette phase

- **Aucun test réel n'a pu être exécuté** : ni projet Supabase provisionné, ni
  identifiants marchand CinetPay, ni binaire `deno` dans l'environnement de
  développement. Les Edge Functions ne sont donc **pas typées** (`deno check`) et
  la migration `002_payments.sql` **n'est pas exécutée**. Elles ont été validées
  par relecture et transpilation (`esbuild`), et la logique pure (arrondi, mapping
  des opérateurs, HMAC) par **19/19** assertions exécutées hors Deno.
- Le remboursement, le paiement partiel et le paiement à la livraison sont hors
  périmètre (voir `docs/BACKLOG.md`).
- Sans `CINETPAY_SECRET_KEY`, le webhook reste fonctionnel mais la notification
  n'est pas authentifiée cryptographiquement (mode « vérification seule ») ; un
  avertissement est écrit dans les logs.

### Test manuel (nécessite de vrais identifiants)

1. Créer une commande de 8 500 FCFA, ouvrir sa fiche, cliquer **Payer par Mobile Money**.
2. Sur le guichet CinetPay, vérifier le montant **8 500 FCFA** et l'absence de frais ajoutés.
3. Payer avec un numéro de test Wave / Orange Money fourni par CinetPay.
4. Après redirection, la page de retour doit afficher « Paiement confirmé » en
   moins de 12 secondes (délai du sondage).
5. Dans Supabase, vérifier `payment_transactions.status = 'paid'` avec
   `signature_verified = true`, et `orders.payment_status = 'paid'`.
6. Rejouer la notification (bouton « Renvoyer » du backoffice CinetPay) :
   le statut ne doit pas changer et aucun doublon ne doit apparaître.

---

## 7quinquies. PWA, connexion et ergonomie tablette (phase 5)

### Installation

Le manifeste est généré par `vite-plugin-pwa` à partir de `vite.config.ts` :
nom, `short_name`, icônes **192 px**, **512 px** et **maskable**, `display:
standalone`, `theme_color` navy, `id` stable (sans quoi Chrome considère un
changement d'URL comme une autre application) et deux **raccourcis** d'appui long
(« Nouvelle commande », « Atelier »).

L'installation n'est proposée qu'en production ou en aperçu : en `npm run dev`,
le service worker est désactivé. Sur Android, elle passe par
**⋮ → Installer l'application**.

> ⚠️ **Choix assumé.** Pas de service worker en développement : il servirait des
> fichiers périmés et rendrait le rechargement à chaud incompréhensible. Le test
> d'installation se fait donc sur `npm run build && npm run preview`.

### Écran hors ligne

`/offline` n'est pas un simple message d'erreur : il rappelle ce qui reste
utilisable sans réseau, ce qui exige une connexion, et affiche le nombre de
commandes en attente. Il est accessible par le lien **Aide** qui apparaît à côté
du badge orange.

Il n'y a **pas** de `offline.html` statique : la coquille de l'application est
précachée par Workbox, donc `index.html` est toujours disponible hors ligne. Un
fichier de secours séparé n'aurait été servi qu'avant la première visite — c'est-
à-dire jamais, puisque rien n'aurait été mis en cache.

### Bouton « Retour » Android

En PWA installée, Android ne « ferme » pas la page comme un onglet : sans
historique, il quitte l'application brutalement, au milieu d'une saisie.

`useAndroidBackButton` pousse une **sentinelle** dans l'historique au démarrage :

1. un appui depuis un écran interne remonte normalement ;
2. arrivé à la sentinelle, un message « Appuyez à nouveau sur Retour » s'affiche ;
3. un second appui en moins de **2 s** laisse Android fermer l'application.

La sentinelle est poussée via `navigate()` et non `history.pushState` brut :
react-router conserve ainsi ses index internes et les boutons précédent/suivant du
navigateur continuent de fonctionner.

### Connexion

`AuthGate` remplace l'ancien écran de sélection d'UUID. Trois chemins :

| Situation | Comportement |
| --- | --- |
| Session valide en cache | Ouverture directe, **y compris hors ligne** |
| Aucune session | Écran `Login` (e-mail + mot de passe) |
| Supabase non configuré | `Login` en mode démonstration (UUID), avec avertissement |

Le pressing n'est jamais saisi : il est lu dans `tenant_users` pour l'utilisateur
connecté. Un compte valide mais non rattaché est **immédiatement déconnecté** avec
un message explicite.

**Pourquoi ignorer `SIGNED_OUT` hors ligne ?** Un rafraîchissement de jeton qui
échoue faute de réseau émet parfois cet événement. Déconnecter la tablette à ce
moment-là priverait l'atelier de toutes ses commandes locales — exactement le
scénario que l'offline-first doit couvrir. L'événement n'est donc traité que si le
réseau est présent ; la RLS bloque de toute façon toute requête tant que le jeton
n'est pas rafraîchi.

**Déconnexion.** Le bouton **Quitter** demande confirmation (tablette partagée).
Les données Dexie ne sont **pas** effacées : elles peuvent contenir des commandes
non synchronisées, et les écrans filtrent par `tenantId`, donc aucun autre
pressing ne les voit.

### Ergonomie tablette

- Toutes les actions tactiles font **au moins 48 px** de haut (`min-h-12`) :
  filtres, liens de retour, boutons de scan, bouton de synchronisation.
- Les champs de saisie passent en `text-base` : lisibles à bout de bras, au
  comptoir.
- Chaque survol (`hover:`) est doublé d'un état `active:` : sur un écran tactile,
  `hover` ne se déclenche jamais.
- Contrastes : texte `slate-600` minimum sur fond blanc ; les états ne reposent
  jamais sur la seule couleur (icône + libellé).

### Limites connues de cette phase

- Pas de réinitialisation de mot de passe par e-mail (reporté en V2, `docs/BACKLOG.md`).
- Un utilisateur = un pressing : `resolveTenantForUser` retient le premier
  rattachement. Le sélecteur multi-pressing est en V2.
- Le rôle est affiché mais ne restreint pas encore la navigation : un artisan voit
  l'onglet comptoir. La RLS empêche en revanche toute écriture non autorisée.
- Le critère « installation sur téléphone Android » n'a pas pu être rejoué dans
  cet environnement (pas de terminal Android) : à valider sur l'appareil cible.

---

## 7sexies. Qualité et vérifications (phase 6)

### Suite de tests automatisés

```bash
npm test          # exécution unique
npm run test:watch
```

Vitest + `jsdom` + `fake-indexeddb` : les modules sont testés dans un
environnement proche du navigateur, avec un IndexedDB en mémoire et **sans aucun
appel réseau** (Supabase est remplacé par un double).

| Fichier | Tests | Ce qui est couvert |
| --- | --- | --- |
| `src/test/qrService.test.ts` | 18 | Format `TENANT-ORDER-TIMESTAMP`, aller-retour encodage/décodage, QR étrangers rejetés, dimensions réelles du PNG (en-tête IHDR) |
| `src/test/syncEngine.test.ts` | 11 | Hors ligne, non configuré, sans pressing, envoi nominal, **échec partiel**, idempotence, appels concurrents, traduction FR des erreurs |
| `src/test/useCreateOrder.test.tsx` | 6 | Refus sans pressing, total calculé, QR cohérent, champs nettoyés, unicité, **aucune requête réseau** |
| `src/test/tenantIsolation.test.ts` | 23 | RLS activée sur les 6 tables, absence de politique permissive, révocation `anon`, écritures de paiement verrouillées, aucune clé `service_role` côté client, tout `.from()` filtré ou documenté |

Les tests vivent dans `src/test/` : `tsc --noEmit` les vérifie comme le reste du
code, mais ils ne sont **jamais** inclus dans le bundle de production.

### Isolation multi-tenant sur une vraie base

Le test automatisé ci-dessus vérifie les politiques dans les migrations. La
preuve « deux pressings, deux connexions » exige une base réelle :

```text
1. Appliquer 001_init.sql, 002_payments.sql puis seed.sql.
2. Ouvrir supabase/tests/isolation.sql dans le SQL Editor de Supabase.
3. Lire les NOTICE : chaque « OK » est une garantie vérifiée.
```

Le script rejoue exactement ce que fait PostgREST (`set local role authenticated`
+ `request.jwt.claims` reconstitué depuis le JWT) et contrôle six points :

1. le pressing 1 ne voit que ses 2 commandes ;
2. la commande du pressing 2 est introuvable **même par identifiant exact** ;
3. les lignes de vêtements sont isolées de la même façon ;
4. une insertion au nom du pressing 2 est refusée — avec vérification du code
   `42501` (RLS), pour ne pas passer pour une mauvaise raison ;
5. un client ne peut pas écrire dans `payment_transactions` ;
6. le rôle `anon` ne lit rien du tout.

Tout se termine par `ROLLBACK` : aucune donnée de test ne subsiste.

### Audit d'accessibilité et de performance

Lighthouse **n'a pas pu être exécuté** : l'environnement de développement ne
contient aucun navigateur Chrome/Chromium et l'installation est bloquée. Les
critères ont donc été vérifiés statiquement, puis corrigés :

| Point | Avant | Après |
| --- | --- | --- |
| Contraste texte blanc sur bouton principal | 3,74:1 (échec AA) | **5,47:1** (teal-700) |
| Contraste survol | 5,47:1 | 7,58:1 (teal-800) |
| Texte d'aide `slate-400` sur blanc | 2,8:1 | `slate-500` à 4,76:1 |
| Bouton de fermeture du scanner | 40 px | 48 px |
| Code imprimé sur l'étiquette | 8 px, gris clair | 9 px, `slate-600`, retour à la ligne |
| `lang`, `viewport`, `theme-color`, `description` | présents | conservés |
| Alternatives textuelles | `alt` sur chaque image, `aria-label` sur les boutons icône | conservées |

**PWA** : manifeste complet (`id`, `start_url`, `display: standalone`, icônes
192/512/maskable, deux raccourcis), service worker précachant 39 fichiers
(1,19 Mo), écran de repli fonctionnel.

**Performance** : bundle initial 204 kB (64 kB gzip) — la librairie de scan
(383 kB) et l'écran hors ligne sont chargés à la demande ; polices système, donc
aucune requête réseau bloquante au premier rendu.

> ⚠️ Ces mesures ne remplacent pas Lighthouse. Le score doit être relevé sur un
> déploiement HTTPS réel avant la mise en production (voir `docs/RAPPORT-FINAL.md`).

### Vérification syntaxique du SQL

Aucun PostgreSQL n'étant disponible dans l'environnement, les quatre fichiers SQL
ont été analysés avec l'analyseur officiel de PostgreSQL (`libpg_query` via le
paquet Python `pglast`) — 98 instructions valides. Cela garantit l'absence
d'erreur de syntaxe, **pas** l'absence d'erreur d'exécution.

```bash
python3 -m venv /tmp/sqlvenv && /tmp/sqlvenv/bin/pip install pglast
/tmp/sqlvenv/bin/python -c "from pglast import parse_sql; print(len(parse_sql(open('supabase/migrations/001_init.sql').read())))"
```

---

## 7septies. Rôles, conflits et paiements (palier 1)

Trois mécanismes ajoutés après l'audit externe (voir `MAJ.md`).

### Rôles

| Action | Propriétaire | Réceptionniste | Artisan |
| --- | :---: | :---: | :---: |
| Créer une commande | ✅ | ✅ | ❌ |
| Faire avancer une commande | ✅ | ✅ | ✅ |
| Modifier montant / coordonnées | ✅ | ✅ | ❌ |
| Encaisser (Mobile Money) | ✅ | ✅ | ❌ |
| Voir les montants | ✅ | ✅ | ❌ |
| Supprimer une commande | ✅ | ❌ | ❌ |
| Gérer le pressing et les accès | ✅ | ❌ | ❌ |

L'interface masque ce qui est interdit, mais la décision est **serveur** :
politiques RLS pour l'insertion et la suppression, trigger `guard_order_update`
pour les colonnes (migration `003`), et contrôle du rôle dans `cinetpay-init`.

Les mêmes règles sont **exécutées** sur un vrai PostgreSQL, sans Supabase :

```bash
npm run sql:verify
```

Le script crée une base jetable, y applique `001`→`005` et le jeu de
démonstration, puis rejoue 76 contrôles (isolation, rôles, verrou optimiste,
guichet unique, catalogue, caisse, attribution, réclamations, remboursements).
Il est aussi lancé par l'intégration continue (job « SQL réel »).

### Conflits de synchronisation

Chaque commande porte un numéro de version serveur. Une tablette n'écrit que si
ce numéro correspond encore : sinon la commande est marquée **en conflit**, elle
n'est plus renvoyée, et la fiche propose deux issues explicites — *garder mes
modifications* (écrase l'autre tablette) ou *prendre la version du serveur*
(remplace le contenu local). Aucun écrasement silencieux.

### Paiement

- Un seul guichet ouvert par commande : une tentative de moins de 15 minutes est
  réutilisée, un index unique partiel empêche la création d'un second guichet
  même en cas de double clic simultané.
- La notification CinetPay doit être signée (HMAC) **en production** : sans
  `CINETPAY_SECRET_KEY`, le webhook répond 503. Le mode sans signature exige
  `APP_ENV=development`.
- Deux notifications simultanées ne peuvent pas marquer la commande payée deux
  fois (compare-and-set sur le statut).

---

## 7octies. Cœur ERP (palier 2)

### Catalogue et prix historisé

Le propriétaire tient un catalogue **article × prestation** (chemise, costume,
robe… croisés avec lavage, nettoyage à sec, repassage, détachage). À la saisie
d'une commande, le comptoir choisit une entrée du catalogue : le **prix est
recopié sur la ligne** de commande. Modifier ou retirer une prestation ensuite
ne change donc **jamais** une facture déjà émise.

Un prix différent du catalogue est un **tarif dérogatoire** : il faut un motif
d'au moins 10 caractères, il est refusé à l'atelier et chaque changement de prix
est journalisé dans `order_price_history` (qui, quand, de combien à combien,
pourquoi).

### Prévenir le client

Depuis une commande, un message pré-rempli part vers **WhatsApp** ou le
composeur (**appel**) : ni fournisseur, ni crédit par message, ni compte à créer.
Chaque sollicitation est journalisée dans `notifications` (migration 010) et le
tableau de bord liste les clients **à prévenir**. Le message ne mentionne jamais
de montant : un prix contesté se règle de vive voix.

### Caisse, acomptes et reçus

- encaissement en espèces au comptoir, en **acompte** ou en solde ;
- le solde restant est calculé à partir des encaissements réels, jamais d'un
  champ saisi à la main ;
- **reçu 80 mm imprimable** (`/commandes/:id/recu`) : référence, téléphone,
  articles, prix, montant reçu, **reste à payer toujours affiché** ; il
  fonctionne hors ligne puisque les données sont lues dans IndexedDB ;
- **clôture de caisse quotidienne** (`/caisse`) : le montant attendu est
  recalculé par le serveur à partir des encaissements de la journée, le
  caissier déclare ses espèces, l'écart est conservé ;
- **remboursements** : propriétaire uniquement, motif obligatoire, plafonnés aux
  encaissements nets ; ils sortent du tiroir et sont déduits de la caisse du
  jour.

Un encaissement porte un identifiant généré sur la tablette : si la réponse
réseau se perd, le renvoi ne crée pas un second paiement (idempotence).

### Workflow, retards et réclamations

Parcours en huit étapes : réception → tri → lavage → séchage → repassage →
contrôle qualité → prêt → remis. Le statut ne peut qu'**avancer** ; revenir en
arrière ou rouvrir une commande livrée est réservé au propriétaire, annuler au
propriétaire et au réceptionniste. Chaque transition est horodatée avec son
auteur, le statut précédent et, s'il est fourni, le **motif**.

La **date de livraison promise** déclenche un badge « En retard » sur la fiche
et dans la liste. Les **réclamations** (tache, déchirure, pièce manquante…)
se constatent à la réception, pendant le traitement ou à la remise ; l'atelier
peut les déclarer, seul le comptoir les clôture.

### Attribution

Une commande peut être confiée à un employé du pressing. L'atelier peut prendre
une commande pour lui-même, le comptoir attribue librement. Le serveur refuse
tout employé d'un autre pressing (`guard_order_assignment`).

---

## 7nonies. Clients, stock, dépenses et tableau de bord (palier 3)

### Clients et historique

Le client n'a pas de compte : il est identifié par son **téléphone**. La fiche
est créée automatiquement par la commande (`attach_customer_to_order`) et
regroupée sur le numéro normalisé — « +225 07 00 00 00 21 » et « 0700000021 »
désignent la même personne. `normalize_phone` (SQL) et `normalisePhone` (TS)
appliquent la même règle : chiffres seuls, indicatif `225` retiré.

- **hors ligne** : la liste, l'historique, le total dépensé et les retards sont
  calculés à partir des commandes présentes dans IndexedDB ;
- **en ligne** : la fiche enrichie (adresse, préférences, notes) est lue et
  mise à jour sur le serveur (`customers`).

La fiche n'est **jamais insérée par le client** : seule la fonction
`attach_customer_to_order` (security definer) la crée, au moment de la commande.
Le comptoir et le propriétaire peuvent modifier les coordonnées, pas le numéro.

### Stock et fournisseurs

Les articles consommables (produit, emballage, consommable, autre) portent une
quantité, une unité (pièce, litre, kg, flacon, rouleau) et un **seuil d'alerte**.

> **Décision structurante.** La quantité n'est **jamais écrite directement** par
> le client : elle découle d'un **grand livre** de mouvements (`stock_movements`,
> entrée ou sortie). Une sortie supérieure au stock est refusée par la fonction
> `apply_stock_movement` (code `22023`), et le journal est **immuable** — ni
> `update` ni `delete`. Un stock faux se corrige par un mouvement, pas par une
> réécriture silencieuse.

La quantité initiale se saisit à la création de l'article : elle produit un
mouvement « Stock initial ». Le réceptionniste peut mouvementer (sortie de
lessive, entrée de livraison) ; seul le propriétaire crée les articles et les
fournisseurs.

### Dépenses

Dépenses catégorisées (fournitures, loyer, salaires, eau et électricité,
transport, autre), **réservées au propriétaire** : la RLS refuse la lecture aux
autres rôles, et l'écran affiche « Accès réservé ». Une dépense est un fait
comptable daté ; elle n'est pas saisie hors ligne, pour éviter deux vérités dans
la trésorerie.

### Tableau de bord

Ouvert au propriétaire (`dashboard.view`). Il répond aux questions du matin :

- **activité du jour** : commandes créées, en atelier, prêtes, en retard ;
- **chiffre d'affaires** : espèces du jour et de la semaine, Mobile Money du
  jour, panier moyen ;
- **encours** : reste à encaisser sur les commandes actives (même calcul que la
  caisse, via `computeBalance`) ;
- **alertes de stock** : articles au seuil ou en dessous ;
- **dépenses du mois**.

Les indicateurs d'activité sont calculés **localement**, donc consultables hors
connexion. Les encaissements Mobile Money et les dépenses viennent du serveur :
ils affichent « hors ligne » quand la lecture échoue, plutôt qu'un zéro trompeur.

---

## 7decies. SaaS : abonnement, multi-boutiques et supervision (palier 4)

> **Décision structurante.** Un abonnement échu ne détruit rien et ne se
> contourne pas : le pressing passe en **lecture seule**. Les données restent
> consultables — elles appartiennent au client —, les écritures sont refusées
> par des politiques RLS **restrictives** et par un déclencheur qui couvre les
> fonctions `security definer` (encaissement, remboursement, stock). Un pressing
> **sans** ligne d'abonnement reste inscriptible : la migration ne coupe jamais
> un client existant.

### Formules et échéances

`plans` décrit trois formules (Essentiel, Pro, Réseau) avec leur prix, leur
durée, le nombre de comptes et de boutiques. `subscriptions` porte, par
pressing, la formule retenue et la fin de période. L'état affiché n'est pas
celui stocké : `subscription_state()` le recalcule à partir des dates —
`active` jusqu'à l'échéance, `grace` (7 jours par défaut) ensuite, `expired`
au-delà. Une suspension décidée par l'éditeur l'emporte sur les dates.

Aucun paiement n'est prélevé dans l'application : le règlement se fait auprès de
l'éditeur (Mobile Money ou espèces), qui enregistre la période réglée via
`platform_set_subscription`. C'est une décision assumée — encaisser un
abonnement en ligne aurait exigé un second compte marchand et une comptabilité
de reversement, hors périmètre.

### Multi-boutiques

Un même compte peut être rattaché à plusieurs pressings, avec un **rôle
différent par boutique** (propriétaire ici, réceptionniste là). La boutique
active voyage dans l'en-tête `x-tenant-id`, que `current_tenant_id()` n'accepte
que si `is_tenant_member()` confirme le rattachement ; un en-tête forgé retombe
sur le claim du jeton. `current_tenant_role()` est lui aussi recalculé par
boutique — un rôle mis en cache dans le JWT ne suffisait plus.

Côté interface, `ShopSwitcher` n'apparaît qu'à partir de deux boutiques et
recharge l'application au changement : IndexedDB, caisse et abonnement sont
propres à chaque pressing.

### Supervision et support

`platform_admins` est une liste blanche **sans aucune politique RLS** : la table
n'est lisible que par les fonctions `security definer` et par la clé
`service_role`. Toutes les actions de l'éditeur (`platform_tenants_overview`,
`platform_set_subscription`, `platform_create_shop`, `platform_members`,
`platform_set_member`, `platform_support_requests`, `platform_answer_support`)
vérifient `is_platform_admin()` et lèvent `42501` sinon — masquer le lien de
navigation ne suffit pas.

La console `/supervision` permet de suivre les pressings (formule, état,
échéance, volumes), de renouveler, de suspendre, d'ouvrir une boutique et de
rattacher un compte (avec les limites `max_users` / `max_shops` de la formule),
enfin de répondre aux demandes de support. Côté pressing, `/support` ouvre une
demande et lit la réponse ; les demandes sont cloisonnées par `tenant_id`.

**Accès au back-office :** connectez-vous dans l'application avec votre compte
Supabase, puis ouvrez **Supervision** dans le menu ou `/supervision`. Le lien
n'apparaît qu'après vérification serveur de votre compte. Un pressing client,
même propriétaire, ne peut ni ouvrir la console ni appeler ses fonctions SQL.

Le compte doit d'abord exister dans Supabase Auth et figurer dans
`platform_admins`. Vous pouvez créer un compte éditeur **sans pressing** dans
Supabase Auth ; une fois autorisé côté administration, connectez-vous à
l'application et `/` ouvre directement `/supervision`. Le RPC réservé aux
éditeurs est le seul moyen d'obtenir cet accès sans adhésion à un pressing.

`PLATFORM_ADMIN=true` dans `.env` reste disponible si l'éditeur est le compte
propriétaire créé par `npm run setup`. Pour un compte éditeur indépendant, son
inscription dans `platform_admins` se fait uniquement côté administration.
La migration 011 impose une seule ligne : aucun second super-administrateur ne
peut être ajouté par erreur. Ne donnez jamais `service_role` à l'application
ni à un pressing.

### Limites connues

- la console exige l'**identifiant Supabase** du compte à rattacher : la
  création d'un compte depuis l'interface demanderait la clé `service_role`
  dans le navigateur, ce qui est proscrit ;
- une demande de support ne peut pas être déposée hors ligne (pas de file
  d'attente dédiée) ;
- `max_shops` compte les boutiques où le compte est **propriétaire** : c'est une
  règle commerciale simple, pas une facturation automatique.

## 8. Feuille de route

- [x] **Phase 0** — Audit (`docs/AUDIT.md`)
- [x] **Phase 1** — Socle technique (PWA, Supabase, tenant, migration RLS)
- [x] **Phase 2** — Offline-first (Dexie, file de synchronisation, indicateur réseau)
- [x] **Phase 3** — QR Code (génération, impression 80 mm, scan atelier)
- [x] **Phase 4** — Paiement Mobile Money (CinetPay, 2 Edge Functions, retour de paiement)
- [x] **Phase 5** — PWA & UX (connexion Supabase, écran hors ligne, bouton retour Android, guide utilisateur)
- [x] **Phase 6** — QA (Vitest, isolation multi-tenant, CHANGELOG, tag `v0.1.0-mvp`) — *Lighthouse à relever sur un déploiement réel*
- [x] **Palier 0** — Rendre l'état fiable (audit, feuille de route, CI)
- [x] **Palier 1** — Stabilisation technique (paiement, sync `version`, HMAC, rôles)
- [x] **Palier 2** — Cœur ERP (catalogue, caisse, reçus, workflow, réclamations)
- [x] **Palier 3** — V1.2 (clients, stock, fournisseurs, dépenses, tableau de bord)
- [x] **Palier 4** — SaaS (abonnements, plusieurs pressings par compte, supervision, support)

---

## 9. Sécurité — rappels

- Ne jamais commiter `.env` (déjà couvert par `.gitignore`).
- La clé `service_role` contourne la RLS : usage exclusif dans les Edge Functions.
- Les montants sont relus en base dans `cinetpay-init` : un client malveillant peut appeler
  l'API directement, il ne peut pas imposer le montant.
- Le webhook CinetPay est authentifié par signature HMAC en production ; l'absence de clé
  secrète provoque un refus (503) au lieu d'une validation silencieuse.
- `payment_status` n'est modifiable que par le serveur : le trigger `guard_order_update`
  rejette toute écriture provenant d'un utilisateur authentifié (42501).
- `stock_movements` est un **journal immuable** : la RLS refuse `update` et `delete`,
  même au propriétaire. Seule la fonction `apply_stock_movement` écrit la quantité.
- `expenses` est lisible et modifiable **uniquement par le propriétaire** du pressing ;
  un réceptionniste ne voit strictement rien, pas même les totaux agrégés.
- La vue `expense_totals` est en `security_invoker` : elle hérite de la RLS des
  dépenses au lieu de la contourner.
- Un abonnement **échu ou suspendu** ferme les écritures par des politiques RLS
  restrictives **et** par un déclencheur sur `payment_transactions`,
  `payment_refunds` et `stock_movements` : les fonctions `security definer` ne
  servent pas de porte dérobée. Les lectures restent ouvertes.
- `platform_admins` n'a **aucune politique RLS** : la liste des éditeurs n'est
  lisible que par les fonctions `security definer` et la clé `service_role`.
- L'en-tête `x-tenant-id` n'est honoré que si `is_tenant_member()` confirme le
  rattachement du compte au pressing demandé.
