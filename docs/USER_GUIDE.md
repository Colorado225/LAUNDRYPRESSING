# Guide utilisateur — Pressing Pro

Version du document : MVP `v0.1.0-mvp`.
Public : personnel d'un pressing à Abidjan (réceptionniste, artisan, propriétaire).

L'application s'utilise sur **téléphone ou tablette Android**, dans Chrome, et
fonctionne **hors ligne** pour tout ce qui concerne les commandes.

---

## 1. Installer l'application sur la tablette

À faire une seule fois, par le propriétaire, avec une connexion internet.

1. Ouvrir l'adresse de l'application dans **Chrome**.
2. Appuyer sur le menu **⋮** en haut à droite.
3. Choisir **« Installer l'application »** (ou **« Ajouter à l'écran d'accueil »**).
4. Confirmer : l'icône **Pressing Pro** apparaît sur l'écran d'accueil.

Une fois installée, l'application s'ouvre en plein écran, sans barre d'adresse.

> **Astuce.** Un appui long sur l'icône propose directement **Nouvelle commande**
> et **Atelier — scanner une étiquette**.

---

## 2. Se connecter ou ouvrir un compte

L'écran d'accueil propose deux onglets : **Se connecter** (compte existant) et
**Créer un compte** (nouveau pressing).

### 2.1 Créer un compte (nouveau pressing)

1. Onglet **Créer un compte**.
2. Renseigner le **nom du pressing**, le **téléphone** (facultatif), l'**adresse
   e-mail**, un **mot de passe** d'au moins 8 caractères contenant une lettre et
   un chiffre, puis le confirmer.
3. Cocher l'acceptation des conditions, puis **Créer mon compte**.

Le compte devient **propriétaire** du pressing, avec un **essai de 14 jours**.
Aucune carte bancaire n'est demandée à l'inscription.

> Si le projet Supabase exige la confirmation de l'adresse, l'écran l'indique :
> ouvrir le lien reçu, puis se connecter. Le pressing est créé à cette première
> connexion.

Un même compte ne peut créer qu'un pressing : pour tenir plusieurs boutiques,
demander l'ajout depuis le compte existant (console de supervision).

### 2.2 Se connecter

1. Ouvrir l'application : l'écran **Connexion** s'affiche.
2. Saisir l'**adresse e-mail** et le **mot de passe** fournis par le propriétaire.
3. Appuyer sur **Se connecter**.

Le pressing est reconnu automatiquement à partir du compte : il n'y a **aucun
identifiant de pressing à saisir**. Le nom du pressing et le rôle apparaissent en
haut de l'écran.

**Points importants**

- La première connexion nécessite internet. Ensuite, la session est mémorisée :
  la tablette redémarre **même sans réseau**.
- Un compte non rattaché à un pressing est refusé avec le message
  « Ce compte n'est rattaché à aucun pressing ».
- Ne jamais partager un mot de passe : chaque membre de l'équipe doit avoir le sien,
  pour que le propriétaire puisse retirer un accès sans bloquer les autres.

---

## 3. Parcours du réceptionniste — le comptoir

### 3.1 Prendre une commande

La prise de commande se fait en **trois étapes**, affichées en haut de l'écran.
Le bouton **Précédent** permet de revenir corriger une étape déjà validée.

1. Onglet **Commandes** → bouton **Nouvelle commande**
   (ou appui long sur l'icône de l'application → **Nouvelle commande**).
2. **Étape 1 — Client** : **nom**, **téléphone** et, si on l'a promis, la
   **date de livraison**. Puis **Suivant**.
3. **Étape 2 — Vêtements** : ajouter chaque pièce (bouton **Ajouter**) :
   - choisir l'**article** et la **prestation** au catalogue : le prix se remplit
     tout seul ;
   - préciser le **tissu** si utile (Bazin, Wax, laine…),
   - les **instructions** particulières (ex. « Empèsage fort »),
   - un **prix différent** du catalogue est possible, mais il exige un **motif**
     d'au moins 10 caractères (tarif dérogatoire).
4. **Étape 3 — Paiement** : vérifier le **récapitulatif** (client, vêtements,
   total) et choisir :
   - **Régler plus tard** : la commande est enregistrée, le solde reste dû ;
   - **Encaisser des espèces maintenant** : la fiche s'ouvre avec le panneau
     d'encaissement déplié, montant pré-rempli.

   Le **Mobile Money** se déclenche ensuite depuis la fiche de la commande :
   CinetPay exige une référence de commande déjà enregistrée.
