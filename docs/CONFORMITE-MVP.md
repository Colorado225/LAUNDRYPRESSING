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
| 1 | Connexion | `/login` | `/` (écran affiché sans session) + `/reinitialisation` | `src/pages/Login.tsx`, `Reinitialisation.tsx`, `src/components/AuthGate.tsx` | ✅ **complet** (réinitialisation, arguments de vente) |
| 2 | Tableau de bord | `/dashboard` | `/tableau-de-bord` | `src/pages/TableauDeBord.tsx` | ✅ **complet** (KPIs + 5 dernières commandes) |
| 3 | Liste des commandes | `/orders` | `/commandes` | `src/pages/Orders.tsx` | ✅ livré (recherche, onglets dont « En retard ») |
| 4 | Détail d'une commande | `/orders/:id` | `/commandes/:orderId` | `src/pages/OrderDetail.tsx` | ✅ livré (timeline, statut, reçu) |
| 5 | Création d'une commande | `/orders/new` | `/commandes/nouvelle` | `src/pages/OrderForm.tsx` | ✅ **trois étapes** (Client → Vêtements → Paiement) |
| 6 | Scan QR / Atelier | `/atelier` | `/atelier` | `src/pages/Atelier.tsx` | ✅ livré, **complété** (historique des derniers scans) |
| 7 | Catalogue | `/catalogue` | `/catalogue` | `src/pages/Catalogue.tsx` | ✅ livré, mis en cache IndexedDB |
| 8 | Paiement / Caisse | `/payment/:orderId` | panneaux dans la fiche + `/caisse` + `/commandes/:orderId/recu` | `src/components/PaymentButton.tsx`, `CashPanel.tsx`, `src/pages/Caisse.tsx`, `Receipt.tsx` | ✅ livré |
| 9 | Clients | `/clients` | `/clients` | `src/pages/Clients.tsx` | ✅ livré |
| 10 | Stocks et dépenses | — | `/stock`, `/depenses` | `Stock.tsx`, `Depenses.tsx` | 🟰 **déjà livré** (palier 3) ; dépenses **paginées côté serveur** |
| 11 | Rapports et statistiques | — | `/rapports` | `src/pages/Rapports.tsx`, `src/lib/reporting.ts` | ✅ **livré** (courbes 7/30/90 j, comparaison de périodes, export CSV) |
| 12 | Profil et paramètres | — | `/parametres` | `src/pages/Parametres.tsx` | ✅ **livré** (page basique, lecture seule) |

Légende : ✅ conforme · ⚠️ conforme mais perfectible · 🟰 hors demande MVP mais
déjà livré · ❌ manquant.

---

## 2. Écran par écran

### 1. Connexion — `/` et `/reinitialisation`

- **Livré :** e-mail + mot de passe via Supabase Auth, mot de passe masqué
  (`Afficher` / `Masquer`), erreurs traduites en français, mode démonstration
  quand Supabase n'est pas configuré, restauration de session hors ligne.
- **Livré le 23/10 :** lien **« Recevoir un lien de réinitialisation »**
  (`resetPasswordForEmail`) et page `/reinitialisation` qui écrit le nouveau mot
  de passe (`updateUser`), plus un encart d'arguments **Rapide / Sécurisé /
  Fiable** sur grand écran. Un lien expiré affiche un message explicite au lieu
  d'un formulaire inutilisable.
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
- **Livré le 23/10 :** tableau des **cinq dernières commandes** (référence,
  client, statut, montant, date) avec lien vers la fiche et vers la liste.
- **Lecture :** tout est calculé depuis Dexie (`useLocalOrders`,
  `useAllCashPayments`), la page fonctionne donc hors ligne ; les compléments
  serveur s'affichent « hors ligne » plutôt que `0`.

### 3. Liste des commandes — `/commandes`

- **Livré :** recherche nom / téléphone, onglets *Toutes, En retard, Réception,
  Tri, Lavage, Séchage, Repassage, Contrôle, Prêt, Remis, Annulée*, bouton
  **Nouvelle commande** masqué si le rôle ne le permet pas.
- **Livré le 23/10 :** **pagination locale** de 20 commandes par page, avec
  barre « X–Y sur N » et boutons *Précédent* / *Suivant* désactivés aux bornes.
  Une recherche ou un changement d'onglet ramène à la première page ; le filtre
  porte sur la liste entière, jamais sur la page affichée.
- **Lecture :** tout reste lu depuis Dexie (`useLocalOrders`), donc la pagination
  fonctionne hors ligne. Aucune requête serveur : c'est une découpe du rendu.
