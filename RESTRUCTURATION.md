Voici un **prompt master** conçu pour être copié-collé directement dans votre agent de codage (Cursor, Claude Code, Windsurf, Cline, etc.). Il est structuré en **phases séquentielles** avec des critères de validation clairs pour éviter que l'agent ne "s'emballe" et produise du code incohérent.

---

# 🎯 PROMPT MASTER — Refonte du template LAUNDRYPRESSING en SaaS MVP

# NB: Applictaion stricement en frnacais

## 🧭 RÔLE ET CONTEXTE

Tu es un **ingénieur logiciel senior full-stack** spécialisé dans les applications SaaS multi-tenant et les architectures **offline-first**. Ta mission est de transformer le template existant `LAUNDRYPRESSING` (dépôt : `https://github.com/Colorado225/LAUNDRYPRESSING.git`) en un **MVP de SaaS de gestion de pressing professionnel pour la Côte d'Ivoire**.

Le produit final est destiné à être revendu en abonnement à des pressings d'Abidjan. Il doit donc être **multi-tenant**, **résilient aux coupures internet**, **compatible Mobile Money (Wave / Orange Money / MTN MoMo)** et **opérationnel sur tablettes Android d'entrée de gamme**.

---

## 📦 PÉRIMÈTRE FONCTIONNEL DU MVP (à ne PAS dépasser)

Le MVP doit couvrir **uniquement** les 4 modules suivants. Toute fonctionnalité hors périmètre (livraison, fidélité, notifications WhatsApp, statistiques avancées, gestion des stocks) doit être **explicitement ignorée** et laissée pour V2 :

1. **Gestion des commandes** (création, listing, changement de statut, spécificités locales : empesage, broderie fragile).
2. **QR Code** (génération par commande + scan pour changer le statut en atelier).
3. **Mode offline-first** (création de commande sans internet, synchronisation automatique au retour de la connexion).
4. **Paiement Mobile Money basique** (intégration CinetPay pour Wave / Orange Money / MTN MoMo / Moov).

---

## 🛠️ STACK TECHNIQUE IMPOSÉE

| Couche               | Technologie                                  | Justification                                |
| -------------------- | -------------------------------------------- | -------------------------------------------- |
| Frontend             | **React + Vite + TypeScript + Tailwind CSS** | Déjà en place dans le template               |
| Base locale          | **Dexie.js** (IndexedDB)                     | Offline-first, léger, éprouvé                |
| Backend / DB cloud   | **Supabase** (PostgreSQL + Auth + RLS)       | Multi-tenant natif via Row-Level Security    |
| Paiement             | **CinetPay API v2**                          | Couvre tous les wallets ivoiriens en une API |
| QR Code (génération) | **`qrcode`** (npm)                           | Léger, rendu canvas/DataURL                  |
| QR Code (scan)       | **`html5-qrcode`**                           | Fonctionne sur caméra de tablette Android    |
| PWA                  | **`vite-plugin-pwa`**                        | Installation et cache de l'UI                |
| État global          | **Zustand**                                  | Remplace les Contextes React trop verbeux    |
| Validation schémas   | **Zod**                                      | Sécurisation des formulaires et des payloads |

⚠️ **Interdictions absolues** : ne pas utiliser Firebase, ne pas utiliser Redux Toolkit, ne pas installer de librairie UI lourde (MUI, AntD). Conserver Tailwind + composants maison.

---

## 🧱 ARCHITECTURE CIBLE MULTI-TENANT

Chaque pressing = un `tenant`. **Toutes** les tables métier (orders, order_items, order_status_history) doivent contenir une colonne `tenant_id UUID NOT NULL` référençant `tenants.id`.

La sécurité est assurée **côté PostgreSQL** via des politiques RLS. Aucune logique de filtrage ne doit reposer uniquement sur le frontend.

**Schéma SQL minimal à créer dans Supabase :**

