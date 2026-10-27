# Audit — parcours de création de commande

> **Statut : audit livré, aucune ligne de code applicatif modifiée.**
> Ce document précède l'implémentation du nouveau parcours (Écran 1 choix du
> service → Écran 2 formulaire → Écran 3 récapitulatif), demandée à partir des
> trois maquettes fournies. Il liste ce qui existe, ce qui sera réutilisé, ce
> qui ne doit pas être cassé, les défauts constatés, et les fichiers que
> l'implémentation touchera.

Date : 27/10/2026 · Branche : `arena/b47084c6-laundrypressing` · Base : `413be87`

---

## 1. Méthode

Relecture du code (pas de la documentation) :

| Élément | Fichier(s) examiné(s) |
| --- | --- |
| Routes et découpage | `src/App.tsx`, `src/components/AppLayout.tsx` |
| Page actuelle de création | `src/pages/OrderForm.tsx` (737 lignes) |
| Grille existante | `src/pages/BlanchisserieGrid.tsx`, `src/constants/garmentImages.ts` |
| Catalogue (activités / prestations) | `src/services/tenantServices.ts`, `src/pages/ServicesPressing.tsx`, `src/lib/tenantActivities.ts` |
| Écriture locale | `src/db/localDb.ts` (Dexie v14), `src/db/ordersRepository.ts`, `src/db/hooks.ts` |
| Synchronisation | `src/sync/syncEngine.ts` (`syncOrderNow`, envoi immédiat, verrou par commande) |
| Validation | `src/schemas/order.ts`, `src/lib/orderPricing.ts`, `src/lib/catalogPricing.ts` |
| Droits | `src/lib/permissions.ts`, `supabase/migrations/001_init.sql` (RLS) |
| Schéma distant | migrations `001` → `026`, en particulier `014`, `020`, `021`→`024` |
| Tests existants | `src/test/orderForm.test.tsx` (13 cas), `orderItems`, `useCreateOrder`, `tenantIsolation`, `syncEngine`, `garmentImages`, et `e2e/` (14 scénarios) |

## 2. Architecture réelle du parcours actuel

```
/commandes                     Orders.tsx          liste + recherche + filtres
  └─ bouton « Nouvelle commande »
/commandes/nouvelle            OrderForm.tsx       3 étapes : Client → Vêtements → Paiement
/commandes/blanchisserie       BlanchisserieGrid   grille tactile de vêtements
/commandes/:orderId            OrderDetail.tsx     fiche, encaissement, reçu
```

Chaîne d'écriture, identique pour tous les écrans :

```
OrderForm (état local React)
  → createOrderSchema.safeParse           validation Zod (src/schemas/order.ts)
  → problemeTarifaire                     refus d'une ligne à 0 FCFA (src/lib/orderPricing.ts)
  → useCreateOrder → createOrderLocal     transaction Dexie unique (orders + orderItems)
  → syncOrderNow → envoyerCommande        upsert idempotent par `id`, verrou par commande
  → navigate('/commandes/:id' [?regler=1])
```

Points structurants confirmés :

- **Aucun doublon possible à la resynchronisation** : l'identifiant est généré sur
  l'appareil, l'envoi fait un `upsert` sur `orders` puis sur `order_items`
  (`onConflict: 'id'`), avec un verrou `envoisEnCours` par commande.
- **Hors ligne assumé** : `createOrderLocal` écrit même sans réseau ; l'échec
  d'envoi est affiché avec son motif et la fiche reste accessible.
- **Le paiement n'est jamais automatique** : la commande est enregistrée, puis
  le panneau d'encaissement s'ouvre (`?regler=1`). C'est un choix produit déjà
  testé (`e2e/demo/encaissement.spec.ts`).
- **RLS** : `orders_insert_tenant` n'autorise que `owner` et `receptionist` sur
  leur propre `tenant_id`. L'interface masque en plus l'action via
  `can(role, 'orders.create')`.

## 3. Ce que l'application sait déjà faire (à réutiliser, pas à réécrire)

