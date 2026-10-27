# Refonte d'interface — rapport de livraison

Reproduction de la maquette « PressingPro CI » (master prompt) dans
l'application existante. Cinq lots, livrés un par un, sans migration SQL ni
changement de modèle de données.

Ce rapport suit le livrable demandé : architecture, fichiers, écrans,
interactions réellement opérationnelles, données fictives, tests, problèmes
restants, vérification visuelle.

---

## 1. Architecture existante (rappel)

React 19 + TypeScript strict + Vite 8, Tailwind CSS 4 (thème dans
`src/index.css`, pas de `tailwind.config.js`), React Router 7, Dexie/IndexedDB
en écriture locale puis Supabase, Zustand pour l'état, Zod pour la validation.

Écrans concernés par la refonte :

| Maquette | Route réelle | Données |
|---|---|---|
| Tableau de bord | `/tableau-de-bord` | `computeDashboard` sur IndexedDB + lectures serveur (dépenses, Mobile Money, stock) |
| Nouvelle commande | `/commandes/nouvelle` | `createOrderSchema` → `createOrderLocal` → `syncOrderNow` |
| Atelier / Suivi | `/atelier` | `getWorkshopOrders` + `useUpdateOrderStatus` |

---

## 2. Décisions arbitrées

| Question | Réponse retenue |
|---|---|
| Référence visuelle | **Structure du master prompt**, identité navy/teal du produit conservée (pas de troisième teinte). |
| Données | **Réel par défaut**, plus un **mode démonstration** explicite affichant les chiffres de la maquette. |
| Dépendances | Recharts + primitives shadcn/ui (Radix, CVA, clsx, tailwind-merge). Pas de TanStack Table, pas de React Hook Form : le dépôt a déjà l'équivalent. |
| Ordre | Lots A → E, avec porte complète à chaque lot. |

Écarts assumés par rapport au prompt, chacun justifié :

1. **Routes conservées** (`/tableau-de-bord`, `/commandes/nouvelle`, `/atelier`).
   Les renommer en `/dashboard`, `/orders/new`, `/workshop` aurait cassé les
   tests E2E, les liens partagés et les raccourcis installés, sans bénéfice
   utilisateur.
2. **Navigation filtrée par les permissions** au lieu des neuf entrées fixes.
   Afficher « Caisse » à un artisan produirait un écran que le serveur refuse.
3. **« Catalogue & Tarifs » → « Services & activités »** : la migration 020 a
   supprimé `catalog_*` et les forfaits. Aucun prix de type « Chemise 2 500 »
   n'est affiché hors démonstration.
4. **Trois colonnes Kanban au-dessus de huit statuts réels** : on regroupe, on
   n'appauvrit pas le modèle (le statut pilote le garde-fou serveur et les
   notifications client).
5. **Pas de glisser-déposer** : peu fiable au doigt avec des gants, inutilisable
   au clavier. Le changement de statut passe par un menu explicite qui ne liste
   que les transitions autorisées par le rôle (`allowedStatusTargets`).

---

## 3. Fichiers

### Créés