```sql
-- Tenants (pressings)
create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  created_at timestamptz default now()
);

-- Utilisateurs liés à un tenant
create table tenant_users (
  user_id uuid references auth.users(id) on delete cascade,
  tenant_id uuid references tenants(id) on delete cascade,
  role text check (role in ('owner','receptionist','artisan')) not null,
  primary key (user_id, tenant_id)
);

-- Commandes
create table orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) not null,
  customer_name text not null,
  customer_phone text not null,
  status text check (status in ('received','washing','ironing','ready','delivered','cancelled')) default 'received',
  qr_code text unique not null,
  photo_url text,
  total_amount integer not null, -- en FCFA
  payment_status text check (payment_status in ('pending','paid','partial')) default 'pending',
  payment_method text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  synced_from_local boolean default false
);

-- Lignes de commande (un vêtement)
create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  tenant_id uuid references tenants(id) not null,
  label text not null,             -- ex: "Costume 3 pièces"
  fabric_type text,                -- ex: "Basin", "Wax"
  special_instructions text,       -- ex: "Empesage fort", "Broderie fragile"
  price integer not null
);

-- Historique statuts
create table order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  tenant_id uuid references tenants(id) not null,
  status text not null,
  changed_by uuid references auth.users(id),
  changed_at timestamptz default now()
);

-- RLS
alter table orders enable row level security;
create policy "tenant_isolation_orders" on orders
  for all using (tenant_id = (select tenant_id from tenant_users where user_id = auth.uid()));
-- Répéter la même politique pour order_items et order_status_history
```

---

## 🚦 PLAN D'EXÉCUTION EN 6 PHASES

L'agent doit **exécuter les phases dans l'ordre**, s'arrêter à la fin de chaque phase et **attendre ma validation** avant de passer à la suivante.

---

### ✅ PHASE 0 — Audit du template existant

**Objectif** : produire un rapport d'audit AVANT toute modification.

**Tâches :**

1. Cloner le dépôt dans un répertoire de travail.
2. Lister l'arborescence complète (`tree -L 3 -I node_modules`).
3. Identifier et documenter :
   - La version de React, Vite, TypeScript, Tailwind.
   - Les composants existants réutilisables (formulaires, tableaux, cartes).
   - La ou les solutions de state management actuelles.
   - La structure de routage (React Router ? TanStack Router ?).
   - Les éventuelles dépendances obsolètes ou redondantes.
4. Produire un fichier `AUDIT.md` à la racine avec :
   - Ce qui est **conservé tel quel**.
   - Ce qui est **refactoré**.
   - Ce qui est **supprimé** (avec justification).
5. Proposer un plan de migration des composants existants vers la nouvelle architecture.

**Livrable** : `AUDIT.md` + commit `chore: audit initial`.
**⛔ STOP — attends ma validation.**

---

### ✅ PHASE 1 — Setup socle technique

**Objectif** : poser les fondations sans toucher au métier.

**Tâches :**

