# Conformité écran par écran — maquette MVP ↔ code livré

**Date :** 23 octobre 2026
**Objet :** comparer les neuf écrans validés pour le MVP (et les trois écrans
repoussés en V2) à ce que contient réellement le dépôt, puis décider de ce qui
reste à faire.

> **À lire avant de recoder quoi que ce soit.** Les écrans 1 à 9 existent déjà,
> dans la même application, avec les contraintes demandées (Dexie pour la
> lecture hors ligne, Zustand pour le contexte, Zod pour les formulaires,
> `html5-qrcode` pour le scan). Les recréer sous d'autres noms (`/dashboard`,
> `/orders`) créerait deux applications concurrentes dans le même dépôt.
> Ce document dit, écran par écran, **ce qui est livré**, **ce qui manque
> vraiment** et **ce qui est refusé, avec la raison**.

---

## 1. Correspondance des écrans

| # | Écran demandé | Route demandée | Route livrée | Fichier | État |
| --- | --- | --- | --- | --- | --- |
| 1 | Connexion | `/login` | `/` (écran affiché sans session) | `src/pages/Login.tsx`, `src/components/AuthGate.tsx` | ✅ livré, **complété** (lien de réinitialisation, arguments de vente) |
| 2 | Tableau de bord | `/dashboard` | `/tableau-de-bord` | `src/pages/TableauDeBord.tsx` | ✅ livré, au-delà du MVP demandé |
| 3 | Liste des commandes | `/orders` | `/commandes` | `src/pages/Orders.tsx` | ✅ livré (recherche, onglets dont « En retard ») |
| 4 | Détail d'une commande | `/orders/:id` | `/commandes/:orderId` | `src/pages/OrderDetail.tsx` | ✅ livré (timeline, statut, reçu) |
| 5 | Création d'une commande | `/orders/new` | `/commandes/nouvelle` | `src/pages/OrderForm.tsx` | ⚠️ livré **en une page**, pas en trois étapes |
| 6 | Scan QR / Atelier | `/atelier` | `/atelier` | `src/pages/Atelier.tsx` | ✅ livré, **complété** (historique des derniers scans) |
| 7 | Catalogue | `/catalogue` | `/catalogue` | `src/pages/Catalogue.tsx` | ✅ livré, mis en cache IndexedDB |
| 8 | Paiement / Caisse | `/payment/:orderId` | panneaux dans la fiche + `/caisse` + `/commandes/:orderId/recu` | `src/components/PaymentButton.tsx`, `CashPanel.tsx`, `src/pages/Caisse.tsx`, `Receipt.tsx` | ✅ livré |
| 9 | Clients | `/clients` | `/clients` | `src/pages/Clients.tsx` | ✅ livré |
| 10 | Stocks et dépenses | — | `/stock`, `/depenses` | `Stock.tsx`, `Depenses.tsx` | 🟰 **déjà livré** (palier 3), voir §4 |
| 11 | Rapports et statistiques | — | `/tableau-de-bord` | `TableauDeBord.tsx` | 🟰 indicateurs livrés ; graphiques non faits |
| 12 | Profil et paramètres | — | *aucune route* | — | ❌ **manquant** (page basique à créer) |

Légende : ✅ conforme · ⚠️ conforme mais perfectible · 🟰 hors demande MVP mais
déjà livré · ❌ manquant.

---

## 2. Écran par écran

### 1. Connexion — `/`

- **Livré :** e-mail + mot de passe via Supabase Auth, mot de passe masqué
  (`Afficher` / `Masquer`), erreurs traduites en français, mode démonstration
  quand Supabase n'est pas configuré, restauration de session hors ligne.
- **Ajouté le 23/10 :** lien **« Recevoir un lien de réinitialisation »**
  (`resetPasswordForEmail`) et page `/reinitialisation` qui écrit le nouveau mot
  de passe (`updateUser`), plus un encart d'arguments **Rapide / Sécurisé /
  Fiable** sur grand écran.
- **Écart assumé :** pas de bouton « Se connecter avec Supabase » en OAuth. Un
  pressing n'a pas de fournisseur OAuth configuré, et un compte Google
  n'apporte aucune information de rattachement : le `tenant_id` vient de
  `tenant_users`, jamais du fournisseur d'identité. Le bouton serait un
  ornement qui ne marche qu'après configuration manuelle côté Supabase.
- **Connexion par téléphone :** Supabase Auth s'authentifie par e-mail ou par
  téléphone **avec un fournisseur SMS payant**. Le téléphone reste la clé métier
  du client (fiche, recherche), pas celle du compte utilisateur.

### 2. Tableau de bord — `/tableau-de-bord`

- **Livré :** commandes du jour, en atelier, prêtes, en retard, espèces du jour
  et de la semaine, Mobile Money, panier moyen, reste à encaisser, série de sept
  jours, répartition par statut, top des prestations, alertes de stock, dépenses
  du mois.
- **Lecture :** tout est calculé depuis Dexie (`useLocalOrders`,
  `useAllCashPayments`), la page fonctionne donc hors ligne ; les compléments
  serveur s'affichent « hors ligne » plutôt que `0`.
- **Écart :** pas de tableau des « 5 dernières commandes » — la liste complète
  est à un onglet. À ajouter seulement si l'usage le réclame.

### 3. Liste des commandes — `/commandes`

- **Livré :** recherche nom / téléphone, onglets *Toutes, En retard, Réception,
  Tri, Lavage, Séchage, Repassage, Contrôle, Prêt, Remis, Annulée*, bouton
  **Nouvelle commande** masqué si le rôle ne le permet pas.