| Besoin du cahier des charges | Existant réutilisable |
| --- | --- |
| Choix du service (Pressing / Blanchisserie) | Référentiel réel `tenant_activities` + `tenant_services` (`legacy_code` côté SQL, `activity_code` sur les prestations) |
| Grille d'articles avec icônes | `GARMENT_GRID` + `GARMENT_IMAGE` (`src/constants/garmentImages.ts`), 23 fichiers dans `public/images/` |
| Prix à la pièce | `billingUnit: 'PIECE'`, prix saisi par ligne (aucun tarif par défaut, décision de la migration 021) |
| Prix au kilo | `billingUnit: 'KG'` + `tenant_services.unit_price` facultatif + composition `garmentDetails` (migration 023) |
| Minimum / incrément / minimum facturable | `calculerTarif` (`src/lib/catalogPricing.ts`), appliqué aussi côté serveur par les colonnes `*_snapshot` |
| Recherche / réutilisation d'un client | `suggestCustomersByPhone`, `countPreviousOrders`, `lastCustomerNameByPhone` (`src/lib/customerSuggestions.ts`) |
| Récapitulatif et total | total calculé sur l'état des lignes ; `formatFcfa` |
| Confirmation, ticket, reçu | `OrderDetail` → `Receipt` / `Facture` (déjà en place, rien à refaire) |
| Enregistrement + synchronisation | `createOrderLocal` + `syncOrderNow` (inchangés) |
| Icônes d'interface | `lucide-react` (déjà la seule dépendance d'icônes) |

