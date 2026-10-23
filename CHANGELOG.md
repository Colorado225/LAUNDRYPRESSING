# Journal des modifications

Toutes les évolutions notables de **Pressing Pro** sont consignées ici.
Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
versionnage selon [SemVer](https://semver.org/lang/fr/).

---

## [0.9.0] — 2026-10-23

Vraie page d'authentification : connexion **et** inscription libre d'un
pressing, au lieu d'un écran de connexion unique.

### Ajouté

- **Page en deux panneaux** (`src/pages/Login.tsx`) : formulaire à gauche sur
  une carte en verre dépoli, photo du pressing à droite avec voile dégradé et
  trois repères. Deux **onglets** : *Se connecter* / *Créer un compte*.
- **Fond animé** : deux halos flous qui respirent derrière la carte, une entrée
  en fondu montant, une pastille flottante. **Toutes les animations sont
  coupées sous `prefers-reduced-motion`** : le confort passe avant l'effet.
- **Photo d'illustration** (`src/assets/auth-pressing.jpg`, 200 ko) : intérieur
  de pressing abidjanais. Servie en `eager` sur le seul panneau bureau ; en
  dessous de 1024 px, le panneau disparaît et le formulaire occupe la largeur.
- **Écran de réinitialisation aligné** sur le même fond et la même carte.
- **Inscription** : nom du pressing, téléphone facultatif, e-mail, mot de passe
  (8 caractères, une lettre, un chiffre), confirmation, conditions. Validation
  champ par champ **avant** l'envoi (`src/lib/inscription.ts`), erreurs annoncées
  aux lecteurs d'écran.
- **`create_tenant_for_user`** (migration `008_inscription.sql`) : crée le
  pressing, rattache le compte comme **propriétaire** et ouvre un **essai de
  14 jours**, en une seule transaction `security definer`.
- **Reprise d'une inscription interrompue** : si le compte a été créé mais que le
  pressing ne l'a pas été (coupure réseau entre deux requêtes), le second envoi
  ne recrée pas de compte — il termine l'opération. La connexion termine aussi
  une inscription en attente, à partir du nom conservé dans `user_metadata`.
- **Confirmation par e-mail gérée** : écran dédié, et aucune écriture tant que
  la session n'est pas ouverte.
- 29 tests supplémentaires (validation du formulaire, service d'inscription,
  montage de la page, et **11 contrôles SQL** sur les garde-fous serveur).

### Décidé

- **L'inscription passe par une fonction `security definer`, pas par une
  politique d'insertion.** Une politique `insert` sur `tenants` puis sur
  `tenant_users` rouvrirait exactement la faille corrigée en `001`
  (auto-rattachement comme propriétaire d'un pressing tiers) ; la fonction impose
  `auth.uid()` et le rôle `owner`, jamais un paramètre.
- **Un compte ne crée qu'un pressing.** L'ajout à une équipe existante reste le
  fait du propriétaire ou de l'éditeur ; la fonction refuse un compte déjà
  rattaché (`23505`), et le test SQL vérifie qu'aucun pressing orphelin ne reste.
- **Mot de passe à 8 caractères avec lettre et chiffre**, au-delà du minimum
  Supabase (6). Pas de règle de symbole obligatoire : elle pousse à noter le mot
  de passe sur un papier collé à la caisse.
- **Aucune information sur l'existence d'un compte** : Supabase ne révèle pas
  qu'une adresse est déjà prise, l'écran détecte le cas (identités vides) et
  renvoie vers la connexion sans confirmer l'existence du compte.

### Vérifié

- 405 tests sur 27 fichiers, **134 contrôles SQL** sur 8 fichiers, `tsc --noEmit`,
  ESLint, build de production, migration `008` appliquée puis rejouée sur
  PostgreSQL 16.2.
- **Provisionnement réel** le 23/10 sur un projet Supabase (PostgreSQL 17) :
  8 migrations appliquées, 20 tables, 66 politiques RLS. Deux constats consignés
  dans `docs/RECETTE-SUPABASE.md` : `anon` héritait du droit d'exécution sur les
  fonctions `security definer` (révoqué, et corrigé dans `008`), et le SMTP
  intégré plafonne les e-mails de confirmation.

## [0.8.0] — 2026-10-23

Facturation A4 — le document que le pressing archive et transmet, à côté du
ticket 80 mm remis au client.

### Ajouté

- **`/commandes/:orderId/facture`** (`src/pages/Facture.tsx`) : facture A4 avec
  en-tête du pressing, bloc client, prestations **regroupées** (deux chemises
  lavées = une ligne, quantité 2), totaux, acomptes **datés**, reste à payer,
  total **en toutes lettres** et mention « facture acquittée » quand le solde
  est nul.
- **`src/lib/facturation.ts`** : numéro **déterministe** `FA-AAAA-XXXXXX`,
  regroupement des lignes, construction du document, montant en lettres en
  français (règles de `quatre-vingts`, `cents`, `mille` invariable). 33 tests.
- **`src/lib/impression.ts`** : `@page` injecté **au moment de l'impression**,
  en A4 ou en 80 mm, puis retiré. La taille du papier ne peut pas dépendre d'une
  classe du DOM, d'où cette feuille temporaire plutôt qu'une règle statique.
- **Lien « Facture »** à côté du reçu dans le panneau d'encaissement.

### Décidé

- **Aucune bibliothèque PDF.** Une librairie comme jsPDF aurait ajouté ~300 ko
  et produit un PDF image. Le navigateur, lui, sait « Enregistrer au format
  PDF » depuis sa boîte d'impression : le document reste du **texte**,
  sélectionnable et lisible par un lecteur d'écran.
- **Numéro déterministe, pas séquentiel.** Un compteur « 0001, 0002… » exigerait
  un état serveur : hors ligne, deux tablettes produiraient le même numéro, et
  une facture réimprimée changerait de numéro. `FA-AAAA-` + six caractères de
  l'UUID est stable, unique et ne demande aucun stockage.
- **Pas de TVA inventée.** Le régime fiscal du pressing n'est pas connu de
  l'application ; afficher un taux arbitraire produirait une fausse facture. Le
  document donne le total HT/TTC neutre, la devise (XOF) et le montant en
  lettres.
- **Rendu hors ligne.** La facture est construite depuis Dexie, comme le reçu.
  Le Mobile Money confirmé côté serveur n'y figure pas : la mention le dit
  explicitement, plutôt que d'afficher un solde faux.

### Vérifié

- 376 tests sur 24 fichiers, 123 contrôles SQL, `tsc --noEmit`, ESLint, build de
  production.

## [0.7.0] — 2026-10-23

Écran 12 enrichi : les paramètres deviennent un poste de conduite du pressing,
et non plus une simple fiche de lecture.

### Ajouté

- **Renommage du pressing** (nom, téléphone) réservé au propriétaire
  (`src/services/tenantService.ts`). Le formulaire relit la fiche avant de
  s'ouvrir : sans cela, enregistrer le nom aurait effacé le téléphone, absent du
  contexte local.
- **Équipe** : liste des membres et de leur rôle, avec la mention « (moi) ».
- **Sécurité du compte** : bouton *Changer le mot de passe* (envoi du lien par
  e-mail, aucun mot de passe saisi sur la tablette) et *Déconnecter tous les
  appareils* (`signOut({ scope: 'global' })`), pour une tablette revendue ou
  perdue.
- **Données sur cet appareil** (`src/db/maintenance.ts`) : commandes, en attente,
  en conflit, lignes, encaissements, espace occupé via `navigator.storage`.
- **Export JSON** de sauvegarde (commandes, lignes, encaissements, anomalies,
  remboursements du pressing courant).
- **Purge des commandes synchronisées** : libère la tablette sans jamais
  supprimer une commande en attente d'envoi ou en conflit.
- **`src/lib/parametres.ts`** : validation pure du nom et du téléphone, tailles
  lisibles, règle de purgeabilité. 17 tests, plus 11 sur les données locales et
  4 sur le montage de l'écran.

### Décidé

- **Rien n'est écrit ici qui vive ailleurs.** La formule reste dans
  `/abonnement`, l'équipe et les rôles dans la console de supervision : un écran
  « paramètres » qui doublerait ces écritures créerait deux chemins pour la même
  donnée.
- **La purge est conservatrice par construction.** `estPurgeable` exige
  `synced === 1` **et** l'absence de conflit ; la règle est testée séparément de
  l'écran.
- **Le téléphone se lit avant d'être écrit**, même si cela ajoute un aller-retour
  réseau : une perte de donnée silencieuse coûte plus cher qu'une requête.

### Vérifié

- 334 tests sur 21 fichiers, 123 contrôles SQL, `tsc --noEmit`, ESLint, build de
  production.

## [0.6.1] — 2026-10-23

Pagination serveur des dépenses — la première liste qui ne tient pas dans Dexie.

### Ajouté

- **`listExpensesPage`** (`expenseService.ts`) : page de 25 dépenses triée par
  `created_at` **puis** `id` décroissants, avec **curseur** et indicateur de
  suite. La requête demande une ligne de plus que la page : elle sait s'il
  existe une suite sans `count(*)`.
- **`decouperPageCurseur` et `filtreCurseur`** (`src/lib/pagination.ts`) :
  découpe d'une page reçue du serveur et construction du filtre
  `created_at.lt.V, and(created_at.eq.V, id.lt.I)`.
- **Bouton « Charger les dépenses plus anciennes »** sur `/depenses` : la page
  suivante s'ajoute à la liste, sans rechargement ni perte de position. Le
  nombre de dépenses affichées est indiqué, ainsi que la fin du registre.

### Corrigé

- **Total du mois des dépenses** : il était calculé sur les 60 lignes chargées
  (plafond silencieux). Il vient désormais d'une agrégation serveur, donc il
  reste juste au-delà de ce plafond — et affiche « Hors ligne » plutôt que zéro
  quand la lecture échoue.

### Décidé

- **Curseur, pas `offset`.** Une dépense saisie entre deux pages décalerait
  toutes les suivantes : doublon en bas de page 1, ligne manquante en page 2.
  Le curseur repart de la dernière ligne réellement vue.
- **Tri total (`created_at`, `id`).** L'horodatage seul n'est pas unique ; un
  tri partiel rendrait la pagination instable.
- **La pagination locale ne change pas** pour les commandes : elles sont déjà
  toutes dans Dexie pour le hors ligne, et `paginate` reste la bonne réponse.

### Vérifié

- 302 tests sur 18 fichiers (dont 8 sur la requête réellement construite), 123
  contrôles SQL, `tsc --noEmit`, ESLint, build de production.

## [0.6.0] — 2026-10-23

Écran 11 de la maquette (rapports) et branchement d'une base PostgreSQL gérée.

### Ajouté

- **Écran Rapport** (`/rapports`, propriétaire) : période de **7, 30 ou 90
  jours**, facturé / encaissé / commandes / panier moyen **comparés à la
  période précédente de même durée**, série quotidienne en barres, répartition
  par statut (annulations comprises), activité par jour de la semaine, top 5 des
  prestations et **export CSV** de la série.
- **`src/lib/reporting.ts`** : calculs purs et testés (bornes de période,
  séries sans trou de jour, variations, CSV). 23 tests, plus 3 tests de
  montage de la page (rendu réel, refus d'accès au réceptionniste, écran vide).
- **`npm run db:etat` / `db:push` / `db:verifier`** (`scripts/db.mjs`) :
  inventaire en lecture seule, application des migrations puis rejeu des
  **123 contrôles SQL** sur une base PostgreSQL gérée (Neon ou autre), sans
  compte Supabase. Suivi par table `_pressing_migrations`, garde-fou sur une
  base déjà initialisée, `--dry-run`, mot de passe toujours masqué. 15 tests.
- **`docs/NEON.md`** : ce qui est branché, ce qui ne peut pas l'être et pourquoi.

### Décidé

- **Graphiques en SVG faits à la main.** Trois courbes ne justifient pas une
  librairie de graphiques dans un bundle destiné à une tablette d'entrée de gamme
  en 3G.
- **Comparaison à la période précédente**, pas « au mois dernier » : comparer un
  23 octobre à un 1er octobre mêlerait un jour ouvré et une période complète.
- **Neon ne remplace pas Supabase pour l'application.** Un navigateur ne peut
  pas détenir un mot de passe de base, et Neon ne fournit ni PostgREST, ni
  GoTrue, ni les Edge Functions. La base gérée sert donc de **cible de schéma et
  de vérification**, jamais de backend direct.
- **`db:push` inclut `supabase/seed.sql`** et refuse de s'exécuter sur une base
  déjà initialisée sans table de suivi : le risque d'écraser un client est
  écarté par défaut, pas par la vigilance de l'opérateur.

### Vérifié

- 286 tests sur 17 fichiers, `tsc --noEmit`, ESLint et build de production
  (dont 3 tests de montage de l'écran Rapports).
- `db:push` → `db:etat` → `db:verifier` de bout en bout sur PostgreSQL 16.2 :
  20 tables, 66 politiques, 0 table sans RLS, **123 contrôles** réussis.

## [0.5.3] — 2026-10-23

Dette technique close : la liste des commandes est paginée, et le projet déployé
peut être contrôlé en une commande.

### Ajouté

- **Pagination de la liste des commandes** (`/commandes`) : 20 commandes par
  page, barre « 21–40 sur 137 », boutons *Précédent* / *Suivant* désactivés aux
  bornes. La recherche et les onglets de statut portent sur **toute** la liste,
  jamais sur la page affichée.
- **`src/lib/pagination.ts`** : découpe de page pure et bornée (`paginate`,
  `Page<T>`, `DEFAULT_PAGE_SIZE`), réutilisable par les futures listes. 9 tests.
- **`npm run recette`** (`scripts/recette.mjs`) : 7 contrôles **en lecture
  seule** sur un projet déployé — API REST joignable, `orders` et
  `platform_admins` fermées à l'anonyme, 20 tables, 3 formules,
  `rpc/my_subscription` et webhook CinetPay déployés. Code de sortie 0/1, donc
  utilisable en CI ou avant une livraison. 9 tests sur le script lui-même.
- **`docs/RECETTE-SUPABASE.md`** : marche à suivre de la recette qu'un humain
  doit exécuter (provisionnement, contrôles SQL, parcours comptoir, paiement
  CinetPay de bout en bout, installation PWA sur tablette, contrôles de sécurité
  côté API).

### Décidé

- **Pagination purement locale.** Les commandes sont déjà toutes dans Dexie pour
  fonctionner hors ligne : paginer côté serveur imposerait un second chemin de
  lecture, donc deux comportements à tester. On découpe le rendu, pas la donnée.
- **La page revient à 1 quand le filtre change**, sans `useEffect` : l'état
  retient `{ clé, page }` et la page affichée n'est retenue que si la clé
  (`recherche|onglet`) correspond. Aucune remise à zéro impérative, donc aucun
  rendu intermédiaire avec une page hors bornes.
- **`npm run recette` n'écrit jamais.** Il peut tourner sur la base d'un client
  en production sans laisser de trace.

### Vérifié

- 245 tests sur 14 fichiers, `tsc --noEmit`, ESLint et build de production.

## [0.5.2] — 2026-10-23

Deux écrans de la maquette complétés : le formulaire de commande en étapes et
les cinq dernières commandes sur le tableau de bord.

### Ajouté

- **Création de commande en trois étapes** (`/commandes/nouvelle`) :
  **Client → Vêtements → Paiement**. Chaque étape est validée séparément
  (téléphone, prix, motif de tarif dérogatoire) et ramène l'utilisateur sur le
  champ fautif ; les étapes franchies restent visibles dans un fil d'étapes.
- **Étape de règlement** : « régler plus tard » ou « encaisser des espèces
  maintenant ». Dans le second cas, la fiche s'ouvre avec le panneau
  d'encaissement déplié et le montant pré-rempli (`?regler=1`).
- **Cinq dernières commandes** sur le tableau de bord : référence, client,
  statut, montant, date, avec lien vers la fiche et vers la liste complète.
  L'ordre suit la **date de création** : une ancienne commande dont le statut
  change ne remonte pas en tête.
- 5 tests supplémentaires sur `recentOrders` (227 au total).

### Décisions

- **Aucun argent ne circule à l'étape 3.** Un encaissement a besoin d'une
  commande existante (clé étrangère côté serveur, reçu imprimable, idempotence
  de la file de synchronisation) : le formulaire ne fait donc que préparer
  l'ouverture du panneau de caisse.

## [0.5.1] — 2026-10-23

Passe de **conformité MVP** : comparaison des douze écrans de la maquette avec
le code livré, puis comblement des manques réels.

### Ajouté

- **Réinitialisation du mot de passe** : lien sur l'écran de connexion
  (`resetPasswordForEmail`), page `/reinitialisation` qui enregistre le nouveau
  mot de passe (`updateUser`). Le message de confirmation reste neutre pour ne
  pas révéler quelles adresses existent.
- **Arguments de connexion** : encart *Rapide / Sécurisé / Fiable* à côté du
  formulaire, masqué sous 1024 px pour laisser toute la largeur à la tablette.
- **Historique des derniers scans** (`/atelier`) : cinq dernières lectures de la
  session (client, code, statut, heure).
- **Page Paramètres** (`/parametres`) : pressing et identifiant copiable, compte
  connecté et rôle, état de synchronisation avec relance manuelle, rappel hors
  ligne et accès à l'abonnement.
- **Barre latérale en bureau** : à partir de 1024 px, la navigation passe en
  colonne fixe à gauche ; en dessous, les onglets horizontaux et leurs cibles
  tactiles de 48 px sont conservés. Une seule liste de destinations alimente les
  deux présentations.
- **`docs/CONFORMITE-MVP.md`** : correspondance écran par écran, écarts réels et
  écarts assumés.

### Décisions

- **Pas de bouton OAuth « Se connecter avec Supabase »** : aucun fournisseur
  n'est configuré pour un pressing, et le `tenant_id` vient de `tenant_users`,
  jamais du fournisseur d'identité.
- **Pas de route `/payment/:orderId`** : le paiement reste un panneau de la fiche
  commande, où le contexte (client, articles, solde) est disponible.
- **Modules des paliers 3 et 4 conservés** : ils sont livrés, testés et masqués
  par rôle quand le pressing ne s'en sert pas.

## [0.5.0] — 2026-10-23

Palier 4 de la feuille de route (`MAJ.md`) : le **SaaS** — abonnement,
multi-boutiques, supervision de l'éditeur et support. Le produit couvre
désormais l'intégralité du périmètre de l'audit.

### Ajouté

- **Formules et abonnements** (`plans`, `subscriptions`) : trois formules
  (Essentiel, Pro, Réseau) avec prix, durée, nombre de comptes et de boutiques.
  L'état affiché est recalculé par `subscription_state()` — `active` jusqu'à
  l'échéance, `grace` pendant sept jours, `expired` ensuite ; une suspension
  décidée par l'éditeur l'emporte sur les dates.
- **Lecture seule quand l'abonnement est échu** : politiques RLS restrictives
  sur les dix tables métier et déclencheurs sur `payment_transactions`,
  `payment_refunds` et `stock_movements`. Un pressing **sans** abonnement reste
  inscriptible : aucune migration ne coupe un client existant. Les lectures
  restent ouvertes — les données appartiennent au pressing.
- **Multi-boutiques** : un compte peut être rattaché à plusieurs pressings avec
  un rôle différent par boutique. La boutique active voyage dans l'en-tête
  `x-tenant-id`, accepté seulement si `is_tenant_member()` confirme le
  rattachement ; `current_tenant_role()` est recalculé par boutique. Sélecteur
  `ShopSwitcher` dans l'en-tête, visible à partir de deux boutiques.
- **Console de supervision** (`/supervision`, réservée à l'éditeur) : suivi des
  pressings (formule, état, échéance, comptes, commandes, dernière activité),
  renouvellement, suspension, ouverture de boutique et rattachement de comptes
  (bornés par `max_shops` et `max_users`), file des demandes de support.
  `platform_admins` n'a **aucune politique RLS** ; chaque fonction
  `security definer` vérifie `is_platform_admin()` et lève `42501` sinon.
- **Support** (`/support`) : le pressing ouvre une demande et lit la réponse ;
  les demandes sont cloisonnées par `tenant_id`.
- **Écran Abonnement** (`/abonnement`) : formule, échéance, comptes et boutiques
  autorisés, catalogue des formules, et bandeau permanent en cas d'échéance
  proche, de grâce ou de lecture seule.
- **Installation** : `PLATFORM_ADMIN=true` dans `.env` inscrit le compte
  propriétaire dans `platform_admins` au moment de `npm run setup`.
- **Tests** : 19 nouveaux tests (222 au total) et 28 contrôles SQL
  supplémentaires (123 au total).

### Décisions

- **Aucun paiement d'abonnement en ligne.** Le règlement se fait auprès de
  l'éditeur, qui enregistre la période réglée. Encaisser un abonnement aurait
  exigé un second compte marchand, une réconciliation et une comptabilité de
  reversement : hors périmètre, et sans bénéfice pour le pressing.
- **Blocage au niveau base, pas interface.** Masquer un bouton n'a jamais
  empêché un appel direct : la lecture seule est appliquée par RLS et
  déclencheurs, l'interface ne fait qu'expliquer la règle.
- **`max_shops` compte les boutiques où le compte est propriétaire.** Règle
  commerciale simple et vérifiable, plutôt qu'une facturation automatique.

### Limites connues

- La console exige l'**identifiant Supabase** du compte à rattacher : créer un
  compte depuis l'interface demanderait la clé `service_role` dans le
  navigateur, ce qui est proscrit.
- Une demande de support ne peut pas être déposée hors ligne.
- Toujours aucune recette sur un projet Supabase réel (aucun identifiant dans
  l'environnement de développement) : schéma, RLS et règles sont en revanche
  exécutés sur PostgreSQL 16.

## [0.4.0] — 2026-10-23

Palier 3 de la feuille de route (`MAJ.md`) : la **gestion** du pressing —
clients, stock, fournisseurs, dépenses — et le **tableau de bord du
propriétaire**.

### Ajouté

- **Clients et historique** (`customers`, `/clients`) : fiche identifiée par le
  téléphone, historique des commandes, total dépensé, reste à encaisser,
  retards, coordonnées et notes modifiables. Le rapprochement se fait sur le
  numéro normalisé (`normalize_phone` en SQL, `normalisePhone` en TS) :
  « +225 07 00 00 00 21 » et « 0700000021 » sont la même personne.
- **Création automatique de la fiche** : `attach_customer_to_order`
  (`security definer`) crée ou complète le client à chaque commande ; le nom le
  plus récent l'emporte, une correction de faute de frappe au comptoir profite
  donc à la fiche.
- **Stock** (`stock_items`, `stock_movements`, `/stock`) : articles
  consommables catégorisés (produit, emballage, consommable, autre), unités
  (pièce, litre, kg, flacon, rouleau), **seuil d'alerte**, entrées et sorties.
  La quantité découle d'un **grand livre immuable** : `apply_stock_movement`
  refuse une sortie supérieure au stock (code `22023`). La quantité initiale
  crée un mouvement « Stock initial ».
- **Fournisseurs** (`suppliers`) : nom, téléphone, notes ; création réservée au
  propriétaire, lecture au comptoir.
- **Dépenses** (`expenses`, `/depenses`) : six catégories, date, fournisseur
  facultatif, note ; **réservées au propriétaire** (RLS). Vue `expense_totals`
  en `security_invoker` pour les agrégations.
- **Tableau de bord** (`/tableau-de-bord`) : commandes du jour, en atelier,
  prêtes et en retard ; espèces du jour et de la semaine ; Mobile Money du
  jour ; panier moyen ; reste à encaisser ; série des sept derniers jours ;
  répartition par statut ; top des prestations ; alertes de stock ; dépenses du
  mois.
- **Rôles** : nouvelles capacités `customers.manage`, `stock.manage`,
  `stock.move`, `expenses.manage` et `dashboard.view`. Le propriétaire a tout ;
  le réceptionniste gère les clients et mouvemente le stock ; l'artisan ne
  change que le statut des commandes.

### Modifié

- **`useAllLocalItems` et `useAllCashPayments`** : lecture Dexie complète pour
  les agrégats du tableau de bord, réactive aux écritures de synchronisation.
- **Navigation** : entrées « Tableau de bord », « Clients », « Stock » et
  « Dépenses », chacune conditionnée par la capacité du rôle.
- **Migrations SQL** : `006_palier3.sql` ajoute clients, fournisseurs, stock,
  dépenses et la vue des totaux ; `scripts/sql-verify.sh` la rejoue avec ses 17
  contrôles.

### Limites connues

- Les modules de **gestion** (stock, dépenses, fiches clients enrichies) sont
  **en ligne** : ils supposent le bureau connecté. L'historique client reste
  consultable hors ligne car il est dérivé des commandes locales.
- Une **dépense** ne peut pas être saisie hors ligne : deux sources de vérité
  rendraient la trésorerie incohérente.
- Le tableau de bord n'affiche pas les encaissements **Mobile Money** hors
  connexion : la tablette n'en garde aucune trace locale (le webhook écrit côté
  serveur). Le montant est marqué « hors ligne », jamais remplacé par zéro.
- Pas de **recette Supabase réelle** : la migration et les 17 contrôles SQL sont
  joués sur un PostgreSQL jetable, pas sur un projet provisionné.

---

## [0.3.0] — 2026-10-23

Palier 2 de la feuille de route (`MAJ.md`) : le cœur ERP — catalogue, caisse,
reçus et workflow complet —, avec les finitions d'atelier (attribution,
réclamations, remboursements).

### Ajouté

- **Catalogue** (`catalog_entries`) : article × prestation, prix en FCFA,
  réservé au propriétaire. Le prix est **recopié sur la ligne de commande** au
  moment de la vente (`order_items.price`) : une hausse tarifaire ultérieure ne
  réécrit jamais une ancienne facture.
- **Tarif dérogatoire** : un prix différent du catalogue exige un motif de
  10 caractères ; l'atelier ne peut pas toucher aux prix (politique RLS) et
  chaque changement est journalisé dans `order_price_history`.
- **Caisse** (`cash_sessions`, `/caisse`) : encaissement en espèces, acomptes,
  solde recalculé, clôture journalière et rapprochement des espèces déclarées.
  Le montant attendu est recalculé par le serveur, jamais fourni par le client.
- **Reçus** (`/commandes/:id/recu`) : 80 mm imprimable, référence, téléphone,
  articles, prix, montant reçu et **reste à payer toujours affiché**. Fonctionne
  hors ligne (lecture IndexedDB).
- **Workflow en 8 étapes** : réception → tri → lavage → séchage → repassage →
  contrôle qualité → prêt → remis, avec date de livraison promise et badge
  « En retard ».
- **Attribution** : une commande peut être confiée à un employé du pressing
  (`orders.assigned_to`) ; l'atelier peut se l'attribuer, pas la confier à un
  autre.
- **Réclamations** (`order_issues`) : tache, déchirure, décoloration, pièce
  manquante, constatées à la réception, pendant le traitement ou à la remise.
  L'atelier déclare, le comptoir clôture.
- **Remboursements** (`payment_refunds`) : propriétaire seulement, motif
  obligatoire, plafonnés aux encaissements nets ; déduits de la caisse du jour.
- **Motif de transition** : `orders.status_reason` transporte le motif d'une
  annulation ou d'un retour en arrière jusqu'à `order_status_history.reason`,
  puis est effacé.

### Modifié

- **`cinetpay-init`** ne demande plus que le **reste à payer** : un acompte
  espèces déjà encaissé n'est plus facturé une seconde fois par Mobile Money.
- **`syncEngine`** : les encaissements passent avant la relecture distante ;
  les réclamations sont transmises après les commandes ; un refus définitif
  sort de la file au lieu d'être renvoyé indéfiniment.
- **`guard_order_update`** : les transitions de statut doivent avancer (sauf
  propriétaire), l'annulation reste au comptoir.
- **Interface** : l'atelier ne propose plus que les transitions réellement
  autorisées ; le formulaire de commande affiche le motif de dérogation dès que
  le prix s'écarte du catalogue.

### Limites connues

- Un remboursement **n'est pas enregistrable hors ligne** : il sort de l'argent
  et doit être validé par le serveur.
- Les commandes modifiées sur un autre appareil ne sont relues que par
  `pullOrders` (état principal) : les réclamations et remboursements créés
  ailleurs ne sont pas encore rapatriés.
- La recette sur un projet Supabase réel reste à faire (aucun identifiant dans
  l'environnement de développement).

### Tests

179 tests (10 fichiers) ; `npm run sql:verify` rejoue **76 contrôles** sur un
PostgreSQL 16 jetable, dont 24 pour les finitions du palier 2 (attribution,
prix dérogatoire, réclamations, remboursements, clôture avec remboursement,
motif de transition).

---

## [0.2.0] — 2026-10-23

Palier 1 de la feuille de route (`MAJ.md`) : les trois risques majeurs relevés
lors de l'audit externe sont traités — double paiement, écrasement silencieux
entre tablettes, droits trop larges du rôle « artisan ».

### Ajouté

- **Migration `003_palier1.sql`** — colonne `orders.version`, trigger
  `bump_order_version` (incrément limité aux champs métier), historique enrichi
  (`previous_status`, `reason`), garde-fou `guard_order_update`, index unique
  partiel `uniq_payment_open_per_order`.
- **Arbitrage des conflits** — bandeau dans la fiche commande avec deux issues
  explicites (garder la version locale, adopter celle du serveur), badge
  « Conflit » dans la liste, service `orderConflictService`.
- **Matrice d'autorisations** (`src/lib/permissions.ts`) — propriétaire,
  réceptionniste, artisan ; navigation, création et montants masqués selon le
  rôle. L'artisan ne voit plus les prix et ne peut plus encaisser.
- **`APP_ENV`** — variable poussée dans les secrets des Edge Functions
  (`production` par défaut).

### Modifié

- **Synchronisation** : l'`upsert` inconditionnel est remplacé par un `insert`
  idempotent (doublon 23505 = réponse perdue, on relit la version) puis un
  `update … eq('version', n)` en compare-and-set. Le statut de paiement n'est
  plus envoyé par la tablette.
- **`cinetpay-init`** : un guichet ouvert de moins de 15 minutes est réutilisé
  tel quel ; un guichet périmé ou d'un autre montant est clôturé avant d'en
  ouvrir un nouveau. Un artisan reçoit 403.
- **`cinetpay-webhook`** : sans `CINETPAY_SECRET_KEY`, refus 503 en production ;
  la bascule vers `paid` est un compare-and-set (notifications simultanées).
- **`scripts/setup.mjs`** : `APP_ENV` transmis aux secrets ; une production sans
  clé secrète CinetPay est refusée au lieu d'être seulement signalée.
- **Interface** : `--color-brand-teal` assombri (`#0f766e`) pour dépasser le
  ratio de contraste AA sur le texte blanc.

### Limites connues

- Le **motif** d'une dérogation (colonne `reason`) n'est pas encore saisi par
  l'interface : la colonne existe, l'écran viendra avec le module caisse.
- La recette sur un projet Supabase réel reste à faire (aucun identifiant dans
  l'environnement de développement).

### Tests

130 tests (9 fichiers), dont 15 sur la synchronisation (conflit, doublon,
échec partiel), 8 sur la matrice de rôles et 2 sur la langue du dépôt. Nouveau script SQL
`supabase/tests/roles.sql` (11 contrôles serveur).

---

## [0.1.1] — 2026-10-23

Installation automatisée : après avoir rempli `.env`, `npm run setup` laisse
l'application pleinement fonctionnelle sans aucune manipulation dans le tableau
de bord Supabase.

### Ajouté

- **`scripts/setup.mjs`** — enchaîne la liaison du projet, `db push`
  (`001_init.sql` puis `002_payments.sql`), le déploiement des deux Edge
  Functions, l'envoi des secrets CinetPay, la création du pressing et du compte
  propriétaire (`app_metadata.tenant_id` + `tenant_users`), puis un contrôle
  final (`orders` doit répondre `42501`, webhook en ligne). Idempotent :
  relancer ne crée ni doublon de pressing ni second compte.
- **`scripts/lib/config.mjs`** — analyse du `.env` sans `dotenv` (commentaires,
  guillemets, `export`, aucun `$` interpolé), validation en deux niveaux :
  erreurs bloquantes (URL, clés, compte à moitié renseigné) et avertissements
  pour les fonctions dégradées (paiement sans identifiants CinetPay).
- **Options** — `--check`, `--dry-run`, `--skip-db`, `--skip-functions`,
  `--skip-account`, `--help`. Les commandes affichées masquent le mot de passe
  de la base.
- **Repli Docker** — si le démon Docker est absent, le déploiement bascule sur
  l'empaquetage côté Supabase (`--use-api`), au lieu d'échouer.
- **46 tests** sur les scripts : analyse du `.env`, validation, et contrat du
  provisionnement rejoué contre un serveur HTTP simulé (création puis relance).

### Modifié

- **`.env.example`** — documente les cinq valeurs indispensables
  (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`,
  `SUPABASE_SERVICE_ROLE_KEY`, plus les deux variables publiques), les
  identifiants du compte initial et `APP_URL`, avec la provenance de chaque
  valeur dans le tableau de bord.
- **`src/lib/env.ts` / écran de connexion** — trois états distincts : `ok`,
  `demo` (aucune variable) et `incomplete` (une seule des deux). Une
  configuration partielle affiche désormais la variable manquante au lieu de
  basculer silencieusement en mode démonstration.
- **README** — installation en une commande, tableau du déroulé de
  `npm run setup`, procédure manuelle conservée en dépannage.

### Tests

111 tests Vitest (7 fichiers), dont 46 pour les scripts d'installation.

---

## [0.1.0-mvp] — 2026-10-23

Première version complète du MVP : quatre modules, conformément au périmètre
fixé dans `RESTRUCTURATION.md` (commandes, QR code, offline-first, paiement
Mobile Money).

### Ajouté

- **Socle technique** — React 19 + TypeScript 6 + Vite 8 + Tailwind v4,
  Supabase (Auth + RLS), PWA installable. Migration `001_init.sql` : schéma
  multi-tenant, fonctions `current_tenant_id()` / `current_tenant_role()`,
  13 politiques RLS nommées, trigger d'historique des statuts.
- **Mode offline-first** — IndexedDB via Dexie (commandes, vêtements, paiements
  en attente), moteur de synchronisation idempotent (envoi à la reconnexion,
  toutes les 60 s et au retour au premier plan), indicateur d'état vert /
  orange / rouge avec envoi manuel.
- **Module QR Code** — étiquette `TENANT-ORDER-TIMESTAMP`, impression 80 mm,
  scan caméra en atelier (`html5-qrcode`, chargé à la demande), saisie manuelle
  de secours, changement de statut sans réseau.
- **Paiement Mobile Money** — Edge Functions `cinetpay-init` et
  `cinetpay-webhook`, table `payment_transactions` en lecture seule côté client,
  vérification HMAC-SHA256, reconfirmation systématique du statut auprès de
  CinetPay, page de retour non bloquante à six états. Wave, Orange Money,
  MTN MoMo et Moov Money.
- **Authentification et PWA** — connexion e-mail / mot de passe, pressing déduit
  de `tenant_users`, session restaurée hors ligne, écran `/offline`, gestion du
  bouton « Retour » Android, raccourcis d'appui long.
- **Documentation** — `docs/USER_GUIDE.md` (parcours réceptionniste, artisan,
  propriétaire), `docs/BACKLOG.md`, `docs/RAPPORT-FINAL.md`, README détaillé.
- **Tests** — 58 tests Vitest : service QR, moteur de synchronisation,
  `useCreateOrder`, isolation multi-tenant. Script SQL `supabase/tests/isolation.sql`.

### Modifié

- Le thème teal passe de `#0d9488` à `#0f766e` : le contraste du texte blanc
  sur le bouton principal atteint 5,47:1 (AA) au lieu de 3,74:1.
- Toutes les cibles tactiles des écrans de travail atteignent 48 px ; les champs
  de saisie passent en `text-base`.
- `AUDIT.md` et `BACKLOG.md` déplacés dans `docs/` pour regrouper la
  documentation du projet.

### Corrigé

- `restoreSession()` conservait mal la session hors ligne : supabase-js renvoie
  une session **avec** une erreur lorsque le rafraîchissement du jeton échoue ;
  seule l'absence totale de session ramène désormais à l'écran de connexion.
- Le webhook ignorait une notification tardive « REFUSED » qui aurait pu annuler
  un paiement déjà encaissé.
- La page de retour masquait le motif d'échec au lieu de l'afficher.
- Le mode hors ligne était testé après `isSupabaseConfigured`, ce qui laissait le
  badge vert sans connexion.

### Sécurité

- Aucune clé `service_role` dans le bundle client (test automatisé).
- Écritures de `payment_transactions` réservées aux Edge Functions.
- Le montant payé est toujours relu dans `orders` côté serveur : un client
  modifié ne peut pas payer moins cher.
- RLS vérifiée table par table (présence, absence de politique permissive,
  révocation du rôle `anon`).

### Limites connues

- Migrations et Edge Functions **non exécutées** : aucun projet Supabase n'était
  provisionné lors du développement. Validation par revue, analyse syntaxique
  SQL et transpilation.
- Aucun paiement réel effectué (pas d'identifiants marchand CinetPay).
- Audit Lighthouse non exécuté : aucun navigateur Chrome/Chromium disponible
  dans l'environnement de développement. Voir `docs/RAPPORT-FINAL.md`.
- Installation sur appareil Android physique non vérifiée.

---

## Modèle pour les versions suivantes

```text
## [0.2.0] — AAAA-MM-JJ

### Ajouté
### Modifié
### Déprécié
### Supprimé
### Corrigé
### Sécurité
```
