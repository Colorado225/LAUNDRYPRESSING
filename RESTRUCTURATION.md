# 🎯 CAHIER DES CHARGES — Pressing Pro (SaaS de gestion de pressing)

> **Version 2.0 — 27 octobre 2026.** Ce document **remplace** le « prompt master » de la
> version 1.0, qui décrivait un MVP de 4 modules. Le produit livré est un **ERP de
> gestion de pressing** : ce cahier des charges décrit désormais **ce qui existe**,
> **ce qui reste à faire** et **ce qui est refusé**, avec les mêmes règles de travail.
>
> Historique de la version 1.0 : conservée dans Git (`9a2f5d3`), résumée au § 11.

# NB : Application strictement en français

---

## 🧭 RÔLE ET CONTEXTE

Tu es un **ingénieur logiciel senior full-stack** spécialisé dans les applications SaaS
multi-tenant et les architectures **offline-first**. Ton terrain de travail est le dépôt
`LAUNDRYPRESSING` (`https://github.com/Colorado225/LAUNDRYPRESSING.git`), qui exploite
**Pressing Pro**, un logiciel de gestion de pressing destiné à être revendu en abonnement
à des pressings d'Abidjan.

Le produit doit rester :

- **multi-tenant** (un pressing = un `tenant`, isolation par RLS PostgreSQL) ;
- **résilient aux coupures internet** (écriture locale d'abord, synchronisation différée) ;
- **compatible Mobile Money** (Wave / Orange Money / MTN MoMo / Moov via CinetPay) ;
- **opérationnel sur tablettes Android d'entrée de gamme**.

---

## 📦 PÉRIMÈTRE FONCTIONNEL LIVRÉ

Le périmètre n'est plus « 4 modules » : le produit couvre le **parcours complet d'un
pressing**. Chaque module ci-dessous est **livré, testé et présent dans `src/`**.

### 1. Commandes (cœur du produit)

| Fonction                                                   | État | Fichiers                                                                                                                 |
| ---------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------ |
| Création en 3 étapes (client → vêtements → paiement)       | ✅   | `pages/OrderForm.tsx`, `schemas/order.ts`                                                                                |
| Listing, recherche, filtres, pagination                    | ✅   | `pages/Orders.tsx`, `lib/pagination.ts`                                                                                  |
| Fiche détaillée (timeline, statut, reçu)                   | ✅   | `pages/OrderDetail.tsx`                                                                                                  |
| Cycle de statut complet (9 états)                          | ✅   | `received → sorting → washing → drying → ironing → quality_check → ready → delivered` + `cancelled`                      |
| Échéance promise, alertes de retard                        | ✅   | `orders.dueDate`                                                                                                         |
| Attribution à un employé                                   | ✅   | `components/AssignmentPanel.tsx`                                                                                         |
| Lignes de vêtement libres (libellé, tissu, prix, quantité) | ✅   | `components/OrderItemsEditor.tsx`                                                                                        |
| Spécificités locales : **empesage**, **broderie fragile**  | ✅   | `order_items.special_instructions`, `constants/garmentTypes.ts`                                                          |
| Prestations au kilo et lots pesés                          | ✅   | `laundry_weight_kg`, `garment_details`                                                                                   |
| Réclamations et vêtements abîmés                           | ✅   | `components/IssuePanel.tsx`, `services/issueService.ts`                                                                  |
| Mesures client historisées                                 | ✅   | `components/OrderMeasurementEditor.tsx`, `components/OrderMeasurementHistory.tsx`, `services/orderMeasurementHistory.ts` |
| Prévenir le client (WhatsApp / appel, journalisé)          | ✅   | `components/NotifyPanel.tsx`, `lib/notifications.ts`                                                                     |

### 2. QR Code

| Fonction                                            | État | Fichiers                       |
| --------------------------------------------------- | ---- | ------------------------------ |
| Génération d'un QR unique par commande              | ✅   | `services/qrService.ts`        |
| Affichage + impression d'étiquette 80 mm            | ✅   | `components/QrCodeDisplay.tsx` |
| Scan caméra à l'atelier (tablette Android)          | ✅   | `components/QrScanner.tsx`     |
| Changement de statut par scan, y compris hors ligne | ✅   | `pages/Atelier.tsx`            |

### 3. Offline-first

| Fonction                                                        | État | Fichiers                                                |
| --------------------------------------------------------------- | ---- | ------------------------------------------------------- |
| Écriture locale d'abord (IndexedDB)                             | ✅   | `db/localDb.ts` (15 versions), `db/ordersRepository.ts` |
| Synchronisation automatique (retour réseau + boucle)            | ✅   | `sync/syncEngine.ts`                                    |
| Synchronisation immédiate à l'enregistrement                    | ✅   | `syncOrderNow`                                          |
| **Verrou optimiste** (`serverVersion`) et résolution de conflit | ✅   | `db/localDb.ts` v3, `components/ConflictBanner.tsx`     |
| Indicateur d'état de synchronisation                            | ✅   | `components/OfflineBadge.tsx`, `stores/syncStore.ts`    |
| Écran de repli hors ligne                                       | ✅   | `pages/Offline.tsx`                                     |

### 4. Paiements

| Fonction                                          | État                             | Fichiers                                                                             |
| ------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------ |
| Mobile Money CinetPay (Wave, Orange, MTN, Moov)   | 🟡 codé, **non recetté en réel** | `supabase/functions/cinetpay-init`, `cinetpay-webhook`, `services/paymentService.ts` |
| Encaissements espèces, acomptes, solde            | ✅                               | `components/CashPanel.tsx`, `services/cashService.ts`                                |
| Clôture de caisse                                 | ✅                               | `pages/Caisse.tsx`                                                                   |
| Remboursements (espèces, propriétaire uniquement) | ✅                               | `services/refundService.ts`                                                          |
| Reçu 80 mm et facture A4                          | ✅                               | `pages/Receipt.tsx`, `pages/Facture.tsx`, `services/receiptService.ts`               |

### 5. Gestion et administration

| Module                                                   | État | Fichiers                                                   |
| -------------------------------------------------------- | ---- | ---------------------------------------------------------- |
| Clients (fiches, historique, CRUD)                       | ✅   | `pages/Clients.tsx`, `services/customerService.ts`         |
| Stock et fournisseurs                                    | ✅   | `pages/Stock.tsx`, `services/stockService.ts`              |
| Dépenses                                                 | ✅   | `pages/Depenses.tsx`, `services/expenseService.ts`         |
| Tableau de bord                                          | ✅   | `pages/TableauDeBord.tsx`, `services/dashboardService.ts`  |
| Rapports (périodes, comparaison, export CSV)             | ✅   | `pages/Rapports.tsx`, `lib/reporting.ts`                   |
| Paramètres (pressing, équipe, sécurité, données locales) | ✅   | `pages/Parametres.tsx`, `services/tenantMembers.ts`        |
| Prestations activées par le pressing                     | ✅   | `pages/ServicesPressing.tsx`, `services/tenantServices.ts` |
| Journal d'audit                                          | ✅   | `pages/Audit.tsx`, `services/auditService.ts`              |
| Abonnement (période réglée par l'éditeur)                | ✅   | `pages/Abonnement.tsx`, `services/subscriptionService.ts`  |
| Support                                                  | ✅   | `pages/Support.tsx`                                        |
| Supervision plateforme (administrateur éditeur)          | ✅   | `pages/Supervision.tsx`, `services/platformService.ts`     |

### Hors périmètre — refusé et consigné

Toute demande n'apparaissant pas ci-dessus est **refusée** et consignée dans
[`docs/BACKLOG.md`](docs/BACKLOG.md) : livraison et tournées, fidélité, notifications SMS,
prélèvement automatique, remboursement CinetPay, codes-barres 1D, temps réel multi-appareils.

---

## 🛠️ STACK TECHNIQUE

| Couche          | Technologie                                             | Version                                    |
| --------------- | ------------------------------------------------------- | ------------------------------------------ |
| Frontend        | **React + Vite + TypeScript strict + Tailwind CSS 4**   | React 19.2, Vite 8, TS 6.0.3, Tailwind 4.2 |
| Routage         | **React Router 7** (routes en `lazy`)                   | 7.14                                       |
| Base locale     | **Dexie / IndexedDB**                                   | 4.4.6                                      |
| Backend / DB    | **Supabase** (PostgreSQL + Auth + RLS + Edge Functions) | supabase-js 2.118                          |
| Paiement        | **CinetPay API v2**                                     | —                                          |
| QR (génération) | **`qrcode`**                                            | 1.5.4                                      |
| QR (scan)       | **`html5-qrcode`**                                      | 2.3.8                                      |
| PWA             | **`vite-plugin-pwa`**                                   | 2.0.0                                      |
| État global     | **Zustand**                                             | 5.0.16                                     |
| Validation      | **Zod**                                                 | 4.6.7                                      |
| Icônes / toasts | lucide-react, react-hot-toast                           | 1.11 / 2.6                                 |
| Tests           | Vitest, jsdom, fake-indexeddb, PostgreSQL               | 5.0.5                                      |

### ⚠️ Interdictions absolues

- **Aucun Firebase**, **aucun Redux Toolkit**, **aucune librairie UI lourde** (MUI, AntD).
- **Aucune librairie d'animation JavaScript** (`framer-motion` a été retiré le 27 octobre
  2026 : 1,67 Mo de paquet pour des tablettes bas de gamme). Les animations sont en
  **CSS uniquement**, et respectent `prefers-reduced-motion`.

> TypeScript est épinglé en **6.0.3** car `typescript-eslint` ne supporte pas encore TS 7.

---

## 🧱 ARCHITECTURE MULTI-TENANT

Chaque pressing = un `tenant`. **Toutes** les tables métier portent `tenant_id UUID NOT NULL`.
La sécurité est assurée **côté PostgreSQL** via RLS ; aucun filtrage ne repose sur le frontend seul.

### Modèle d'isolation en place

```sql
-- Tenant courant : JWT en priorité, sinon rattachement dans tenant_users.
create or replace function public.current_tenant_id() returns uuid ...
create or replace function public.current_tenant_role() returns text ...

-- Chaque politique est séparée par opération, avec WITH CHECK explicite.
create policy "..." on public.orders
  for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_tenant_role() in ('owner', 'receptionist')
  );
```

**Règles non négociables :**

1. **Toujours `WITH CHECK`** sur `insert`/`update` — jamais `FOR ALL`.
2. **Cohérence de tenant entre une commande et ses lignes** : FK composites
   `(order_id, tenant_id) references orders(id, tenant_id)`. Jamais seulement `order_id`.
3. **`tenants`** : `update` réservé au rôle `owner`. Aucune écriture client sur `tenant_users`.
4. **Rôles** : `owner`, `receptionist`, `artisan` — contrôlés par `lib/permissions.ts` côté UI
   **et** par les politiques côté serveur.
5. Toute opération sensible (suppression de commande, remboursement, clôture de caisse)
   passe par une fonction `security definer` contrôlant le rôle.

### Migrations

`supabase/migrations/001_init.sql` → `026_client_sync_events.sql`, **additives** dès que
possible. Une migration destructive (ex. `020_suppression_tarification…`) doit être
**précédée d'une sauvegarde** et **annoncée dans le README**.

---

## 🗂️ ARBORESCENCE CIBLE

```text
src/
├── App.tsx                    # Router + AuthGate, routes en lazy()
├── components/                # dont ui/ (button, field, input, label, select)
├── constants/                 # orders, garmentTypes
├── db/                        # localDb (Dexie), *Repository, hooks
├── hooks/                     # useAndroidBackButton, usePrefersReducedMotion
├── lib/                       # supabaseClient, tenantContext, permissions, formatters,
│                              # orderPricing, reporting, facturation, impression
├── pages/                     # 1 page = 1 route
├── schemas/                   # validation Zod
├── services/                  # accès serveur / métier
├── stores/                    # Zustand (syncStore)
├── sync/                      # syncEngine
├── test/                      # Vitest (jsdom, fake-indexeddb)
└── types/                     # database.ts
supabase/
├── migrations/                # 001 → 026, versionnées
├── functions/                 # cinetpay-init, cinetpay-webhook, _shared/
└── tests/                     # contrôles SQL
docs/                          # AUDIT-COURANT, BACKLOG, CRUD-COMPLET, USER_GUIDE…
```

### Routes livrées

`/` (connexion) · `/bienvenue` · `/commandes` · `/commandes/nouvelle` · `/commandes/:orderId`
· `/commandes/:orderId/recu` · `/commandes/:orderId/facture` · `/atelier` · `/caisse`
· `/tableau-de-bord` · `/rapports` · `/clients` · `/stock` · `/depenses` · `/abonnement`
· `/support` · `/supervision` · `/parametres` · `/audit` · `/offline` · `/paiement/retour`

---

## 🚦 RÈGLES DE TRAVAIL POUR L'AGENT

1. **Ne jamais dépasser le périmètre du § « Périmètre fonctionnel livré ».** Toute
   fonctionnalité nouvelle doit d'abord être refusée et consignée dans `BACKLOG.md`, ou
   faire l'objet d'une décision explicite de l'éditeur.
2. **La chaîne de vérification doit rester verte** avant tout commit :
   `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Un build rouge est un
   bug bloquant, jamais un détail.
3. **Un commit par tâche logique**, en **Conventional Commits** (`feat:`, `fix:`, `chore:`,
   `refactor:`, `docs:`, `test:`).
4. **Commenter en français**, sur les décisions non évidentes uniquement (RLS, offline,
   synchronisation, calculs de prix). Pas de commentaire qui paraphrase le code.
5. **Ne jamais coder en dur** : clés API, `tenant_id`, numéros de téléphone, montants
   d'abonnement. Tout passe par `.env` ou par la base.
6. **Aucun secret dans une variable `VITE_*`** : ces variables finissent dans le bundle.
   Les secrets CinetPay et `service_role` vivent dans les secrets des Edge Functions.
7. **Robustesse offline d'abord** : toute fonctionnalité qui touche une commande doit être
   éprouvée en mode avion avant d'être considérée comme livrée.
8. **Ne jamais modifier la configuration globale** (`tsconfig.json`, `vite.config.ts`,
   `eslint.config.js`) sans justification écrite dans le message de commit.
9. **Les documents de référence ne mentent pas.** `docs/AUDIT-COURANT.md` doit refléter les
   contrôles réellement exécutés, datés. Un document d'audit faux est une anomalie P1.
10. **Un seul document de référence par sujet** : pas de troisième audit contradictoire.

---

## ✅ DÉFINITION DE « LIVRÉ »

Une fonctionnalité est livrée lorsque **les cinq conditions** sont réunies :

| #   | Condition                                                                    |
| --- | ---------------------------------------------------------------------------- |
| 1   | Le parcours fonctionne **à l'écran**, pas seulement dans les tests           |
| 2   | `typecheck`, `lint`, `test` et `build` passent                               |
| 3   | Le comportement **hors ligne** est vérifié s'il touche une commande          |
| 4   | L'isolation par tenant est assurée côté serveur (RLS), pas seulement côté UI |
| 5   | Les messages utilisateur sont en **français**                                |

---

## 📏 ÉTAT DE VÉRIFICATION (27 octobre 2026)

| Contrôle                             | Résultat                                                             |
| ------------------------------------ | -------------------------------------------------------------------- |
| `npm run typecheck`                  | ✅                                                                   |
| `npm run lint`                       | ✅                                                                   |
| `npm test`                           | ✅ **661 tests / 62 fichiers**                                       |
| `npm run build`                      | ✅ bundle principal 477,7 kB (143,6 kB gzip), sous le seuil d'alerte |
| Migrations SQL 001 → 026             | ✅ appliquées sur Supabase réel (projet `Pressing_Pro`)              |
| Isolation multi-tenant (2 pressings) | ✅ vérifiée (`supabase/tests/isolation.sql`, `recette_reelle.sql`)   |
| **Paiement CinetPay en réel**        | ❌ **non recetté** — secrets Edge Functions non renseignés           |
| Lighthouse PWA                       | ❌ non rejoué sur déploiement HTTPS                                  |

---

## 🎁 RESTE À FAIRE AVANT MISE EN VENTE

Par ordre de priorité. Ces points sont **bloquants pour la commercialisation**, pas pour le développement.

| #   | Point                                                         | Pourquoi c'est bloquant                                                                    |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | **Recette CinetPay en sandbox**                               | Un encaissement non vérifié de bout en bout expose à un défaut de règlement en production  |
| 2   | **Recette de la webhook** (signature, rejeu, idempotence)     | Une webhook non signée est un vecteur de fraude                                            |
| 3   | **Sauvegarde / export des données d'un tenant**               | Un pressing qui part doit pouvoir récupérer ses données ; c'est une obligation commerciale |
| 4   | **Audit Lighthouse sur HTTPS**                                | Objectif > 90 Performance / PWA / Accessibilité                                            |
| 5   | **Politique de rétention et de suppression** (RGPD-like)      | Données clients (nom, téléphone) conservées sans durée définie                             |
| 6   | **Chiffrage réel** (commissions CinetPay, Supabase, Vercel)   | Condition du prix d'abonnement                                                             |
| 7   | **Tests de charge** au-delà de quelques milliers de commandes | Les rapports lisent IndexedDB : à réévaluer (voir `BACKLOG.md`)                            |

---

## 📚 DOCUMENTS DE RÉFÉRENCE

| Document                        | Objet                                                  | Statut                                |
| ------------------------------- | ------------------------------------------------------ | ------------------------------------- |
| `docs/AUDIT-COURANT.md`         | **État vérifié du dépôt** — contrôles, limites connues | ✅ référence                          |
| `docs/PHASE-0-AUDIT-CONSTAT.md` | Audit de reprise du 27/10/2026 (périmètre, anomalies)  | ✅ référence                          |
| `docs/CONFORMITE-MVP.md`        | Correspondance écran par écran maquette ↔ code         | ✅ référence                          |
| `docs/CRUD-COMPLET.md`          | Matrice des opérations d'écriture par rôle             | ✅ référence                          |
| `docs/RECETTE-SUPABASE.md`      | Procédure de recette sur un projet réel                | ✅ référence                          |
| `docs/BACKLOG.md`               | Hors périmètre et dette identifiée                     | ⚠️ à recadrer (marqué « historique ») |
| `docs/AUDIT.md`                 | Audit du point de départ (`ae2903f`)                   | 🗄️ archive                            |

---

## 11. Historique — ce que disait la version 1.0

La version 1.0 (23 octobre 2026) imposait un **MVP de 4 modules** : commandes, QR code,
offline-first et paiement Mobile Money. Ce périmètre a été **largement dépassé** par le
développement (paliers 1 à 5, migrations 003 → 026).

Les écarts entre la version 1.0 et le produit livré ont été constatés le 27 octobre 2026
dans `docs/PHASE-0-AUDIT-CONSTAT.md`. La présente version 2.0 aligne le contrat sur la
réalité : **le produit est un ERP de pressing**, et c'est ce périmètre qui fait foi.

Points de la version 1.0 **définitivement abandonnés** :

- le découpage en 6 phases séquentielles (le produit est livré et en maintenance) ;
- l'interdiction de `framer-motion` **est conservée** et a été appliquée ;
- le schéma SQL minimal du § Architecture v1.0 est **remplacé** par les 26 migrations réelles ;
- la politique RLS de démonstration v1.0 (`for all using (select tenant_id from tenant_users …)`)
  **ne doit jamais être réintroduite** : elle échoue dès qu'un utilisateur a deux pressings.

---

**Prochaine action attendue :** traiter les points 1 et 2 du § « Reste à faire avant mise
en vente » (recette CinetPay), ou documenter la sauvegarde/export d'un tenant (point 3).
