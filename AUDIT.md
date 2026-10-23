# AUDIT.md — Rapport d'audit du template LAUNDRYPRESSING (PHASE 0)

Date : 2026-10-23
Dépôt audité : `https://github.com/Colorado225/LAUNDRYPRESSING.git` (dossier local `mufti-laundry-website`)

---

## 1. Versions détectées (package.json)

| Couche | Technologie | Version détectée | Version cible (RESTRUCTURATION.md) | Écart |
|--------|-------------|------------------|-----------------------------------|-------|
| Framework | React | ^19.2.4 | React + TypeScript | ❌ Pas de TypeScript, JS pur (.jsx) |
| Build tool | Vite | ^8.0.4 | Vite | ✅ |
| Styling | Tailwind CSS | ^4.2.2 | Tailwind CSS | ✅ |
| Routing | react-router-dom | ^7.14.0 | React Router | ✅ (à conserver) |
| État global | React Context (AuthContext) | — | Zustand | ❌ À remplacer |
| HTTP client | Axios | ^1.14.0 | — | À remplacer par Supabase client |
| Base de données | API custom (localhost:5000/api) | — | Supabase (PostgreSQL + RLS) | ❌ À remplacer |
| Auth | AuthContext maison (localStorage JWT) | — | Supabase Auth | ❌ À remplacer |
| PWA | Aucun | vite-plugin-pwa | vite-plugin-pwa | ❌ À ajouter |
| QR Code | Aucun | qrcode / html5-qrcode | qrcode / html5-qrcode | ❌ À ajouter |
| Validation | Aucun | Zod | Zod | ❌ À ajouter |
| Offline / IndexedDB | Aucun | Dexie.js | Dexie.js | ❌ À ajouter |
| Paiement | Aucun | CinetPay API v2 | CinetPay API v2 | ❌ À ajouter |
| TypeScript | Non installé | TypeScript | TypeScript | ❌ À ajouter |

> Note : le README indique React 18, mais `package.json` déclare React ^19.2.4. Le projet est écrit en JavaScript (`.jsx`), pas en TypeScript.

---

## 2. Arborescence complète (depth 3, hors node_modules)

```
.
├── .env.example
├── .gitignore
├── DEPLOYMENT_GUIDE.md
├── README.md
├── RESTRUCTURATION.md
├── eslint.config.js
├── index.html
├── package-lock.json
├── package.json
├── vercel.json
├── vite.config.js
├── public/
│   ├── favicon.svg
│   └── icons.svg
└── src/
    ├── api/
    │   └── axios.js
    ├── assets/
    │   ├── hero.png
    │   ├── react.svg
    │   └── vite.svg
    ├── components/
    │   ├── AdminLayout.jsx
    │   ├── BillingModal.jsx
    │   ├── CreateOrderModal.jsx
    │   ├── PaymentModal.jsx
    │   ├── PrintableTag.jsx
    │   ├── Receipt.jsx
    │   ├── StatusUpdateModal.jsx
    │   ├── protectedRoute.jsx
    │   └── workCard.jsx
    ├── context/
    │   └── AuthContext.jsx
    ├── hooks/
    │   └── useAuth.js
    ├── index.css
    ├── main.jsx
    ├── muftiLandingpage/
    │   ├── MuftiLandingPage.jsx
    │   ├── components/
    │   ├── data/
    │   ├── hooks/
    │   └── utils/
    └── pages/
        ├── DashboardOverview.jsx
        ├── InvoiceView.jsx
        ├── Login.jsx
        ├── Orders.jsx
        ├── Services.jsx
        ├── StaffDashboard.jsx
        ├── StaffManagement.jsx
        └── TrackOrder.jsx
```

---

## 3. Analyse détaillée

### 3.1 Routage
React Router v7 (`BrowserRouter`, `Routes`, `Route`, `Navigate`, `Outlet`, `Link`, `useNavigate`) dans `src/App.jsx`.
- Routes publiques : `/`, `/track`, `/login`, `/invoice/:orderId`
- Routes admin (sous `AdminLayout`, `ProtectedRoute adminOnly`) : `/dashboard`, `/dashboard/orders`, `/dashboard/services`, `/dashboard/staff`
- Route staff : `/staff` (`ProtectedRoute staffOnly`)
- Fallback : `*` → `/`

### 3.2 Authentification
`src/context/AuthContext.jsx` + `src/hooks/useAuth.js` :
- Contexte React maison, état dans `localStorage` (`token`, `user`)
- Pas de Supabase Auth, pas de RLS, pas de `tenant_id`
- `ProtectedRoute` vérifie `user.role` (`ADMIN` / `STAFF`)