5. Appuyer sur **Enregistrer la commande**.

Le **téléphone** suffit à retrouver le client : les commandes passées avec le
même numéro — avec ou sans indicatif `+225` — sont regroupées dans son
historique.

La commande est immédiatement visible dans la liste, **même sans réseau**. Un
badge orange indique qu'elle attend l'envoi vers le serveur.

> **Retrouver une commande dans la liste.** La liste affiche **20 commandes par
> page**, de la plus récente à la plus ancienne. La barre du bas indique
> « 21–40 sur 137 » ; *Précédent* et *Suivant* changent de page. La **recherche**
> (nom ou téléphone) et les **onglets de statut** portent sur **toutes** les
> commandes, pas seulement sur la page affichée : chercher un nom ramène
> directement à la page où il se trouve.

### 3.2 Imprimer l'étiquette

1. Ouvrir la commande depuis la liste.
2. Section **Étiquette QR** → bouton **Imprimer**.
3. L'étiquette est mise en page pour une imprimante **80 mm** (imprimante thermique
   de comptoir) : code QR, nom du client, numéro de commande, total.

Coller l'étiquette sur le sachet ou le ticket du client. Le QR code est la clé de
tout le reste du circuit.

### 3.3 Encaisser un paiement Mobile Money

1. Sur la fiche de la commande, appuyer sur **Payer par Mobile Money**.
2. Le **guichet sécurisé CinetPay** s'ouvre : le client choisit **Wave**,
   **Orange Money**, **MTN MoMo** ou **Moov Money**, puis valide sur son téléphone.
3. Au retour dans l'application, l'écran affiche l'état du paiement :
   - **« Paiement confirmé »** → la commande passe en **Payée** ;
   - **« En attente »** → l'opérateur n'a pas encore répondu ; la page réessaie
     seule pendant quelques secondes, un bouton permet de revérifier ;
   - **« Paiement refusé »** → solde insuffisant ou annulation ; relancer le paiement.

**Le paiement nécessite internet.** Le bouton est désactivé hors ligne, avec un
message explicite : la commande reste enregistrée, le règlement se fera plus tard.

> **Arrondi.** CinetPay impose un montant multiple de 5 FCFA. Une commande de
> 8 503 FCFA est débitée **8 505 FCFA** ; le montant exact est rappelé au moment
> du paiement. L'écart ne dépasse jamais 4 FCFA.

### 3.4 Encaisser en espèces

1. Ouvrir la commande → **Encaisser**.
2. Saisir le montant remis (acompte ou solde). Le **reste à payer** est recalculé
   à partir des encaissements réels : il ne se saisit jamais à la main.
3. Un **reçu 80 mm** est disponible via **Reçu** : référence, téléphone,
   articles, montant reçu et **reste à payer**.
4. Le reçu s'imprime même hors ligne, puisque les données sont sur la tablette.

### 3.4 bis Éditer une facture A4

Pour une entreprise cliente, un remboursement ou l'archivage du pressing :

1. Ouvrir la commande → panneau **Encaissement** → bouton **Facture**.
2. Le document tient sur une page A4 : en-tête du pressing, client, prestations
   **regroupées** (deux chemises lavées = une ligne, quantité 2), total,
   acomptes datés, reste à payer, **total en toutes lettres**.
3. **Imprimer** → dans la destination, choisir **« Enregistrer au format
   PDF »** pour obtenir un fichier. Le texte reste sélectionnable.
4. Quand tout est réglé, la facture porte la mention **« Facture acquittée »**.

> Le **numéro** (`FA-2026-3B4C5D`) est dérivé de la commande : il ne change
> jamais, même réimprimé six mois plus tard ou depuis une autre tablette.
> Aucune TVA n'est affichée : l'application ne connaît pas le régime fiscal du
> pressing et n'invente pas de taux.

### 3.5 Clôturer la caisse

1. Onglet **Caisse** → le montant **attendu** est recalculé par le serveur à
   partir des encaissements du jour (les remboursements sont déduits).
2. Compter les espèces du tiroir et déclarer le montant.
3. Valider : l'écart est conservé et reste consultable. Une clôture par jour.

### 3.6 Consulter un client

Onglet **Clients** → rechercher par nom ou par numéro. La fiche affiche le
nombre de commandes, le **total dépensé**, le **reste à encaisser** et les
**retards**. L'historique s'ouvre commande par commande.

