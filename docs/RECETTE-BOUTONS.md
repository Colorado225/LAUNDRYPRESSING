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

### Parcours de création en trois écrans

- [ ] **Écran 1** : les deux cartes (Pressing, Blanchisserie) sont cliquables à la souris **et** activables au clavier (Tab puis Entrée)
- [ ] Pressing → grille des vêtements à la pièce ; Blanchisserie → grille du linge et lot au kilo déjà présent (poids + tarif/kg saisissables)
- [ ] Ajouter un article, puis une seconde fois → une seule ligne, quantité 2 ; corriger la quantité au panier → total recalculé
- [ ] Supprimer une ligne, puis **Vider** → panier vide, total à 0 FCFA
- [ ] **Article libre** (libellé hors grille) → ligne ajoutée, prix saisissable
- [ ] **Rechercher un client déjà venu** → suggestion, clic qui remplit nom et téléphone
- [ ] Prix à 0 FCFA → refus explicite, aucune commande créée (le message parle de « prix unitaire » à la pièce et de « tarif au kilo » pour un lot)
- [ ] Enregistrer sans nom de client → retour sur l'écran des articles, motif affiché, liste des commandes inchangée
- [ ] **Récapitulatif** : les lignes et le total correspondent exactement au panier
- [ ] **F5 en pleine saisie** → le navigateur demande confirmation ; après enregistrement, il ne demande plus rien
- [ ] **← Retour aux commandes** avec des données saisies → confirmation ; sur un formulaire vierge → sortie immédiate
- [ ] Compte sans droit de création → le bouton d'enregistrement explique le refus au lieu de rester inerte, et rien n'est écrit
- [ ] Double clic rapide sur **Enregistrer la commande** → une seule commande dans la liste

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

## 10 bis. Scénarios navigateur automatisés (Playwright)

Ces scénarios ne remplacent pas la checklist ci-dessus : ils la **précèdent**.
Ils tournent à chaque poussée (job `bout_en_bout` de la CI) et sur le poste.

```bash
npm run e2e:install     # une seule fois : Chromium + dépendances système
npm run e2e:demo        # projets « demo » + « demo-mobile », sans backend ni secret
npm run typecheck:e2e   # types des scénarios eux-mêmes
```

Contre un vrai projet : renseigner `E2E_BASE_URL`, `E2E_EMAIL`, `E2E_PASSWORD`
puis `npm run e2e:reel`. **Sans ces trois variables, les scénarios sont
ignorés** — un scénario qui ne peut pas tourner doit être visiblement sauté.

### Ce que les scénarios couvrent déjà (mode démonstration)

- [x] Connexion par l'écran « Choisir le pressing » → `/commandes`
- [x] Création d'une commande en trois étapes, deux lignes, total calculé
- [x] Refus d'une commande sans nom de client, sans quitter le formulaire
- [x] Deux commandes distinctes, chacune avec ses propres lignes
- [x] Recherche dans la liste, y compris une recherche sans résultat
- [x] Persistance vérifiée **après rechargement complet** (donc IndexedDB)
- [x] Encaissement d'un acompte → reçu → reste à payer → rechargement
- [x] Règlement immédiat (`?regler=1`) : panneau espèces déjà déplié
- [x] Bouton d'encaissement retiré quand la commande est soldée
- [x] Page de caisse : l'encaissement du jour apparaît
- [x] Aucune mention ni bouton de paiement Mobile Money sans projet configuré
- [x] Les mêmes parcours sur un format téléphone (Pixel 7)

### Ce qui reste à faire à la main

- [ ] **Profil « animations activées »** : les scénarios tournent en
  `reducedMotion: 'reduce'` (voir `playwright.config.ts`). Dans un Chromium
  sans GPU, le clic souris est perdu quand la carte **et** le bouton se
  soulèvent en même temps. À rejouer une fois sur un Chrome avec GPU pour
  savoir s'il s'agit d'un défaut réel ou d'une limite de l'environnement.
- [ ] Authentification réelle (e-mail + mot de passe) et confirmation d'e-mail
- [ ] Synchronisation serveur, conflits, RLS : projet `reel`
- [ ] Second appareil sur le même pressing : projet `reel`
- [ ] Coupe réseau physique, mode avion, installation PWA
- [ ] Paiement CinetPay réel (guichet → webhook → statut)

## 11. Clôture de recette

- [ ] Consigner les échecs dans `docs/AUDIT-BOUTONS.md` (statut `BUG CONFIRMÉ`)
- [ ] Fournir l'heure, le compte, l'écran, l'action, le message et la requête SQL de vérification
- [ ] Ne pas corriger « à chaud » en production : ouvrir une branche dédiée