| Fichier | Rôle |
|---|---|
| `src/lib/utils.ts` | `cn()` (clsx + tailwind-merge), base des composants. |
| `src/components/ui/{button,badge,card,input,dropdown-menu,dialog}.tsx` | Primitives shadcn/ui adaptées (CVA + Radix). |
| `src/components/layout/AppSidebar.tsx` | Marque, navigation, contexte pressing, carte d'abonnement, déconnexion. |
| `src/components/layout/AppHeader.tsx` | Recherche globale, notifications, menu de compte. |
| `src/components/layout/GlobalSearch.tsx` | Recherche clavier (commandes + pages), sur IndexedDB. |
| `src/components/layout/HeaderNotifications.tsx` | Cloche des sollicitations clients des 24 dernières heures. |
| `src/components/layout/SubscriptionCard.tsx` | Abonnement réel (formule, échéance, blocage). |
| `src/components/layout/DemoBanner.tsx` | Bandeau permanent du mode démonstration. |
| `src/components/dashboard/MetricCard.tsx` | Carte KPI avec variation et mini-courbe. |
| `src/components/dashboard/RevenueChart.tsx` | Courbe Recharts + résumé accessible. |
| `src/components/dashboard/RecentOrdersTable.tsx` | Tableau des commandes récentes + actions. |
| `src/components/dashboard/DemoSwitch.tsx` | Interrupteur du mode démonstration. |
| `src/components/order/PromoBanner.tsx` | Bandeau secondaire de la réception. |
| `src/components/workshop/{KanbanBoard,KanbanColumn,OrderCard}.tsx` | Kanban d'atelier. |
| `src/lib/atelierKanban.ts` | Regroupement pur des statuts en trois colonnes. |
| `src/lib/demoMode.ts` | Store du mode démonstration (désactivé par défaut, persisté). |
| `src/data/demo-data.ts` | Chiffres de la maquette, isolés de la production. |
| `src/services/globalSearch.ts` | Recherche pure (nom, téléphone, référence, pages). |
| `src/test/{globalSearch,demoData,dashboardComposants,atelierKanban}.test.*` | 44 tests nouveaux. |

### Modifiés

| Fichier | Modification |
|---|---|
| `src/index.css` | Jetons sémantiques (background, card, primary, border, ring…), rayon commun. |
| `src/components/AppLayout.tsx` | Compose `AppSidebar` / `AppHeader` / `DemoBanner`, contenu élargi à `max-w-7xl`. |
| `src/components/ui/button.tsx`, `input.tsx`, `index.ts` | Passage à CVA + `cn`, variantes conservées (`danger`). |
| `src/pages/TableauDeBord.tsx` | KPI / courbe / tableau réécrits, mode démonstration, sections réelles conservées. |
| `src/pages/OrderForm.tsx` | Prix indicatifs en démo, bandeau promo, refus d'enregistrement en démo. |
| `src/components/order/OrderItemGrid.tsx` | Pastilles de catégorie, prix conditionnel. |
| `src/pages/Atelier.tsx` | Bascule Kanban (défaut) / Liste, compteur de pièces, verrou de transition. |
| `src/services/dashboardService.ts` | `ordersYesterday`, `cashYesterday`, `variationPourcent`. |
| `src/test/{atelierUx,orderBasket,orderForm}.test.tsx` | Sélecteurs et cas nouveaux. |
| `README.md`, `docs/RECETTE-BOUTONS.md` | Une ligne produit + checklist manuelle des trois écrans. |

---

## 4. Les trois écrans

### Tableau de bord (`/tableau-de-bord`)

- **Quatre KPI** : chiffre d'affaires du jour, commandes, en cours de
  traitement (hors prêtes), prêtes à livrer. Variation par rapport à la veille
  calculée à partir des données réelles ; **aucune flèche** quand la veille est
  à zéro (on ne peut pas annoncer +100 % sur une journée vide).
- **Courbe du chiffre d'affaires** sur sept jours (Recharts), axe en kFCFA,
  infobulle en FCFA, résumé textuel pour les lecteurs d'écran.
- **Commandes récentes** : N°, client, articles, montant, statut, date, actions
  (ouvrir la fiche, encaisser).
- Sections conservées : trésorerie et dépenses, alertes de stock, clients à
  prévenir, répartition des statuts, prestations les plus demandées.
- **Mode démonstration** : interrupteur à côté du titre. Actif, les KPI, la
  courbe et le tableau affichent les chiffres exacts de la maquette ; les
  sections calculées sur l'activité réelle sont masquées, et le bandeau global
  rappelle que les chiffres sont fictifs.

### Réception (`/commandes/nouvelle`)

Le parcours en trois écrans validé au point 3 est conservé. Ce lot ajoute :

