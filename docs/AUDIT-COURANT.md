# Audit courant — Pressing Pro

**Date :** 26 octobre 2026
**Branche :** `arena/e64723d6-laundrypressing`
**Périmètre :** application, synchronisation, migration 020, tests et documentation du dépôt.

> Cet audit décrit l’état vérifié dans cette révision. Les documents d’audit antérieurs restent dans Git comme historique, mais ne sont pas une description de la version actuelle.

## Résumé exécutif

Le projet est une application ERP de pressing construite autour d’un socle offline-first : React/TypeScript, Dexie/IndexedDB, Supabase/PostgreSQL avec RLS et fonctions Edge de paiement CinetPay. Le périmètre comprend la gestion des commandes, l’atelier QR, la caisse, les clients, le stock, les dépenses, les rapports et les fonctions d’administration.

Le catalogue de prestations et les modèles commerciaux ont été retirés. Les lignes de commande sont saisies librement. La migration 020 supprime les tables et références spécifiques de ces fonctionnalités, tout en conservant les libellés, prix, quantités et snapshots génériques des commandes existantes.

### État des contrôles locaux

| Contrôle | Résultat dans cette révision |
|---|---|
| `npm run typecheck` | Réussi |
| `npm run lint` | Réussi |
| `npm test` | **625 tests réussis / 625**, 59 fichiers |
| `npm run build` | Réussi ; avertissement de chunk principal supérieur à 500 kB |
| `npm run sql:verify` en local | Non exécuté : `psql` n’est pas installé dans l’environnement |
| CI PostgreSQL 16 | Réussie sur la PR #7 : migrations et suite SQL ordonnée passées |
| Suite SQL ordonnée dans PGlite | Tous les scripts listés par `scripts/sql-verify.sh` passent ; extension `pgcrypto` omise car non disponible dans PGlite |
| Supabase/CinetPay réels | Non vérifiés dans cette session |

Le passage complet dans PGlite valide l’ordre des migrations et des tests jusqu’à 020. La CI de la PR #7 a également exécuté `scripts/sql-verify.sh` sur PostgreSQL 16 réel avec succès ; cela ne remplace pas une recette Supabase déployée. Pendant ces vérifications, le test `catalogue_commercial_models.sql` a été corrigé : il prétendait tester un article hors périmètre, mais réutilisait par erreur l’identifiant d’une chemise déjà incluse dans le forfait.

## Mise à jour du 26 octobre 2026 — CRUD complet (migration 025)

Les écritures manquantes des modules de gestion ont été ajoutées : fiches clients
(création, modification complète, suppression propriétaire), édition et archivage
des articles de stock, modification/désactivation des fournisseurs, correction des
dépenses, clôture/réouverture/suppression des réclamations, clôture et retrait des
demandes de support, suppression de commande encadrée, et gestion de l'équipe par
le propriétaire (rattachement par e-mail, rôle, nom, détachement).

La migration `025_crud_complet.sql` est **additive** : aucune table ni donnée
supprimée. Elle ajoute deux politiques sur `customers`, trois déclencheurs de
protection (fiches clients, stock et fournisseurs, suppression de commande) et six
fonctions `security definer` contrôlées par le rôle. Le détail de la matrice et les règles métier sont
dans [`CRUD-COMPLET.md`](CRUD-COMPLET.md).

Contrôles rejoués : typecheck, lint, build et suite Vitest (625 tests / 59
fichiers). La chaîne complète des migrations et des tests SQL, y compris
`supabase/tests/crud_complet.sql` (19 contrôles), a été exécutée avec succès sur
PostgreSQL via PGlite ; `psql` reste absent de l'environnement, la CI PostgreSQL 16
doit rejouer `npm run sql:verify`.

## Architecture

### Frontend et données locales

- Point d’entrée : `src/main.tsx` → `src/App.tsx` → `AuthGate` → `AppLayout`.
- React Router fournit les routes ; les pages sont chargées à la demande.
- Dexie/IndexedDB contient commandes, lignes, encaissements et éléments de synchronisation.
- Le moteur `src/sync/syncEngine.ts` transmet les données locales, remonte certains états distants et laisse l’arbitrage des conflits à un choix utilisateur.
- La PWA est configurée dans `vite.config.ts` avec service worker, manifeste et cache des ressources statiques.

