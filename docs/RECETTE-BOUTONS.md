# Recette manuelle des actions — Pressing Pro

Checklist à exécuter sur l'environnement de recette (navigateur réel + projet
Supabase), pour les actions que les tests automatisés ne peuvent pas prouver.
Chaque ligne se coche **après vérification dans la source de persistance**, pas
seulement après l'apparition d'un message de succès.

Convention : `[ ]` à faire · `[x]` validé · `[!]` en échec (ouvrir un ticket avec
l'heure, le compte utilisé et le message affiché).

## 0. Avant de commencer

- [ ] `.env` renseigné (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
- [ ] `npm ci && npm run typecheck && npm run lint && npm test` verts
- [ ] Sauvegarde du projet Supabase (Database → Backups) avant toute écriture de masse
- [ ] Deux navigateurs ou deux profils prêts (test multi-appareils)

## 1. Authentification

- [ ] Connexion avec le compte propriétaire → arrive sur `/commandes` (et non `/bienvenue`)
- [ ] Mot de passe erroné → message clair, aucun compte créé
- [ ] Déconnexion → retour à l'écran de connexion, session vidée
- [ ] Rechargement de page → session conservée
- [ ] « Mot de passe oublié » → e-mail reçu (vérifier aussi le dossier spam)

## 2. Onboarding / prestations

- [ ] Créer un nouveau pressing de test → l'écran de configuration s'affiche
- [ ] « Terminer la configuration » désactivé tant qu'il manque une activité ou une prestation
- [ ] Après clic → navigation vers `/commandes` **et** `tenants.onboarding_completed_at` renseigné (vérifier en SQL)
- [ ] Rechargement → plus de retour forcé vers `/bienvenue`

## 3. Commandes

- [ ] Créer une commande en ligne → visible dans la liste **et** ligne dans `orders`
- [ ] Créer une commande hors ligne (couper le réseau) → visible localement, bandeau hors-ligne affiché
- [ ] Revenir en ligne → la commande remonte dans Supabase (aucun doublon après plusieurs tentatives)
- [ ] Modifier une ligne (quantité, prix) → total recalculé, `order_items` à jour
- [ ] Changer le statut → `order_status_history` contient une ligne
- [ ] Modifier la même commande sur un second appareil → bandeau de conflit explicite, arbitrage possible
- [ ] Imprimer l'étiquette QR → aperçu d'impression avec QR lisible
- [ ] Scanner l'étiquette à l'atelier → la commande s'ouvre (autoriser la caméra)

## 4. Caisse et paiements

- [ ] Encaisser un acompte → `payment_transactions` créé, solde réduit, reçu proposé
- [ ] Tenter un montant supérieur au solde → refus explicite
- [ ] Tenter un montant sous le minimum → refus explicite
- [ ] Rembourser (propriétaire) → `payment_refunds` créé, plafond respecté
- [ ] Clôturer la caisse → écart calculé, session verrouillée
- [ ] Double clic sur « Encaisser » → un seul enregistrement (bouton désactivé pendant l'envoi)
- [ ] Bouton « Payer par Mobile Money » **absent** de la fiche quand les clés CinetPay ne sont pas installées (aucun message de paiement simulé ne doit apparaître)
- [ ] Après installation des clés + `npm run deploy:fonctions` : le bouton réapparaît (recharger la page ou attendre l'expiration du cache de 10 min)
- [ ] Avec les clés installées : un clic ouvre bien le guichet CinetPay réel

## 5. Clients, stock, fournisseurs

- [ ] Créer un client → visible dans `customers`
- [ ] Re-créer avec le même téléphone → doublon refusé, message clair
- [ ] Supprimer un client sans historique → disparaît
- [ ] Supprimer un client avec commandes → refus explicite
- [ ] Ajouter un article de stock → `stock_items` créé
- [ ] Enregistrer une entrée/sortie → `stock_movements` créé, quantité cohérente
- [ ] Supprimer un article déjà mouvementé → archivage, pas de suppression
- [ ] Désactiver un fournisseur → `is_active = false`, historique conservé

## 6. Dépenses et rapports

- [ ] Ajouter une dépense → visible dans `expenses` **et** dans les totaux du tableau de bord
- [ ] Corriger une dépense → montant et catégorie à jour
- [ ] Supprimer une dépense → disparaît des agrégats après rechargement
- [ ] Changer la période du rapport → totaux recalculés
- [ ] Exporter le CSV → fichier téléchargé avec le bon nombre de lignes

## 7. Réclamations, support, équipe

- [ ] Ouvrir une réclamation sur une commande → `order_issues` créé, auteur renseigné
- [ ] Clôturer avec un motif → `resolution`, `resolution_note`, `resolved_at` renseignés
- [ ] Envoyer une demande de support → `support_requests` créée
- [ ] Clôturer / retirer une demande → statut mis à jour, réservé au propriétaire
- [ ] Rattacher un membre par e-mail → ligne dans `tenant_users`, rôle correct
- [ ] Changer le rôle d'un membre → effet immédiat sur ses accès
- [ ] Retirer un membre → accès révoqué, historique conservé

## 8. Supervision et abonnement

- [ ] Compte non-admin : `/supervision` inaccessible
- [ ] Compte admin : liste des boutiques, changement d'abonnement effectif
- [ ] Répondre à une demande de support depuis la supervision → réponse visible côté pressing
- [ ] État d'abonnement suspendu → bandeau affiché, écritures bloquées par le serveur

## 9. Isolation multi-tenant (sécurité)

- [ ] Avec le compte du pressing A, forcer `x-tenant-id` vers B (outil de développement) → aucune donnée de B ne remonte
- [ ] Modifier une commande de A avec un identifiant de B → refus
- [ ] Vérifier qu'aucune clé `service_role` n'apparaît dans le bundle (`grep -r "service_role" dist/`)

## 10. PWA, mobile, impression

- [ ] Installation de la PWA sur Android → icône et nom corrects
- [ ] Mode avion → l'application s'ouvre, les commandes locales restent lisibles
- [ ] Reprise du réseau → synchronisation automatique, bandeau mis à jour
- [ ] Impression d'un reçu → mise en page correcte (pas de QR coupé)
- [ ] Bouton retour Android → navigation cohérente, pas de sortie inattendue

## 11. Clôture de recette

- [ ] Consigner les échecs dans `docs/AUDIT-BOUTONS.md` (statut `BUG CONFIRMÉ`)
- [ ] Fournir l'heure, le compte, l'écran, l'action, le message et la requête SQL de vérification
- [ ] Ne pas corriger « à chaud » en production : ouvrir une branche dédiée
