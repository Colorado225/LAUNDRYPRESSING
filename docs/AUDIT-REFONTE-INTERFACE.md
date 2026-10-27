# Audit — refonte visuelle PressingPro CI

> **Statut : audit livré, aucune ligne de code applicatif modifiée.**
> Ce document répond à l'étape 1 du master prompt (« analyse préalable
> obligatoire ») : ce que le dépôt contient réellement, ce que la maquette
> demande, où les deux se contredisent, et ce que je propose de faire.

Date : 27/10/2026 · Branche : `arena/b47084c6-laundrypressing` · Base : `685b0bf`

---

## 1. Ce que le dépôt contient déjà

| Élément | Réel | Conséquence |
|---|---|---|
| Framework | React 19 + TypeScript strict + Vite 8, React Router 7 | rien à initialiser |
| Styles | **Tailwind CSS 4** via `@tailwindcss/vite`, jetons CSS dans `src/index.css` | classes utilitaires directes, pas de `tailwind.config.js` |
| Composants UI | **pas de shadcn/ui**, pas de Radix, pas de CVA : composants maison + classes utilitaires (`rounded-2xl`, `border-slate-200`, `min-h-12`) | une bibliothèque shadcn serait une seconde couche à maintenir |
| Icônes | `lucide-react` ✅ | conforme à la maquette |
| Graphiques | **pas de Recharts** ; le tableau de bord dessine ses barres en `div` + hauteur en % (`chart-bar`) | librairie évitable |
| Tableaux | HTML natif (`<table>`), pagination maison | TanStack inutile |
| Formulaires | **pas de React Hook Form** ; contrôles natifs + Zod (`createOrderSchema`) | RHF inutile |
| État | Zustand (`tenantContext`, `subscriptionContext`) | à réutiliser |
| Données | **Dexie/IndexedDB d'abord**, puis Supabase ; sync par `syncEngine` | toute refonte doit respecter cette chaîne |
| Identité | `--color-brand-navy #0f172a`, `--color-brand-teal #0f766e`, `--color-brand-amber #f59e0b` | la maquette demande un bleu `#2563EB` |

### Écrans existants concernés

| Écran maquette | Route réelle | Fichier | État |
|---|---|---|---|
| Tableau de bord | `/tableau-de-bord` | `src/pages/TableauDeBord.tsx` (491 l.) | **fonctionnel**, KPI + série 7 jours + dernières commandes, calculés depuis IndexedDB (`dashboardService.computeDashboard`) |
| Nouvelle commande | `/commandes/nouvelle` | `src/pages/OrderForm.tsx` (~720 l.) | **livré au point 3** : 3 écrans, grille + panier, enregistrement local → sync |
| Atelier / Suivi | `/atelier` | `src/pages/Atelier.tsx` (637 l.) | **liste + filtres par statut** + scan QR, pas de Kanban |
| Coquille | toutes | `src/components/AppLayout.tsx` (372 l.) | barre latérale **claire** 264 px, en-tête minimal, tiroir mobile, contenu `max-w-5xl` |

Navigation réelle (filtrée par permissions) : Commandes, Nouvelle commande,
Atelier, Caisse, Tableau de bord, Rapports, Clients, Stock, Dépenses,
Abonnement, Journal d'audit, Support, Services & activités, Paramètres.

---

## 2. Écarts entre la maquette et le réel

