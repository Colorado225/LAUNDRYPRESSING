# Analyse du projet Pressing Pro et workflow métier

**Date :** 26 octobre 2026  
**Branche examinée :** `arena/e64723d6-laundrypressing`  
**Révision locale :** `8daf93a`  
**Méthode :** lecture des routes, services, hooks Dexie, synchronisation, migrations, fonctions Edge, tests et documentation ; vérifications Supabase limitées à des métadonnées non sensibles (état des services, historique des migrations, schéma, politiques et noms des secrets). Aucune donnée client n’a été consultée et aucune configuration/base Supabase n’a été modifiée.

## 1. Synthèse

Pressing Pro est une application web installable (PWA) pour téléphone/tablette, orientée comptoir et atelier. Son architecture est **local-first** : React/TypeScript présente l’interface, Dexie/IndexedDB porte les commandes utilisables hors ligne, Supabase Auth/PostgreSQL fournit l’identité et la source distante, et des Edge Functions encadrent CinetPay.

Le périmètre applicatif actuel est centré sur les commandes à lignes libres, l’avancement atelier, la caisse, les clients, le stock, les dépenses, les rapports et l’administration. Le catalogue de prix et les modèles commerciaux ne font plus partie du parcours courant. La migration 020 les retire du schéma Supabase, tout en conservant les données génériques des lignes de commande.

**Connexion Supabase : oui, elle est possible et le connecteur Supabase est relié à un projet actif.** Le projet `Pressing_Pro` est sain pour Auth, Postgres, REST et Storage, en région `eu-west-1`, sur PostgreSQL 17. Les migrations enregistrées vont jusqu’à 019. La migration 020 n’est pas déployée sur ce projet ; ses anciennes tables et colonnes de catalogue/modèles sont encore présentes. L’application de 020 supprimerait définitivement ces objets et leurs données : elle ne doit pas être faite sans sauvegarde, environnement de préproduction et validation explicite.

La CI de la PR #7 a réussi ses deux jobs : application et suite SQL sur PostgreSQL 16. Les contrôles locaux précédents donnent 578 tests réussis sur 55 fichiers, typecheck, lint et build réussis. Le build signale encore un chunk JavaScript principal supérieur à 500 kB.

## 2. Architecture et modules

| Couche | Responsabilité principale |
|---|---|
| `src/App.tsx` / React Router | Démarrage de la synchronisation, porte d’authentification, routes métier et chargement différé des pages. |
| `src/components/AuthGate.tsx`, `src/services/authService.ts` | Restauration de session, connexion/inscription, rattachement au pressing, accès de supervision, mode local hors ligne. |
| `src/lib/tenantContext.ts`, `ShopSwitcher` | Rôle et pressing actif côté interface ; le serveur doit toujours rester l’autorité d’accès. |
| `src/db/localDb.ts`, `src/db/ordersRepository.ts`, `src/db/hooks.ts` | Schéma IndexedDB, écritures locales transactionnelles et lectures réactives. Des champs Dexie historiques sont conservés pour compatibilité. |
| `src/sync/syncEngine.ts` | Envoi idempotent des commandes, lignes, encaissements, réclamations et notifications ; récupération périodique d’états distants ; arbitrage des conflits. |
| `src/pages/Orders.tsx`, `OrderForm.tsx`, `OrderDetail.tsx` | Liste, création libre et fiche de commande. |
| `src/pages/Atelier.tsx`, `src/components/QrScanner.tsx` | Recherche par QR/code, statut de production et commandes en cours. |
| `src/components/CashPanel.tsx`, `src/pages/Caisse.tsx` | Encaissement local, solde, clôture et historique de caisse. |
| `src/services/paymentService.ts`, `src/components/PaymentButton.tsx` | Initiation Mobile Money en ligne et lecture de l’état distant. |
| `supabase/functions/cinetpay-init`, `cinetpay-webhook` | Création du guichet, contrôle des droits et du solde, vérification du paiement et finalisation côté serveur. |
| Pages de gestion | Clients, stock/fournisseurs, dépenses, tableau de bord, rapports, abonnement, support, audit, paramètres et supervision. |
| PostgreSQL / RLS | Multi-tenant, contraintes et règles serveur ; les tables principales vérifiées (`orders`, `order_items`, `tenant_users`, `payment_transactions`, etc.) ont RLS activée. |

La navigation distingue les rôles `owner`, `receptionist` et `artisan`. Les contrôles visuels sont centralisés dans `src/lib/permissions.ts`, mais la protection réelle doit rester dans les politiques RLS et les fonctions SQL/Edge.

