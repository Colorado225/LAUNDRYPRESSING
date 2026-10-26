# Guide utilisateur — Pressing Pro

**Version de référence : 26 octobre 2026.** L’application se destine aux propriétaires, réceptionnistes et artisans. Elle fonctionne sur téléphone ou tablette et garde les opérations de commande disponibles hors ligne après la première connexion.

> Le catalogue tarifaire et les modèles commerciaux ne font plus partie de l’application actuelle. Le prix est saisi directement sur chaque ligne de commande. Les anciennes pages catalogue décrites dans les versions antérieures de ce guide ont été retirées.

## 1. Installer et se connecter

1. Ouvrir l’adresse HTTPS de l’application dans Chrome sur Android.
2. Dans le menu Chrome, choisir **Installer l’application** ou **Ajouter à l’écran d’accueil**.
3. Ouvrir Pressing Pro et se connecter avec le compte fourni par le propriétaire.

La première connexion demande internet. Après connexion, les données de commande peuvent être utilisées hors ligne et seront synchronisées au retour du réseau. La liste des boutiques et le rôle proviennent du compte Supabase ; le choix d’une boutique ne confère aucun droit supplémentaire.

## 2. Navigation selon le rôle

Sur téléphone et tablette, ouvrir le menu avec le bouton hamburger. Les destinations visibles dépendent du rôle et des permissions : commandes, création, atelier, caisse, rapports et outils de gestion. L’artisan dispose d’un accès plus limité que le réceptionniste et le propriétaire.

Les droits déterminants sont aussi vérifiés côté serveur ; l’interface ne constitue pas seule une mesure de sécurité.

## 3. Créer une commande

Dans **Commandes**, choisir **Nouvelle commande**. Le formulaire comporte trois étapes.

### Étape 1 — Client

- Saisir le nom et le numéro de téléphone ivoirien.
- Ajouter, si nécessaire, la date de livraison promise.
- Des commandes précédentes du même appareil peuvent aider à reconnaître un numéro.
- **Annuler** abandonne le formulaire et revient à la liste.

### Étape 2 — Articles

Pour chaque vêtement ou prestation :

- saisir un libellé (par exemple « Chemise » ou « Retouche ») ;
- indiquer la quantité entière ;
- entrer le prix unitaire en FCFA ;
- ajouter éventuellement le type de tissu et des instructions.

Le total de chaque ligne est calculé à partir de la quantité et du prix unitaire. Le total de la commande est calculé automatiquement. Les lignes et le total restent affichés pour vérification avant l’enregistrement.

### Étape 3 — Règlement

- **Régler plus tard** : la commande est créée et reste à payer.
- **Encaisser des espèces maintenant** : la commande est d’abord enregistrée ; sa fiche s’ouvre ensuite avec le panneau espèces déplié. Vérifier le montant reçu et confirmer l’encaissement dans ce panneau. Aucun paiement n’est enregistré simplement en choisissant cette option.

Le paiement Mobile Money se lance depuis la fiche de commande après sa création. Un état de simulation ne signifie pas qu’un règlement réel a été reçu.

## 4. Travailler sur les commandes

La liste permet de consulter et de rechercher les commandes. Ouvrir une commande pour voir le client, les articles, le total, le QR code, les opérations de caisse et l’avancement.

Les transitions disponibles suivent le flux de traitement. Le personnel d’atelier peut mettre à jour les étapes autorisées par son rôle. Si plusieurs appareils modifient une commande hors ligne, l’application signale un conflit et propose de conserver la version locale ou d’adopter celle du serveur : ne pas fermer ce choix sans vérifier les modifications.

Le propriétaire peut **supprimer définitivement** une commande depuis sa fiche, mais seulement si aucun encaissement ni remboursement n’y est rattaché. Une commande qui porte de l’argent doit être **annulée** : elle reste dans l’historique et conserve ses reçus.

## 5. Atelier et QR code