La liste et l'historique fonctionnent **hors ligne** : ils sont calculés à
partir des commandes de la tablette. Les coordonnées (adresse, préférences,
notes) se modifient en ligne.

### 3.6 bis Prévenir le client

Ouvrir la commande → section **Prévenir le client**. Le message est déjà écrit ;
choisir le motif (**Commande prête**, **Retard de traitement**, **Linge non
retiré**), le relire, puis :

- **Envoyer sur WhatsApp** ouvre WhatsApp avec le texte pré-rempli et le bon
  numéro (indicatif 225 ajouté automatiquement) — il reste à appuyer sur
  envoyer dans l'application ;
- **Appeler** ouvre le composeur du téléphone.

Chaque envoi est journalisé : la commande indique « Dernier contact : … », et le
tableau de bord liste les clients **à prévenir** (commandes prêtes, retards) en
omettant ceux déjà joints depuis le dernier changement. Aucun message ne part
tout seul et aucun crédit SMS n'est consommé.

> L'atelier ne voit pas cette section : prévenir un client est un geste du
> comptoir.

### 3.7 Mouvementer le stock

Onglet **Stock** → choisir l'article → **Entrée** ou **Sortie**. Une sortie
supérieure au stock restant est refusée : le stock ne devient jamais négatif.
Le journal des mouvements est définitif ; une erreur se corrige par un mouvement
inverse, pas en réécrivant l'histoire.

> Le stock et les dépenses sont des écrans de **bureau** : ils demandent une
> connexion.

### 3.8 Remettre le linge

Quand le client se présente, ouvrir la commande et la faire passer en **Livrée**
(voir le parcours artisan, §4.3 : le réceptionniste peut aussi le faire).

---

## 4. Parcours de l'artisan — l'atelier

### 4.1 Ouvrir l'atelier

Onglet **Atelier**. La caméra n'est activée qu'à ce moment-là : le reste de
l'application reste léger.

### 4.2 Scanner une étiquette

1. Appuyer sur **Scanner une étiquette** et autoriser l'accès à la caméra
   (une seule fois).
2. Présenter le **QR code** de l'étiquette devant l'objectif.
3. La fiche de la commande s'affiche : client, total, paiement, liste des vêtements.

**Si la caméra ne fonctionne pas** (autorisée refusée, objectif sale, étiquette
abîmée) : saisir le code à la main dans le champ de recherche
(`CMD-7F3A2B` ou le code complet) puis appuyer sur **Rechercher**.

### 4.3 Faire avancer une commande

Depuis la fiche affichée, choisir le statut suivant :

**Reçue → En lavage → Repassage → Prête → Livrée**

- Le bouton **Revenir à « … »** corrige une erreur de manipulation.
- Une commande **annulée** ne peut plus être payée.

Le statut change **immédiatement** sur la tablette, sans réseau. Il est transmis
au serveur dès le retour de la connexion.

### 4.4 Vérifier que tout est envoyé

En haut de l'écran, le badge de synchronisation indique :

| Badge | Signification |
| --- | --- |
| 🟢 **Synchronisé** | Tout est enregistré sur le serveur. |
| 🟠 **Hors ligne** | Pas de réseau : les commandes attendent sur la tablette. |
| 🔵 **Synchronisation…** | Envoi en cours. |
| 🔴 **Erreur de synchro** | Un envoi a échoué ; le texte de l'erreur est affiché à côté. |

Le bouton **Synchroniser** force un envoi immédiat.

---

## 5. Parcours du propriétaire — la supervision

### 5.1 Créer un membre de l'équipe

Deux chemins, selon que l'éditeur a ouvert la console de supervision :

- **Console** (`/supervision`, éditeur) : choisir la boutique, saisir
  l'identifiant du compte, choisir le rôle → **Rattacher**. La formule du
  pressing borne le nombre de comptes et de boutiques.
- **À la main**, ci-dessous, quand la console n'est pas disponible.

1. Dans Supabase : **Authentication → Users → Add user** (e-mail + mot de passe).
2. Ouvrir **SQL Editor** et rattacher le compte au pressing :

```sql
insert into public.tenant_users (user_id, tenant_id, role)
values ('<uuid-utilisateur>', '<uuid-pressing>',
        'receptionist');  -- 'owner' | 'receptionist' | 'artisan'
```