Couleurs disponibles sans nouvelle dépendance : `brand-navy` (#0f172a, bleu) pour
le Pressing, `brand-teal` (#0f766e, turquoise) pour la Blanchisserie.

## 4. Défauts constatés pendant l'audit (vérifiés, non corrigés)

### D1 — La grille blanchisserie est inatteignable et perd sa sélection

- Aucun lien vers `/commandes/blanchisserie` n'existe dans l'interface
  (`AppLayout`, `Orders`, `TableauDeBord` n'y renvoient pas) : la route n'est
  accessible qu'en tapant l'URL.
- `BlanchisserieGrid` transmet le décompte par
  `navigate('/commandes/nouvelle', { state: { composition } })`, mais
  `OrderForm` n'importe jamais `useLocation` : **la sélection est silencieusement
  perdue**, le formulaire s'ouvre vide.
- Conséquence : ce code mort devient le point de départ du nouvel Écran 1 ; il
  sera remplacé, pas dupliqué.

### D2 — Les « forfaits au kilo » de la maquette 2 ne sont plus supportés

La migration `020_suppression_tarification_et_laundry_models.sql` (destructive,
assumée et documentée) a supprimé `laundry_models`, `catalog_*` et les colonnes
`laundry_*` de `order_items`. Le modèle de tarification **actuel** est :

- `tenant_services.billing_unit ∈ {'PIECE','KG'}` ;
- `tenant_services.unit_price` (facultatif, autorisé seulement au kilo) ;
- prix de chaque ligne figé sur la commande (`price`, `unit_price`, snapshots).

Dexie conserve des tables `laundryModels` / `catalogEntries` en lecture seule
« pour ne pas effacer les caches des anciennes versions » : elles ne doivent
**pas** être réutilisées. Les cartes « CKS 2 Kg — Rp 20 000 » de la maquette se
traduisent donc par une **prestation au kilo** (poids + tarif/kg + composition),
pas par un modèle de forfait.

### D3 — Impossible de distinguer Pressing et Blanchisserie côté interface

`tenant_activities.legacy_code` porte bien le code (`'pressing'`,
`'blanchisserie'`, …) et `tenant_services.activity_code` aussi, mais :

- `fetchTenantServiceConfiguration` sélectionne `activity_code` puis
  **l'ignore** dans le mapping ;
- `TenantActivity` / `LocalTenantActivity` ne conservent pas `legacy_code`.

Sans cette donnée, l'Écran 1 ne peut pas classer les activités réelles : il
faut exposer le code (lecture seule) avant de construire les deux cartes.

### D4 — La règle « prix > 0 » est uniquement côté client

`src/pages/OrderForm.tsx` commente que PostgreSQL refuse une ligne à 0 FCFA via
le déclencheur `guard_order_item_price`. Ce déclencheur a été **supprimé par la
migration 020**. Ce qui reste réellement : `price >= 0` en base, et le refus
côté client (`problemeTarifaire`) + Zod. Le commentaire est donc trompeur : à
corriger, et la règle doit rester appliquée par le formulaire (aucun garde-fou
serveur à attendre).

### D5 — Aucune confirmation en quittant un formulaire rempli

Le cahier des charges demande « Annuler le parcours avec une confirmation si des
données sont saisies ». Aujourd'hui « Annuler » et « ← Retour aux commandes »
naviguent immédiatement, et il n'existe aucun garde `beforeunload`.

### D6 — En mode démonstration, il n'existe aucun catalogue

Aucune graine d'activités ni de prestations n'est installée sans Supabase : la
grille doit donc rester utilisable **avec un catalogue vide** (elle s'appuie sur
les constantes d'icônes, pas sur la base). C'est aussi ce que rejoue la suite
E2E ; tout écran qui exigerait une prestation configurée casserait les 14
scénarios existants.

### D7 — Inventaire d'images incomplet mais suffisant

`public/images/` contient 23 fichiers ; `GARMENT_IMAGE` en référence 12 (un par
type de `OrderGarmentType`). Les fichiers non référencés (`tile000`, `tile004`,
`tile007`, `tile008`, `tile016`, `tile018`, `tile020`, `tile026`, `tile028`,
`chaussettes`, `culotte`) ne correspondent à aucun type métier existant : ils
ne seront pas utilisés, et le mapping reste centralisé dans
`garmentImages.ts` (protégé par `src/test/garmentImages.test.ts`, qui vérifie
l'existence réelle des fichiers).

### D8 — Les libellés d'étapes sont verrouillés par des tests

`Étape 1 : Client` / `Étape 2 : Vêtements` / `Étape 3 : Paiement`,
`Enregistrer la commande`, `Suivant`, `Ajouter une ligne`… sont utilisés par
`src/test/orderForm.test.tsx` **et** par les 14 scénarios Playwright. Toute
refonte du parcours doit mettre ces tests à jour dans le même lot — c'est la
condition pour ne pas transformer une évolution en régression silencieuse.

## 5. Correspondance maquette → modèle existant

| Écran maquette | Ce que montre la maquette | Ce que l'application sait stocker |
| --- | --- | --- |
| 1 | Deux cartes de service | Activités réelles du pressing (`tenant_activities`), classées par code ; à défaut, les deux parcours restent proposés |
| 2A | Client + dates + grille de vêtements avec prix + panier | `customerName`, `customerPhone`, `dueDate` ; lignes `PIECE` (`label`, `quantity`, `unitPrice`) |
| 2B | Grille de linge, paquets au kilo, panier | Lignes `KG` : `quantity` = poids, `unitPrice` = tarif/kg, `garmentDetails` = composition du lot |
| 3 | Récapitulatif, total, bouton de paiement | Étape de récapitulatif + `Enregistrer la commande` ; **le paiement reste le panneau de caisse existant**, jamais automatique |

Ce qui ne sera **pas** fait, faute de support serveur : forfaits au kilo
supprimés par la migration 020, abonnements, article→icône côté base (le mapping
reste une constante locale), et toute nouvelle table ou migration.

## 6. Fichiers prévus pour l'implémentation

### Créés

| Fichier | Rôle |
| --- | --- |
| `src/constants/orderServices.ts` | Classification Pressing / Blanchisserie (à partir d'`activityCode`), catégories affichées par écran, fallback sans catalogue |
| `src/components/order/ServiceChoiceCard.tsx` | Carte de service accessible (clavier + souris, état sélectionné) |
| `src/components/order/OrderItemGrid.tsx` | Grille d'articles avec icônes existantes, recherche, compteur +/- |
| `src/components/order/OrderBasket.tsx` | Panier : lignes, quantités, suppression, sous-totaux et total |
| `src/components/order/OrderSummary.tsx` | Écran 3 : service, client, dates, lignes, total, erreurs bloquantes |
| `src/test/orderServices.test.ts` | Classification et filtrage des catégories |
| `src/test/orderBasket.test.tsx` | Panier : ajout, +/- , suppression, recalcul, ligne à 0 FCFA |

### Modifiés

| Fichier | Modification |
| --- | --- |
| `src/pages/OrderForm.tsx` | Orchestrateur : Écran 1 (choix) → Écran 2 (client + grille + panier) → Écran 3 (récapitulatif) ; conserve la validation, l'enregistrement local, l'envoi immédiat, la sonde et le `?regler=1` |
| `src/services/tenantServices.ts` | Exposer `activityCode` (prestations) et `legacyCode` (activités), en lecture seule |
| `src/db/localDb.ts` | Ajouter `legacyCode` au cache local des activités (champ optionnel, aucune migration de données) |
| `src/pages/BlanchisserieGrid.tsx` | La sélection n'est plus perdue : redirection vers `/commandes/nouvelle?service=blanchisserie` avec les types choisis |
| `src/pages/Orders.tsx` | Le bouton « Nouvelle commande » ouvre l'Écran 1 (aucun changement de route) |
| `src/test/orderForm.test.tsx` | Adapter les cas aux nouveaux libellés et au parcours en 3 écrans |
| `e2e/helpers.ts`, `e2e/demo/*.spec.ts` | Adapter les sélecteurs ; ajouter le parcours blanchisserie au kilo |
| `docs/RECETTE-BOUTONS.md` | Section « parcours de commande » mise à jour |
| `README.md` | Une ligne sur le parcours en trois écrans |

### Volontairement **non** touchés

`src/schemas/order.ts`, `src/db/ordersRepository.ts`, `src/sync/syncEngine.ts`,
`src/lib/orderPricing.ts`, `src/lib/catalogPricing.ts`, `supabase/migrations/*`,
les politiques RLS, `OrderDetail` / `Receipt` / `Facture`, `CashPanel`.
Aucune table, aucune migration, aucun second moteur de commandes.

## 7. Tests prévus

Unitaires / composants (Vitest + jsdom, organisation actuelle) :

1. les deux cartes de service s'affichent et sont activables au clavier ;
2. la carte Pressing ouvre la grille pièces, la carte Blanchisserie la grille linge ;
3. la grille charge les articles des constantes et filtre par recherche ;
4. un client existant est proposé par le téléphone, sans perdre la saisie ;
5. ajout / +1 / −1 / suppression d'une ligne ;
6. recalcul des sous-totaux et du total ;
7. refus d'une commande sans nom de client, avec l'alerte attendue ;
8. refus d'une ligne à 0 FCFA (règle client, cf. D4) ;
9. enregistrement réussi → `createOrderLocal` appelé une seule fois, navigation vers la fiche ;
10. échec d'envoi → commande conservée localement, message explicite, aucun succès affiché ;
11. double clic sur « Enregistrer » → une seule commande ;
12. rôle sans `orders.create` → formulaire bloqué avec explication ;
13. rechargement de page → commande retrouvée (déjà couvert, à conserver) ;
14. non-régression : `orderItems`, `useCreateOrder`, `syncEngine`, `tenantIsolation`.

Bout en bout (Playwright, déjà en place) : parcours desktop + Pixel 7, et un
scénario blanchisserie au kilo (poids, tarif/kg, composition) avec vérification
après rechargement.

Commandes exécutées à chaque lot : `npm run typecheck`,
`npm run typecheck:e2e`, `npm run lint`, `npm test`, `npm run build`,
`npm run e2e:demo`. `npm run sql:verify` et `npm run recette` restent hors
portée de cet environnement (pas de PostgreSQL jetable ici) et seront signalés
comme non exécutés.

## 8. Décisions à valider avant d'écrire le code

1. **Source du choix de service** — classer les activités réelles par
   `legacy_code`/`activity_code`, ou toujours proposer les deux cartes ?
2. **Étape 3** — remplacer l'étape « Paiement » par « Récapitulatif » (le
   paiement restant le panneau de caisse après enregistrement), ou conserver
   quatre étapes ?
3. **Blanchisserie** — prestations au kilo existantes uniquement (pas de
   forfaits, cf. D2), ou affichage de « paquets » purement indicatifs ?
4. **Client** — suggestions par téléphone (existant) suffisent-elles, ou
   faut-il une vraie recherche dans une liste de clients ?