1. Depuis la commande, afficher ou imprimer l’étiquette QR.
2. Ouvrir **Atelier**, autoriser l’accès caméra puis scanner le code.
3. Si la caméra n’est pas disponible, rechercher la commande par saisie manuelle lorsque l’écran le permet.
4. Vérifier le vêtement et les consignes avant de mettre à jour son statut.

La lecture caméra nécessite les permissions du navigateur et, en général, une origine HTTPS.

## 6. Caisse et documents

Depuis la fiche d’une commande, le panneau **Encaissement** affiche le total, le montant encaissé et le solde restant. Un encaissement espèces peut être saisi hors ligne ; il est placé dans la file de synchronisation. Un message d’erreur de synchronisation doit être résolu avant de considérer la caisse comme réconciliée sur tous les appareils.

Les reçus thermiques et les factures s’ouvrent depuis la fiche de commande. La page **Caisse** regroupe les encaissements et la clôture journalière. Les remboursements sont soumis aux permissions et aux règles applicables aux montants encaissés.

## 7. Clients, stock, dépenses et équipe

- **Clients** : la liste réunit les clients des commandes de l’appareil et les fiches enregistrées sur le serveur. **Nouveau client** crée une fiche sans commande (dépôt à venir, renseignement au comptoir) ; sélectionner un client ouvre sa fiche où le nom, le téléphone, l’e-mail, l’adresse et les préférences se modifient. La suppression d’une fiche est réservée au propriétaire : les commandes et leur historique restent conservés.
- **Stock** : créer un article, puis modifier son nom, sa catégorie, son unité, son seuil et son coût. Un article déjà mouvementé ne peut pas être supprimé : **archiver** le retire des mouvements sans effacer le journal. Les fournisseurs se modifient de la même façon ; un fournisseur déjà utilisé par une dépense se désactive au lieu de se supprimer.
- **Dépenses** : créer, corriger (bouton crayon sur la ligne) et supprimer une dépense. Le total du mois est recalculé côté serveur.
- **Équipe** (dans **Paramètres**) : le propriétaire rattache un collègue par son e-mail, change son rôle ou son nom affiché, ou le détache. Le dernier propriétaire du pressing ne peut pas être retiré. Le collègue doit avoir créé son compte au préalable ; aucun mot de passe ne circule dans cet écran.
- **Support** : clôturer une demande résolue sur place, ou retirer une demande encore ouverte (erreur de saisie).

Ces écrans de gestion dépendent du réseau, à l’exception de l’historique client calculé sur l’appareil. L’indicateur de connexion et de synchronisation signale si des données restent en attente.

## 8. Tableau de bord, rapports et audit

Le tableau de bord et les rapports présentent des indicateurs d’activité et de caisse selon les droits du compte. L’écran de rapports permet de consulter les périodes prises en charge et les exports proposés.

Le journal d’audit retrace les opérations de gestion enregistrées côté serveur. Il ne constitue pas un journal des événements qui n’ont jamais été synchronisés depuis un appareil hors ligne.

## 9. Comprendre l’état hors ligne

- **En ligne / synchronisé** : aucune donnée connue n’attend l’envoi.
- **En attente** : les changements locaux seront envoyés à la prochaine connexion.
- **Conflit** : une version distante a changé ; l’application attend un arbitrage humain.
- **Erreur** : consulter le message associé, vérifier la connexion et demander de l’aide au propriétaire si l’envoi ne reprend pas.

Ne pas effacer les données du navigateur ni désinstaller l’application tant qu’une commande, un paiement ou une réclamation est en attente de synchronisation.

## 10. Limites actuelles

- Aucun catalogue partagé ni modèle de prix au kilo/forfait : renseigner les montants manuellement.
- Le navigateur doit avoir déjà chargé l’application et les données nécessaires avant une utilisation hors ligne.
- Les paiements réels nécessitent un projet Supabase et une configuration CinetPay valides.
- Les interfaces de gestion ne sont pas toutes disponibles hors ligne.
- Les opérations sensibles et les données entre pressings restent soumises à la configuration effective des politiques serveur.
