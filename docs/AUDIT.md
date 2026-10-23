# AUDIT.md — Phase 0 : audit du template LAUNDRYPRESSING

**Date de l'audit :** 23 octobre 2026
**Commit audité :** `ae2903f` — *feat: setup socle technique Phase 1 (TypeScript, Supabase, PWA, tenant context, migration)*
**Branche :** `arena/9283dd0f-laundrypressing`
**Dépôt :** `https://github.com/Colorado225/LAUNDRYPRESSING.git`
**Référentiel :** `RESTRUCTURATION.md` (prompt master, 6 phases)

---

## 0. Synthèse exécutive

Le dépôt est aujourd'hui **un template de démonstration « Mufti Laundry » (marché nigérian)** — interface **100 % en anglais**, devise **Naira (₦)**, et **aucune** des briques du MVP demandé (offline-first, QR Code, CinetPay, Supabase Auth).

Le socle technique de la Phase 1 a déjà été **partiellement posé** (commit `ae2903f` : dépendances, `supabaseClient.ts`, `tenantContext.ts`, migration SQL, `vite-plugin-pwa`), mais **le code applicatif n'a pas été raccordé** : `supabaseClient.ts` et `tenantContext.ts` ne sont importés nulle part, et l'application continue de fonctionner (ou plutôt de ne pas fonctionner) sur l'ancienne API Axios `http://localhost:5000/api`, qui n'existe plus.

**Verdict :** le build passe, mais **l'application est non fonctionnelle à l'exécution** (authentification cassée, toutes les requêtes de données pointent vers un backend inexistant). La refonte demandée est donc bien un **chantier de fond**, pas un simple habillage.

**5 points bloquants (P0) :**

| # | Constat | Impact |
|---|---------|--------|
| 1 | `AuthContext` n'expose plus `login` / `logout`, mais `Login.jsx` et `AdminLayout.jsx` les appellent | `TypeError: login is not a function` → aucun utilisateur ne peut se connecter |
| 2 | Toutes les données passent par Axios vers `http://localhost:5000/api` | Aucune commande, aucun service, aucune statistique ne se charge |
| 3 | Aucun code offline (Dexie), aucun QR, aucun paiement Mobile Money | 3 des 4 modules du MVP sont à créer intégralement |
| 4 | Modèle métier incompatible : statuts `REQUESTED/PICKED_UP/BILLED/PROCESSING/READY/DELIVERED` et devise Naira | Le schéma Supabase cible (`received/washing/ironing/...`, FCFA) n'est adossé à aucune UI |
| 5 | Interface intégralement en anglais (159 libellés anglais pour 14 français) | Non-conformité directe à « Application strictement en français » |

**Volumétrie :** 6 730 lignes dans `src/`, dont **2 572 lignes (38 %) hors périmètre MVP** (page marketing `muftiLandingpage/`) et **333 lignes de code mort commenté** dans `DashboardOverview.jsx`. Le bundle de production pèse **2,03 Mo (561 Ko gzip)** : trop lourd pour des tablettes Android d'entrée de gamme.

**Effort estimé pour atteindre le MVP :** ~90 % du code applicatif est à écrire ou refondre ; le socle (build, PWA, Tailwind v4, migration SQL) est réutilisable.

---

## 1. Périmètre et méthode

1. Clone local du dépôt, branche de travail `arena/9283dd0f-laundrypressing` (base : `main`, commit `ae2903f`).
2. Inventaire complet de l'arborescence (`find`, hors `node_modules` et `.git`).
3. Lecture intégrale des fichiers de configuration, des 8 pages, des 9 composants métier, du contexte d'authentification, de la couche API et de la migration SQL.
4. **Vérifications d'exécution réalisées** (aucune modification de code source à ce stade) :
   - `npm ci` → 531 paquets installés, 0 erreur ;
   - `npm run build` → succès (Vite 8.0.7), PWA générée ;
   - `npx tsc --noEmit` → succès (0 erreur) ;
   - `npm run lint` → succès (0 erreur) ;
   - `git check-ignore` sur `.env.local` → correctement ignoré.
5. Aucun fichier source n'a été modifié en Phase 0 ; **seul `AUDIT.md` est livré**.

> **Note importante — état réel du dépôt.** Le commit de base contient déjà les livrables annoncés pour la Phase 1 (dépendances, `.env.example`, `README.md` mis à jour, `vite.config.ts` avec `vite-plugin-pwa`, `src/lib/supabaseClient.ts`, `src/lib/tenantContext.ts`, `supabase/migrations/001_init.sql`). Cet audit décrit donc **l'état constaté** et non l'état théorique du template d'origine. Les écarts de ce socle sont traités au § 15.

---

## 2. Arborescence complète (profondeur 3, hors `node_modules`)