- **Écart résiduel :** aucun. Au-delà de quelques milliers de commandes, il
  faudra un chargement progressif côté base — consigné dans `docs/BACKLOG.md`.

### 4. Détail d'une commande — `/commandes/:orderId`

- **Livré :** client et employé assigné, articles et total, **timeline** du
  parcours, boutons de changement de statut filtrés par rôle, encaissement
  espèces / Mobile Money, remboursement, réclamations, impression du reçu.
- **Hors ligne :** le changement de statut écrit dans Dexie et marque la
  commande « à synchroniser » ; la synchronisation part au retour du réseau.

### 5. Création d'une commande — `/commandes/nouvelle`

- **Livré :** **trois étapes** — Client → Vêtements → Paiement — avec fil
  d'étapes, bouton *Précédent*, validation par étape (téléphone à 10 chiffres,
  prix supérieur à zéro, motif obligatoire en cas de tarif dérogatoire), total
  rappelé en permanence dans le pied de page.
- **Étape Paiement :** récapitulatif complet puis choix entre « régler plus
  tard » et « encaisser des espèces maintenant » — dans ce cas la fiche s'ouvre
  avec le panneau de caisse déplié (`?regler=1`). Le Mobile Money reste déclenché
  depuis la fiche : CinetPay exige une commande déjà enregistrée.
- **Inchangé :** génération du `qr_code`, enregistrement Dexie puis
  synchronisation au retour du réseau.

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

### 11. Rapports et statistiques — `/rapports`

- **Livré le 23/10 :** période de **7, 30 ou 90 jours** (bornes incluses), quatre
  indicateurs — facturé, encaissé, commandes, panier moyen — **comparés à la
  période précédente de même durée** (± %), série quotidienne du chiffre
  d'affaires, répartition par statut (annulations comprises), activité par jour
  de la semaine, top 5 des prestations, **export CSV** de la série quotidienne.
- **Choix :** graphiques **SVG faits à la main**. Une librairie de graphiques
  pèserait plus lourd que la page elle-même, pour trois courbes ; sur une
  tablette d'entrée de gamme en 3G, c'est exactement ce qu'on cherche à éviter.
- **Choix :** comparaison avec la période **précédente**, pas avec « le mois
  dernier ». Comparer un 23 octobre à un 1er octobre mélangerait un jour ouvré
  et une période complète.
- **Limite affichée :** « encaissé » ne compte que les **espèces** ; le Mobile
  Money vient du serveur et n'est pas journalisé localement. Un rapport qui
  l'ignorerait en silence ferait croire à un trou de trésorerie.

### 12. Paramètres — `/parametres`

- **Livré :** pressing et identifiant copiable, compte connecté et rôle, état de
  synchronisation (en attente, dernière réussite, dernière erreur) avec relance
  manuelle, rappel hors ligne, accès à l'abonnement pour le propriétaire.
- **Choix :** écran en **lecture seule**. Modifier le nom du pressing, la
  formule ou l'équipe se fait déjà dans `/abonnement` et dans la console de
  supervision : dupliquer ces écritures multiplierait les chemins pour aucun
  gain.

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

| Priorité | Élément | État |
| --- | --- | --- |
| ~~1~~ | Page **Paramètres** (écran 12) | ✅ **fait** — `/parametres` : pressing, compte, synchronisation, hors ligne. |
| ~~2~~ | Formulaire de commande en **trois étapes** (écran 5) | ✅ **fait** — validation par étape, étape Paiement avec règlement différé ou caisse immédiate. |
| ~~3~~ | Tableau des **5 dernières commandes** (écran 2) | ✅ **fait** — `recentOrders`, ordonné par date de création. |
| ~~4~~ | **Pagination** de la liste (écran 3) | ✅ **fait** — 20 commandes par page, filtres portant sur la liste entière. |
| ~~5~~ | **Rapports et statistiques** (écran 11) | ✅ **fait** — `/rapports` : période 7/30/90 j, comparaison, export CSV. |

### Mise en page

La maquette décrit une **barre latérale** ; l'application utilise désormais les
deux : colonne fixe à partir de 1024 px, onglets horizontaux en dessous, pour
que la tablette d'atelier garde des cibles de 48 px sans menu caché.

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
- `npm test` — **227 tests**, 12 fichiers
- `npm run sql:verify` — **123 contrôles** sur PostgreSQL 16.2
- `npm run build` — PWA, 81 fichiers précachés
