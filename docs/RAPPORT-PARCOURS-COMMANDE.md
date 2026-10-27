# Point 3 — Nouveau parcours de création de commande

Rapport de livraison. Le parcours de commande n'est plus un formulaire unique :
c'est une suite de **trois écrans** qui suit le geste réel du comptoir
(choisir le service → identifier le client et saisir les articles → relire et
enregistrer).

Rien n'a été dupliqué : la validation, l'écriture locale, l'envoi immédiat, les
permissions et les tables sont ceux qui existaient déjà. Ce point ajoute une
**façade** et des composants d'interface, pas un second moteur de commandes.

---

## 1. Fichiers

### Créés

| Fichier | Rôle |
|---|---|
| `src/lib/orderServices.ts` | Règles pures du parcours : catégories, articles proposés, filtre de recherche, rattachement d'une activité/prestation à un parcours, présentation des deux cartes. Aucun accès au stockage ni au réseau. |
| `src/components/order/ServiceChoiceCard.tsx` | Carte de l'écran 1 (icône, titre, description, prix indicatif). Bouton réel, nom accessible « Choisir … ». |
| `src/components/order/OrderItemGrid.tsx` | Grille tactile d'articles (icône + libellé + quantité déjà au panier), groupée par catégorie. |
| `src/components/order/OrderBasket.tsx` | Panier : quantité, prix unitaire, total par ligne, suppression, vidage. Exporte le type `LignePanier`. |
| `src/components/order/OrderSummary.tsx` | Écran 3 : relecture client, lignes, total, avertissements. Lecture seule. |
| `src/test/orderServices.test.ts` | 15 tests sur les règles de parcours. |
| `docs/AUDIT-PARCOURS-COMMANDE.md` | Audit préalable (constats D1–D8, table de réutilisation, plan de test). |
| `docs/RAPPORT-PARCOURS-COMMANDE.md` | Ce rapport. |
| `e2e/demo/blanchisserie.spec.ts` | Scénarios navigateur du parcours au kilo. |

### Modifiés

