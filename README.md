# Pressing Pro — gestion de pressing

Application web installable (PWA) pour gérer les commandes d’un pressing. Le projet cible en priorité les téléphones et tablettes Android, une interface française et les connexions intermittentes.

> **État de cette révision (26 octobre 2026).** Le catalogue tarifaire et les modèles commerciaux ont été retirés du produit. Les commandes utilisent désormais des lignes librement saisies (libellé, quantité, prix unitaire). La migration 020 supprime ces données de la base : elle est destructive et doit être précédée d’une sauvegarde lorsqu’elle est appliquée à un projet existant. Voir [`docs/AUDIT-COURANT.md`](docs/AUDIT-COURANT.md) pour les contrôles et limites connus.

## Fonctionnalités

- Création d’une commande en trois écrans : choix du service (pressing à la
  pièce ou blanchisserie au kilo), client et articles (grille tactile, panier,
  article libre, lot pesé), récapitulatif puis enregistrement. Voir
  [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) et
  [`docs/RAPPORT-PARCOURS-COMMANDE.md`](docs/RAPPORT-PARCOURS-COMMANDE.md).
- Commandes, lignes d’articles, statuts de traitement, échéance promise et attribution.
- QR code de commande, impression d’étiquette et scan à l’atelier.
- Mode hors ligne : stockage IndexedDB, création locale et synchronisation différée.
- Détection des conflits de synchronisation avec arbitrage explicite.
- Encaissements espèces, acomptes, clôture de caisse, remboursements et reçus/factures imprimables.
- Paiement Mobile Money via CinetPay et fonctions Supabase Edge.
- Clients, stock, dépenses, tableau de bord, rapports, audit et support.
- CRUD complet des modules de gestion : fiches clients créées/modifiées/supprimées,
  articles de stock archivés ou supprimés selon leur historique, fournisseurs,
  dépenses corrigées, réclamations clôturées, demandes de support retirées et
  gestion de l'équipe par le propriétaire ([`docs/CRUD-COMPLET.md`](docs/CRUD-COMPLET.md)).
- Authentification Supabase, rôles et isolation multi-tenant avec politiques RLS.
- PWA installable avec écran de repli hors ligne.

Les prix sont saisis sur les lignes de commande. Il n’existe plus de grille de prix ou de modèles au kilo/forfait dans l’interface actuelle.

## Stack

- React 19, TypeScript strict, Vite 8, Tailwind CSS 4
- React Router, Zustand, Zod
- Dexie / IndexedDB pour le mode local
- Supabase Auth, PostgreSQL/RLS et Edge Functions
- CinetPay pour les paiements Mobile Money
- Vitest, jsdom et tests SQL PostgreSQL

## Démarrage local

Prérequis : Node.js 22 recommandé et npm 10+.

```bash
npm ci
cp .env.example .env
# Renseigner la configuration Supabase dans .env
npm run dev
```

Le serveur Vite écoute sur `0.0.0.0:3000`. Pour un environnement réellement connecté, configurer au minimum `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`. Les scripts d’installation et de provisionnement demandent également les secrets indiqués dans `.env.example`.

> **Ne jamais mettre de secret dans une variable `VITE_*`** : ces variables sont intégrées au bundle navigateur. La clé `service_role`, les jetons Supabase et les secrets CinetPay doivent rester côté serveur ou dans les secrets de déploiement.

## Commandes utiles

| Commande | Usage |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run typecheck` | Vérification TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Suite Vitest |
| `npm run e2e:install` | Installer Chromium pour les scénarios navigateur (une fois) |
| `npm run e2e:demo` | Scénarios navigateur hors ligne (bureau + téléphone) |
| `npm run e2e:reel` | Scénarios navigateur contre un vrai projet (`E2E_BASE_URL`, `E2E_EMAIL`, `E2E_PASSWORD`) |
| `npm run typecheck:e2e` | Vérification TypeScript des scénarios |
| `npm run build` | Typecheck et build PWA |
| `npm run preview` | Prévisualisation du build |
| `npm run setup:check` | Vérifier la configuration `.env` |
| `npm run setup:dry` | Simuler les étapes de provisionnement |
| `npm run sql:verify` | Rejouer migrations et tests SQL sur PostgreSQL jetable (requiert `psql` 15+) |
| `npm run recette` | Vérifications de recette configurées |
| `npm run deploy:fonctions` | Déployer les Edge Functions |

## Données et sécurité

- Le client crée d’abord les commandes dans IndexedDB ; le moteur les pousse ensuite vers Supabase.
- Le `tenant_id` choisi dans l’interface ne constitue pas une frontière de sécurité. La RLS, les contrôles SQL et les fonctions serveur doivent rester la source d’autorisation.
- Les mises à jour de commande utilisent un contrôle de version pour éviter les écrasements silencieux entre appareils.
- Les montants et informations client sont protégés par les rôles définis dans l’application et les règles serveur.
- Les fonctions CinetPay doivent être configurées avec leurs secrets en environnement serveur. Le mode de simulation n’est pas une preuve de paiement réel.

## Déploiement et migration 020

Le déploiement nécessite un projet Supabase configuré et une URL HTTPS pour l’application. Les migrations sont dans `supabase/migrations/`; les fonctions sont dans `supabase/functions/`.

La migration `025_crud_complet.sql` est **additive** : elle ajoute les politiques,
déclencheurs et fonctions des écritures de gestion manquantes, sans supprimer de
données. Elle doit être appliquée avant de déployer le frontend correspondant.

La migration `020_suppression_tarification_et_laundry_models.sql` supprime les tables de catalogue, les modèles commerciaux, les compositions de forfaits et leurs références spécifiques sur les lignes. Les libellés, quantités, montants vendus et snapshots génériques des lignes sont conservés. **Faire une sauvegarde et vérifier le projet ciblé avant d’appliquer cette migration** : sa suppression de données commerciales est irréversible.

La recette locale et les tests automatisés ne remplacent pas un test de bout en bout sur le projet Supabase et le compte marchand CinetPay de production. La procédure est détaillée dans [`docs/DEPLOIEMENT-FONCTIONS.md`](docs/DEPLOIEMENT-FONCTIONS.md) et [`docs/RECETTE-SUPABASE.md`](docs/RECETTE-SUPABASE.md).

## Structure du dépôt

```text
src/
  components/     composants de l’application
  db/             Dexie, repositories et hooks
  lib/            règles, formatage, permissions et configuration
  pages/          écrans métier
  schemas/        validation Zod
  services/       accès métier et intégrations
  sync/           moteur de synchronisation offline-first
  test/           tests Vitest
supabase/
  functions/      fonctions Edge CinetPay
  migrations/     migrations SQL 001 à 025
  tests/          recettes et vérifications SQL
scripts/          installation, base, recette et déploiement
```