### 3.3 Couche API
`src/api/axios.js` : instance Axios avec `baseURL = VITE_API_BASE_URL || http://localhost:5000/api`, intercepteur d'injection du token Bearer, intercepteur de réponse (gestion 401, toasts d'erreur).

### 3.4 Composants réutilisables identifiés

| Fichier | Rôle | Réutilisable pour le MVP |
|---------|------|--------------------------|
| `AdminLayout.jsx` | Layout sidebar + header + `Outlet` | Oui (à adapter multi-tenant) |
| `protectedRoute.jsx` | Garde de route par rôle | Oui (à adapter tenant_id) |
| `CreateOrderModal.jsx` | Création de commande avec panier | Oui (refactor : items = vêtements, offline) |
| `PrintableTag.jsx` | Tag garment imprimable (`@media print`) | Oui (étiquette QR) |
| `Receipt.jsx` | Reçu client | Non (hors périmètre MVP) |
| `StatusUpdateModal.jsx` | Changement de statut + assignation staff | Oui (atelier, statut reçu→lavage→repassage→prêt) |
| `BillingModal.jsx` | Facturation / solde client | Non (hors périmètre MVP) |
| `PaymentModal.jsx` | Enregistrement paiement | Oui (à adapter Mobile Money) |
| `workCard.jsx` | Carte de travail | Oui (à adapter) |

### 3.4 Pages identifiées

| Fichier | Rôle | Sort MVP |
|---------|------|----------|
| `Login.jsx` | Connexion staff/admin | Oui (à refaire avec Supabase Auth + tenant) |
| `Orders.jsx` | Liste et gestion des commandes | Oui (cœur du MVP) |
| `DashboardOverview.jsx` | Tableau de bord exécutif | Oui (allégé) |
| `Services.jsx` | Catalogue de services | Non (hors périmètre) |
| `StaffDashboard.jsx` | Espace opérateur | Oui (atelier) |
| `StaffManagement.jsx` | Gestion du personnel | Non (hors périmètre) |
| `InvoiceView.jsx` | Facture détaillée | Non (hors périmètre) |
| `TrackOrder.jsx` | Suivi public client | Non (hors périmètre) |
| `MuftiLandingPage.jsx` | Page d'accueil marketing | Non (hors périmètre MVP) |

### 3.5 État global
Aucune librairie de gestion d'état (Zustand, Redux). Uniquement React Context (`AuthContext`). À remplacer par Zustand per la stack imposée.

