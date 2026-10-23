# Journal des modifications

Toutes les évolutions notables de **Pressing Pro** sont consignées ici.
Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
versionnage selon [SemVer](https://semver.org/lang/fr/).

---

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