| Fichier | Changement |
|---|---|
| `src/pages/OrderForm.tsx` | Réécrit : trois étapes, client avec recherche, grille + panier, récapitulatif, enregistrement. Même schéma, même repository, même synchronisation. |
| `src/pages/BlanchisserieGrid.tsx` | L'ancien écran dédié ne fait plus que rediriger vers `/commandes/nouvelle?service=blanchisserie` : plus qu'un seul point d'entrée. |
| `src/services/tenantServices.ts`, `src/db/localDb.ts` | Ajout de `legacyCode` / `activityCode` pour rattacher une activité réelle au bon parcours (sans deviner d'après le seul libellé). |
| `src/test/orderForm.test.tsx` | Réécrit sur le nouveau DOM : 20 cas (navigation, panier, tarifs, double clic, échec réseau, droits). |
| `src/test/servicesPressing.test.tsx` | Fixture alignée sur les nouveaux champs obligatoires. |
| `e2e/helpers.ts` | `entrerEnDemonstration`, `choisirParcours`, `creerCommande` (trois écrans), `montantAffiche`. |
| `e2e/demo/parcours-commande.spec.ts`, `e2e/demo/encaissement.spec.ts`, `e2e/reel/parcours-reel.spec.ts` | Sélecteurs et étapes mis à jour sur le nouveau parcours. |

### Réutilisé tel quel

`createOrderSchema` / `normalizePhoneCi` / `zodMessages` (`src/schemas/order.ts`),
`problemeTarifaire` (`src/lib/orderPricing.ts`), `useCreateOrder` /
`useLocalOrders` (`src/db/hooks.ts`), `createOrderLocal`
(`src/db/ordersRepository.ts`), `syncOrderNow` / `signalerSonde` /
`signalerIncidentCommande` (`src/sync/syncEngine.ts`), `can`
(`src/lib/permissions.ts`), `formatFcfa`, `suggestCustomersByPhone` /
`lastCustomerNameByPhone` / `countPreviousOrders`, `GARMENT_GRID` /
`getGarmentImage()`, `CashPanel` (encaissement), les jetons `brand-navy` /
`brand-teal`.

Aucun nouveau tableau, aucune nouvelle table, aucun nouvel appel réseau.

---

## 2. Les trois écrans

### Écran 1 — « Quel type de service ? »

Deux cartes, deux boutons. Le clic ne mène pas à un écran vide : il fixe le
parcours, prépare la grille d'articles et, pour la blanchisserie, crée d'emblée
le **lot au kilo** à saisir.

- **Pressing** (bleu, icône fer/chemise) : articles à la pièce.
- **Blanchisserie** (turquoise, icône machine) : linge pesé, facturé au kilo.

Les cartes existent aussi en arrivant par une URL : `/commandes/nouvelle?service=blanchisserie`
(ancienne route `/commandes/blanchisserie`, conservée en redirection) saute
l'écran 1. C'est ce qui garde les liens existants fonctionnels.

### Écran 2 — client et articles

Trois blocs, dans l'ordre du comptoir :

1. **Client** — champ *Rechercher un client déjà venu* (autocomplétion sur les
   commandes locales : téléphone ou nom), nom, téléphone, date de livraison
   promise. Un client reconnu affiche son nom habituel et son nombre de
   commandes ; le clic remplit nom + téléphone. Un client inconnu s'écrit
   librement : aucune fiche client n'est créée, le schéma de commande ne
   change pas.
2. **Prestation** — la prestation choisie s'applique aux articles ajoutés
   ensuite. Pour le pressing : prestations à la pièce configurées par la
   boutique (ou aucune → prix saisis). Pour la blanchisserie : prestation au
   kilo, dont le tarif pré-remplit le lot.
3. **Grille + panier** — grille d'icônes groupée par catégorie
   (Quotidien / Robes et jupes / Costumes et vestes / Autre pour le pressing ;
   Linge de lit / Linge de toilette / Uniformes / Autre pour la blanchisserie).
   Un appui ajoute une pièce, les appuis suivants incrémentent la même ligne.
   Le panier permet de corriger quantité et prix, de supprimer une ligne, de
   tout vider, et affiche le total. Un **article libre** (hors grille) est
   possible : c'est le cas du vêtement qui n'est dans aucune catégorie.

Boutons : `Précédent` (retour au service, sans perdre la saisie),
`Suivant` (récapitulatif — voir la règle ci-dessous).

### Écran 3 — récapitulatif et enregistrement

Relecture : service, client, date promise, lignes (quantité, unité, prix
unitaire, total), montant total, avertissements. Puis :

- **Encaisser des espèces maintenant** : la commande est enregistrée puis la
  fiche s'ouvre avec le panneau d'encaissement déplié (`?regler=1`). Aucun
  paiement n'est créé à ce stade ; il ne l'est que si le comptoir confirme le
  montant reçu.
- **Enregistrer la commande** : écriture locale, envoi immédiat, ouverture de
  la fiche.
- `Modifier les articles`, `Changer de service`, `← Retour aux commandes`
  (avec confirmation si des données ont été saisies).

### Règle conservée : « Suivant » produit toujours quelque chose

Un défaut de saisie ne rend jamais le bouton inerte. Il annonce le problème,
mène à l'écran fautif et, au moment d'enregistrer, ramène sur cet écran avec le
message exact. Aucun clic muet.

---

## 3. Règles de tarification

| Situation | Résultat |
|---|---|
| Article à la pièce | `billingUnit: 'PIECE'`, `quantity × unitPrice`, `pricingMode: 'FIXED'`, `priceStatus: 'CONFIRMED'`. Le prix unitaire est saisi au comptoir ou repris de la prestation configurée. |
| Lot au kilo | Une seule ligne `billingUnit: 'KG'`, `quantity` = poids en kg, `unitPrice` = tarif au kilo, `price` = arrondi de `poids × tarif`. La **composition** du lot (`garmentDetails` : 2 × Drap, 1 × Serviette…) est conservée sur la ligne pour le suivi du linge. |
| Article libre | Même chemin qu'un article à la pièce, `type: null`. |
| Prix à zéro | Refusé avant tout envoi (`problemeTarifaire`), avec le message adapté : « prix unitaire » à la pièce, « tarif au kilo » pour un lot. |
| Total | `formatFcfa` partout ; arrondi entier (FCFA sans centimes). Le total du panier, celui du récapitulatif, celui enregistré et celui affiché sur la fiche sont calculés par la même fonction. |
| Historique | Le prix est figé sur la ligne de commande (`order_items`) : changer un tarif de prestation ne réécrit pas les commandes passées. |
| Prestations du catalogue | Utilisées quand elles existent (`tenant_services`, `unit_price` uniquement pour le kilo). Aucun tarif n'est inventé : sans catalogue, le champ est à saisir. |
| Forfaits / modèles commerciaux | Toujours non proposés : la migration 020 a supprimé `laundry_models` et les forfaits famille du schéma. |

---

## 4. Hors ligne et synchronisation

Le parcours suit la chaîne existante, sans la modifier :

```
saisie → createOrderSchema.safeParse → problemesTarifaires()
       → useCreateOrder → createOrderLocal (transaction Dexie)
       → syncOrderNow(id) → envoyerCommande → Supabase
       → navigation vers /commandes/:id[?regler=1]
```

- L'écriture **locale d'abord** : le comptoir ne dépend pas du réseau.
- L'envoi immédiat est tenté dans la foulée ; en cas d'échec, la commande reste
  en local avec son statut de synchronisation, un message le dit explicitement
  (« Commande enregistrée sur cet appareil… ») et l'incident est tracé.
- L'état de synchronisation est affiché (`Enregistrement local…`,
  `Envoi au serveur…`) et les boutons sont bloqués pendant l'opération.