- des **pastilles de catégorie** au-dessus de la grille (« Tous » + catégories
  réelles du parcours), avec `aria-pressed` ; le panier n'est pas vidé ;
- un **prix sur la tuile** uniquement quand il est connu — c'est-à-dire en mode
  démonstration. Le produit n'a pas de tarif par type de vêtement depuis la
  migration 021 : afficher « Chemise 2 500 FCFA » en production serait un prix
  inventé ;
- un **bandeau secondaire** sous la grille (illustration prise dans
  `public/images`, aucune dépendance réseau) ;
- en démonstration, l'enregistrement est **refusé** avec un message explicite :
  rien n'est écrit dans Dexie, rien n'est envoyé.

### Atelier (`/atelier`)

- Bascule **Kanban / Liste**, Kanban par défaut. Recherche et filtres par
  statut communs aux deux vues.
- Trois colonnes : **Reçues** (received, sorting, bleu), **En cours** (washing,
  drying, ironing, quality_check, ambre), **Prêtes** (ready, vert), chacune avec
  son compteur et un message quand elle est vide.
- Carte : référence, client, nombre de pièces, montant, heure de réception,
  échéance (soulignée si en retard), badge de statut, menu d'actions.
- Le menu ne propose que les transitions autorisées par le rôle ; il est
  désactivé en démonstration, avec explication.
- Le scan d'étiquette et la saisie manuelle du code restent intacts.

---

## 5. Interactions réellement opérationnelles

| Interaction | Où | Vérifiée par |
|---|---|---|
| Recherche globale (nom, téléphone sans espaces, référence, page) | en-tête, toutes pages | 11 tests unitaires |
| Menu de compte, notifications (Radix : focus, Échap) | en-tête | test de coquille |
| Carte d'abonnement → page Abonnement | barre latérale | lecture de l'état réel |
| Bascule démonstration (bouton `role="switch"`) | tableau de bord | 12 tests de données + rendu |
| Filtres par catégorie de la grille | réception | 2 tests de composant |
| Ajustement de panier, refus d'enregistrement en démo | réception | 25 tests d'écran |
| Bascule Kanban / Liste, changement de statut | atelier | 8 tests Kanban + 3 tests d'atelier |

Ne sont **pas** opérationnels, et l'interface ne le prétend pas :
glisser-déposer (non implémenté), actions contextuelles en mode démonstration
(désactivées), écritures serveur (inchangées, testées ailleurs).

---

## 6. Données fictives

Un seul endroit : `src/data/demo-data.ts`, lu **uniquement** quand
`useDemoStore().actif` est vrai. Contenu : les sept points de la courbe, les
quatre KPI et leurs variations, les cinq tickets `#000125`…`#000121`, cinq
cartes d'atelier, les prix de tuiles.

Garde-fous :

1. désactivé par défaut ;
2. bandeau permanent et non fermable tant que le mode est actif ;
3. blocs marqués « démo » ;
4. aucune écriture possible (commande, statut) ;
5. en démonstration, les sections calculées sur les données réelles sont
   masquées : jamais de mélange dans un même écran ;
6. les tests vérifient que l'instantané de démonstration a exactement la forme
   de l'instantané réel — c'est ce qui garantit qu'aucun écran n'a de branche
   spéciale, donc qu'aucune valeur fictive ne peut entrer dans un calcul métier.

---

## 7. Tests exécutés

| Commande | Résultat |
|---|---|
| `npx tsc --noEmit` | ✅ |
| `npx tsc -p tsconfig.e2e.json` | ✅ |
| `npm run lint` | ✅ (2 avertissements `react-refresh` sur les fichiers de variantes CVA, sans incidence) |
| `npm test` | **71 fichiers / 772 tests**, tous verts |
| `npm run build` | ✅ (PWA, 93 entrées précachées) |
| `npx playwright test` | **non exécuté — voir §8** |