## 3. Workflow fonctionnel de l’application

### A. Démarrage, connexion et contexte

1. L’application vérifie les variables `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`.
2. Avec Supabase configuré, `AuthGate` restaure la session et retrouve l’appartenance dans `tenant_users`. Le compte plateforme est vérifié par un RPC dédié.
3. En absence de réseau, une session déjà persistée et le contexte local permettent de consulter les données présentes sur l’appareil. Une nouvelle authentification nécessite internet.
4. Sans configuration Supabase, l’application propose le mode démonstration local ; celui-ci ne constitue pas une connexion au projet distant.
5. Le pressing actif et le rôle déterminent la navigation. Les données locales restent filtrées par pressing dans la majorité des hooks et requêtes.

### B. Inscription et mise en place du pressing

1. Le propriétaire saisit le nom du pressing, son téléphone, son e-mail et son mot de passe.
2. Supabase crée le compte. Si la confirmation d’adresse est requise, le parcours s’arrête jusqu’à la confirmation.
3. À la première connexion confirmée, l’application appelle `create_tenant_for_user` pour créer le pressing et rattacher le compte comme propriétaire.
4. Les autres membres sont rattachés au pressing par le processus d’équipe ; leurs droits dépendent de leur rôle.

Le projet relié exige actuellement une confirmation e-mail (`mailer_autoconfirm = false`). Il faut donc vérifier la délivrabilité de l’e-mail et l’URL de retour avant de tester l’inscription.

### C. Création d’une commande

1. Le comptoir ouvre **Nouvelle commande** et saisit les coordonnées du client et l’échéance éventuelle.
2. Il ajoute une ou plusieurs lignes libres : libellé, quantité, prix unitaire, tissu et instructions ; le montant total est calculé.
3. `createOrderLocal` valide le tout avec Zod et écrit la commande et ses lignes dans une transaction Dexie. La commande reçoit un identifiant/QR et le total, avec état initial `received` et synchronisation en attente.
4. Le choix « espèces maintenant » n’encaisse pas à lui seul : il ouvre la fiche avec `?regler=1`, où le comptoir confirme le montant.
5. L’option Mobile Money se fait depuis la fiche existante.

### D. Atelier et livraison

Parcours normal : **Reçue → En tri → En lavage → En séchage → En repassage → Contrôle qualité → Prête → Livrée**. Une commande peut aussi être annulée selon le rôle. L’atelier retrouve une commande par scan QR ou saisie du code ; le changement de statut est d’abord écrit localement puis envoyé. L’écran indique le retard, l’état de synchronisation et les conflits.

### E. Encaissements

- **Espèces :** le montant est enregistré localement, avec identifiant idempotent, et transmis ensuite par RPC. Le solde tient compte des paiements espèces et des paiements Mobile Money confirmés.
- **Mobile Money :** nécessite réseau et configuration serveur. `cinetpay-init` retrouve la commande, le pressing, le rôle et le montant restant dans PostgreSQL ; il ne doit pas croire le montant fourni par le navigateur. Le client est redirigé vers CinetPay.
- **Confirmation :** le retour navigateur ne valide pas un paiement. Le webhook vérifie la signature et reconfirme l’état auprès de CinetPay, puis finalise la transaction et la commande côté PostgreSQL.
- **Caisse :** la clôture appelle une RPC serveur qui recalcule le total attendu.

### F. Synchronisation hors ligne

Le moteur tente une synchronisation au démarrage, au retour du réseau, au retour au premier plan et toutes les 60 secondes. Les commandes sont envoyées par pressing ; une modification serveur concurrente déclenche un conflit de version plutôt qu’un écrasement silencieux. Les encaissements sont transmis après les commandes auxquelles ils se rapportent. L’état du paiement distant et des commandes est relu périodiquement ; l’application n’emploie pas actuellement d’abonnement Supabase Realtime.

### G. Gestion et pilotage

- Clients : liste/historique dérivés des commandes locales ; fiche enrichie en ligne.
- Stock et fournisseurs : mouvements et quantités pilotés par le serveur.
- Dépenses : saisie et agrégation serveur, fonctions réservées au propriétaire.
- Tableau de bord et rapports : agrégats locaux avec certains compléments serveur, export CSV.
- Paramètres : équipe, informations du pressing, session, diagnostic/sauvegarde/purge des données synchronisées.
- Audit, abonnement, support et supervision : fonctions de gestion et d’administration.