- **Double soumission** : verrou par `ref` (l'état React seul ne suffisait pas —
  deux clics dans la même frame passaient tous les deux), plus un délai de
  garde de 25 s sur l'écriture locale, pour ne jamais laisser l'écran muet.
- Permission `orders.create` absente : l'enregistrement explique le refus et le
  trace, au lieu d'un bouton grisé sans raison. Aucune écriture n'est tentée.
- Aucun `catch` silencieux : toute erreur devient un message visible.

---

## 5. Tests exécutés

| Commande | Résultat |
|---|---|
| `npx vitest run src/test/orderForm.test.tsx` | **24/24** |
| `npx vitest run src/test/orderBasket.test.tsx` | **13/13** |
| `npx vitest run src/test/orderServices.test.ts` | **15/15** |
| `npm test` | **67 fichiers / 725 tests**, tous verts |
| `npx tsc --noEmit` | ✅ |
| `npx tsc -p tsconfig.e2e.json` | ✅ |
| `npm run lint` | ✅ |
| `npm run build` | ✅ (PWA générée, 94 entrées précachées) |
| `npx playwright test --project=demo` | **12/12** (49 s) |
| `npx playwright test --project=demo-mobile` | **12/12** (1 min 09) |

Ce que couvrent les scénarios navigateur, sur un vrai Chromium et un vrai
IndexedDB (aucun mock) : création d'une commande à la pièce et au kilo,
relecture de la fiche **après rechargement complet**, recherche dans la liste,
variation du total quand quantité ou poids change, suppression de ligne,
refus explicite (nom manquant, prix à zéro), deux commandes qui ne se
mélangent pas, encaissement d'un acompte puis solde, et absence totale de
Mobile Money sans backend.

### Non exécuté ici — à exécuter ailleurs

| Commande | Pourquoi |
|---|---|
| `npx playwright test --project=reel` | Exige `E2E_BASE_URL`, `E2E_EMAIL`, `E2E_PASSWORD` et un projet Supabase joignable : cet environnement n'a pas d'accès réseau vers `*.supabase.co`. **L'envoi réel vers Supabase n'est donc pas prouvé ici**, seulement l'écriture locale et un envoi mocké côté unitaire. |
| `npm run sql:verify` | Exige `psql` 15+ et une base jetable. |
| `npm run recette` | Recette configurée hors de portée du bac à sable. |

---

## 6. Problèmes restants

1. **Synchronisation serveur non prouvée ici.** Le code d'envoi est inchangé et
   testé unitairement (mock réseau), mais aucun test navigateur n'a poussé une
   commande vers le vrai projet Supabase faute de réseau. À jouer depuis un
   poste avec les identifiants (`npm run e2e:reel`).
2. **Mode démonstration sans catalogue.** Sans prestations configurées, les
   listes de prestations sont vides et les prix partent de 0 : l'écran reste
   utilisable (prix saisis), mais un utilisateur pourrait croire à un défaut.
   C'est le comportement attendu, pas un bug ; à documenter côté formation.
3. **Un seul lot au kilo par commande.** Le parcours crée un lot unique dont la
   composition s'agrège. Deux pesées distinctes (linge de lit / uniformes) dans
   la même commande demanderaient une décision produit (fusion ou lignes
   séparées) — non tranchée, donc non implémentée.
4. **`?regler=1` conserve le panneau ouvert.** Comportement existant, utile au
   comptoir ; il empêche en revanche de retrouver le bouton « Encaisser en
   espèces » sur une commande créée avec règlement immédiat.
5. **Chromium sans GPU + animations.** Avec les transformations de survol
   activées, ce Chromium headless perd des clics (`elementFromPoint` désigne
   pourtant le bouton). Les scénarios tournent donc en `prefers-reduced-motion:
   reduce`, comme documenté dans `playwright.config.ts` et
   `docs/RECETTE-BOUTONS.md`. Le profil « animations activées » n'est pas
   couvert par les tests.
