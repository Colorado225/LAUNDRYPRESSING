# Pressing Pro — SaaS de gestion de pressing (Côte d'Ivoire)

> MVP multi-tenant destiné à être revendu en abonnement à des pressings d'Abidjan.
> Application **strictement en français**, pensée pour des **tablettes Android d'entrée de gamme**
> et **résiliente aux coupures internet**.

**État actuel : Phase 3 terminée** (socle, offline-first et module QR Code).

---

## 1. Périmètre du MVP

Le MVP couvre **quatre modules**, et rien d'autre :

| # | Module | Statut |
|---|--------|--------|
| 1 | **Gestion des commandes** (création, listing, statuts, empesage, broderie fragile) | ✅ phase 2 (base locale) |
| 2 | **QR Code** (génération par commande + scan atelier) | ✅ phase 3 |
| 3 | **Offline-first** (création sans internet, synchronisation automatique) | ✅ phase 2 |
| 4 | **Paiement Mobile Money** (CinetPay : Wave, Orange Money, MTN MoMo, Moov) | à venir — phase 4 |

Hors périmètre, volontairement reportés en V2 : livraison, fidélité, notifications WhatsApp,
statistiques avancées, gestion des stocks, gestion du personnel, facturation PDF, suivi client public.
Toute suppression liée à ce périmètre est **conservée dans l'historique Git** et tracée dans `AUDIT.md`.

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

### 3.1 Installation

```bash
git clone https://github.com/Colorado225/LAUNDRYPRESSING.git
cd LAUNDRYPRESSING
npm install
```

### 3.2 Variables d'environnement

```bash
cp .env.example .env
```

Renseigner ensuite dans `.env` :

```env
VITE_SUPABASE_URL=https://<votre-projet>.supabase.co
VITE_SUPABASE_ANON_KEY=<clé anon publique>
```

> ⚠️ **Toute variable préfixée `VITE_` est embarquée dans le bundle et donc publique.**
> Les secrets (clé API CinetPay, `service_role`, secret webhook) se configurent
> **côté Supabase**, jamais dans `.env` côté front : voir `.env.example` § 2.

### 3.3 Base de données Supabase

**Option A — projet Cloud (recommandé pour ce MVP)**