## 4. Connexion Supabase : état constaté et prochaines étapes

### État constaté (lecture seule)

- Connecteur Supabase activé ; projet `Pressing_Pro` listé comme `ACTIVE_HEALTHY`.
- Auth, DB, REST et Storage sont signalés sains. Le service Realtime est signalé sain mais sa métadonnée indique `db_connected = false` ; aucun abonnement Realtime n’est actuellement utilisé par le code.
- Historique distant : migrations `001` à `019` ; les colonnes `catalog_entry_id`, `laundry_model_id` et `service_operations_snapshot` existent encore sur `order_items`.
- RLS est activée sur les tables métier principales vérifiées.
- Les fonctions Edge `cinetpay-init` et `cinetpay-webhook` sont actives ; la première exige un JWT et le webhook est configuré sans vérification JWT, comme requis par l’appel fournisseur.
- La liste des secrets contient les secrets Supabase et les réglages `APP_URL`, `APP_ENV`, `CINETPAY_MODE`, `CINETPAY_NOTIFY_URL`, mais pas les secrets marchands `CINETPAY_API_KEY`, `CINETPAY_SITE_ID` et `CINETPAY_SECRET_KEY`. Les paiements réels ne sont donc pas prêts à être validés avec les éléments actuellement configurés. Aucune valeur secrète n’est reproduite dans ce rapport ni utilisée pour configurer l’application.
- Aucun fichier `.env` local n’est présent dans le checkout. Le navigateur local n’est donc pas configuré pour ce projet.
- Auth est configuré avec `site_url = http://localhost:5173` et une liste de redirections associée. Le dépôt Vite lance son serveur sur le port **3000**. Le flux de réinitialisation utilise l’origine du navigateur ; il faut aligner l’URL autorisée avec le port/domaines réellement utilisés.

### Pour brancher le navigateur local sans exposer de secrets

1. Créer `.env` depuis `.env.example`.
2. Y configurer uniquement `VITE_SUPABASE_URL` et la clé navigateur **anon/publishable** issue des réglages du projet.
3. Ne jamais placer `service_role`, le mot de passe de base ou les secrets CinetPay dans une variable `VITE_*`.
4. Ajouter au tableau de bord Supabase les URL de confirmation/récupération nécessaires pour `http://localhost:3000` et le domaine de préproduction/production.
5. Vérifier un compte de test confirmé, son rattachement au pressing et les droits RLS avant d’utiliser des données métier.
6. Configurer les secrets CinetPay côté Edge Functions depuis un canal secret dédié, puis tester en mode marchand de test.
7. Pour appliquer 020, sauvegarder le projet, faire une répétition sur une branche/base de préproduction et valider la réconciliation des migrations. Le projet connecté n’a pas encore 020.

**Aucune migration, création de compte, modification d’Auth, de secret ou de donnée métier n’a été faite pendant cette analyse.**

## 5. Améliorations recommandées par priorité

### P0 — avant toute migration en production

1. **Traiter 020 comme irréversible.** Faire une sauvegarde vérifiée, mesurer les tables/données de catalogue existantes, rejouer 020 et les tests sur préproduction, vérifier reçus/commandes après migration, puis seulement planifier une fenêtre de production. La CI PostgreSQL 16 valide le script mais ne remplace pas une recette sur le projet cible.
2. **Ne pas confondre CI et déploiement.** La PR #7 est ouverte et ses contrôles passent ; la migration 020 n’est pas pour autant appliquée au projet Supabase connecté.

### P1 — isolation, synchronisation et disponibilité commerciale

