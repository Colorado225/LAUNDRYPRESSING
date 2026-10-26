# CRUD complet — état, règles et exploitation

**Date :** 26 octobre 2026
**Dernière migration concernée :** `025_crud_complet.sql`

Ce document décrit les opérations **créer / lire / modifier / supprimer** offertes
par chaque écran de gestion, la règle métier qui les encadre et la couche qui les
protège (interface, service, RLS, déclencheur).

> Les commandes restent **local-first** : la création, l'avancement et les
> encaissements espèces s'écrivent d'abord dans IndexedDB. Les modules de gestion
> (clients, stock, dépenses, équipe, support) restent **en ligne**, décision
> documentée depuis la migration 006 : un inventaire ou une dépense ne se saisit
> pas en plein service.

## 1. Matrice des opérations

| Module | Créer | Lire | Modifier | Supprimer | Rôles |
|---|---|---|---|---|---|
| Commandes | Formulaire libre + QR | Liste, fiche, atelier | Statut, échéance, attribution, lignes (ajout/retrait) et mesures | **Propriétaire**, si aucun encaissement ni remboursement | comptoir + atelier |
| Réclamations | « Signaler » sur la fiche | Fiche commande | Clôture / réouverture (réparé, dédommagé, sans suite) | **Propriétaire** | atelier constate, comptoir clôture |
| Clients | « Nouveau client » (fiche sans commande) | Liste locale + fiches serveur | Nom, téléphone, e-mail, adresse, préférences | **Propriétaire** | comptoir |
| Stock — articles | « Nouvel article » | Liste, alertes de seuil | Nom, catégorie, unité, seuil, coût | **Propriétaire**, si aucun mouvement | propriétaire crée, comptoir mouvemente |
| Stock — mouvements | Entrée / sortie, imputation à une ligne | Derniers mouvements | — (journal immuable) | — | propriétaire + réception |
| Fournisseurs | « Ajouter » | Panneau fournisseurs | Nom, téléphone, note, désactivation | **Propriétaire**, si inutilisé | propriétaire |
| Dépenses | Formulaire | Liste paginée par curseur, total du mois | Libellé, catégorie, montant, date, fournisseur, note | **Propriétaire** | propriétaire |
| Support | Nouvelle demande | Mes demandes | Clôture par le pressing | Auteur/propriétaire, **demande ouverte seulement** | comptoir |
| Équipe | Rattachement par e-mail | Annuaire avec e-mails | Rôle, nom affiché | Détachement **sauf dernier propriétaire** | propriétaire |
| Prestations | Activité, prestation | Onglets | Nom, tarif au kilo | Suppression confirmée | propriétaire |
| Paramètres | — | Identité, compte, données locales | Nom et téléphone du pressing | — | propriétaire |
| Supervision | Boutique, abonnement, membre | Vue éditeur | Formule, période, rôle | — | éditeur uniquement |

## 2. Ce que la migration 025 ajoute

Aucune table nouvelle : elle complète les **écritures manquantes** des tables
existantes et protège l'historique.

1. **Clients**
   - `prepare_customer_row()` calcule `phone_key` (via `normalize_phone`) et
     `updated_at` à chaque écriture : une fiche créée à la main se rapproche des
     commandes exactement comme celles créées par un ticket.
   - `customers_insert_counter` : comptoir et propriétaire créent.
   - `customers_delete_owner` : propriétaire seul. Les commandes gardent le nom
     et le téléphone ; seul `customer_id` passe à `NULL`.
   - `grant insert, delete` au rôle `authenticated`.

2. **Stock et fournisseurs**
   - `guard_stock_item_delete()` refuse la suppression d'un article mouvementé
     (`23503`). La clé étrangère étant `on delete cascade`, sans ce garde-fou un
     inventaire effacerait des sorties déjà imputées à des commandes.
   - `guard_supplier_delete()` refuse la suppression d'un fournisseur porteur
     d'une dépense ou d'un mouvement. La désactivation (`is_active = false`)
     conserve l'origine des écritures.
   - Aucune nouvelle politique : `stock_items_write_owner` et
     `suppliers_write_owner` sont déjà `for all` au propriétaire.

3. **Support**
   - `tenant_close_support_request(id)` : clôture par le comptoir du pressing,
     avec `response` renseignée si elle était vide.
   - `tenant_delete_support_request(id)` : retire une demande **encore ouverte**,
     par son auteur ou par le propriétaire.

4. **Équipe**
   - `tenant_team()` : annuaire du pressing actif, e-mails compris, lisible par
     tout membre (`security definer`, contrôle `is_tenant_member`).
   - `tenant_set_member(user, role, nom)` : rattache, change le rôle ou le nom,
     `p_role = null` détache. Vérifie le rôle propriétaire, l'abonnement
     (`tenant_writable`), la limite `plans.max_users` et la règle du **dernier
     propriétaire**.
   - `tenant_attach_member_by_email(email, role, nom)` : retrouve le compte
     existant ; aucun mot de passe ne circule. Un e-mail inconnu est refusé
     (`P0002`).
   - `tenant_remove_member(user)` : raccourci de détachement.
   - `tenant_users` n'accorde toujours que `select` au client : toutes les
     écritures passent par ces fonctions.