| # | Maquette | Réel | Verdict |
|---|---|---|---|
| E1 | Routes `/dashboard`, `/orders/new`, `/workshop` | `/tableau-de-bord`, `/commandes/nouvelle`, `/atelier` | **garder les routes** ; ajouter les alias si besoin (un renommage casserait les tests E2E, les liens partagés et les raccourcis installés) |
| E2 | Barre latérale à 9 entrées fixes, dont « Catalogue & Tarifs » et « Stock & Fournitures » | 15 entrées pilotées par les permissions, dont « Services & activités » | **conserver le pilotage par permissions** ; « Catalogue & Tarifs » n'existe plus depuis la migration 020 (voir C3) |
| E3 | Carte « Formule Pro / abonnement actif » statique | `useSubscriptionStore` + `SubscriptionBanner` + page `/abonnement` | **brancher la carte sur l'état réel** (`plan_name`, statut), pas sur un texte figé |
| E4 | Recherche globale + notifications + profil « Koffi Bah / Gérant » dans l'en-tête | en-tête = pressing + rôle + hors-ligne ; recherche seulement dans Commandes et Clients | à créer (vraie recherche multi-entités), profil alimenté par le rôle réel |
| E5 | KPI « 482 500 FCFA, +12 % vs hier » | KPI réels : commandes du jour, prêtes, encaissé, reste à encaisser | **conserver les KPI réels**, restylés ; les chiffres de la maquette ne doivent pas s'afficher (voir C2) |
| E6 | Graphique en courbe (Recharts) 7 jours | barres CSS + série réelle 7 jours | remplacer les barres par une courbe **en SVG maison** (aucune dépendance) |
| E7 | Tableau « Commandes récentes » : N°, Client, Articles, Montant, Statut, Date | tableau réel : N°, Client, Statut, Montant, Date | ajouter la colonne « Articles » (les lignes sont déjà chargées via `useAllLocalItems`) |
| E8 | POS : filtres Hauts/Pantalons/Robes…, prix catalogue, bannière promo | grille par catégories (`orderServices.ts`), prix saisi, pas de bannière | voir C4 et C5 |
| E9 | Kanban 3 colonnes Reçues / En cours / Prêtes | 8 statuts linéaires (`received`→`delivered`) + filtres | **grouper** les 8 statuts en 3 colonnes, sans perdre le statut réel (voir C6) |
| E10 | Glisser-déposer | changement de statut par boutons (`allowedStatusTargets`) + confirmation | DnD possible en complément, **jamais seul** : alternative clavier obligatoire |
| E11 | Contenu pleine largeur tablette 1366 px | `max-w-5xl` (1024 px) | élargir (`max-w-7xl`) sur les écrans denses (dashboard, POS, Kanban) |
| E12 | Palette bleue `#2563EB` / fond `#F8FAFC` | navy `#0f172a` + teal `#0f766e` | voir C1 |

---

## 3. Contradictions à trancher (elles changent le résultat)

### C1 — Quelle référence visuelle fait foi ?

Le prompt décrit une interface **bleue** (barre latérale blanche, `#2563EB`,
« PressingPro CI »). Les trois fichiers HTML joints
(`01-tableau-de-bord.html`, `02-reception-commande.html`,
`03-production-remise.html`) montrent une **autre** direction : barre latérale
**noire** (`#09090b`), accent bleu-600, boutons noirs, « CA du jour 186 500 »,
« Maquette 1/3 • Shadcn UI + Tailwind ». Les deux ne décrivent ni les mêmes
cartes, ni la même navigation, ni la même couleur dominante. Les images JPEG
jointes sont, elles, les maquettes d'origine (POS indonésien, JFSS) qui ont
servi au point 3 — encore une troisième direction.

**Sans arbitrage, je ne peux pas « reproduire fidèlement » : je dois choisir.**

### C2 — Données fictives contre données réelles

Le prompt demande des chiffres illustratifs (482 500 FCFA, `#000125`,
« Koffi Bah »). Le tableau de bord actuel affiche des montants **réels** du
pressing. Injecter les chiffres de la maquette reviendrait à montrer un chiffre
d'affaires faux à un commerçant — exactement ce que la règle « ne jamais simuler
un succès » interdit.

### C3 — « Catalogue & Tarifs » a été supprimé par la migration 020

`laundry_models`, `catalog_*` et les forfaits n'existent plus (migration
destructive documentée). Le successeur réel est **Services & activités**
(`tenant_services` : `billing_unit` `PIECE`/`KG`, `unit_price` optionnel), et
les prix se saisissent sur la ligne de commande. Ajouter une entrée de menu
« Catalogue & Tarifs » avec des prix figés (Chemise 2 500 FCFA…) réintroduirait
une fonctionnalité retirée et une seconde source de prix.

### C4 — L'écran POS existe déjà (point 3)

Le master prompt décrit un catalogue à gauche + panier à droite, avec quantités
±, sous-totaux et total. C'est **exactement** ce qui a été livré au point 3
(grille + panier + récapitulatif + enregistrement), avec en plus la
synchronisation, le hors-ligne et les tests. Une réécriture conforme à la
maquette jetterait ce travail. La bonne opération est un **relookage** de la
mise en page (filtres horizontaux, cartes plus illustrées, panier collant),
pas un nouveau moteur.

### C5 — Prix du catalogue dans la grille