### 3.6 Dépendances obsolètes / redondantes / hors périmètre
- `framer-motion` : animations, hors périmètre MVP (conserver si déjà utilisé, mais ne pas ajouter de nouvelle UI lourde)
- `html2canvas-pro`, `html2pdf.js`, `react-to-print` : génération PDF/Canvas, non requis par le MVP (PrintableTag fait déjà l'impression CSS)
- `react-helmet-async` : gestion du head, non essentiel
- `axios` : remplacé par `@supabase/supabase-js`
- Tailwind v4 est déjà en place (bonne nouvelle)

### 3.7 Ce qui manque par rapport à la stack imposée
- TypeScript (projet en JS pur)
- `@supabase/supabase-js`
- `dexie` + `dexie-react-hooks`
- `zustand`
- `zod`
- `qrcode`
- `html5-qrcode`
- `vite-plugin-pwa`
- Supabase Edge Functions (`cinetpay-init`, `cinetpay-webhook`)
- Migrations SQL Supabase (`supabase/migrations/001_init.sql`)

---

## 4. Ce qui est conservé tel quel

1. `vite.config.js` (Vite + React + Tailwind v4) — base de build saine.
2. `tailwindcss` ^4.2.2 et `@tailwindcss/vite` — déjà conformes.
3. `react-router-dom` ^7.14.0 — structure de routage conservée (à adapter aux nouvelles pages MVP).
4. `src/components/AdminLayout.jsx` — layout réutilisable (sidebar + Outlet), à adapter au multi-tenant.
5. `src/components/protectedRoute.jsx` — garde de route réutilisable, à adapter à `tenant_id` / Supabase Auth.
6. `src/components/PrintableTag.jsx` — impression CSS `@media print` réutilisable pour les étiquettes QR.
7. `src/components/CreateOrderModal.jsx` — formulaire de création de commande réutilisable (refactor vers items = vêtements, offline-first).
8. `src/components/StatusUpdateModal.jsx` — cycle de statut réutilisable pour l'atelier.
9. `src/components/PaymentModal.jsx` — base pour le bouton paiement Mobile Money.
10. `src/index.css` — directives Tailwind.
11. `vercel.json` — réécritures SPA pour le déploiement front (Vercel).
12. `public/favicon.svg`, `public/icons.svg` — assets statiques.

---

## 5. Ce qui est refactoré

1. **Langage** : passage de JavaScript (`.jsx`) à TypeScript (`.tsx`).
2. **Authentification** : `AuthContext` maison + `localStorage` → Supabase Auth (`auth.users`) lié à `tenant_users`.
3. **Couche données** : Axios vers API custom (`localhost:5000/api`) → `@supabase/supabase-js` + RLS multi-tenant (`tenant_id`).
4. **État global** : React Context → Zustand.
5. **Base locale / offline** : aucun → Dexie.js (IndexedDB) avec stores `orders`, `orderItems`, `pendingPayments`.
6. **Pages** : les pages hors périmètre (Services, StaffManagement, InvoiceView, TrackOrder, MuftiLandingPage) sont retirées ou désactivées ; les pages MVP (Login, Orders, DashboardOverview, StaffDashboard/Atelier, PaymentReturn) sont refondues.
7. **Composants** : `CreateOrderModal`, `StatusUpdateModal`, `PaymentModal` refactorisés pour le modèle de données pressing (tenant_id, vêtements, statut reçu/lavage/repassage/prêt/livré).
8. **Build** : ajout de `vite-plugin-pwa`, `zod`, `qrcode`, `html5-qrcode`.

---

## 6. Ce qui est supprimé (avec justification)

| Élément | Justification |
|---------|---------------|
| `src/pages/Services.jsx` | Hors périmètre MVP (pas de catalogue de services dans les 4 modules) |
| `src/pages/StaffManagement.jsx` | Hors périmètre MVP (gestion du personnel = V2) |
| `src/pages/InvoiceView.jsx` | Hors périmètre MVP (facturation avancée = V2) |
| `src/pages/TrackOrder.jsx` | Hors périmètre MVP (suivi public client = V2) |
| `src/muftiLandingpage/` | Page marketing hors périmètre MVP (back-office pressing uniquement) |
| `src/components/BillingModal.jsx` | Hors périmètre MVP (billing avancé = V2) |
| `src/components/Receipt.jsx` | Hors périmètre MVP (reçu détaillé = V2) |
| `framer-motion` | Librairie UI lourde d'animation, non requise (interdiction des librairies UI lourdes) |
| `html2canvas-pro`, `html2pdf.js`, `react-to-print` | Génération PDF/Canvas non requise (impression CSS via `PrintableTag`) |
| `react-helmet-async` | Non essentiel au MVP |
| `axios` | Remplacé par `@supabase/supabase-js` |
| `AuthContext` maison + `localStorage` token | Remplacé par Supabase Auth + RLS |

Ces suppressions sont consignées dans `BACKLOG.md` (à créer en Phase 6) pour une éventuelle V2.

---

## 7. Plan de migration des composants vers la nouvelle architecture

| Composant actuel | Destination MVP | Modifications principales |
|------------------|-----------------|---------------------------|
| `AdminLayout.jsx` | `src/layouts/AdminLayout.tsx` | TypeScript, tenant switcher, Supabase Auth |
| `protectedRoute.jsx` | `src/components/ProtectedRoute.tsx` | Vérification `tenant_id` via `tenant_users`, rôle owner/receptionist/artisan |
| `CreateOrderModal.jsx` | `src/components/CreateOrderModal.tsx` | Dexie local-first, items = vêtements (label, tissu, instructions spéciales), `qr_code` auto-généré |
| `PrintableTag.jsx` | `src/components/QrCodeDisplay.tsx` | QR Code + impression étiquette |
| `StatusUpdateModal.jsx` | `src/pages/Atelier.tsx` (scanner) | Statuts pressing (received/washing/ironing/ready/delivered), scan QR |
| `PaymentModal.jsx` | `src/components/PaymentButton.tsx` | Appel Edge Function CinetPay, redirection `payment_url` |
| `Login.jsx` | `src/pages/Login.tsx` | Supabase Auth email/password, liaison `tenant_id` |
| `Orders.jsx` | `src/pages/Orders.tsx` | Liste des commandes du tenant (Dexie + Supabase sync), filtres par statut |
| `DashboardOverview.jsx` | `src/pages/Dashboard.tsx` | Métriques allégées du tenant courant |

---

## 8. Livrable de la Phase 0

- ✅ `AUDIT.md` produit (ce fichier)
- ⏳ Commit `chore: audit initial` — en attente de votre validation pour passer à la Phase 1

---

**⛔ STOP — J'attends votre validation explicite avant de commencer la Phase 1 (Setup socle technique).**
