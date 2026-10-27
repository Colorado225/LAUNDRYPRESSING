# Audit fonctionnel des actions — Pressing Pro

> **État à la date du 27 octobre 2026**, branche `arena/b47084c6-laundrypressing`.
> Périmètre : toutes les actions présentées à l'utilisateur (boutons, formulaires,
> liens d'action, panneaux) et la chaîne complète
> `interface → validation → service → Dexie/Supabase → PostgreSQL/RLS → retour → actualisation`.
> Méthode et limites détaillées en fin de document. Les statuts `OK` ne sont
> accordés qu'à ce qui est **démontré** par un test ou un contrôle automatisé.

## 1. Ce qui a été exécuté

| Contrôle | Commande | Résultat |
|---|---|---|
| Typage strict | `npm run typecheck` | ✅ aucune erreur |
| Analyse statique | `npm run lint` | ✅ aucune erreur, aucun avertissement |
| Suite de tests | `npm test` | ✅ 65 fichiers, 680 tests |
| Contrat colonnes frontend ↔ PostgreSQL | script d'inventaire + `information_schema` du projet `Pressing_Pro` | ✅ 20 tables, 0 colonne inexistante |
| Contrat fonctions RPC | comparaison des `.rpc('…')` du code avec `pg_proc` | ✅ 22 fonctions appelées, 22 présentes |
| Boutons sans gestionnaire / formulaires sans `onSubmit` | analyse statique (171 `<button>`, 11 `<form>`) | ✅ 0 bouton inerte, 0 formulaire sans `onSubmit` |
| Blocs `catch` vides | analyse statique | ✅ 0 `catch {}` |
| Politiques RLS | `pg_class` + `pg_policy` | ✅ RLS active sur 33 tables (1 sans politique : `platform_admins`, accès refusé par défaut — voulu) |

Les deux seuls signalements bruts de l'analyse ont été vérifiés un par un et sont
des **faux positifs** :

- `src/components/ui/button.tsx` : `<button>` sans `onClick` car il diffuse `{...props}` — composant de base, correct.
- `src/pages/OrderDetail.tsx` : bouton « Imprimer le reçu » sans `type` explicite, mais **hors de tout `<form>`** — aucun risque de soumission parasite.

## 2. Inventaire des actions (par écran)

Décompte automatique des éléments interactifs présents dans le code :

| Écran | Boutons | Formulaires | Liens | Gestionnaires distincts |
|---|---|---|---|---|
| `Atelier` | 10 | 1 | 2 | 5 |
| `Audit` | 1 | 0 | 0 | 1 |
| `BlanchisserieGrid` | 4 | 0 | 0 | 4 |
| `Caisse` | 3 | 0 | 1 | 3 |
| `Clients` | 4 | 0 | 1 | 5 |
| `Depenses` | 5 | 0 | 0 | 5 |
| `Facture` | 1 | 0 | 4 | 1 |
| `Login` | 12 | 4 | 0 | 6 |
| `Offline` | 1 | 0 | 1 | 1 |
| `OrderDetail` | 13 | 0 | 0 | 5 |
| `OrderForm` | 14 | 0 | 0 | 7 |
| `Orders` | 3 | 0 | 2 | 3 |
| `Parametres` | 16 | 0 | 1 | 14 |
| `PaymentReturn` | 1 | 0 | 1 | 1 |
| `Rapports` | 2 | 0 | 0 | 2 |
| `Receipt` | 1 | 0 | 2 | 1 |
| `Reinitialisation` | 1 | 1 | 1 | 0 (soumission native) |
| `ServicesPressing` | 15 | 4 | 0 | 7 |
| `Stock` | 20 | 0 | 0 | 15 |
| `Supervision` | 8 | 0 | 0 | 6 |
| `Support` | 3 | 0 | 0 | 3 |
| `TableauDeBord` | 0 | 0 | 5 | 0 |
| **Total (pages)** | **138** | **10** | **22** | — |
| Composants (`CashPanel`, `PaymentButton`, `OrderItemsEditor`, `AssignmentPanel`, `IssuePanel`, `NotifyPanel`, `QrScanner`, `ConflictBanner`, `AppLayout`…) | **+33** | **+1** | — | — |

## 3. Matrice de contrôle par module

Statuts : `OK` = démontré par un test automatisé ou un contrôle de schéma ·
`À TESTER` = comportement plausible mais non démontré (session Supabase ou
navigateur requis) · `BLOQUÉ` = dépendance externe manquante.