6. **Images d'articles.** 12 des 23 PNG de `public/images` sont utilisés par la
   grille ; les autres restent orphelins (constat D7 de l'audit). Rien n'a été
   supprimé.
7. **Recherche client** limitée aux commandes locales de l'appareil : pas de
   répertoire clients serveur (il n'existe pas dans le schéma).

---

## 7. Vérification manuelle

Sur `npm run dev`, en mode démonstration (identifiant de pressing
`11111111-1111-4111-8111-111111111111`) :

1. **Écran 1** — `Commandes → Nouvelle commande`. Deux cartes visibles, focus
   clavier possible, `Entrée` sur « Choisir Pressing » ouvre l'écran 2.
2. **Écran 2, client** — taper les 4 derniers chiffres d'un téléphone déjà
   utilisé : la suggestion apparaît, un clic remplit nom et téléphone.
3. **Écran 2, grille** — appuyer deux fois sur *Chemise* : une seule ligne,
   quantité 2. Corriger la quantité à 3 dans le panier : le total suit
   immédiatement. Supprimer la ligne : le panier affiche « Aucun article pour
   le moment. ».
4. **Article libre** — saisir « Rideau » puis *Ajouter* : la ligne apparaît au
   panier, prix saisissable.
5. **Refus explicite** — laisser le nom vide et enregistrer : retour sur
   l'écran 2, message lisible, aucune commande créée (la liste n'a pas bougé).
6. **Écran 3** — vérifier que le récapitulatif reprend exactement les lignes et
   le total du panier, puis *Enregistrer la commande*.
7. **Persistance** — sur la fiche, recharger la page (F5) : la commande, ses
   lignes et son total sont toujours là (IndexedDB).
8. **Blanchisserie** — `Nouvelle commande → Choisir Blanchisserie` : un lot au
   kilo est déjà présent ; ajouter 2 draps et 1 serviette, saisir 3 kg à
   2 000 FCFA/kg → 6 000 FCFA ; enregistrer, recharger : la composition du lot
   est affichée sur la fiche.
9. **Encaissement** — sur la fiche, *Encaisser en espèces*, saisir un acompte
   inférieur au total : le reçu s'affiche, le reste à payer est correct après
   rechargement. Aucun bouton Mobile Money n'apparaît.
10. **Permissions** — avec un compte sans `orders.create`, le bouton
    d'enregistrement reste cliquable et explique le refus ; rien n'est écrit.

---

## 8. Clôture du point 3

Trois restes de l'audit ont été traités dans un second lot, sans toucher au
moteur de commande :

| Reste | Traitement |
|---|---|
| **D5** — un rechargement (F5) ou une fermeture d'onglet effaçait la saisie sans un mot | Garde `beforeunload` dans `OrderForm`, armé dès qu'un nom, un téléphone ou une ligne existe, libéré au démontage. Le message personnalisé n'est pas possible côté navigateur, mais la confirmation l'est : c'est la différence entre « commande perdue » et « clic par erreur ». |
| Le test composant annoncé à l'audit n'existait pas | `src/test/orderBasket.test.tsx` : 13 cas sur `OrderBasket` (état vide, comptage pièces vs kilos, unité affichée, quantité/prix transmis à l'appelant, suppression, vidage) et sur `OrderItemGrid` (regroupement, ajout, badge de quantité, filtre sans accents, aucun résultat, icônes locales). |
| La documentation utilisateur décrivait encore « Client / Vêtements / Paiement » | `docs/USER_GUIDE.md` §3 réécrit pour les trois écrans (service, client et articles, récapitulatif), avec le lot au kilo, l'article libre et le garde de rechargement. `docs/RECETTE-BOUTONS.md` §3 reçoit la checklist manuelle correspondante, `README.md` une ligne sur le parcours. |

Quatre cas ont été ajoutés à `orderForm.test.tsx` : formulaire vierge → aucune
confirmation ; nom saisi → confirmation ; ligne au panier → confirmation ;
composant démonté → plus d'écouteur (sinon toute l'application demanderait
confirmation à chaque rechargement).

Non couvert, et assumé : le garde n'est pas rejoué dans Playwright. Le
navigateur affiche une boîte native que le test ne peut que constater, et
`beforeunload` n'existe pas en jsdom au-delà de l'événement — les quatre cas
unitaires vérifient la seule chose qui nous appartienne, l'armement et le
désarmement de l'écouteur.

## 9. État de la branche

Branche `arena/b47084c6-laundrypressing`, aucun changement sur `main`. Les
points 1 et 2 sont déjà livrés (`7704e14`, `413be87`) ; ce point ajoute les
fichiers ci-dessus. `main` reste intact tant que la revue n'est pas faite.