- **Écart :** pas de pagination. La liste est chargée en entier depuis IndexedDB
  (assumé, voir `docs/BACKLOG.md`).

### 4. Détail d'une commande — `/commandes/:orderId`

- **Livré :** client et employé assigné, articles et total, **timeline** du
  parcours, boutons de changement de statut filtrés par rôle, encaissement
  espèces / Mobile Money, remboursement, réclamations, impression du reçu.
- **Hors ligne :** le changement de statut écrit dans Dexie et marque la
  commande « à synchroniser » ; la synchronisation part au retour du réseau.

### 5. Création d'une commande — `/commandes/nouvelle` ⚠️

- **Livré :** formulaire complet en une page — client (nom, téléphone),
  articles avec quantités, prestations du catalogue, prix, spécificités locales
  (« empesage », « broderie fragile »), total calculé, génération du `qr_code`,
  enregistrement Dexie + synchronisation si en ligne.
- **Manquant :** le découpage en **trois étapes** (Client → Articles → Paiement).
- **Réserve :** sur une tablette de comptoir, un formulaire long défile mal. Un
  stepper de trois étapes est un vrai gain — mais il touche le chemin critique
  de la prise de commande, il doit donc être fait à part, avec les tests de
  création de commande rejoués.

### 6. Scan QR / Atelier — `/atelier`

- **Livré :** scan plein écran (`html5-qrcode`), saisie manuelle, résultat
  détaillé, changement de statut immédiat, liste des commandes en atelier.
- **Ajouté le 23/10 :** **historique des cinq derniers scans** de la session
  (client, code, statut, heure), pour rattraper un scan raté sans le refaire.

### 7. Catalogue — `/catalogue`

- **Livré :** articles × prestations, tarifs, création et modification
  réservées au propriétaire ; le catalogue est **mis en cache dans IndexedDB**
  pour que la prise de commande fonctionne hors ligne.
- **Point de conception :** le prix est **recopié sur la ligne** au moment de la
  vente ; modifier un tarif ne change jamais une facture émise.

### 8. Paiement / Caisse — fiche commande, `/caisse`, `/commandes/:orderId/recu`

- **Livré :** montant dû, **espèces** (local, immédiat) et **Mobile Money**
  (Edge Function `cinetpay-init` → lien CinetPay → webhook signé), succès avec
  référence et opérateur, reçu imprimable 80 mm, clôture de caisse.
- **Écart assumé :** **carte bancaire** absente. CinetPay l'exposerait, mais
  aucun pressing d'Abidjan du périmètre ne l'a demandée et cela ajoute une
  réconciliation de plus.
- **Écart assumé :** pas de route `/payment/:orderId` isolée. Le paiement est
  un panneau de la fiche commande : il y a toujours un contexte (client,
  articles, solde), ce qu'une page nue ferait perdre.

### 9. Clients — `/clients`

- **Livré :** liste, recherche nom / téléphone, nombre de commandes, total
  dépensé, reste dû, retards, historique cliquable, fiche enrichie (adresse,
  notes) côté serveur.
- **Nuance :** la liste et l'historique sont dérivés des **commandes locales**
  (donc disponibles hors ligne) ; la fiche enrichie est lue sur le serveur. Il
  n'y a **pas** de bouton « Nouveau client » : la fiche naît de la commande
  (`attach_customer_to_order`), ce qui évite les doublons créés à la main.

---

## 3. Ce qui manque vraiment

| Priorité | Élément | Pourquoi |
| --- | --- | --- |
| 1 | Page **Paramètres** (écran 12) | Dernier écran de la liste non couvert : informations du pressing, compte connecté, état de synchronisation, accès à l'abonnement. |
| 2 | Formulaire de commande en **trois étapes** (écran 5) | Gain d'ergonomie réel au comptoir ; touche le chemin critique, donc à faire avec les tests. |
| 3 | Tableau des **5 dernières commandes** (écran 2) | Confort ; le tableau de bord actuel montre déjà les indicateurs. |
| 4 | Pagination de la liste (écran 3) | Nécessaire au-delà de quelques centaines de commandes ; déjà consigné en dette. |

---

## 4. Ce que je ne retire pas

Le message d'origine propose de repousser en V2 les stocks, les dépenses, les
statistiques et les paramètres avancés. Trois de ces modules sont **déjà
livrés, testés et documentés** (paliers 2 et 3 de `MAJ.md`) :

- ils viennent de l'**audit validé**, pas d'une improvisation : ils sont donc
  dans le périmètre du produit ;
- les retirer supprimerait 5 tables, 9 politiques RLS, 41 contrôles SQL, 24
  tests, 4 écrans et deux migrations — pour un gain de délai nul, puisque le
  travail est fait ;
- ils sont **inerte par défaut** côté client qui n'en veut pas : la navigation
  les masque par capacité (`stock.move`, `expenses.manage`, `dashboard.view`).
  Un pressing qui ne s'en sert pas ne les voit pas s'il n'a pas le rôle.

En revanche, la **priorisation commerciale** est légitime : ces modules peuvent
rester hors de la démonstration de vente et n'être activés qu'après signature.
C'est une décision de mise sur le marché, pas de code.

---

## 5. État des vérifications

- `npm run typecheck` — 0 erreur
- `npm run lint` — 0 avertissement
- `npm test` — **222 tests**, 12 fichiers
- `npm run sql:verify` — **123 contrôles** sur PostgreSQL 16.2
- `npm run build` — PWA, 81 fichiers précachés