```text
.
├── .env.example                                  # mis à jour Phase 1 (contient encore des restes Axios)
├── .gitignore                                    # ⚠ dernière ligne concaténée : ".env.localnode_modules/"
├── docs/AUDIT.md                                 # ← ce rapport (réécrit)
├── DEPLOYMENT_GUIDE.md                           # obsolète (parle de VITE_API_BASE_URL)
├── README.md                                     # mis à jour Phase 1, mais décrit des features inexistantes
├── RESTRUCTURATION.md                            # cahier des charges
├── eslint.config.js                              # ne couvre que .js/.jsx
├── index.html                                    # lang="en", title="laundry-frontend"
├── package.json / package-lock.json              # 531 paquets
├── tsconfig.json                                 # strict, allowJs, checkJs:false, alias @/* inexistant côté Vite
├── vercel.json                                   # SPA rewrites OK
├── vite.config.ts                                # Vite 8 + React 19 + Tailwind v4 + PWA
├── public/
│   ├── favicon.svg
│   └── icons.svg                                 # ⚠ sprite d'icônes sociales (bluesky, discord…) utilisé comme icône PWA
├── supabase/
│   └── migrations/
│       └── 001_init.sql                          # schéma + RLS (Phase 1)
└── src/
    ├── main.jsx                                  # 9 l.
    ├── App.jsx                                   # 122 l. — routage + Toaster + listeners online/offline
    ├── index.css                                 # 275 l. — @theme Tailwind v4 (palette Mufti)
    ├── vite-env.d.ts
    ├── api/
    │   └── axios.js                              # 54 l. — instance Axios + intercepteurs JWT
    ├── assets/                                   # hero.png, react.svg, vite.svg
    ├── components/                               # 9 fichiers, 1 301 l.
    │   ├── AdminLayout.jsx                       # 187 l. — sidebar + header + <Outlet/>
    │   ├── BillingModal.jsx                      # 245 l.
    │   ├── CreateOrderModal.jsx                  # 270 l.
    │   ├── PaymentModal.jsx                      # 137 l.
    │   ├── PrintableTag.jsx                      # 87 l. — étiquette 80 mm + @media print
    │   ├── Receipt.jsx                           # 53 l.
    │   ├── StatusUpdateModal.jsx                 # 192 l.
    │   ├── protectedRoute.jsx                    # 28 l.
    │   └── workCard.jsx                          # 102 l.
    ├── context/
    │   └── AuthContext.jsx                       # 72 l. — ⚠ login/logout supprimés (code commenté)
    ├── hooks/
    │   └── useAuth.js                            # 9 l. — doublon de l'export de AuthContext
    ├── lib/                                      # Phase 1
    │   ├── supabaseClient.ts                     # 14 l. — jamais importé
    │   └── tenantContext.ts                      # 30 l. — store Zustand, jamais importé
    ├── muftiLandingpage/                         # 28 fichiers, 2 572 l. — HORS PÉRIMÈTRE
    │   ├── MuftiLandingPage.jsx                  # 82 l.
    │   ├── components/                           # 19 composants marketing
    │   ├── data/                                 # branches.js, navigation.js, services.js, testimonials.js
    │   ├── hooks/                                # useCounter, useInView, useScrollPosition
    │   └── utils/                                # vide
    └── pages/                                    # 8 fichiers, 2 650 l.
        ├── DashboardOverview.jsx                 # 719 l. (333 lignes commentées = code mort)
        ├── InvoiceView.jsx                       # 174 l. — hors périmètre
        ├── Login.jsx                             # 143 l. — casse : appelle un login inexistant
        ├── Orders.jsx                            # 433 l. — cœur métier actuel
        ├── Services.jsx                          # 637 l. — hors périmètre
        ├── StaffDashboard.jsx                    # 168 l. — embryon d'atelier
        ├── StaffManagement.jsx                   # 174 l. — hors périmètre
        └── TrackOrder.jsx                        # 202 l. — hors périmètre
```

**Fichiers TypeScript/TSX réellement présents :** 3 fichiers `.ts` (`supabaseClient.ts`, `tenantContext.ts`, `vite-env.d.ts`) et **0 fichier `.tsx`**. Les 40 fichiers `.jsx` constituent l'application.

---

## 3. Versions réelles (vérifiées dans `node_modules`)

| Couche | Technologie | Version déclarée | Version installée | Cible `RESTRUCTURATION.md` |
|--------|-------------|------------------|-------------------|-----------------------------|
| Framework UI | React | `^19.2.4` | **19.2.4** | React + TS ✅ |
| Runtime DOM | react-dom | `^19.2.4` | 19.2.4 | ✅ |
| Build | Vite | `^8.0.4` | **8.0.7** | Vite ✅ |
| Plugin React | @vitejs/plugin-react | `^6.0.1` | 6.0.1 | ✅ |
| Langage | TypeScript | `7.0.2` | **7.0.2** | TypeScript ⚠ (présent mais inexploité) |
| CSS | Tailwind CSS | `^4.2.2` | **4.2.2** | Tailwind ✅ |
| Plugin Tailwind | @tailwindcss/vite | `^4.2.2` | 4.2.2 | ✅ |
| Routage | react-router-dom | `^7.14.0` | 7.14.0 | React Router ✅ |
| État global | Zustand | `5.0.16` | 5.0.16 | Zustand ✅ (installé, 1 seul store technique) |
| État global (legacy) | React Context | — | — | ❌ à remplacer |
| Base cloud | @supabase/supabase-js | `2.118.0` | 2.118.0 | ✅ (client créé, non utilisé) |
| Base locale | dexie / dexie-react-hooks | `4.4.6` / `4.4.0` | 4.4.6 / 4.4.0 | ✅ (installé, **aucun code**) |
| QR génération | qrcode | `1.5.4` | 1.5.4 | ✅ (installé, **aucun code**) |
| QR scan | html5-qrcode | `2.3.8` | 2.3.8 | ✅ (installé, **aucun code**) |
| Validation | zod | `4.6.7` | 4.6.7 | ✅ (installé, **aucun code**) |
| PWA | vite-plugin-pwa | `2.0.0` | 2.0.0 | ✅ (configuré) |
| HTTP legacy | axios | `^1.14.0` | 1.14.0 | ❌ à retirer |
| Animations | framer-motion | `^12.38.0` | 12.38.0 | ❌ hors périmètre |
| Tests | vitest | *absent* | — | ❌ Phase 6 |

**Environnement d'exécution vérifié :** Node **22.22.3**, npm **10.9.8**, lockfile v3.

> ⚠ **Versions très récentes.** `vite@8`, `typescript@7` et `react@19` sont des majeures récentes. Elles fonctionnent (`build` OK), mais l'écosystème `supabase-js` / `vite-plugin-pwa` peut présenter des incompatibilités marginales : **à figer** dans le `package.json` (pas de `^`) pour la production, afin d'éviter des builds non reproductibles sur Vercel.

---

## 4. Analyse technique de l'existant

### 4.1 Routage — React Router v7

`src/App.jsx` utilise `BrowserRouter` + `Routes`/`Route` (API déclarative, pas de `createBrowserRouter`). Structure actuelle :

| Chemin | Composant | Protection | Sort MVP |
|--------|-----------|-----------|----------|
| `/` | `MuftiLandingPage` | publique | ❌ supprimé |
| `/track` | `TrackOrder` | publique | ❌ supprimé |
| `/login` | `Login` | publique | ✅ refondu |
| `/invoice/:orderId` | `InvoiceView` | publique | ❌ supprimé |
| `/dashboard` (index) | `DashboardOverview` | `ProtectedRoute adminOnly` | ⚠ refondu |
| `/dashboard/orders` | `Orders` | idem | ✅ refondu |
| `/dashboard/services` | `Services` | idem | ❌ supprimé |
| `/dashboard/staff` | `StaffManagement` | idem | ❌ supprimé |
| `/staff` | `StaffDashboard` | `ProtectedRoute staffOnly` | ✅ refondu en `/atelier` |
| `*` | `Navigate to="/"` | — | ✅ conservé (cible à adapter) |