1. Installer les dépendances : `dexie`, `dexie-react-hooks`, `qrcode`, `html5-qrcode`, `@supabase/supabase-js`, `zustand`, `zod`, `vite-plugin-pwa`.
2. Configurer `vite.config.ts` avec `vite-plugin-pwa` (mode `injectManifest` ou `generateSW`, cache des assets, `registerType: 'autoUpdate'`).
3. Créer `src/lib/supabaseClient.ts` (variables d'env `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
4. Créer `src/lib/tenantContext.ts` : utilitaire pour récupérer et stocker `tenant_id` de l'utilisateur connecté (à relier plus tard au flux Supabase Auth).
5. Créer le fichier SQL `supabase/migrations/001_init.sql` avec le schéma complet + les politiques RLS.
6. Ajouter les variables dans `.env.example`.
7. Mettre à jour le `README.md` avec la procédure de démarrage (Supabase local via `supabase start` ou projet cloud + migration).

**Critère de validation** : `npm run dev` fonctionne, l'app PWA s'installe, le schéma s'applique sans erreur.
**⛔ STOP — attends ma validation.**

---

### ✅ PHASE 2 — Couche offline-first

**Objectif** : permettre la création et la lecture de commandes **sans internet**.

**Tâches :**

1. Créer `src/db/localDb.ts` (Dexie) avec les stores : `orders` (indexé sur `tenantId`, `status`, `synced`), `orderItems`, `pendingPayments`.
2. Créer `src/db/hooks.ts` exposant :
   - `useLocalOrders()` : retourne les commandes du tenant courant triées par date.
   - `useCreateOrder()` : crée une commande locale + ses items + un `qr_code` unique (format `TENANTID-ORDERID-TIMESTAMP`).
   - `useUpdateOrderStatus()` : change le statut localement.
3. Créer `src/sync/syncEngine.ts` :
   - Fonction `syncPendingOrders()` : récupère toutes les lignes `synced: 0` et les upsert dans Supabase. En cas de succès, marque `synced: 1`. En cas d'échec, laisse en file.
   - Écouteur `window.addEventListener('online', syncPendingOrders)`.
   - Sync périodique toutes les 60 s quand `navigator.onLine === true`.
4. Créer `src/components/OfflineBadge.tsx` : indicateur visuel (vert = sync OK, orange = hors ligne, rouge = erreurs de sync).
5. Tester le flux : couper le réseau (DevTools → Network → Offline), créer une commande, la voir apparaître dans la liste, réactiver le réseau, vérifier la sync dans Supabase.

**Critère de validation** : une commande créée hors ligne apparaît en base Supabase dans les 60 s suivant le retour de la connexion.
**⛔ STOP — attends ma validation.**

---

### ✅ PHASE 3 — Module QR Code

**Objectif** : chaque commande génère un QR unique, scannable en atelier.

**Tâches :**

1. Créer `src/services/qrService.ts` :
   - `generateQrString(orderId, tenantId): string` → format `TENANTID-ORDERID-TIMESTAMP`.
   - `generateQrImage(text): Promise<string>` → retourne une DataURL via `qrcode`.
2. Créer `src/components/QrCodeDisplay.tsx` : affiche le QR en `<img>` avec bouton "Imprimer l'étiquette" (utilise `window.print()` avec CSS `@media print`).
3. Créer `src/components/QrScanner.tsx` : utilise `html5-qrcode`. Prend une prop `onScanSuccess(decodedText)`. Nettoie le scanner au démontage.
4. Créer la page `src/pages/Atelier.tsx` :
   - Bouton "Scanner un vêtement" qui ouvre le scanner en modal.
   - À la lecture : recherche la commande par `qr_code` dans Dexie, affiche les détails et un sélecteur de statut (`received → washing → ironing → ready → delivered`).
   - La mise à jour du statut passe par `useUpdateOrderStatus()` (fonctionne offline).
5. Ajouter un test manuel dans le README : « imprimer une étiquette, la scanner depuis une tablette, changer le statut ».

**Critère de validation** : je peux imprimer un QR, le scanner avec la caméra de mon laptop/tablette, et changer le statut de la commande associée.
**⛔ STOP — attends ma validation.**

---

### ✅ PHASE 4 — Intégration paiement Mobile Money (CinetPay)

**Objectif** : permettre le règlement d'une commande par Wave / Orange Money / MTN MoMo.

**Tâches :**

1. Créer la fonction serverless **Supabase Edge Function** `supabase/functions/cinetpay-init/index.ts` :
   - Reçoit `{ orderId, amount, customerName, customerPhone }` en body.
   - Valide l'utilisateur via le JWT Supabase et vérifie qu'il appartient au bon tenant.
   - Appelle `POST https://api-checkout.cinetpay.com/v2/payment` avec les clés en variables d'env (`CINETPAY_API_KEY`, `CINETPAY_SITE_ID`).
   - Retourne `{ payment_url, transaction_id }`.
2. Créer une Edge Function `cinetpay-webhook` :
   - Reçoit la notification de CinetPay.
   - Vérifie la signature (HMAC).
   - Met à jour `orders.payment_status = 'paid'` et `payment_method`.
3. Côté frontend, créer `src/services/paymentService.ts` :
   - `initiatePayment(orderId, amount, customer)` → appelle l'Edge Function, redirige vers `payment_url`.
4. Créer `src/pages/PaymentReturn.tsx` :
   - Route `/payment/return` où CinetPay redirige l'utilisateur.
   - Affiche un message de succès/échec en interrogeant le statut de la commande.
5. Ajouter un bouton "Payer par Mobile Money" sur la fiche commande.
6. Documenter dans `README.md` : comment créer un compte marchand CinetPay, récupérer les clés, configurer les URLs de retour/webhook.

**Critère de validation** : je peux régler une commande en sandbox CinetPay et le statut `payment_status` passe à `paid` dans Supabase.
**⛔ STOP — attends ma validation.**

---

### ✅ PHASE 5 — Finalisation PWA & UX

**Objectif** : rendre l'app installable et utilisable sur tablette Android en atelier.

**Tâches :**

1. Configurer `manifest.webmanifest` (nom, icônes 192/512, `display: standalone`, thème couleur).
2. Ajouter un écran de fallback offline (`offline.html` ou route `/offline`).
3. Ajouter la gestion du bouton "Retour" Android (via `useNavigate` + `window.history`).
4. Appliquer un design **mobile-first** avec Tailwind : gros boutons tactiles (`min-h-12`), contrastes élevés, pas de hover-only interactions.
5. Ajouter un fichier `src/pages/Login.tsx` avec Supabase Auth (email/password) et liaison au `tenant_id` via `tenant_users`.
6. Rédiger un `docs/USER_GUIDE.md` : parcours réceptionniste, parcours artisan, parcours propriétaire.

**Critère de validation** : l'app s'installe sur mon téléphone Android depuis Chrome, fonctionne en mode avion pour créer une commande, et se resynchronise au retour du réseau.
**⛔ STOP — attends ma validation.**

---

### ✅ PHASE 6 — QA et livraison MVP

**Tâches :**

1. Écrire des tests Vitest sur les modules critiques : `qrService`, `syncEngine`, `useCreateOrder`.
2. Passer un audit Lighthouse sur la PWA (viser > 90 sur Performance, PWA, Accessibility).
3. Vérifier que **toutes** les requêtes Supabase retournent uniquement les données du tenant courant (test manuel : créer 2 tenants, se connecter à chacun, vérifier l'isolation).
4. Préparer un `CHANGELOG.md` du MVP.
5. Créer un tag git `v0.1.0-mvp`.

**Critère de validation** : tests verts, isolation multi-tenant confirmée, tag posé.

---

## 📏 RÈGLES DE TRAVAIL POUR L'AGENT

1. **Ne jamais dépasser le périmètre du MVP.** Toute fonctionnalité non listée doit être refusée et documentée dans `BACKLOG.md`.
2. **Ne jamais modifier les fichiers de config globaux sans justification écrite** (ex : `tsconfig.json`).
3. **Un commit par tâche logique**, avec un message au format Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`).
4. **Commenter le code** en français, avec un focus sur les décisions techniques non évidentes (RLS, sync, offline).
5. **Ne jamais coder en dur** : clés API, `tenant_id`, numéros de téléphone → tout en `.env` ou paramétrage.
6. **Priorité absolue à la robustesse** : toute fonctionnalité offline doit être testée en mode avion avant d'être validée.
7. **Demander confirmation** si une décision technique majeure sort du cadre imposé.
8. **À la fin de chaque phase**, rédiger un récapitulatif de 10 lignes : ce qui a été fait, ce qui a été testé, ce qui bloque, ce qui vient ensuite.

---

## 🎁 LIVRABLES FINAUX ATTENDUS

- Un dépôt `LAUNDRYPRESSING` restructuré, avec :
  - Un `README.md` clair (installation, variables d'env, migrations Supabase, lancement).
  - Un dossier `supabase/migrations/` versionné.
  - Un dossier `supabase/functions/` avec les 2 Edge Functions.
  - Un dossier `docs/` (AUDIT, USER_GUIDE, BACKLOG).
  - Un tag `v0.1.0-mvp`.
- Un MVP déployé (Vercel pour le front, Supabase Cloud pour le back) accessible via une URL de staging.
- Un compte-rendu final de 1 page : ce qui fonctionne, ce qui reste à faire en V2, coût réel consommé (CinetPay commissions, Supabase).

---

**Commence par exécuter la PHASE 0 uniquement, puis présente-moi le rapport `AUDIT.md` et attends ma validation explicite avant de continuer.**