5. **Commandes**
   - Aucune migration nécessaire pour l'édition : `orders_update_tenant`,
     `order_items_write_tenant`, `order_items_update_tenant` et
     `order_items_delete_tenant` existaient déjà. Le travail a donc porté sur
     le **frontend et le moteur de synchronisation** :
     - `pushOrder` transmet désormais `assigned_to`, `assigned_at` et
       `status_reason`. Ces colonnes étaient absentes de la charge utile de mise
       à jour : l'attribution faite à l'atelier n'arrivait jamais au serveur (et
       le rapatriement suivant l'effaçait), et le motif d'annulation saisi au
       comptoir n'atteignait pas l'historique.
     - Après l'upsert des lignes, le moteur **purge les lignes distantes
       absentes de la liste locale** (`delete … not in (ids)`). Sans cela, une
       ligne retirée continuait d'exister sur les autres appareils.
   - Nouvelle correction possible depuis la fiche : « Modifier l'échéance »
     (`updateOrderDueDateLocal`, jusqu'ici présent mais jamais appelé par
     l'écran) et le panneau **Articles** (`addOrderItemLocal`,
     `removeOrderItemLocal`).
   - Garde-fous : une commande livrée, annulée ou soldée n'est plus modifiable ;
     la dernière ligne ne peut pas être retirée ; une ligne libre porte un
     motif de prix d'au moins 10 caractères, exigé par le déclencheur serveur
     `guard_order_item_price` (vérifié sur la base réelle).
   - La politique `orders_delete_owner` existait déjà (001), mais les clés
     étrangères de `payment_transactions` et `payment_refunds` sont en
     `on delete cascade` : supprimer une commande effaçait en silence ses
     encaissements Mobile Money et ses remboursements.
   - `guard_order_delete()` refuse désormais la suppression (`23503`) dès qu'un
     paiement ou un remboursement existe. L'interface propose alors
     l'**annulation** (`status = 'cancelled'`), qui conserve l'historique.
   - Le service `orderAdminService` vérifie en plus, côté client, les
     encaissements et remboursements locaux avant d'appeler le serveur.

## 3. Règles métier vérifiées par les tests

`src/test/crudServices.test.ts`, `src/test/crudLocal.test.ts`,
`src/test/clientsPage.test.tsx` et `supabase/tests/crud_complet.sql` couvrent :

- normalisation du téléphone et refus du doublon, quel que soit le chemin
  d'écriture ;
- suppression de fiche refusée au réceptionniste, autorisée au propriétaire ;
- suppression d'un article mouvementé refusée, archivage accepté ;
- suppression d'un fournisseur utilisé refusée, désactivation acceptée ;
- clôture et retrait du support selon le rôle et le statut ;
- rattachement par e-mail, protection du dernier propriétaire, refus aux rôles
  non propriétaires ;
- suppression d'une commande impossible dès qu'un encaissement, un remboursement
  ou une transaction Mobile Money existe (déclencheur `orders_guard_delete`
  couvert par le contrôle 19), annulation acceptée à la place ;
- suppression locale qui nettoie lignes, réclamations, notifications, file
  d'encaissement et remboursements (aucun orphelin dans les agrégats) ;
- clôture de réclamation locale en mode démonstration et refus tant que la
  réclamation n'est pas synchronisée ;
- ajout d'une ligne au comptoir, retrait d'une ligne et total recalculé, y
  compris le refus de retirer la dernière ligne ;
- envoi de l'attribution et du motif de statut, et purge des lignes retirées
  côté serveur (`src/test/syncEngine.test.ts`).

## 4. Ordre d'application et compatibilité

1. Appliquer `025_crud_complet.sql` (additive, réversible par `drop` des
   fonctions/politiques ; aucune donnée supprimée).
2. Déployer le frontend correspondant.
3. Vérifier sur un pressing de recette : création de fiche client, suppression
   d'un article mouvementé (doit être refusée), rattachement d'un collègue.

Tant que 025 n'est pas appliquée, l'application reste utilisable : la lecture de
l'équipe retombe sur `tenant_users` (sans e-mails) et les écritures ajoutées
renvoient une erreur explicite (« fonction introuvable »).

`scripts/sql-verify.sh` applique la migration puis `supabase/tests/crud_complet.sql`
après la 024. La suite complète a été rejouée le 26 octobre 2026 sur PostgreSQL
via PGlite (extension `pgcrypto` omise, `gen_random_uuid()` natif) : toutes les
migrations et tous les tests passent, y compris les 19 contrôles du nouveau test.
`psql` n'étant pas installé dans l'environnement de développement, la suite a
également été rejouée par la CI sur PostgreSQL 16 réel (`npm run sql:verify`,
PR #8) : migrations 001 à 025 et tous les tests SQL passent, sans réserve.

## 5. Points d'attention

- **Suppression de commande** : opération définitive, réservée au propriétaire.
  Une commande qui porte de l'argent doit être **annulée**, pas supprimée. La
  suppression distante est tentée avant le nettoyage local : un échec réseau
  laisse la commande intacte et affiche l'erreur.
- **Clients** : supprimer une fiche ne supprime pas les commandes. L'historique
  reste lisible via le nom et le téléphone saisis sur les tickets.
- **Équipe** : la création de compte reste hors application (pas de
  `service_role` dans le navigateur). Le propriétaire rattache un compte
  existant, il n'en crée pas.
- **Mouvements de stock et réclamations déjà envoyées** : le journal des
  mouvements n'est jamais modifiable ; une réclamation se clôture, elle ne
  s'écrase pas.
- **Support** : une demande déjà traitée ne peut pas être retirée, seulement
  clôturée, afin de conserver la trace de l'échange.