3. (Recommandé) Ajouter les claims dans le JWT :

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('tenant_id', '<uuid-pressing>', 'tenant_role', 'receptionist')
where id = '<uuid-utilisateur>';
```

Le membre peut alors se connecter : il voit **uniquement** les commandes de son
pressing.

### 5.2 Suivre l'activité

- **Tableau de bord** : commandes du jour, en atelier, prêtes, en retard ;
  espèces du jour et de la semaine ; Mobile Money du jour ; panier moyen ; reste
  à encaisser ; série des sept derniers jours ; top des prestations ; alertes de
  stock et dépenses du mois.
- **Commandes** : liste complète, avec recherche par nom ou téléphone et filtres
  par statut.
- Chaque fiche indique le **statut de paiement** (Non payée / Payée) et le
  **moyen utilisé** (Wave, Orange Money, MTN MoMo, Moov Money).
- Le badge de synchronisation signale les tablettes qui n'ont pas encore envoyé
  leurs commandes.

Les indicateurs d'activité sont calculés **sur la tablette** : ils restent
consultables hors connexion. Les encaissements Mobile Money et les dépenses
viennent du serveur et s'affichent « hors ligne » quand ils ne peuvent pas être
lus — jamais « 0 ».

### 5.3 Retirer un accès

```sql
delete from public.tenant_users
where user_id = '<uuid-utilisateur>' and tenant_id = '<uuid-pressing>';
```

Le membre perd l'accès à ses prochaines requêtes. Sur une tablette déjà ouverte,
la déconnexion se produit à l'expiration du jeton (au plus une heure), ou
immédiatement via le bouton **Quitter**.

### 5.4 Se déconnecter

Bouton **Quitter** en haut à droite → confirmation.

> Les commandes **non synchronisées restent sur la tablette** après la
> déconnexion : elles ne sont pas perdues. Elles ne sont visibles que par le
> pressing qui les a créées.

### 5.5 Tenir le catalogue

Onglet **Prestations** (propriétaire uniquement) : créer les couples
**article × prestation** avec leur tarif. Modifier un tarif ne change **jamais**
une facture déjà émise : le prix est recopié sur la ligne au moment de la vente.

### 5.6 Créer les articles de stock et les fournisseurs

Onglet **Stock** → **Nouvel article** : nom, catégorie (produit, emballage,
consommable, autre), unité (pièce, litre, kg, flacon, rouleau), **seuil
d'alerte** et quantité initiale. La quantité initiale produit un mouvement
« Stock initial », visible dans le journal.

Le même écran permet d'ajouter un **fournisseur** (nom, téléphone, notes). Le
réceptionniste peut mouvementer le stock et choisir un fournisseur ; seul le
propriétaire crée les articles et les fournisseurs.

### 5.7 Enregistrer les dépenses

Onglet **Dépenses** (propriétaire uniquement) : libellé, catégorie (fournitures,
loyer, salaires, eau et électricité, transport, autre), montant, date,
fournisseur facultatif et note.

Le total du mois s'affiche en haut de l'écran ; il est calculé par le serveur,
donc il reste juste même si le registre est long. Un autre rôle ne voit ni
l'écran ni les montants : la base refuse la lecture.

La liste affiche les **25 dépenses les plus récentes**. Le bouton **Charger les
dépenses plus anciennes** ajoute la page suivante sans recharger l'écran ; il
disparaît quand le registre est épuisé. La pagination suit la dernière ligne
affichée, pas un numéro de page : une dépense ajoutée pendant la consultation
n'apparaît jamais deux fois.

### 5.8 Suivre l'abonnement

Onglet **Abonnement** (propriétaire) : formule en cours, montant, échéance,
nombre de comptes et de boutiques autorisés. Un bandeau apparaît dans toute
l'application dans trois cas :

| Situation | Ce que voit le pressing | Écritures |
| --- | --- | --- |
| Essai en cours | jours d'essai restants | ✅ |
| Échéance dans moins de sept jours | rappel de renouvellement | ✅ |
| Période de grâce (après l'échéance) | « échu depuis N jours », bandeau orange | ✅ encore |
| Abonnement échu | bandeau rouge | ❌ lecture seule |
| Suspendu par l'éditeur | motif affiché | ❌ lecture seule |

En lecture seule, la consultation, la recherche, le tableau de bord et
l'impression restent disponibles ; **toute écriture est refusée par le serveur**
(commande, encaissement, mouvement de stock, dépense). Le règlement se fait
auprès de l'éditeur, jamais depuis l'application.

### 5.9 Travailler avec plusieurs boutiques

Si le compte est rattaché à plusieurs pressings, un **sélecteur de boutique**
apparaît en haut de l'écran. Il affiche aussi le rôle tenu dans chaque boutique
(on peut être propriétaire d'une boutique et réceptionniste d'une autre).

Changer de boutique recharge l'application : commandes hors ligne, caisse et
abonnement sont propres à chaque pressing. Aucune donnée d'une boutique n'est
visible depuis une autre.

### 5.10 Lire les rapports

Onglet **Rapports**, réservé au propriétaire. Trois durées : **7, 30 ou 90
jours**, aujourd'hui compris.

- **Facturé** : total des commandes créées sur la période, annulations exclues.
  La variation entre parenthèses compare à la période précédente de même durée.
- **Encaissé** : espèces reçues pendant la période, y compris le règlement
  d'une commande plus ancienne.
- **Commandes** et **panier moyen** : mêmes règles de calcul que le tableau de
  bord.
- **Chiffre d'affaires par jour** : une barre par jour ; survoler une barre
  affiche le montant et le nombre de commandes. Sur 90 jours, une date sur
  quatorze est écrite sous l'axe pour rester lisible.
- **Répartition par statut**, **activité par jour de la semaine** (pour caler
  les lessives) et **top 5 des prestations**.
- **Exporter en CSV** télécharge la série quotidienne, prête pour un tableur.

> Les montants « encaissé » ne comptent que les **espèces** : les paiements
> Mobile Money viennent du serveur et ne sont pas stockés sur la tablette. Le
> rapport l'indique en bas de page plutôt que d'afficher un total trompeur.

### 5.11 Écrire au support

Onglet **Support** : un sujet, une description, puis **Envoyer au support**. La
réponse s'affiche sous la demande, avec son statut (Ouverte, En cours,
Clôturée). Les demandes sont cloisonnées par pressing et nécessitent une
connexion internet.

### 5.12 Consulter les paramètres

Onglet **Paramètres**, ouvert à tous les rôles :

- le **pressing** et son identifiant (bouton *Copier*, utile au support) ;
- le **compte** connecté : rôle sur ce pressing, adresse e-mail, identifiant ;
- l'**équipe** du pressing : qui travaille ici et avec quel rôle ;
- la **synchronisation** : état, commandes en attente, dernière réussite,
  dernière erreur, et un bouton *Synchroniser maintenant* ;
- les **données sur cet appareil** et l'état de l'application.

**Renommer le pressing** (propriétaire uniquement) : bouton *Modifier*, corriger
le nom ou le téléphone, puis *Enregistrer*. Le changement part au serveur
immédiatement et nécessite une connexion. Attention : laisser le téléphone vide
**efface** le numéro enregistré.

**Changer son mot de passe** : bouton *Changer le mot de passe* → un lien part
sur l'adresse e-mail du compte → le lien ouvre la page de choix du nouveau mot
de passe. Aucun mot de passe n'est saisi dans cet écran.

**Tablette revendue ou perdue** : *Déconnecter tous les appareils* invalide la
session partout. Les commandes non synchronisées restent sur la tablette.

**Données locales** : l'écran affiche le nombre de commandes, celles en attente
d'envoi, celles en conflit et l'espace occupé.

- *Exporter une sauvegarde* télécharge un fichier JSON (commandes, lignes,
  encaissements, anomalies, remboursements). À faire avant tout nettoyage.
- *Effacer les commandes synchronisées* libère de la place : seules les
  commandes **déjà enregistrées sur le serveur** partent. Les commandes en
  attente ou en conflit sont toujours conservées.

Le mot de passe se change depuis l'écran de connexion : **« Recevoir un lien de
réinitialisation »** envoie un e-mail, dont le lien ouvre la page de choix du
nouveau mot de passe. Un lien expiré affiche un message explicite.

### 5.13 Console de supervision (éditeur uniquement)

Onglet **Supervision** — visible seulement pour les comptes inscrits dans
`platform_admins` :

- **Suivi** : chaque pressing, sa formule, son état, son échéance, son nombre de
  comptes, de commandes et sa dernière activité ;
- **Renouveler / changer de formule** : sélection de la formule puis « +30 j » ;
  une formule inconnue est refusée par le serveur ;
- **Suspendre** : coupe immédiatement les écritures du pressing (motif
  enregistré) ;
- **Ouvrir une boutique** : nom, téléphone, identifiant du propriétaire,
  formule. La limite de boutiques de la formule est appliquée ;
- **Rattacher un compte** : boutique, identifiant du compte, rôle. Le dernier
  propriétaire d'un pressing ne peut pas être détaché ;
- **Support** : répondre et clôturer une demande.

Pour désigner un éditeur : `PLATFORM_ADMIN=true` dans `.env` avant
`npm run setup`, ou `insert into public.platform_admins (user_id) values (…)`.

---

### 5.9 Consulter le journal d'audit

Ouvrir **Journal d'audit** dans le menu (propriétaire uniquement).

Le journal enregistre **tout seul** les décisions sensibles : tarif d'une
prestation modifié, rôle d'un compte changé, compte rattaché ou détaché,
clôture de caisse, remboursement, dépense, abonnement, nom du pressing.

- Chaque ligne indique **qui** a agi (adresse du compte et rôle au moment de
  l'action), **quoi** et **quand**, avec l'ancienne et la nouvelle valeur.
- Le filtre **Catégorie** restreint l'affichage aux tarifs, à la caisse, etc.
- Les écritures faites par le système (notification de paiement) apparaissent
  sous l'auteur « Serveur ».

> Le journal est **en lecture seule, pour tout le monde**. Personne — pas même
> le propriétaire — ne peut ajouter, modifier ou effacer une ligne depuis
> l'application. C'est ce qui lui donne sa valeur en cas de litige.

---

## 6. Travailler sans réseau

Le pressing fonctionne en **mode avion**. Ce qui marche et ce qui ne marche pas :

| Action | Hors ligne |
| --- | --- |
| Se connecter sur une tablette déjà utilisée | ✅ |
| Consulter les commandes déjà sur la tablette | ✅ |
| Créer une commande | ✅ |
| Imprimer une étiquette | ✅ |
| Scanner un QR code en atelier | ✅ |
| Changer le statut d'une commande | ✅ |
| Chercher un client et voir son historique | ✅ (commandes locales) |
| Payer par Mobile Money | ❌ (guichet CinetPay) |
| Envoyer une commande au serveur | ❌ (automatique au retour) |
| Mouvementer le stock, saisir une dépense | ❌ (module de bureau) |
| Consulter l'abonnement, écrire au support | ❌ (données serveur) |

**Retour du réseau.** La synchronisation est automatique : dès que la tablette
retrouve internet, les commandes en attente partent une par une. Un échec sur une
commande n'empêche pas les autres de partir.

**Écran « Vous êtes hors ligne ».** Accessible par le lien **Aide** à côté du
badge orange : il rappelle ce qui reste possible et affiche le nombre de
commandes en attente.

---

## 7. Bouton « Retour » Android

- Depuis une fiche ou l'atelier, **Retour** ramène à l'écran précédent.
- Sur l'écran principal, un premier appui affiche
  « Appuyez à nouveau sur Retour pour quitter l'application ».
- Un second appui en moins de **2 secondes** ferme l'application.

Cette protection évite de quitter l'application par erreur au milieu d'une saisie.

---

## 8. Dépannage rapide

| Problème | Que faire |
| --- | --- |
| « E-mail ou mot de passe incorrect » | Vérifier la casse du mot de passe ; demander une réinitialisation au propriétaire. |
| « Ce compte n'est rattaché à aucun pressing » | Le compte existe mais n'est pas dans `tenant_users` (§5.1). |
| « La connexion nécessite internet » | Se connecter une fois avec du réseau ; ensuite le mode avion fonctionne. |
| Le badge reste **Hors ligne** | Vérifier les données mobiles / le Wi-Fi de la tablette. |
| Badge **Erreur de synchro** | Lire le message affiché à côté du badge ; le plus souvent le projet Supabase n'est pas migré. |
| La caméra ne s'ouvre pas | Autoriser la caméra dans Chrome (icône 🔒 dans la barre d'adresse), ou saisir le code à la main. |
| Le QR code n'est pas reconnu | Nettoyer l'objectif, éviter le contre-jour, approcher l'étiquette (15–20 cm). |
| Le bouton de paiement est grisé | Soit la commande est déjà payée, soit elle est annulée, soit il n'y a pas de réseau. |

---

## 9. Vocabulaire

| Terme | Définition |
| --- | --- |
| **Pressing (tenant)** | Une boutique. Les données de deux pressings ne se croisent jamais. |
| **Commande** | Le ticket d'un client, avec ses vêtements et son total. |
| **Étiquette** | Le QR code collé sur le sachet, imprimé en 80 mm. |
| **Synchronisation** | L'envoi des commandes de la tablette vers le serveur. |
| **RLS** | La règle serveur qui garantit qu'un pressing ne voit que ses propres données. |
