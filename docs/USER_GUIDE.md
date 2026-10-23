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

## 2. Se connecter

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

1. Onglet **Commandes** → bouton **Nouvelle commande**
   (ou appui long sur l'icône de l'application → **Nouvelle commande**).
2. Renseigner le **nom** et le **téléphone** du client.
3. Ajouter chaque vêtement (bouton **Ajouter**) avec :
   - son **libellé** (ex. « Costume 3 pièces »),
   - le **tissu** si utile (Bazin, Wax, laine…),
   - les **instructions** particulières (ex. « Empèsage fort »),
   - son **prix** en francs CFA.
4. Vérifier le **total** affiché en bas, puis **Enregistrer**.

La commande est immédiatement visible dans la liste, **même sans réseau**. Un
badge orange indique qu'elle attend l'envoi vers le serveur.

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

### 3.4 Remettre le linge

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

- **Commandes** : liste complète, avec recherche par nom ou téléphone et filtres
  par statut.
- Chaque fiche indique le **statut de paiement** (Non payée / Payée) et le
  **moyen utilisé** (Wave, Orange Money, MTN MoMo, Moov Money).
- Le badge de synchronisation signale les tablettes qui n'ont pas encore envoyé
  leurs commandes.

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
| Payer par Mobile Money | ❌ (guichet CinetPay) |
| Envoyer une commande au serveur | ❌ (automatique au retour) |

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