**Manques structurels :** aucune route de retour de paiement (`/payment/return`), aucune route `/offline`, aucun lazy-loading (`React.lazy`), donc un bundle monolithique.

### 4.2 Authentification et rôles

- `AuthContext.jsx` : contexte maison, état lu depuis `localStorage` (`token`, `user`). **`login`, `logout`, `loading` fonctionnel ont été retirés** (l'implémentation Axios est restée en commentaire, lignes 1-40). Seuls `user` et `setUser` sont exposés.
- `ProtectedRoute` vérifie `user.role === 'ADMIN' | 'STAFF'` — **rôles non conformes** à la cible (`owner` / `receptionist` / `artisan`).
- `hooks/useAuth.js` duplique exactement le hook exporté par `AuthContext.jsx` (code mort).
- Aucune notion de `tenant_id`, aucune session Supabase, aucun refresh token, aucune gestion d'expiration JWT (le token est posé en `localStorage`, vulnérable au XSS).
- `PaymentModal.jsx` poste `receivedById: "current-user-id"` — **valeur codée en dur** (violation de la règle 5 du prompt master).

### 4.3 Accès aux données

- `src/api/axios.js` : instance Axios, `baseURL = VITE_API_BASE_URL || 'http://localhost:5000/api'`, intercepteur Bearer + toast d'erreur global.
- **Aucun fichier `.env` fourni** : en l'état, toutes les requêtes visent `localhost:5000`, backend absent du dépôt.
- Endpoints consommés : `/auth/login`, `/services`, `/orders/book`, `/orders/all`, `/orders/status/:id`, `/admin/stats`, `/admin/staff`, `/payments/record/:id`.
- **Aucune requête Supabase** dans le code applicatif : `supabaseClient.ts` n'est importé par aucun module.

### 4.4 Gestion d'état

| Mécanisme | Utilisation actuelle | Verdict |
|-----------|----------------------|---------|
| React Context | `AuthContext` (session + role) | Remplacé par Zustand (store `auth`) |
| `useState` local | 100 % des modales et listes | À conserver pour l'UI locale |
| Zustand | `tenantContext.ts` (Phase 1) | Socle conservé, **à généraliser** |
| TanStack Query | absent | Non imposé — `dexie-react-hooks` couvrira le live-query |

### 4.5 Offline / PWA

- `vite-plugin-pwa` configuré en `generateSW` + `registerType: 'autoUpdate'`, précache des assets, `dist/sw.js` généré (vérifié).
- **Manques :** pas de `runtimeCaching` pour Supabase, pas de route `/offline`, pas de bannière de mise à jour, icônes PWA invalides (voir § 8), `orientation: 'portrait'` inadapté à une tablette d'atelier.
- **Aucune persistance locale** : pas de Dexie, pas de file d'attente de synchronisation, pas de détection `navigator.onLine` au-delà d'un simple toast (`App.jsx`).

### 4.6 Localisation (écart majeur avec le cahier des charges)

| Élément | État actuel | Attendu |
|---------|-------------|---------|
| Langue de l'interface | **Anglais** (`Sign In`, `New Order`, `Basket`, `Ready for Pickup`…) | **Français strict** |
| Devise | **Naira `₦`** dans 12 fichiers + `toLocaleString()` sans locale | **FCFA `FCFA`** en entier |
| Statuts métier | `REQUESTED`, `PICKED_UP`, `BILLED`, `PROCESSING`, `READY`, `DELIVERED` | `received`, `washing`, `ironing`, `ready`, `delivered`, `cancelled` |
| Marque | « Mufti Spot », numéros WhatsApp nigérians `+234…` codés en dur | Marque du tenant, paramétrable |
| `<html lang>` | `en` | `fr` |

C'est l'écart le plus coûteux du chantier : il touche **tous** les composants conservés.

---

## 5. Inventaire des composants et pages (réutilisabilité)

### 5.1 Composants

| Fichier | Rôle | Réutilisable ? | Décision |
|---------|------|----------------|----------|
| `AdminLayout.jsx` | Sidebar + header + `<Outlet/>`, drawer mobile | Oui, structure solide | **Refactoré** → `layouts/AppLayout.tsx` (nav FR, badge offline, tenant) |
| `protectedRoute.jsx` | Garde par rôle | Oui, logique simple | **Refactoré** → `ProtectedRoute.tsx` (session Supabase + rôle tenant) |
| `CreateOrderModal.jsx` | Formulaire de commande + panier + recherche | Partiellement (dépend d'Axios et d'un catalogue serveur) | **Refactoré** → création offline Dexie + Zod, items = vêtements |
| `StatusUpdateModal.jsx` | Cycle de statuts + assignation staff | Partiellement (5 statuts, assignation hors périmètre) | **Refactoré** → sélecteur de statut simple, réutilisé par l'atelier |
| `PrintableTag.jsx` | Étiquette 80 mm prête à imprimer (`@media print`) | **Oui, très bon** (CSS d'impression déjà propre) | **Refactoré** → `QrCodeDisplay.tsx` (on remplace le code-barres texte par le QR) |
| `workCard.jsx` | Carte de tâche avec chrono | Oui (UI) | **Refactoré** en carte de commande atelier |
| `PaymentModal.jsx` | Enregistrement de paiement manuel (cash/transfer/POS) | Non (hors périmètre : le MVP = Mobile Money en ligne) | **Supprimé / remplacé** par `PaymentButton.tsx` |
| `BillingModal.jsx` | Facturation, remises, solde | Non (hors périmètre) | **Supprimé** |
| `Receipt.jsx` | Reçu client | Non (hors périmètre) | **Supprimé** |
| `hooks/useAuth.js` | Doublon du hook du contexte | Non (doublon) | **Supprimé** |
| `muftiLandingpage/**` | Site marketing (28 fichiers) | Non | **Supprimé** |

**Ce qui manque totalement (à créer) :** composants de formulaire génériques, `OfflineBadge`, `QrScanner`, `QrCodeDisplay`, `Modal` réutilisable, `Button`, `Input`, `StatCard` génériques, `SyncStatus`, `Toast` FR — **il n'existe aujourd'hui aucune bibliothèque de composants UI maison** : chaque écran réimplémente ses classes Tailwind (d'où le `min-h-12`/contraste non garantis).

### 5.2 Pages

| Page | Lignes | Valeur pour le MVP | Décision |
|------|--------|--------------------|----------|
| `Login.jsx` | 143 | Structure visuelle réutilisable | **Refondu** (Supabase Auth + tenant) |
| `Orders.jsx` | 433 | Liste + filtres + tags + modales | **Refondu** (Dexie + QR + paiement) |
| `StaffDashboard.jsx` | 168 | Embryon de vue atelier | **Refondu** → `Atelier.tsx` (scanner QR) |
| `DashboardOverview.jsx` | 719 | 333 lignes de code mort commenté ; KPI hors périmètre | **Réécrit de zéro**, version allégée |
| `Services.jsx` | 637 | Catalogue + CRUD service | **Supprimé** (hors périmètre) |
| `StaffManagement.jsx` | 174 | CRUD personnel | **Supprimé** (hors périmètre) |
| `InvoiceView.jsx` | 174 | Facture publique | **Supprimé** (hors périmètre) |
| `TrackOrder.jsx` | 202 | Suivi public client | **Supprimé** (hors périmètre) |
| `MuftiLandingPage` | 2 572 | Site vitrine | **Supprimé** (hors périmètre) |

---

## 6. Dépendances obsolètes, redondantes ou hors périmètre

| Paquet | Version | Statut | Justification |
|--------|---------|--------|---------------|
| `axios` | 1.14.0 | ❌ **à retirer** | Remplacé par `@supabase/supabase-js` ; backend `localhost:5000` inexistant |
| `framer-motion` | 12.38.0 | ❌ **à retirer** | Animation lourde, interdite par le prompt master ; utilisée dans 8 fichiers → à remplacer par des transitions CSS/Tailwind |
| `html2pdf.js` | 0.14.0 | ❌ **à retirer** | Génération PDF hors périmètre (l'impression CSS suffit) |
| `html2canvas-pro` | 2.0.2 | ❌ **à retirer** | Idem |
| `react-to-print` | 3.3.0 | ❌ **à retirer** | Idem (remplacé par `window.print()` + `@media print`) |
| `react-helmet-async` | 3.0.0 | ❌ **à retirer** | Utilisé uniquement par la landing page (supprimée) |
| `react-icons` | 5.6.0 | ⚠ **à vérifier/retirer** | `lucide-react` couvre déjà tous les besoins (doublon d'iconothèque) |
| `react-hot-toast` | 2.6.0 | ✅ **conservé** | Léger, adapté ; messages à traduire en français |
| `lucide-react` | 1.11.0 | ✅ **conservé** | Icônes SVG légères |
| `@types/node` | 26.6.5 | ⚠ **à déplacer** en `devDependencies` | N'est pas une dépendance d'exécution |
| `typescript` | 7.0.2 | ⚠ **à déplacer** en `devDependencies` | Idem |

**Gain estimé après nettoyage :** 6 paquets lourds retirés, bundle réduit d'environ **700 Ko à 900 Ko** (les 2,03 Mo actuels incluent framer-motion, html2pdf/html2canvas et la landing page).

---

## 7. Santé du build (mesurée le 23/10/2026)

| Commande | Résultat | Détail |
|----------|----------|--------|
| `npm ci` | ✅ Succès | 531 paquets en 9 s |
| `npm run build` | ✅ Succès | Vite 8.0.7, build en 1,54 s |
| `npx tsc --noEmit` | ✅ Succès | 0 erreur — **mais `checkJs: false` : aucun `.jsx` n'est réellement typé** |
| `npm run lint` | ✅ Succès | 0 erreur — **mais la config ESLint ignore les fichiers `.ts/.tsx`** |

**Artefacts produits :**

| Fichier | Taille | Gzip |
|---------|--------|------|
| `dist/assets/index-*.js` | **2 034 Ko** | **561 Ko** |
| `dist/assets/index-*.css` | 91 Ko | 14 Ko |
| `dist/sw.js` + `workbox-*.js` | 209 Ko précachés (8 entrées) | — |

⚠ Vite émet un avertissement « chunk > 500 Ko ». Sur une tablette Android d'entrée de gamme en 3G, 561 Ko gzip + la landing page = **temps d'affichage initial rédhibitoire** (objectif contractuel : PWA performante). **Correctif :** suppression des écrans hors périmètre + `React.lazy()` par route.

> **Les trois « ✅ » sont trompeurs :** ils valident la compilation, pas le fonctionnement. Aucun test automatisé n'existe (`0` fichier de test), donc aucune régression n'est détectable aujourd'hui.

---

## 8. Dette technique et anomalies détectées

### 8.1 Bloquantes (P0)

| # | Fichier | Anomalie | Conséquence |
|---|---------|----------|-------------|
| 1 | `context/AuthContext.jsx` | `login`, `logout` absents du `value` du provider | `Login.jsx` (`const { login } = useAuth()`) et `AdminLayout.jsx` (`const { logout } = useAuth()`) plantent à l'appel |
| 2 | `api/axios.js` | `baseURL` par défaut `http://localhost:5000/api` | 100 % des écrans de données restent vides / en erreur |
| 3 | `lib/supabaseClient.ts` | Importé par personne ; `throw` si les variables d'env manquent | Le socle Supabase est inerte |
| 4 | `lib/tenantContext.ts` | Store Zustand jamais lu/écrit | Aucune isolation multi-tenant côté client |
| 5 | global | Aucune page `/atelier`, aucun QR, aucun Dexie, aucun CinetPay | 3 modules du MVP inexistants |

### 8.2 Majeures (P1)

| # | Fichier | Anomalie | Conséquence |
|---|---------|----------|-------------|
| 6 | `vite.config.ts` + `public/icons.svg` | Icône PWA = sprite d'icônes réseaux sociaux, `sizes: 'any'`, aucune icône 192/512 | **Installation PWA refusée par Chrome/Android** |
| 7 | `index.html` | `lang="en"`, `<title>laundry-frontend</title>`, pas de `meta description`, pas de `theme-color` | SEO/accessibilité/lancement PWA dégradés |
| 8 | `tsconfig.json` | Alias `@/*` déclaré ; **aucun alias équivalent dans `vite.config.ts`** | Tout futur import `@/...` cassera le build |
| 9 | `eslint.config.js` | `files: ['**/*.{js,jsx}']` | Les futurs fichiers `.ts/.tsx` ne seront jamais lintés |
| 10 | `pages/DashboardOverview.jsx` | 333 lignes de code mort commenté sur 719 | Maintenance et lisibilité |
| 11 | `pages/*.jsx` | 22 `console.error`/`console.log` en production | Fuite d'informations, bruit |
| 12 | `components/PaymentModal.jsx` | `receivedById: "current-user-id"` codé en dur | Faille de traçabilité |
| 13 | `muftiLandingpage/**` | Numéros WhatsApp `+234…`, URL `muftispot.com` codés en dur | Non-conformité « ne jamais coder en dur » |
| 14 | `.gitignore` | Dernière ligne `*.sw?` + `.env.localnode_modules/` concaténées | `.env.local` reste ignoré par `*.local` (vérifié), mais la ligne est un résidu à corriger |
| 15 | `.env.example` | `VITE_API_BASE_URL` (legacy) + `CINETPAY_API_KEY`/`SITE_ID` au même endroit que les variables publiques | Risque de fuite : **toute variable préfixée `VITE_` est exposée au navigateur**. Les secrets CinetPay doivent vivre dans les *secrets* Supabase Edge Functions |

### 8.3 Mineures (P2)

- Nommage incohérent : `protectedRoute.jsx`, `workCard.jsx` (camelCase) vs `AdminLayout.jsx`.
- Duplication : `hooks/useAuth.js` ≡ hook de `AuthContext.jsx`.
- `build` = `vite build && tsc --noEmit` : les erreurs de type n'apparaissent qu'après un build complet.
- Aucune convention de commit/CI ; pas de `.github/workflows`.
- Pas de `docs/`, `BACKLOG.md`, `CHANGELOG.md`, ni tag git (vérifié : `git tag` vide).
- Absence de `noUncheckedIndexedAccess` dans `tsconfig.json` (robustesse des accès indexés).

---

## 9. Audit de la migration `supabase/migrations/001_init.sql`

**Points conformes :** les 5 tables sont présentes, `tenant_id NOT NULL` sur toutes les tables métier, index de performance créés, trigger `updated_at` sur `orders`, RLS activée sur les 5 tables.

**Points à corriger avant la Phase 2 (critiques) :**

| # | Problème | Impact | Correctif recommandé |
|---|----------|--------|----------------------|
| S1 | Sous-requête `(select tenant_id from tenant_users where user_id = auth.uid())` | **Si un utilisateur appartient à 2 pressings → `ERROR: more than one row returned by a subquery`** : toutes les requêtes échouent | Utiliser le JWT : `tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid`, ou une fonction `current_tenant_id()` avec `limit 1` + sélection explicite du tenant actif |
| S2 | Politique `tenant_users` : `for all using (user_id = auth.uid())` | **Escalade de privilèges** : n'importe quel utilisateur connecté peut s'insérer dans n'importe quel `tenant_id` avec le rôle `owner` | Politique `select` seule pour l'utilisateur ; les insertions passent par `service_role` (invitation) |
| S3 | Politique `tenants` : `for all` | Un membre peut renommer/supprimer son pressing | Restreindre `update`/`delete` au rôle `owner` |
| S4 | `order_items` / `order_status_history` | La politique vérifie `tenant_id` mais **pas la cohérence avec `orders.tenant_id`** | Contrainte FK composite `(order_id, tenant_id)` ou trigger de vérification |
| S5 | Aucun `WITH CHECK` explicite | Comportement implicite acceptable, mais fragile | Déclarer explicitement `with check (...)` sur chaque politique |
| S6 | `id uuid default gen_random_uuid()` | En offline, l'`id` doit être généré **côté client** avant la synchronisation | Générer l'UUID dans Dexie (`crypto.randomUUID()`) et l'envoyer à Supabase |
| S7 | `changed_by uuid references auth.users(id)` sans défaut | L'historique sera vide | `default auth.uid()` + trigger |
| S8 | Aucun seed de démonstration, aucune contrainte d'unicité `(tenant_id, qr_code)` | Impossible de tester l'isolation en Phase 6 | `unique (tenant_id, qr_code)` + `supabase/seed.sql` (2 tenants) |
| S9 | `photo_url text` sans bucket Storage | Colonne morte | Bucket `order-photos` + politiques Storage (V2 si hors périmètre) |
| S10 | Pas de fonction `handle_new_user()` | Inscription orpheline, sans `tenant_users` | Trigger `auth.users` ou création via Edge Function |

> **Aucune de ces corrections n'a été appliquée en Phase 0** : conformément aux règles de travail, la migration est analysée, pas modifiée. Les correctifs S1/S2 sont **indispensables avant la Phase 2**, sinon le mode offline synchronisera dans le vide.

---

## 10. Matrice de conformité au périmètre MVP

| Module imposé | État actuel | Reste à faire |
|---------------|-------------|---------------|
| **1. Gestion des commandes** (création, listing, statuts, empesage, broderie fragile) | 🟡 UI existante mais 100 % adossée à l'API disparue ; statuts et devise non conformes ; aucun champ `fabric_type` / `special_instructions` | Refonte complète : modèle `order_items`, formulaires FR/FCFA, Zod, retrait de la logique de facturation |
| **2. QR Code** (génération + scan atelier) | 🔴 Absent | `qrService`, `QrCodeDisplay`, `QrScanner`, page `Atelier` |
| **3. Offline-first** (Dexie + sync) | 🔴 Absent (toast `offline` uniquement) | `localDb.ts`, `hooks.ts`, `syncEngine.ts`, `OfflineBadge` |
| **4. Paiement Mobile Money** (CinetPay) | 🔴 Absent | 2 Edge Functions, `paymentService`, `PaymentReturn`, bouton de paiement |
| Socle technique (Vite/TS/Tailwind/PWA/Supabase) | 🟡 Posé mais inexploité | Raccordement effectif, correctifs § 15 |
| Auth Supabase + multi-tenant | 🔴 Absent | `Login.tsx`, store Zustand `auth`, `ProtectedRoute` |
| Qualité (léger, tablette Android, FR) | 🔴 Anglais, Naira, bundle 2 Mo | Localisation complète + code-splitting |

**Fonctionnalités hors périmètre à ne pas développer** (à tracer dans `BACKLOG.md` en Phase 6) : livraison, fidélité, notifications WhatsApp, statistiques avancées, gestion de stock, gestion du personnel, facturation/PDF, suivi public, site marketing.

---

## 11. Ce qui est conservé tel quel

1. **`vite.config.ts`** — base Vite + React + Tailwind v4 + PWA saine (seul le bloc `manifest.icons`/`orientation` sera corrigé).
2. **`tailwindcss` 4.2.2 et `@tailwindcss/vite`** — conformes ; le thème `@theme` de `src/index.css` sera réutilisé comme base (palette à rebrander).
3. **`react-router-dom` 7.14.0** et l'architecture déclarative de `App.jsx`.
4. **`lucide-react`** — iconothèque légère conservée.
5. **`react-hot-toast`** — notifications conservées (messages traduits).
6. **`src/components/PrintableTag.jsx`** — la logique d'impression `@media print` 80 mm est excellente, elle sert de base à l'étiquette QR.
7. **`src/components/AdminLayout.jsx`** — structure layout responsive (sidebar + drawer + header) reprise.
8. **`src/components/protectedRoute.jsx`** — pattern de garde de route repris.
9. **`vercel.json`** — réécritures SPA correctes (à ajuster : `deploymentEnabled` limité à `main`).
10. **`src/lib/supabaseClient.ts`** et **`src/lib/tenantContext.ts`** — écrits en Phase 1, conservés (à raccorder).
11. **`supabase/migrations/001_init.sql`** — squelette conservé, politiques RLS corrigées (§ 9).
12. **`public/favicon.svg`**, **`eslint.config.js`** (étendu aux `.ts/.tsx`), **`.gitignore`** (ligne concaténée corrigée).
13. **`React 19`, `Vite 8`, `TypeScript 7`** — versions conservées, mais **figées** (retrait des `^`).

---

## 12. Ce qui est refactoré

| # | Élément | Transformation |
|---|---------|----------------|
| 1 | Langage | `.jsx` → `.tsx` strict pour tout le nouveau code ; `checkJs` activé progressivement ; alias `@/*` aligné entre Vite et TS |
| 2 | Authentification | `AuthContext` + `localStorage` JWT → **Supabase Auth** + store **Zustand** `useAuthStore` + table `tenant_users` |
| 3 | Rôles | `ADMIN`/`STAFF` → `owner` / `receptionist` / `artisan` |
| 4 | Accès données | Axios → **`@supabase/supabase-js`** (cloud) + **Dexie** (local) |
| 5 | État global | React Context → **Zustand** (auth, tenant, sync) |
| 6 | Offline | Rien → **Dexie** (`orders`, `orderItems`, `pendingPayments`) + `syncEngine` (online event + polling 60 s) |
| 7 | Statuts | `REQUESTED/PICKED_UP/BILLED/PROCESSING/READY/DELIVERED` → `received/washing/ironing/ready/delivered/cancelled` |
| 8 | Devise & locale | `₦` + `toLocaleString()` → `FCFA` + `fr-CI`, entiers (XOF sans décimales) |
| 9 | Langue | Anglais → **français intégral** (UI, toasts, erreurs, manifest, `index.html`) |
| 10 | `Orders.jsx` | Liste serveur → liste Dexie réactive (`useLiveQuery`), filtres par statut FR, actions QR + paiement |
| 11 | `CreateOrderModal.jsx` | Panier de services + frais logistique → formulaire vêtements (`label`, `fabric_type`, `special_instructions`, `price`), validation Zod, création locale immédiate |
| 12 | `StatusUpdateModal.jsx` | Workflow NI géant → sélecteur de statut compact réutilisé par l'atelier |
| 13 | `DashboardOverview.jsx` | 719 lignes dont 333 commentées → page allégée (compteurs du jour, commandes récentes) |
| 14 | `StaffDashboard.jsx` | Liste de tâches → `pages/Atelier.tsx` (scan QR + avancement de statut offline) |
| 15 | `Login.jsx` | Formulaire factice → Supabase Auth email/mot de passe + sélection du tenant |
| 16 | `AdminLayout.jsx` | Sidebar EN + branding Mufti → `AppLayout.tsx` FR (Commandes, Atelier, Déconnexion) + `OfflineBadge` |
| 17 | PWA | `manifest` minimal invalide → icônes 192/512, thème, `start_url`, écran `/offline` |
| 18 | ESLint | `.js/.jsx` uniquement → `.ts/.tsx` inclus, règles React Hooks strictes |
| 19 | README / docs | Affirmations non vérifiées, bilingue → docs FR factuelles ; `docs/` (AUDIT, USER_GUIDE, BACKLOG) |

---

## 13. Ce qui est supprimé (avec justification)

| Élément | Lignes | Justification |
|---------|--------|---------------|
| `src/muftiLandingpage/` (28 fichiers) | 2 572 | Site marketing nigérian hors périmètre MVP ; contient des données codées en dur (`+234…`, `muftispot.com`) |
| `src/pages/Services.jsx` | 637 | Catalogue de services : hors périmètre (règle 1) |
| `src/pages/StaffManagement.jsx` | 174 | Gestion du personnel : V2 |
| `src/pages/InvoiceView.jsx` | 174 | Facture publique : V2 |
| `src/pages/TrackOrder.jsx` | 202 | Suivi client public : V2 (non listé dans les 4 modules) |
| `src/components/BillingModal.jsx` | 245 | Facturation/remises/solde : V2 |
| `src/components/Receipt.jsx` | 53 | Reçu détaillé : V2 |
| `src/components/PaymentModal.jsx` | 137 | Paiement manuel cash/POS : remplacé par le Mobile Money CinetPay |
| `src/api/axios.js` | 54 | Backend `localhost:5000` inexistant ; remplacé par Supabase |
| `src/context/AuthContext.jsx` | 72 | Cassé (login/logout retirés) ; remplacé par Supabase Auth + Zustand |
| `src/hooks/useAuth.js` | 9 | Doublon pur |
| `src/pages/DashboardOverview.jsx` | 719 | Réécriture complète (333 lignes de code mort) |
| `framer-motion`, `html2pdf.js`, `html2canvas-pro`, `react-to-print`, `react-helmet-async`, `axios` | — | Voir § 6 |
| `.env.example` : `VITE_API_BASE_URL` | — | Backend supprimé |
| `DEPLOYMENT_GUIDE.md` (réécrit) | 164 | Décrit l'ancien backend Axios et des procédures obsolètes |

**Bilan des suppressions : ≈ 5 000 lignes de code hors périmètre ou mort** (sur 6 730), soit une base de code ramenée à ~1 700 lignes utiles, avant ajout des modules MVP.

> Toute fonctionnalité supprimée est **conservée dans l'historique Git** (commit `ae2903f`) et listée dans `docs/BACKLOG.md`. Aucune perte définitive.

---

## 14. Plan de migration des composants vers la nouvelle architecture

### 14.1 Cible d'arborescence

```text
src/
├── db/                  # localDb.ts (Dexie), hooks.ts (useLocalOrders, useCreateOrder, useUpdateOrderStatus)
├── sync/                # syncEngine.ts (syncPendingOrders, listeners online/visibility)
├── services/            # qrService.ts, paymentService.ts, authService.ts
├── stores/              # authStore.ts, tenantStore.ts, syncStore.ts (Zustand)
├── schemas/             # zod : orderSchema.ts, orderItemSchema.ts, paymentSchema.ts
├── components/          # OfflineBadge, QrCodeDisplay, QrScanner, StatusBadge, ui/ (Button, Input, Card, Modal)
├── layouts/             # AppLayout.tsx (ex-AdminLayout)
├── pages/               # Login.tsx, Orders.tsx, OrderDetail.tsx, Atelier.tsx, PaymentReturn.tsx, Offline.tsx
├── lib/                 # supabaseClient.ts, tenantContext.ts, formatters.ts (FCFA), i18n.ts
└── types/               # database.ts (types générés Supabase), domain.ts
```

### 14.2 Correspondance composant par composant

| Composant actuel | Destination MVP | Nature du travail |
|------------------|-----------------|-------------------|
| `App.jsx` | `App.tsx` + `router.tsx` | Routes FR (`/login`, `/commandes`, `/atelier`, `/paiement/retour`), `React.lazy`, garde de session |
| `AdminLayout.jsx` | `layouts/AppLayout.tsx` | Traduction FR, nav réduite à 2 entrées + atelier, `OfflineBadge`, nom du tenant |
| `protectedRoute.jsx` | `components/ProtectedRoute.tsx` | Session Supabase + rôle `tenant_users` + redirection |
| `context/AuthContext.jsx` | `stores/authStore.ts` + `pages/Login.tsx` | `signInWithPassword`, chargement du tenant, persistance de session |
| `hooks/useAuth.js` | — | Supprimé |
| `api/axios.js` | `lib/supabaseClient.ts` + `db/localDb.ts` | Lecture locale prioritaire, écriture distante via `syncEngine` |
| `CreateOrderModal.jsx` | `components/OrderForm.tsx` + `db/hooks.ts` | Formulaire vêtements + champs locaux (empesage, broderie fragile), Zod, `crypto.randomUUID()`, QR généré localement |
| `Orders.jsx` | `pages/Orders.tsx` | `useLiveQuery` Dexie, filtres FR, badges de statut, accès fiche |
| `StatusUpdateModal.jsx` | `components/StatusSelector.tsx` | 5 statuts actifs + annulation, mise à jour locale |
| `PrintableTag.jsx` | `components/QrCodeDisplay.tsx` | QR en `<img>` (DataURL `qrcode`), bouton « Imprimer l'étiquette », `@media print` conservé |
| — (nouveau) | `components/QrScanner.tsx` | `html5-qrcode`, `onScanSuccess`, nettoyage au démontage |
| `StaffDashboard.jsx` | `pages/Atelier.tsx` | Scan → recherche `qr_code` dans Dexie → détail + sélecteur de statut |
| `PaymentModal.jsx` | `components/PaymentButton.tsx` + `pages/PaymentReturn.tsx` | Edge Function `cinetpay-init`, redirection, retour et vérification du statut |
| `DashboardOverview.jsx` | `pages/Dashboard.tsx` | 4 compteurs simples (à traiter, en lavage, repassage, prêts) |
| `Services/StaffManagement/InvoiceView/TrackOrder/*` | — | Supprimés, tracés dans `BACKLOG.md` |
| `index.css` (`@theme`) | `index.css` rebrandé | Palette neutre/professionnelle + variables de contraste accessibles |
| `vite.config.ts` | idem + `manifest` corrigé | Icônes 192/512, `orientation: 'any'`, `runtimeCaching` Supabase |
| `001_init.sql` | `001_init.sql` corrigé + `002_*.sql` | Corrections RLS S1/S2/S4, contrainte `(tenant_id, qr_code)` |

### 14.3 Séquence de migration (rattachée aux phases du prompt)

| Phase | Migration de composants |
|-------|-------------------------|
| 1 (socle) | Raccorder `supabaseClient.ts` + `tenantContext.ts` ; corriger `index.html`, `manifest`, alias Vite, ESLint TS ; supprimer `axios` |
| 2 (offline) | `localDb.ts` → `hooks.ts` → `syncEngine.ts` → `OfflineBadge` → `OrderForm` + `Orders` branchés sur Dexie |
| 3 (QR) | `qrService` → `QrCodeDisplay` (ex-`PrintableTag`) → `QrScanner` → `Atelier` |
| 4 (paiement) | Edge Functions → `paymentService` → `PaymentButton` → `PaymentReturn` |
| 5 (PWA/UX) | `AppLayout` FR, `Login`, routes lazy, `/offline`, tokens UI (`min-h-12`, contrastes) |
| 6 (QA) | Vitest sur `qrService`, `syncEngine`, `useCreateOrder` ; test d'isolation 2 tenants |

---

## 15. Écarts du socle « Phase 1 » déjà commité — à corriger

Ces éléments sont **présents** dans le commit `ae2903f` mais incomplets ou inexacts. Ils sont listés ici pour être corrigés au début de la Phase 1 (ou au fil des phases), **sans les rejouer inutilement**.

| # | Élément | Écart constaté | Correction |
|---|---------|----------------|------------|
| 1 | `src/lib/supabaseClient.ts` | Créé mais importé nulle part ; `throw` au chargement du module si `.env` absent → écran blanc en dev sans variables | Utiliser `import.meta.env` avec message d'erreur non bloquant + `.env` local documenté |
| 2 | `src/lib/tenantContext.ts` | Store Zustand isolé, non raccordé | Fusionner avec `authStore` (tenant issu de `tenant_users`) |
| 3 | `vite.config.ts` (manifest) | Icône SVG issue d'un sprite social | Générer `pwa-192x192.png` / `pwa-512x512.png` |
| 4 | `.env.example` | Oublie `CINETPAY_SECRET_KEY`/`CINETPAY_NOTIFY_URL` ; mélange secrets serveur et variables publiques | Séparer clairement « Variables front (VITE_) » et « Secrets Edge Functions » |
| 5 | `README.md` | Annonce React 19 + **TypeScript** alors qu'il n'y a aucun `.tsx` ; décrit des fonctionnalités non implémentées (Supabase Auth, Dexie, CinetPay) ; affiche l'auteur tiers et des liens de recherche Google | Réécrire factuellement en Phase 5/6 |
| 6 | `DEPLOYMENT_GUIDE.md` | Documente `VITE_API_BASE_URL` (backend supprimé) | Réécrire (Vercel + Supabase + secrets) |
| 7 | `tsconfig.json` | Alias `@/*` sans équivalent Vite ; `checkJs: false` | Ajouter `resolve.alias` ; activer `checkJs` progressivement |
| 8 | `eslint.config.js` | TS non couvert | Ajouter `typescript-eslint` (déviation à valider, voir § 17) |
| 9 | `supabase/migrations/001_init.sql` | 10 failles/limites (§ 9) | Corriger S1, S2, S4 en priorité |
| 10 | `AUDIT.md` (version précédente) | Déclarait « TypeScript non installé », « Vite absent de la config », « audit en attente » | **Remplacé par le présent rapport** |

---

## 16. Risques identifiés et parades

| Risque | Probabilité | Impact | Parade |
|--------|-------------|--------|--------|
| RLS mal calibrée → fuite de données entre pressings | Moyenne | **Critique** | Corriger S1/S2 avant Phase 2 ; test d'isolation à 2 tenants en Phase 6 |
| Sync offline produisant des doublons | Élevée | Élevé | UUID générés côté client + `upsert` idempotent sur `id` |
| Bundle trop lourd sur tablette Android low-cost | Élevée | Élevé | Suppression hors périmètre + lazy routes + audit Lighthouse |
| `html5-qrcode` indisponible/incompatible sur caméras Android anciennes | Moyenne | Moyen | Fallback saisie manuelle du code QR |
| Webhook CinetPay non signé correctement | Moyenne | **Critique (fraude)** | Vérification HMAC + relecture du statut via l'API CinetPay |
| Versions majeures très récentes (Vite 8 / TS 7) | Moyenne | Moyen | Figer les versions, builds reproductibles |
| Perte de contexte si `localStorage` est vidé (tenant) | Faible | Moyen | Recharger le tenant depuis Supabase à chaque session |
| Secrets exposés (variables `VITE_*`) | Faible | **Critique** | Séparation stricte front/secrets, `.env` jamais commité |

---

## 17. Décisions à valider avant la Phase 1

Le prompt master impose de demander confirmation pour toute décision majeure sortant du cadre. Trois points ne sont pas tranchés par `RESTRUCTURATION.md` et bloqueront la Phase 1 :

1. **TypeScript strict sur l'existant.** Le cahier des charges impose TS, mais l'application actuelle est en `.jsx`. Proposition : **nouveau code 100 % `.tsx` strict**, ancien code supprimé ou migré au fil des phases ; `allowJs` conservé temporairement. Alternative : migration complète immédiate (coût +3 à 4 jours).
2. **Suppression immédiate vs progressive des écrans hors périmètre.** Proposition : suppression **en Phase 1** (gain de bundle immédiat, périmètre clarifié) ; le code reste dans l'historique Git.
3. **Devise et formats.** Proposition : montants stockés en **entiers XOF** (aucun décimal), affichage `1 500 FCFA` via `Intl.NumberFormat('fr-CI')`. Confirmer l'orthographe attendue sur les étiquettes (« FCFA » vs « CFA »).

---

## 18. Livrable de la Phase 0

- ✅ `AUDIT.md` réécrit et conforme à l'état réel du dépôt (ce fichier)
- ✅ Vérifications d'exécution : `npm ci`, `npm run build`, `tsc --noEmit`, `npm run lint` → tous verts
- ✅ Aucun fichier source modifié
- ⏳ Commit `chore: audit initial`

---

## ⛔ STOP — Phase 0 terminée

Conformément au plan d'exécution, je **m'arrête ici** et **j'attends votre validation explicite** avant la **Phase 1 — Setup socle technique**.

Merci de me confirmer, en même temps que votre validation :
1. la stratégie TypeScript (proposition § 17.1) ;
2. la suppression des écrans hors périmètre dès la Phase 1 (§ 17.2) ;
3. le format d'affichage de la devise (§ 17.3).

En l'absence de réponse sur ces trois points, j'appliquerai les propositions par défaut et je le signalerai au début de la Phase 1.

---

## 19. Suites données (mise à jour après validation)

La Phase 0 a été validée et la Phase 1 exécutée. Les décisions du § 17 ont été appliquées par défaut :

1. **TypeScript** : nouveau code 100 % `.tsx` strict (`allowJs: false`), ancien code JSX supprimé.
2. **Périmètre** : écrans hors MVP supprimés dès la Phase 1 (code conservé dans l'historique Git).
3. **Devise** : montants en entiers XOF, affichage `1 500 FCFA` via `Intl.NumberFormat('fr-CI')`.

Deux écarts ont été constatés et documentés dans `README.md` § 7 : TypeScript est épinglé en
**6.0.3** (et non 7.0.2) car `typescript-eslint` ne supporte pas encore TS 7, et les types de
lignes Supabase sont déclarés en `type` et non `interface` (incompatibilité avec `postgrest-js`).