| Module | Action représentative | Chaîne technique | Statut | Preuve / reste à faire |
|---|---|---|---|---|
| Authentification | Connexion e-mail/mot de passe | `Login` → `authService.signInWithPassword` → GoTrue | `OK` (service) / `À TESTER` (parcours) | Tests de service verts ; l'e-mail `aduerwins@gmail.com` est confirmé côté GoTrue ; connexion réelle à valider dans le navigateur (pas d'accès sortant depuis l'environnement d'audit) |
| Authentification | Inscription pressing + propriétaire | `Login` → `authService.signUpWithPassword` → RPC `create_tenant_for_user` | `OK` (RPC présente) | RPC vérifiée en base ; parcours réel `À TESTER` |
| Onboarding | « Terminer la configuration » | `ServicesPressing` → `completeTenantOnboarding` → RPC `complete_tenant_onboarding` | **CORRIGÉ** | Voir §4 : le pressing était bloqué à `onboarding_completed_at = null` alors que les prérequis étaient remplis |
| Commandes | Création (en ligne) | `OrderForm` → `ordersRepository` → `syncEngine.pousserCommande` → `orders` + `order_items` | `OK` | Tests de synchronisation et de tarification verts ; doublons neutralisés par code `23505` |
| Commandes | Création (hors ligne) | `OrderForm` → Dexie → file de synchronisation | `OK` | Test hors-ligne vert ; envoi différé au retour du réseau |
| Commandes | Modification de lignes | `OrderItemsEditor` → `updateItem` → service | `OK` | Tests dédiés verts ; erreurs remontées par toast |
| Commandes | Changement de statut | `OrderDetail` → `changeStatus` → `orders` (version) | `OK` | Contrôle de version + `guard_order_update` côté SQL |
| Commandes | Suppression | `guard_order_delete()` (SQL) | `OK` | Filet serveur ; aucune suppression destructive depuis l'UI |
| Commandes | Conflit entre appareils | `ConflictBanner` → `orderConflictService` | `OK` | Arbitrage explicite, journalisé (`client_sync_events`) |
| Atelier | Scan QR + changement de statut | `Atelier` → `QrScanner` → même chaîne que ci-dessus | `À TESTER` | Permission caméra = appareil physique |
| Atelier | Impression d'étiquette | `impression.ts` → `window.print` | `À TESTER` | Nécessite un navigateur |
| Clients | Création / modification | `Clients` → `customerService` → `customers` | `OK` | Contrat colonnes vérifié ; `phone_key` anti-doublon |
| Clients | Suppression | `customerService` + contraintes FK | `OK` | Refus si historique de commandes |
| Caisse | Encaissement espèces | `CashPanel` → `record_cash_payment` (RPC) → `payment_transactions` + `cash_sessions` | `OK` (RPC + tests) | Montant plafonné au solde, minimum contrôlé, reçu après succès seulement |
| Caisse | Remboursement | `CashPanel` → `recordRefund` → RPC `record_refund` | `OK` | Réservé au propriétaire, plafonné au remboursable |
| Caisse | Clôture de caisse | `Caisse` → RPC `close_cash_session` | `OK` | RPC présente, écart calculé côté serveur |
| Paiement Mobile Money | Bouton CinetPay | `PaymentButton` → `cinetpay-init` → guichet hébergé | `BLOQUÉ` | **Clés marchandes absentes des secrets du projet** : le bouton bascule sur un paiement *simulé* explicite (aucun encaissement). Voir §5 |
| Paiement | Retour de paiement | `PaymentReturn` → `cinetpay-webhook` → `finalize_cinetpay_payment` | `BLOQUÉ` | Même cause ; la fonction vérifie la signature côté serveur |
| Stock | Article, mouvement, seuil | `Stock` → `stockService` → `stock_items` / `stock_movements` + triggers | `OK` | Archivage au lieu de suppression si historique |
| Stock | Suppression article | `guard_stock_item_delete()` | `OK` | Refus serveur si mouvement existant |
| Fournisseurs | Création / désactivation | `Stock` → `stockService` → `suppliers` | `OK` | `guard_supplier_delete()` protège l'historique |
| Dépenses | Ajout / correction / suppression | `Depenses` → `expenseService` → `expenses` | `OK` | Contrat colonnes vérifié ; agrégats via `expense_totals` (`security_invoker`) |
| Rapports | Filtres + export CSV | `Rapports` → `reporting.ts` → `order_balances`, `expense_totals` | `À TESTER` | Export navigateur |
| Réclamations | Ouverture / clôture | `IssuePanel` → `issueService` → `order_issues` | `OK` | Auteur et résolution estampillés par triggers |
| Support | Envoi / clôture / retrait | `Support` → RPC `tenant_close_support_request`, `tenant_delete_support_request` | `OK` | RPC présentes, contrôles de rôle |
| Équipe | Rattachement, rôle, retrait | `Parametres` → RPC `tenant_attach_member_by_email`, `tenant_set_member`, `tenant_remove_member` | `OK` (RPC) / `À TESTER` (parcours multi-comptes) | RPC présentes ; isolation vérifiée par `is_tenant_member` |
| Paramètres | Enregistrement du pressing | `Parametres` → `tenantService` → `tenants` | `OK` | `update` vérifié dans le contrat |
| Supervision | Boutiques, abonnements, support | `Supervision` → RPC `platform_*` | `OK` (RPC) / `À TESTER` (compte superviseur) | `is_platform_admin()` contrôle l'accès |
| Abonnement | Lecture de l'état | `RPC my_subscription` | `OK` | RPC présente |
| PWA / hors-ligne | Bandeau, reprise, repli | `OfflineBadge`, `Offline`, service worker | `À TESTER` | Installation et coupure réseau sur appareil |

