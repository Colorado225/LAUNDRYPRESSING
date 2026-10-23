# Pressing Pro — SaaS de gestion de pressing (Côte d'Ivoire)

> MVP multi-tenant destiné à être revendu en abonnement à des pressings d'Abidjan.
> Application **strictement en français**, pensée pour des **tablettes Android d'entrée de gamme**
> et **résiliente aux coupures internet**.

**État actuel : Phase 1 terminée** (socle technique). Les modules métier arrivent aux phases 2 à 6.

---

## 1. Périmètre du MVP

Le MVP couvre **quatre modules**, et rien d'autre :

| # | Module | Statut |
|---|--------|--------|
| 1 | **Gestion des commandes** (création, listing, statuts, empesage, broderie fragile) | à venir — phase 2 |
| 2 | **QR Code** (génération par commande + scan atelier) | à venir — phase 3 |
| 3 | **Offline-first** (création sans internet, synchronisation automatique) | à venir — phase 2 |
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
3. (Optionnel) Exécuter `supabase/seed.sql` pour deux pressings de démonstration.

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

Ouvrir <http://localhost:5173>. La page affichée est la **page de diagnostic du socle**
(elle sera remplacée par la connexion en phase 5) : elle indique l'état de Supabase,
du service worker, du pressing courant et le rendu des formats ivoiriens.

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
│   ├── constants/orders.ts       # statuts, libellés français, couleurs de badge
│   ├── lib/
│   │   ├── env.ts                # lecture des variables d'environnement
│   │   ├── supabaseClient.ts     # client Supabase (singleton paresseux)
│   │   ├── tenantContext.ts      # pressing courant (Zustand + persistance)
│   │   └── formatters.ts         # FCFA, dates et téléphones ivoiriens
│   ├── pages/Socle.tsx           # page de diagnostic (temporaire)
│   └── types/database.ts         # types alignés sur le schéma SQL
├── supabase/
│   ├── migrations/001_init.sql   # schéma multi-tenant + RLS
│   └── seed.sql                  # jeu de démonstration (2 pressings)
├── AUDIT.md                      # rapport de la phase 0
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

---

## 8. Feuille de route

- [x] **Phase 0** — Audit (`AUDIT.md`)
- [x] **Phase 1** — Socle technique (PWA, Supabase, tenant, migration RLS)
- [ ] **Phase 2** — Offline-first (Dexie, file de synchronisation, indicateur réseau)
- [ ] **Phase 3** — QR Code (génération, impression 80 mm, scan atelier)
- [ ] **Phase 4** — Paiement Mobile Money (CinetPay, 2 Edge Functions, retour de paiement)
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