1. Créer un projet sur [supabase.com](https://supabase.com).
2. Ouvrir **SQL Editor**, coller le contenu de `supabase/migrations/001_init.sql`, exécuter.
3. Exécuter ensuite `supabase/migrations/002_payments.sql` (table `payment_transactions`
   du module Mobile Money). L'ordre est impératif : la migration 002 référence `orders`.
4. (Optionnel) Exécuter `supabase/seed.sql` pour deux pressings de démonstration.

**Option B — Supabase local**

```bash
supabase start
supabase db push
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" -f supabase/seed.sql
```

### 3.4 Provisionner un utilisateur

Un utilisateur n'a accès à rien tant qu'il n'est pas rattaché à un pressing.
Après avoir créé le compte dans **Authentication > Users** :

```sql
-- 1. Créer le pressing
insert into public.tenants (name, phone)
values ('Pressing Cocody', '+225 07 00 00 00 01')
returning id;

-- 2. Rattacher l'utilisateur (remplacer les deux UUID)
insert into public.tenant_users (user_id, tenant_id, role)
values ('<user-uuid>', '<tenant-uuid>', 'owner');
-- role ∈ ('owner', 'receptionist', 'artisan')

-- 3. (Recommandé) Poser les claims dans le JWT
update auth.users
set raw_app_meta_data =
  coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('tenant_id', '<tenant-uuid>', 'tenant_role', 'owner')
where id = '<user-uuid>';
```

Sans l'étape 3, la fonction `current_tenant_id()` retombe automatiquement sur la table
`tenant_users` (voir commentaire dans la migration). L'étape 3 est la voie officielle,
la seconde n'existe que pour ne pas bloquer le développement.

### 3.5 Lancer l'application

```bash
npm run dev
```

Ouvrir <http://localhost:5173>. Au premier lancement, l'application demande
l'**identifiant du pressing** (UUID) : c'est un écran temporaire, la connexion
Supabase Auth arrivant en phase 5. Utilisez l'UUID créé par `supabase/seed.sql` :

```text
11111111-1111-4111-8111-111111111111
```

ou définissez `VITE_DEMO_TENANT_ID` dans `.env` pour le pré-remplir.

---

## 4. Scripts

| Commande | Rôle |
|----------|------|
| `npm run dev` | Serveur de développement (HMR), exposé sur `0.0.0.0:5173` |
| `npm run build` | Vérification TypeScript **puis** build de production (PWA incluse) |
| `npm run preview` | Sert le build de production (`0.0.0.0:4173`) |
| `npm run lint` | ESLint (`.ts`, `.tsx`, `.js`) |
| `npm run typecheck` | `tsc --noEmit` seul |

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
│   │   ├── OfflineBadge.tsx      # vert / orange / rouge + envoi manuel
│   │   ├── PaymentButton.tsx     # bouton Mobile Money + badges opérateurs
│   │   ├── QrCodeDisplay.tsx     # étiquette 80 mm imprimable
│   │   ├── QrScanner.tsx         # scan caméra (html5-qrcode)
│   │   └── TenantGate.tsx        # sélection du pressing (temporaire, phase 5)
│   ├── constants/orders.ts       # statuts, libellés français, couleurs de badge
│   ├── db/
│   │   ├── localDb.ts            # schéma Dexie (orders, orderItems, pendingPayments)
│   │   ├── ordersRepository.ts   # CRUD local + mapping Supabase
│   │   └── hooks.ts              # useLocalOrders, useCreateOrder, useUpdateOrderStatus
│   ├── lib/
│   │   ├── env.ts                # lecture des variables d'environnement
│   │   ├── supabaseClient.ts     # client Supabase (singleton paresseux)
│   │   ├── tenantContext.ts      # pressing courant (Zustand + persistance)
│   │   ├── formatters.ts         # FCFA, dates et téléphones ivoiriens
│   │   └── ids.ts                # UUID côté client + code QR
│   ├── pages/
│   │   ├── Orders.tsx            # liste (recherche + filtres)
│   │   ├── OrderForm.tsx         # création hors ligne
│   │   ├── OrderDetail.tsx       # fiche + étiquette QR + avancement
│   │   ├── PaymentReturn.tsx     # retour CinetPay (lecture seule)
│   │   └── Atelier.tsx           # scan QR → changement de statut
│   ├── services/
│   │   ├── paymentService.ts     # initiation, redirection, lecture du statut
│   │   └── qrService.ts          # génération / analyse des codes QR
│   ├── schemas/order.ts          # validation Zod (client, téléphone, vêtements)
│   ├── stores/syncStore.ts       # état de synchronisation (Zustand)
│   ├── sync/syncEngine.ts        # envoi des commandes en attente
│   └── types/database.ts         # types alignés sur le schéma SQL
├── supabase/
│   ├── config.toml               # verify_jwt de chaque Edge Function
│   ├── functions/
│   │   ├── _shared/              # client CinetPay, CORS, clients Supabase
│   │   ├── cinetpay-init/        # initialisation du paiement (JWT requis)
│   │   └── cinetpay-webhook/     # notification serveur (sans JWT)
│   ├── migrations/001_init.sql   # schéma multi-tenant + RLS
│   ├── migrations/002_payments.sql # payment_transactions + RLS lecture seule
│   └── seed.sql                  # jeu de démonstration (2 pressings)
├── AUDIT.md                      # rapport de la phase 0
├── BACKLOG.md                    # fonctionnalités explicitement hors périmètre
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

`SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` sont injectées
automatiquement par Supabase — ne pas les définir manuellement.

### Limites de cette phase

- **Aucun test réel n'a pu être exécuté** : ni projet Supabase provisionné, ni
  identifiants marchand CinetPay, ni binaire `deno` dans l'environnement de
  développement. Les Edge Functions ne sont donc **pas typées** (`deno check`) et
  la migration `002_payments.sql` **n'est pas exécutée**. Elles ont été validées
  par relecture et transpilation (`esbuild`), et la logique pure (arrondi, mapping
  des opérateurs, HMAC) par **19/19** assertions exécutées hors Deno.
- Le remboursement, le paiement partiel et le paiement à la livraison sont hors
  périmètre (voir `BACKLOG.md`).
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

## 8. Feuille de route

- [x] **Phase 0** — Audit (`AUDIT.md`)
- [x] **Phase 1** — Socle technique (PWA, Supabase, tenant, migration RLS)
- [x] **Phase 2** — Offline-first (Dexie, file de synchronisation, indicateur réseau)
- [x] **Phase 3** — QR Code (génération, impression 80 mm, scan atelier)
- [x] **Phase 4** — Paiement Mobile Money (CinetPay, 2 Edge Functions, retour de paiement)
- [ ] **Phase 5** — PWA & UX (connexion Supabase, écran hors ligne, bouton retour Android, guide utilisateur)
- [ ] **Phase 6** — QA (Vitest, Lighthouse, test d'isolation, CHANGELOG, tag `v0.1.0-mvp`)

---

## 9. Sécurité — rappels

- Ne jamais commiter `.env` (déjà couvert par `.gitignore`).
- La clé `service_role` contourne la RLS : usage exclusif dans les Edge Functions.
- Les montants sont vérifiés côté serveur (`check (total_amount >= 0)`) et devront l'être
  à nouveau dans l'Edge Function CinetPay : un client malveillant peut appeler l'API directement.
- Le webhook CinetPay devra être authentifié par signature HMAC avant toute mise à jour de
  `payment_status`.