Répartition des tests nouveaux : `globalSearch` 11, `demoData` 12,
`dashboardComposants` 13, `atelierKanban` 8 ; plus les cas ajoutés à
`orderBasket` (15 au total) et `orderForm` (25 au total).

---

## 8. Problèmes restants

1. **Aucune vérification visuelle dans cet environnement.** Le bac à sable a
   été réinitialisé et Chromium a disparu ; `npx playwright install chromium`
   échoue (`Download failure`, pas d'accès au CDN Playwright). Les scénarios
   E2E **n'ont donc pas été rejoués** (`demo`, `demo-mobile`, `reel`), et
   **aucune capture d'écran n'a pu être produite**. Les tests de composants
   couvrent la structure du DOM, pas la fidélité pixel.
   → À faire depuis un poste : `npm run e2e:demo`, puis comparer 1366×768 à la
   maquette et corriger les écarts (espacements, densité, proportions).
2. **Fidélité à la maquette non mesurée.** Le prompt demande de corriger les
   écarts « dimensions, alignements, espacements, couleurs, typographie » en
   comparant des captures. Sans navigateur, cette boucle n'a pas eu lieu.
3. **Deux colonnes plutôt que trois sur tablette étroite.** En dessous de
   `lg`, le Kanban s'empile verticalement (choix assumé) ; le prompt autorisait
   le défilement horizontal, écarté pour ne pas cacher de colonne.
4. **La recherche globale ne couvre que l'appareil.** Pas de répertoire clients
   serveur : les clients proposés sont ceux des commandes locales.
5. **Le nom de l'utilisateur.** L'en-tête affiche le pressing et le rôle, faute
   de nom d'utilisateur dans le schéma. La maquette montrait « Koffi Bah » ;
   l'inventer aurait été un mensonge dans une interface partagée.
6. **Recharts alourdit le bundle** (~100 ko gzip). Il n'est utilisé que par un
   graphique ; les autres visualisations restent en HTML/CSS. À surveiller sur
   les tablettes d'entrée de gamme en 3G.
7. **`src/test/appLayout.test.tsx` ne couvre pas le nouveau menu de compte.**
   Le tiroir mobile est testé, pas le comportement Radix du menu (fermeture par
   Échap, restitution du focus) : à compléter.

---

## 9. Vérification manuelle

Sur `npm run dev` (mode démonstration de l'application, identifiant
`11111111-1111-4111-8111-111111111111`) :

1. **Verifier la coquille** — barre latérale avec la marque et les entrées
   autorisées ; en-tête avec recherche, cloche, compte.
2. **Recherche globale** — taper `atelier` : la page est proposée ; taper le
   début d'un numéro de téléphone : la commande apparaît ; Échap ferme la liste.
3. **Tableau de bord réel** — les KPI affichent les montants réels ; une
   journée sans encaissement la veille ne montre aucune flèche.
4. **Mode démo** — basculer l'interrupteur : bandeau ambre, KPI à 482 500 FCFA,
   courbe de la maquette, tableau `#000125`, sections réelles masquées.
5. **Réception en démo** — `Nouvelle commande` : prix indicatifs sur les
   tuiles, pastilles de catégorie, bandeau promo ; enregistrer → refus explicite.
6. **Réception réelle** — couper le mode démo, créer une commande, vérifier la
   fiche et le rechargement (IndexedDB).
7. **Atelier** — basculer Kanban / Liste ; sur une carte, ouvrir le menu et
   faire avancer une commande ; vérifier le compteur des colonnes.
8. **Tablette** — en 1024–1366 px de large, contrôler que la barre latérale
   reste visible, que les quatre KPI tiennent sur une ligne et que le Kanban
   conserve ses trois colonnes.

---

## 10. État de la branche

Branche `arena/b47084c6-laundrypressing`, `main` intacte. Commits de ce lot :
fondations, tableau de bord, réception, atelier, finitions.