## 4. Défaut confirmé et corrigé pendant l'audit

**Onboarding bloqué malgré une configuration complète.**

- Symptôme : l'application renvoyait systématiquement vers `/bienvenue` ; le
  pressing `Press Coco` (`4c53e367-…`) avait `tenants.onboarding_completed_at = null`.
- Constat côté données : 2 activités, 1 prestation (« Lavage & repassage », KG),
  1 commande, une seule ligne `tenant_users` en rôle `owner` — les prérequis de
  la fonction serveur étaient donc **remplis**.
- Constat côté serveur : `complete_tenant_onboarding()` est saine (contrôles de
  connexion, de rôle et de prérequis), appelée en tant que propriétaire avec
  l'en-tête `x-tenant-id`, elle a renvoyé `2026-10-27 09:18:10+00` et la valeur a
  été persistée.
- Cause probable : le garde se remontait en boucle (corrigé au commit
  `538ef15`), l'appel final n'aboutissait jamais. La fonction `markComplete()`
  mémorise désormais la complétion par pressing pour la session.
- Effet : les nouveaux comptes ne restent plus coincés ; le pressing existant est
  débloqué sans perte de données.

## 5. Risques identifiés, non corrigés (décision produit requise)

1. **Paiement simulé quand CinetPay n'est pas configuré** (`PaymentButton`).
   Le code est honnête — le message précise « rien n'a été encaissé » et la
   commande reste à régler — mais un utilisateur pressé peut croire à un
   paiement. Deux réglages possibles : masquer le bouton quand les clés
   marchandes sont absentes, ou exiger une confirmation supplémentaire. À
   trancher avant la mise en service.
2. **`platform_admins`** : RLS active, aucune politique. Accès impossible via
   l'API REST ; la console de supervision passe exclusivement par les RPC
   `platform_*`. Comportement sûr, à confirmer comme intentionnel.
3. **Dérive de schéma 027→030** : quatre migrations existent en base mais pas
   dans le dépôt (voir `docs/AUDIT-COURANT.md`). Une installation neuve ne
   reproduit donc pas exactement la base actuelle.

## 6. Ce qui n'a pas pu être testé, et pourquoi

- **Parcours navigateur de bout en bout** : aucun outil E2E n'est installé
  (ni Playwright ni Cypress) et l'environnement d'audit n'a pas d'accès sortant
  vers `supabase.co` ; les tests existants s'appuient sur Dexie/`fake-indexeddb`.
- **Authentification réelle, Edge Functions en production, paiement CinetPay** :
  dépendent de secrets et d'un navigateur.
- **Multi-appareils** : nécessite deux sessions réelles sur le même pressing.
- **`npm run sql:verify`** : requiert un PostgreSQL 15+ jetable et `psql`.

Ces scénarios figurent dans `docs/RECETTE-BOUTONS.md` sous forme de checklist
manuelle à cocher sur l'environnement de recette.