La grille actuelle n'affiche pas de prix par tuile : le prix dépend de la
prestation choisie ou de la saisie. Afficher « Chemise 2 500 FCFA » en dur
serait un prix inventé. Solution : afficher le prix **issu de la prestation
sélectionnée** quand il existe, et rien sinon (ou « prix à saisir »).

### C6 — Trois colonnes contre huit statuts

Reçues / En cours / Prêtes ne couvrent pas `sorting → washing → drying →
ironing → quality_check`. Réduire les statuts à trois appauvrirait le suivi
d'atelier et la base (`status` est historisé). Solution : trois **colonnes de
regroupement**, chaque carte gardant son statut réel, et le changement de
statut passant toujours par `updateStatus` + `allowedStatusTargets` (règles
métier existantes).

### C7 — Dépendances demandées

`shadcn/ui`, `Recharts`, `TanStack Table`, `React Hook Form` ne sont pas
installés. Le prompt lui-même dit de ne pas ajouter de dépendances redondantes.
Recharts pèse ~100 ko gzip pour une tablette Android en 3G, alors qu'une courbe
SVG de 60 lignes suffit ; shadcn/ui suppose Radix + CVA + `tailwind-merge` et
réécrirait tous les composants existants.

---

## 4. Plan proposé (5 lots, chacun livrable et testé)

| Lot | Contenu | Fichiers principaux |
|---|---|---|
| **A — Fondations** | jetons de couleur, `AppSidebar` + `SubscriptionCard` (état réel), `AppHeader` (recherche globale, notifications, profil), largeur de contenu | `src/index.css`, `src/components/layout/*`, `src/components/AppLayout.tsx`, `src/components/rechercheGlobale.ts` |
| **B — Tableau de bord** | `MetricCard`, `RevenueChart` (SVG), `RecentOrdersTable`, sur données réelles | `src/pages/TableauDeBord.tsx`, `src/components/dashboard/*` |
| **C — Réception (POS)** | relookage de l'écran 2 : filtres horizontaux, cartes illustrées, panier collant, bannière secondaire — **sans toucher** au moteur ni au schéma | `src/pages/OrderForm.tsx`, `src/components/order/*` |
| **D — Atelier Kanban** | `KanbanBoard` / `KanbanColumn` / `OrderCard`, 3 colonnes groupées, changement de statut accessible (boutons + clavier), recherche | `src/pages/Atelier.tsx`, `src/components/workshop/*` |
| **E — Finitions** | responsive 1366×768 / tablette / mobile, focus visibles, captures d'écran, docs | tests, `docs/`, captures dans `docs/captures/` |

Chaque lot : `npm run typecheck`, `typecheck:e2e`, `lint`, `test`, `build`,
`e2e:demo` + `demo-mobile`, puis mise à jour des sélecteurs E2E dans le même
commit (les libellés actuels sont verrouillés par les tests).

### Ce qui ne sera pas fait, sauf demande contraire

- Aucune migration SQL, aucune nouvelle table, aucun changement de la RLS.
- Aucun renommage de route (alias seulement).
- Aucun second moteur de commande ni de synchronisation.
- Aucun prix de catalogue inventé affiché comme réel.
- Aucune donnée de démonstration injectée dans les écrans de production.

---

## 5. Décisions arbitrées (27/10/2026)

1. **Référence visuelle** : structure et libellés du master prompt, **identité
   navy/teal existante conservée** — aucune troisième teinte introduite. Les
   maquettes HTML jointes ne servent que de repère de densité.
2. **Palette** : navy `#0f172a` et teal `#0f766e` restent la marque ; les
   couleurs sémantiques de la maquette (ambre = en cours, vert = prêt, rouge =
   alerte) sont reprises telles quelles.
3. **Données** : réel par défaut **plus** un mode démonstration explicite
   (`src/lib/demoMode.ts`, `src/data/demo-data.ts`), bandeau non fermable,
   écritures désactivées.
4. **Dépendances** : Recharts + primitives shadcn/ui (Radix, CVA, clsx,
   tailwind-merge). Ni TanStack Table ni React Hook Form : le dépôt a déjà
   l'équivalent (tableaux natifs, Zod).
5. **Ordre** : lots A → E, porte complète à chaque lot.

Le résultat détaillé est dans [`docs/RAPPORT-REFONTE-INTERFACE.md`](RAPPORT-REFONTE-INTERFACE.md).