1. **Filtrer les agrégats locaux par tenant.** `useAllCashPayments()` et `useAllLocalItems()` lisent actuellement toutes les lignes locales sans tenant. Les montants `cashToday`, `cashWeek`, les séries et les encaissements des rapports consomment cette liste globale : avec plusieurs pressings sur le même appareil/profil navigateur, les chiffres d’espèces peuvent inclure ceux d’un autre tenant. Passer `tenantId` aux hooks et filtrer avant agrégation ; ajouter des tests de non-mélange entre deux tenants.
2. **Rendre le curseur de synchronisation propre à chaque pressing.** `PULL_CURSOR_KEY` est global (`pressing.derniereLecture`), alors que la requête distante est filtrée par `tenant_id`. Lors d’un changement de pressing, un curseur récent d’un tenant peut empêcher de rapatrier des modifications plus anciennes d’un autre. Stocker un curseur par tenant, ou réinitialiser le curseur au changement de tenant, et tester le scénario de va-et-vient.
3. **Bloquer/attendre l’envoi serveur avant Mobile Money.** Le bouton peut initier CinetPay sur une commande encore locale ; l’Edge Function cherche la commande dans `orders` et répondra « introuvable » si la synchronisation n’a pas encore poussé cette commande. Griser le paiement tant que `order.synced !== 1`, afficher « Synchronisation requise », puis relancer l’initiation après confirmation serveur.
4. **Aligner les redirections Supabase.** Configurer les URL correspondant au port local 3000 et aux domaines réels. Vérifier le retour d’inscription et la réinitialisation avant d’ouvrir l’inscription en production.
5. **Installer les secrets marchands CinetPay manquants.** Sans clé API/site/secret côté Edge Functions, le flux réel renverra une erreur de configuration. Tester signature, montant, doublon de webhook et remboursement avant activation commerciale.
6. **Protéger les appareils partagés.** Les données hors ligne restent volontairement dans IndexedDB après déconnexion afin de ne pas perdre une file non synchronisée. Ajouter verrouillage par PIN/temporisation et tests de séparation de session/tenant plutôt que supprimer aveuglément les données en attente.

### P2 — amélioration produit et exploitation

1. **Clarifier le niveau de fraîcheur des données.** L’application utilise une lecture périodique jusqu’à 60 secondes et non Realtime. Soit documenter ce délai, soit activer des canaux Realtime ciblés après étude de la publication/RLS et des reconnexions mobiles.
2. **Améliorer la tolérance hors ligne des fonctions de gestion.** Le stock, les dépenses et plusieurs fiches de gestion dépendent du serveur. Une file locale idempotente pourrait être conçue pour certaines mutations, avec statut en attente, reprise et rapprochement ; commencer par les mouvements de stock seulement après définition de règles anti-doublon.
3. **Réduire le bundle initial.** Le chunk principal fait environ 593 kB minifiés et l’atelier QR environ 389 kB. Mesurer sur réseau mobile, extraire les dépendances lourdes et différer réellement le scanner/graphes si nécessaire.
4. **Ajouter des tests d’intégration navigateur multi-appareils.** Les tests Vitest/jsdom et CI SQL couvrent bien les unités et le PostgreSQL, mais pas encore l’inscription réelle, l’e-mail de confirmation, les deux appareils concurrents, la coupure réseau physique ou un paiement marchand CinetPay bout en bout.
5. **Rafraîchir les documents opérationnels historiques.** `docs/RECETTE-SUPABASE.md` comporte un relevé de projet daté du 23 octobre et arrêté à des migrations anciennes. Le conserver comme historique daté ou le remplacer par un relevé courant, pour éviter des consignes de recette périmées.

## 6. Séquence de réalisation recommandée

1. Corriger les deux défauts d’isolation multi-tenant (agrégats cash et curseur de lecture), avec tests ciblés.
2. Corriger l’état du bouton Mobile Money tant que la commande n’existe pas sur le serveur.
3. Configurer l’environnement local/public Supabase et les redirect URLs sans exposer de secret ; créer un compte de test contrôlé.
4. Vérifier les secrets CinetPay et exécuter une recette fournisseur en mode test.
5. Créer une sauvegarde/branche de préproduction, appliquer 020 et jouer la recette fonctionnelle complète ; ne jamais exécuter directement sur le projet actif sans confirmation et sauvegarde.
6. Faire un pilote sur un seul pressing et deux appareils : création hors ligne, reprise réseau, conflit, espèces, Mobile Money, clôture, export et restauration.
7. Observer logs Edge, erreurs de sync, doublons et retards pendant le pilote avant généralisation.

## 7. Parcours métier résumé

```text
Ouverture PWA
  → restauration session Supabase / mode démonstration
  → résolution du rôle et du pressing actif
  → liste locale des commandes
  → nouvelle commande (client → lignes libres → choix de règlement)
  → écriture IndexedDB + QR + total
      ├─ espèces : fiche commande → confirmation comptoir → file locale → RPC serveur
      ├─ Mobile Money : synchronisation commande → Edge init → CinetPay
      │                  → webhook vérifié → statut payé → retour en lecture seule
      └─ plus tard : fiche commande → atelier/statut ou encaissement ultérieur
  → atelier : scan QR → tri → lavage → séchage → repassage → contrôle → prête
  → remise client → commande livrée / notification enregistrée
  → caisse, clients, stock, dépenses et rapports selon le rôle
  → synchronisation en ligne, conflit explicite si versions divergentes
```