### Serveur

- Supabase Auth identifie les comptes ; `tenant_users` associe les comptes à un ou plusieurs pressings.
- PostgreSQL et les politiques RLS encadrent les accès multi-tenant.
- Les paiements CinetPay sont initiés et confirmés par les Edge Functions `cinetpay-init` et `cinetpay-webhook`.
- Les opérations sensibles de caisse, d’abonnement et de supervision s’appuient sur des fonctions SQL et des règles serveur.

### Routes métier principales

Commandes (`/commandes`, `/commandes/nouvelle`, `/commandes/:orderId`), atelier (`/atelier`), caisse (`/caisse`), reçus et factures, clients, stock, dépenses, tableau de bord, rapports, abonnement, support, audit, paramètres et supervision.

## Modèle courant des commandes

Le formulaire crée une commande locale avec une ou plusieurs lignes saisies librement : libellé, quantité, prix unitaire, tissu et instructions éventuelles. Le total de ligne est calculé ; le total de commande est la somme des lignes. Les choix de règlement sont distincts de la création : « espèces maintenant » crée d’abord la commande, puis ouvre sa fiche avec le panneau espèces prêt à confirmer. Le Mobile Money se lance depuis une commande déjà créée.

La synchronisation envoie maintenant les lignes ordinaires par upsert sans colonne de catalogue, modèle commercial ou composition famille. Les snapshots génériques encore présents servent à préserver l’historique et les quantités sur les données existantes.

## Migration 020 — portée et précautions

Fichier : `supabase/migrations/020_suppression_tarification_et_laundry_models.sql`.

- Supprime catalogue, aliases, opérations de catalogue, modèles au kilo/forfait et compositions de forfaits famille.
- Retire les clés catalogue, les colonnes spécifiques aux modèles commerciaux et les snapshots d’opérations d’atelier.
- Conserve `order_items`, ses prix, libellés, quantités, unités et snapshots génériques.
- Remplace la fonction de journalisation des corrections de prix pour qu’elle ne consulte plus de colonnes supprimées.
- Le test `supabase/tests/suppression_tarification.sql` vérifie l’absence des tables/colonnes supprimées, la présence des commandes et de `order_balances`, et l’insertion d’une ligne libre.
- `scripts/sql-verify.sh` applique les tests historiques avant la migration 020, puis applique 020 et son test de régression. Les anciens tests catalogue sont donc conservés comme tests de transition pré-migration.

**Risque opérationnel :** les tables, tarifs, modèles et compositions sont supprimés définitivement. Sauvegarde et confirmation de la cible obligatoires avant application à une base existante.

## Écarts résiduels connus

1. Certains types et modules utilitaires locaux conservent encore des structures de catalogue ou de modèles pour compatibilité avec les données Dexie historiques et des tests antérieurs. Ils ne sont plus exposés par le parcours courant ni transmis au serveur.
2. Le bundle principal dépasse l’avertissement Vite de 500 kB minifiés. Une analyse ultérieure du découpage des dépendances peut réduire le chargement initial sur réseau mobile.
3. Le test de sélection « espèces » confirme l’ouverture du panneau d’encaissement après création ; il ne prend pas d’argent sans confirmation explicite sur la fiche.
4. Les tests locaux ne valident pas l’authentification sur un vrai projet Supabase, les paramètres RLS déployés, les Edge Functions en production, les paiements CinetPay réels ni le comportement sur tablette physique.
5. Les documents d’historique (`CHANGELOG.md`, anciens rapports de recette, `MAJ.md`) peuvent évoquer l’ancien catalogue comme fonctionnalité passée. Le README et le guide utilisateur doivent rester la référence pour le périmètre actuel.

## Vérifications à faire avant production

- Exécuter `npm run sql:verify` sur PostgreSQL 15+ (PostgreSQL 16 recommandé) et obtenir tous les contrôles verts.
- Sauvegarder la base Supabase cible et appliquer la migration 020 sur un environnement de préproduction avant production.
- Vérifier RLS sur plusieurs pressings et rôles, puis les scénarios de synchronisation après coupure réseau.
- Tester les Edge Functions, notifications et paiement/remboursement avec les comptes et identifiants CinetPay appropriés.
- Valider l’installation PWA, le scanner caméra, l’impression et l’usage hors ligne sur la tablette Android cible.
