Voici le prompt master d’implémentation de PRESSPRO, conçu pour être transmis directement à ton agent IA dans VS Code, Cursor, Claude Code ou un autre agent capable d’analyser et de modifier un dépôt Git.

Il est orienté vers un objectif précis : transformer ton idée métier en un module fonctionnel de gestion des pressings et blanchisseries, intégré à l’architecture existante, avec une base de données cohérente, une interface claire et un workflow de réception et de facturation fiable.

# PROMPT MASTER — PRESSPRO

## Implémentation du système de gestion des pressings professionnels et des blanchisseries artisanales

**Dépôt cible :** [https://github.com/ErwinsS225/PRESSPRO.git](https://github.com/ErwinsS225/PRESSPRO.git)

**Objectif :** développer et intégrer dans PRESSPRO un module complet de configuration des modèles de blanchisserie, de gestion des vêtements, des services, des prestations, des tarifs et des commandes de dépôt.

**Environnement métier :** pressings et blanchisseries en Côte d’Ivoire.

**Devise :** XOF (franc CFA).

**Résultat attendu :** une fonctionnalité réellement opérationnelle, intégrée à l’application existante, et non une simple maquette visuelle.

---

# 1. TON RÔLE ET TES RESPONSABILITÉS

Tu interviens en tant qu’ingénieur logiciel senior, architecte de bases de données relationnelles, développeur full-stack et spécialiste des processus opérationnels d’un pressing et d’une blanchisserie.

Tu dois analyser le dépôt existant, comprendre son architecture, concevoir les évolutions nécessaires, les implémenter, les tester et documenter les résultats.

Tu ne dois pas recommencer le projet à zéro.

Tu dois travailler sur le code existant de PRESSPRO, préserver les fonctionnalités opérationnelles et éviter toute régression.

Tu ne dois pas te limiter à produire un rapport ou une liste de recommandations. Après l’audit initial, tu dois réaliser les modifications nécessaires, dans les limites de l’environnement et des accès disponibles.

## Règles impératives

1. Examine le code existant avant de modifier quoi que ce soit.
2. Identifie le véritable système d’authentification, la structure multi-tenant, les migrations SQL, les modèles, les API et les composants frontend existants.
3. Réutilise les tables et composants qui remplissent déjà les fonctions nécessaires.
4. Ne crée aucune table, route, fonction ou composant en double sans justification.
5. Ne remplace pas Go par Node.js, ni une autre technologie par une nouvelle, si le backend existant fonctionne déjà avec cette technologie. Respecte la stack réellement présente dans le dépôt.
6. Si le fichier de référence `presspro_modele_pressing_blanchisserie.sql` est disponible dans l’environnement de travail, examine-le. Considère-le comme une proposition métier à vérifier et non comme un schéma définitif à importer aveuglément.
7. N’écrase aucune donnée existante et ne supprime aucune fonctionnalité opérationnelle sans migration et justification.
8. Toute donnée affichée comme enregistrée doit réellement être persistée en base de données.
9. Le serveur doit être responsable des validations, des autorisations et des calculs de prix.
10. N’affirme jamais qu’un test est réussi si tu ne l’as pas exécuté.
11. Si une ambiguïté métier subsiste, rends-la configurable lorsque cela est raisonnable et documente le choix retenu.
12. Ne t’arrête pas à la conception : va jusqu’à l’intégration et aux tests réalisables.

---

# 2. COMPRENDRE LE MODÈLE MÉTIER À IMPLÉMENTER

PRESSPRO doit gérer deux modèles d’exploitation distincts.

Ces deux modèles peuvent partager les mêmes clients, commandes, types de vêtements et infrastructures techniques. Toutefois, leurs méthodes de prestation et de tarification ne doivent pas être confondues.

Le propriétaire doit pouvoir choisir un modèle lors de la configuration initiale de son établissement, puis le faire évoluer selon les possibilités et règles prévues par l’application.

Prévoir trois configurations possibles :

- `PRESSING_PRO` : pressing professionnel.
- `BLANCHISSERIE` : blanchisserie artisanale.
- `MIXTE` : établissement qui propose les deux modèles.

Le modèle choisi influence les services disponibles, les méthodes de tarification, les champs de saisie et le parcours de réception. Il ne doit pas imposer un catalogue identique à tous les établissements.

## 2.1. Modèle A : pressing professionnel

Un pressing professionnel propose différentes prestations, notamment :

- Lavage seul.
- Lavage avec repassage.
- Repassage seul.
- Nettoyage à sec.
- Détachage.
- Amidonnage.
- Traitement des textiles délicats.
- Entretien de costumes et robes.
- Traitement spécialisé des vêtements.
- Lavage au kilogramme.
- Lavage avec repassage au kilogramme.
- Entretien du linge de maison.
- Traitement express.
- Emballage, collecte et livraison si l’établissement le propose.
- Autres prestations créées par le propriétaire.

Cette liste constitue une bibliothèque initiale. Elle ne doit pas devenir une liste fixe et impossible à personnaliser.

Chaque pressing doit pouvoir activer, désactiver, créer, modifier, dupliquer et archiver ses propres prestations.

### Tarification du pressing professionnel

Le propriétaire peut définir les prix selon plusieurs méthodes :

- Prix par pièce.
- Prix au kilogramme.
- Prix fixe par prestation.
- Tarification par tranches de poids.
- Prix sur devis pour une prestation spéciale.
- Éventuellement, forfait commercial composé de plusieurs prestations.

Exemples de tarifs configurables :

- Lavage au kilo : 1 600 FCFA/kg.
- Lavage avec repassage au kilo : 2 000 FCFA/kg.
- Repassage d’une chemise : tarif fixe configurable.
- Nettoyage à sec d’un costume : tarif propre à cet article et à cette prestation.

Ces montants servent à illustrer le fonctionnement. Ils ne doivent jamais être imposés à tous les pressings.

### Règle fondamentale

Le tarif au kilo est associé à une prestation et à une règle tarifaire appartenant au pressing.

Ne code jamais en dur un prix tel que `1600` ou `2000` dans le frontend, le backend ou le calculateur.

Le propriétaire doit pouvoir modifier le tarif sans intervention d’un développeur.

---

## 2.2. Modèle B : blanchisserie artisanale

La blanchisserie artisanale démarre avec deux prestations principales :

1. `WASH_ONLY` : lavage seul.
2. `WASH_IRON` : lavage avec repassage.

Ces prestations doivent être personnalisables et désactivables. Le propriétaire pourra ajouter d’autres prestations si son activité évolue.

Le fonctionnement tarifaire doit prendre en charge deux possibilités :

- Une facturation selon le nombre total de vêtements.
- Une facturation selon un forfait de nombre de vêtements.

Le besoin principal est le forfait par nombre de vêtements.

### Exemple commercial

Le propriétaire configure une offre :

- Nom : Forfait blanchisserie standard.
- Prestation : Lavage avec repassage.
- Nombre de vêtements inclus : 25.
- Prix total : 2 000 FCFA.

Il peut également configurer :

- Nom : Forfait économique.
- Nombre de vêtements inclus : 25.
- Prix total : 1 500 FCFA.

Ces forfaits doivent pouvoir être modifiés, désactivés, dupliqués ou archivés.

### Règle essentielle

Le forfait est déterminé par le nombre total de vêtements comptés, et non par leur catégorie.

Une chemise, un pantalon, un T-shirt, une robe et un autre vêtement admissible contribuent chacun au compteur selon la règle de comptage configurée.

Le logiciel ne doit pas appliquer automatiquement un tarif différent à une chemise et à un pantalon dans un forfait global lorsque le propriétaire a choisi un tarif identique pour tous les vêtements admissibles.

Toutefois, il doit conserver le détail des vêtements pour la traçabilité, la préparation du linge et la remise au client.

Exemple de dépôt :

| Type de vêtement | Quantité |
| ---------------- | -------- |
| Chemises         | 8        |
| Pantalons        | 6        |
| T-shirts         | 5        |
| Robes            | 3        |
| Autres vêtements | 3        |
| **Total**        | **25**   |

Le système compte 25 vêtements et applique le forfait de 2 000 FCFA.

Le montant est indépendant de la répartition par catégorie, tant que tous les articles sont admissibles au forfait sélectionné.

### Gestion impérative des quantités supérieures au forfait

Ne déduis jamais automatiquement la manière de facturer un dépassement.

Pour chaque modèle de tarification par quantité, prévoir une politique configurable, par exemple :

- `PER_EXTRA_ITEM` : facturer les vêtements supplémentaires selon un tarif unitaire défini.
- `REPEAT_PACKAGE` : appliquer un nouveau forfait pour chaque groupe supplémentaire, selon la règle configurée.
- `MANUAL_QUOTE` : demander un montant personnalisé validé par un utilisateur autorisé.
- `REJECT_OVER_LIMIT` : interdire le dépassement et demander une nouvelle configuration.

Prévoir aussi une règle explicite pour les quantités non multiples du nombre de vêtements du forfait.

Si le client dépose 30 vêtements pour un forfait de 25, le système ne doit ni ignorer les 5 vêtements supplémentaires ni inventer une facturation.

Il doit suivre la règle de dépassement configurée et afficher le détail du calcul avant validation.

Le propriétaire doit pouvoir définir la règle applicable depuis l’interface de configuration.

---

# 3. MODÉLISER CORRECTEMENT LES DONNÉES

Le modèle relationnel doit distinguer les concepts suivants.

### A. Catégorie de vêtement

Permet de regrouper les articles.

Exemples :

- Hauts.
- Bas.
- Costumes et ensembles.
- Robes et tenues.
- Sous-vêtements.
- Literie.
- Linge de maison.
- Rideaux.
- Linge professionnel.
- Textiles délicats.
- Accessoires.

### B. Type de vêtement

Représente un article concret.

Exemples :

- Chemise.
- T-shirt.
- Polo.
- Pantalon.
- Jean.
- Costume deux pièces.
- Costume trois pièces.
- Robe courte.
- Robe longue.
- Boubou.
- Tenue en bazin.
- Pagne.
- Drap.
- Couette.
- Serviette.
- Rideau.
- Uniforme professionnel.

Chaque type de vêtement doit pouvoir avoir un code, un nom, une catégorie, une description, une icône, un statut et des attributs nécessaires à son traitement.

Le catalogue doit être extensible. Le propriétaire doit pouvoir créer ses propres types de vêtements.

### C. Catégorie de prestation

Exemples :

- Lavage.
- Repassage.
- Nettoyage à sec.
- Détachage.
- Amidonnage.
- Traitement spécialisé.
- Express.
- Linge au kilo.
- Finition.
- Livraison.

### D. Prestation

Définit le service rendu au client.

Exemples :

- Lavage seul.
- Lavage avec repassage.
- Repassage seul.
- Nettoyage à sec.
- Détachage.
- Lavage au kilo.
- Lavage avec repassage au kilo.

Une prestation peut être associée à plusieurs types de vêtements et à des méthodes de tarification différentes selon sa configuration.

### E. Modèle de blanchisserie

Le modèle de blanchisserie regroupe une configuration de travail comprenant notamment :

- Le modèle d’exploitation.
- Les prestations proposées.
- Les types de vêtements admis.
- Les règles de tarification.
- Les forfaits disponibles.
- Les règles de dépassement.
- Les paramètres applicables lors de la réception.

Le propriétaire doit pouvoir créer son propre modèle, le modifier, le dupliquer, l’activer, le désactiver et l’archiver.

Chaque pressing doit disposer d’une configuration indépendante.

### F. Règle tarifaire

Une règle tarifaire définit comment le montant d’une ligne ou d’une commande est calculé.

Elle doit préciser :

- La méthode de tarification.
- Le prix.
- L’unité.
- Les seuils éventuels.
- Les paramètres de calcul.
- La règle d’arrondi.
- La période d’application si nécessaire.
- Le statut de la règle.

---

# 4. AUDIT DU DÉPÔT AVANT MODIFICATION

Commence par analyser le dépôt Git existant.

Identifie notamment :

1. Le backend réellement utilisé et sa structure.
2. Le frontend React/TypeScript et son système de navigation.
3. La base PostgreSQL et ses migrations existantes.
4. Les tables des tenants, des clients, des commandes, des lignes de commande et des paiements.
5. Les fonctionnalités existantes de catalogue, de prix et de modèles de blanchisserie.
6. Le module de dépôt et la génération des tickets.
7. Le système de rôles et d’autorisations.
8. Les limitations des plans SaaS.
9. Les tests et les outils de migration existants.

Cherche les composants et fichiers déjà liés à la gestion des dépôts, par exemple `NewOrderModal.tsx`, les clients API de commandes et les fonctions de persistance, si ces fichiers existent dans cette version du projet.

Ne te limite pas aux noms suggérés ici : recherche les véritables fichiers du dépôt.

### Livrable de l’audit

Produis un tableau avec :

- Fonctionnalité recherchée.
- Fichier ou table existante.
- État actuel.
- Modification nécessaire.
- Risque de régression.
- Tests à exécuter.

Après cet audit, poursuis l’implémentation en respectant la structure existante.

Ne bloque pas inutilement le travail sur une question déjà résolue par le code ou la configuration du projet.

---

# 5. CONCEVOIR ET IMPLÉMENTER LE SCHÉMA POSTGRESQL

Examine d’abord la base existante.

Réutilise les tables déjà disponibles lorsqu’elles répondent au besoin.

Crée uniquement les tables manquantes et les migrations nécessaires.

Selon le schéma existant, le modèle cible devra couvrir les entités suivantes, en les adaptant aux conventions du dépôt :

- Catégories d’articles.
- Types de vêtements.
- Catégories de prestations.
- Prestations.
- Associations entre prestations et vêtements.
- Tarifs par pièce.
- Règles tarifaires au kilogramme.
- Tranches de poids.
- Modèles de blanchisserie.
- Éléments appartenant aux modèles.
- Forfaits selon le nombre de vêtements.
- Commandes de dépôt.
- Lignes de commande.
- Détail des quantités par vêtement.
- Paiements et historique des montants, en réutilisant les tables existantes.

### Contraintes de base de données

1. Chaque donnée appartenant à un établissement doit être isolée par son tenant.
2. Les identifiants et les clés étrangères doivent respecter les conventions existantes.
3. Les codes métier doivent être uniques dans leur périmètre approprié.
4. Les montants XOF doivent être stockés sans erreur d’arrondi, par exemple en entier.
5. Les poids doivent être stockés en type décimal, et non en virgule flottante binaire.
6. Les quantités de vêtements doivent être des nombres entiers strictement positifs.
7. Les règles tarifaires doivent être validées afin d’éviter les tranches de poids contradictoires.
8. Les suppressions ne doivent pas détruire les références historiques.
9. Les migrations doivent être versionnées et respecter l’outil déjà utilisé dans le dépôt.
10. Les données initiales doivent être insérées de manière idempotente : réexécuter le seed ne doit pas créer de doublons.

Ne crée pas une deuxième table de commandes si une structure opérationnelle existe déjà.

### Séparation des données système et des données personnalisées

Prévoir une bibliothèque initiale de catégories, de vêtements et de prestations communes.

Cependant, une donnée système ne doit pas devenir un objet mutable partagé directement entre tous les pressings.

Quand un pressing utilise un modèle standard, copie les données et crée des identifiants indépendants pour ce tenant.

Les modifications de son catalogue ne doivent jamais modifier celui des autres établissements.

Les modèles globaux doivent être protégés contre toute modification par un utilisateur tenant.

### Tarification et historique

Toute commande validée doit conserver un instantané des valeurs nécessaires à sa compréhension :

- Libellé de l’article.
- Libellé de la prestation.
- Quantité.
- Poids si applicable.
- Unité de facturation.
- Prix unitaire ou prix par kilogramme si pertinent.
- Nombre de vêtements inclus dans le forfait.
- Prix du forfait.
- Éventuels suppléments et réductions.
- Montant total calculé.
- Identifiant et version de la règle tarifaire lorsque cela est pertinent.

Une modification ultérieure du catalogue ne doit pas modifier une ancienne commande ou un ancien ticket.

---

# 6. DÉVELOPPER LE MOTEUR DE TARIFICATION

Le calcul tarifaire doit être un module métier clairement séparé de l’interface.

Il reçoit des données validées, applique la règle choisie et retourne un détail de calcul exploitable par la caisse.

## 6.1. Tarification par pièce

Exemple :

3 chemises × 800 FCFA = 2 400 FCFA.

Le tarif vient du catalogue ou de la règle tarifaire applicable. Il ne doit pas provenir d’une valeur libre envoyée par le frontend sans vérification.

## 6.2. Tarification au kilogramme

Exemple :

5 kg × 1 600 FCFA/kg = 8 000 FCFA.

Le moteur doit prendre en charge les poids décimaux, les unités, les seuils et la règle d’arrondi configurée.

Il doit distinguer explicitement deux stratégies lorsque les tranches sont utilisées :

- `FLAT_RATE` : le poids total détermine une tranche et le tarif de cette tranche s’applique à tout le poids.
- `PROGRESSIVE_TIERS` : chaque portion du poids est facturée selon la tranche correspondante.

Le choix de la stratégie appartient à la configuration tarifaire.

Ne mélange pas ces deux calculs.

## 6.3. Tarification selon le nombre de vêtements

Exemple :

25 vêtements × forfait configuré = prix global configuré.

Pour cette méthode, le calcul ne doit pas dépendre de la catégorie de vêtement si le modèle commercial prévoit un tarif uniforme pour tous les vêtements admissibles.

Le système compte les quantités de toutes les catégories incluses.

Formule de comptage :

`total_garments = somme des quantités de vêtements admissibles`

Le nombre de vêtements et le prix global sont des informations distinctes.

Un forfait de 25 vêtements pour 2 000 FCFA ne signifie pas que chaque vêtement coûte 80 FCFA dans le catalogue. Il s’agit d’un forfait commercial, et non nécessairement d’un tarif unitaire.

Le détail du forfait doit être conservé dans la commande.

## 6.4. Mélange de prestations

Une commande peut contenir plusieurs lignes si le workflow existant le permet.

Par exemple, certains articles peuvent relever du lavage seul et d’autres du lavage avec repassage.

Lorsqu’un forfait est appliqué, le système doit identifier exactement quelles lignes et quelles quantités sont incluses dans ce forfait.

Un vêtement ne doit pas être facturé deux fois par erreur, à la fois dans le forfait et comme prestation individuelle, sauf si cette facturation correspond explicitement à une option autorisée.

---

# 7. IMPLÉMENTER LE WORKFLOW DE RÉCEPTION

Le workflow doit être utilisable rapidement au comptoir par un réceptionniste.

## Étape 1 — Sélection de l’établissement et du modèle

Le système connaît le tenant à travers l’utilisateur authentifié et le contexte de l’établissement.

Il récupère la configuration active :

- Pressing professionnel.
- Blanchisserie artisanale.
- Modèle mixte.

L’utilisateur ne doit pas pouvoir changer arbitrairement le tenant simplement en modifiant une valeur envoyée par le navigateur.

## Étape 2 — Sélection ou création du client

Le réceptionniste recherche un client existant ou en crée un nouveau selon le formulaire déjà présent dans PRESSPRO.

Réutilise le module client opérationnel.

## Étape 3 — Sélection des prestations

Pour un pressing professionnel, afficher les prestations activées par l’établissement : lavage, repassage, nettoyage à sec, etc.

Pour une blanchisserie artisanale, afficher notamment :

- Lavage seul.
- Lavage avec repassage.

Les prestations réellement proposées dépendent du catalogue configuré. Ne rends pas obligatoires des services que le propriétaire a désactivés.

## Étape 4 — Enregistrement du linge

### Cas A : pressing professionnel au kilo

Le réceptionniste choisit la prestation, saisit le poids mesuré et ajoute les informations nécessaires.

Le serveur identifie la règle tarifaire et calcule le montant.

### Cas B : pressing professionnel à la pièce

Le réceptionniste choisit chaque type de vêtement, la prestation et la quantité.

Le prix applicable est recherché dans le catalogue.

### Cas C : blanchisserie au nombre de vêtements

Le réceptionniste sélectionne ou compte les vêtements par catégorie.

Exemple :

- 8 chemises.
- 6 pantalons.
- 5 T-shirts.
- 3 robes.
- 3 autres articles.

Le système calcule 25 vêtements.

Il recherche ensuite les forfaits actifs compatibles avec le service sélectionné et la quantité totale.

Le tarif doit être calculé en fonction du forfait retenu et de sa politique de dépassement.

Le détail des vêtements reste enregistré, même si leurs catégories ne déterminent pas le montant facturé.

## Étape 5 — Simulation et validation du prix

Avant de confirmer le dépôt, afficher clairement :

- Les prestations.
- Les quantités par type de vêtement.
- Le poids si applicable.
- Le forfait sélectionné.
- Les suppléments.
- Les réductions.
- Le sous-total.
- Le total final.

Le serveur doit recalculer le montant et retourner le détail validé.

Ne considère jamais le total fourni par le navigateur comme une source de vérité.

Si la règle tarifaire est absente ou incohérente, bloquer la confirmation et indiquer ce que l’utilisateur doit corriger.

## Étape 6 — Création de la commande

À la validation :

1. Vérifier les droits et le tenant.
2. Vérifier la disponibilité des prestations.
3. Revalider les quantités, les poids et les règles tarifaires.
4. Calculer le montant final côté serveur.
5. Enregistrer la commande et ses lignes dans une transaction.
6. Conserver les instantanés des articles et des prix.
7. Enregistrer le paiement si un paiement est effectivement effectué et utiliser le mécanisme de paiement existant.
8. Générer le numéro de dépôt selon la convention de PRESSPRO.
9. Générer le ticket avec les données historisées.

Une erreur pendant la création ne doit pas laisser de commande à moitié enregistrée.

La création de commande et l’écriture de ses lignes doivent être transactionnelles.

## Étape 7 — Ticket de dépôt

Réutilise le mécanisme d’impression existant.

Le ticket doit pouvoir afficher :

- L’identité du pressing.
- Le numéro de dépôt.
- Le client.
- La date.
- Le détail des vêtements.
- Les prestations.
- Le nombre total de vêtements ou le poids selon le modèle.
- Le forfait sélectionné si applicable.
- Le prix détaillé.
- Le montant total.
- Le montant payé et le solde restant si le système gère ces notions.
- Les informations utiles à la restitution du linge.

Préserve la compatibilité avec l’impression thermique de 80 mm si elle est déjà prise en charge.

---

# 8. ENDPOINTS API À IMPLÉMENTER

Avant d’ajouter des routes, vérifie si des endpoints équivalents existent déjà.

Adapte ensuite les nouveaux endpoints à la convention de versionnement, au routeur, aux middlewares et au format de réponse du projet.

Le contrat fonctionnel doit couvrir :

### Configuration des modèles

- Lister les modèles disponibles.
- Obtenir le détail d’un modèle.
- Créer un modèle personnalisé.
- Modifier un modèle.
- Dupliquer un modèle.
- Activer ou désactiver un modèle.
- Archiver un modèle.
- Importer une copie d’un modèle standard.

### Types de vêtements

- Lister les catégories.
- Lister les types de vêtements.
- Rechercher et filtrer les vêtements.
- Créer un type de vêtement.
- Modifier un type de vêtement.
- Désactiver ou archiver un type de vêtement.

### Prestations

- Lister les catégories de prestations.
- Lister les prestations.
- Créer une prestation.
- Modifier une prestation.
- Associer une prestation à des types de vêtements.
- Configurer les prix applicables.
- Configurer les règles au kilo.
- Configurer un forfait par nombre de vêtements.
- Désactiver ou archiver une prestation.

### Tarification

- Obtenir les tarifs applicables.
- Créer ou modifier une règle tarifaire.
- Configurer les tranches de poids.
- Configurer un forfait de quantité.
- Configurer la politique de dépassement.
- Simuler le prix d’une prestation ou d’une commande.
- Retourner un détail du calcul.

### Commandes

Réutiliser les endpoints de dépôt et de commande existants.

Les adapter seulement lorsqu’ils ne prennent pas en charge les nouvelles données nécessaires.

Le contrat doit permettre d’envoyer le détail des vêtements, la prestation, la quantité ou le poids, ainsi que la référence du forfait sélectionné.

Le serveur doit identifier les tarifs applicables, recalculer les totaux et enregistrer l’historique.

Ne crée pas une deuxième API de commande indépendante de celle déjà utilisée par l’application.

---

# 9. INTERFACE REACT/TYPESCRIPT

Implémente les écrans avec le design system existant.

N’introduis pas une nouvelle bibliothèque graphique si les composants du projet sont déjà suffisants.

## Écran A — Paramétrage de l’établissement

Permet au propriétaire de choisir son modèle d’exploitation :

- Pressing professionnel.
- Blanchisserie artisanale.
- Modèle mixte.

Affiche une explication des différences.

Le changement de modèle doit être traité comme une modification de configuration, pas comme une opération qui supprime les données existantes.

Si des prestations ou des règles deviennent incompatibles, avertis l’utilisateur et propose une migration ou une désactivation contrôlée.

## Écran B — Catalogue des vêtements

Fonctionnalités :

- Affichage des catégories.
- Recherche.
- Création d’un type de vêtement.
- Modification.
- Activation et désactivation.
- Configuration de l’icône.
- Gestion des textiles délicats si pertinent.

## Écran C — Catalogue des prestations

Fonctionnalités :

- Liste des prestations.
- Catégorie.
- Mode de facturation.
- Prix ou méthode de calcul.
- Statut.
- Création, modification, duplication et archivage.
- Association avec les types de vêtements.

## Écran D — Configuration des tarifs

Le formulaire doit s’adapter au mode de tarification.

Pour une prestation au kilo : poids minimal, tranches, tarifs, stratégie de calcul et arrondi.

Pour une prestation par pièce : prix de base et éventuels prix spécifiques selon le vêtement.

Pour un forfait par nombre de vêtements : nombre inclus, prix global, prestations admises et règle de dépassement.

Pour une prestation sur devis : validation manuelle du montant avant confirmation.

Ne présente jamais une valeur manquante comme un prix de zéro franc.

## Écran E — Modèles de blanchisserie

Le propriétaire doit pouvoir :

- Voir les modèles disponibles.
- Créer son propre modèle.
- Choisir les services.
- Associer les vêtements.
- Configurer les méthodes de tarification.
- Configurer les forfaits.
- Modifier ou dupliquer son modèle.
- Activer un modèle ou en archiver un autre.

Une modification de modèle ne doit pas altérer les commandes déjà enregistrées.

## Écran F — Réception et dépôt

Il s’agit de l’écran le plus important pour le workflow.

Il doit rester rapide, lisible et utilisable au comptoir.

Pour la blanchisserie au nombre de vêtements :

- Afficher les catégories de vêtements.
- Permettre d’ajouter rapidement une quantité par catégorie.
- Afficher le total général en temps réel.
- Afficher les forfaits compatibles.
- Afficher le détail du prix retourné par le serveur.
- Signaler clairement les vêtements non admissibles à un forfait.

Pour le pressing professionnel :

- Permettre la saisie des vêtements à la pièce ou des poids.
- Afficher les prestations applicables.
- Calculer et présenter les sous-totaux.
- Empêcher la confirmation si une règle tarifaire est manquante.

Ne crée pas de deuxième interface de dépôt si l’application en possède déjà une. Fais évoluer la fonctionnalité existante.

---

# 10. SÉCURITÉ ET MULTI-TENANT

Toutes les données du catalogue, des modèles, des tarifs et des commandes doivent être correctement isolées entre établissements.

Pour chaque endpoint, vérifier que l’utilisateur a le droit d’accéder à l’objet concerné.

Un tenant ne peut pas lire, modifier ou supprimer les données d’un autre tenant en utilisant simplement un identifiant UUID connu.

Les prix ne doivent pas être modifiables en contournant les contrôles du backend.

Toute modification importante de catalogue ou de tarif doit pouvoir être auditée selon les capacités existantes du projet.

Respecte également les limites des plans d’abonnement existants de PRESSPRO.

Si la création d’un nouveau service ou modèle est soumise à une limite de plan :

- Vérifie cette limite côté serveur.
- Refuse uniquement l’opération non autorisée.
- Préserve les données déjà enregistrées.
- Retourne une erreur exploitable par le frontend.

N’implémente pas un nouveau système d’abonnement si celui-ci existe déjà.

---

# 11. TESTS D’ACCEPTATION OBLIGATOIRES

Tu dois créer ou adapter les tests automatisés nécessaires.

## A. Modèles et catalogue

**CAT-001 :** un propriétaire peut créer un modèle de blanchisserie personnalisé.

**CAT-002 :** un propriétaire peut ajouter une prestation de lavage avec repassage.

**CAT-003 :** un propriétaire peut créer un type de vêtement.

**CAT-004 :** un propriétaire peut modifier le tarif d’un service sans modifier les anciens dépôts.

**CAT-005 :** le même code métier peut être utilisé par deux tenants différents si le schéma le permet, sans partager leurs données.

**CAT-006 :** les données du catalogue standard ne peuvent pas être modifiées directement par un tenant.

**CAT-007 :** l’import d’un modèle standard produit une copie indépendante.

**CAT-008 :** les seeds sont idempotents.

## B. Blanchisserie au nombre de vêtements

**BL-001 :** saisir 8 chemises, 6 pantalons, 5 T-shirts, 3 robes et 3 autres vêtements donne un total de 25.

**BL-002 :** avec le forfait configuré de 25 vêtements à 2 000 FCFA, le total est de 2 000 FCFA.

**BL-003 :** avec un forfait de 25 vêtements à 1 500 FCFA, le total est de 1 500 FCFA.

**BL-004 :** modifier la répartition des catégories sans modifier le total de 25 ne change pas le prix, lorsque le forfait considère toutes ces catégories comme admissibles.

**BL-005 :** une quantité négative, nulle lorsqu’un article est saisi, ou non entière est rejetée.

**BL-006 :** une commande de 30 vêtements applique exactement la politique de dépassement configurée.

**BL-007 :** si la politique de dépassement exige un montant manuel, la commande ne peut pas être confirmée sans ce montant.

**BL-008 :** le détail des vêtements est conservé même si le montant est calculé globalement.

**BL-009 :** la commande affiche clairement le forfait appliqué, le nombre inclus et le nombre supplémentaire si applicable.

**BL-010 :** un même vêtement ne peut pas être compté deux fois par accident dans la somme des quantités d’un forfait.

## C. Pressing professionnel

**PRO-001 :** 5 kg à 1 600 FCFA/kg donnent 8 000 FCFA.

**PRO-002 :** une prestation au kilo peut avoir un tarif différent d’une prestation au kilo avec repassage.

**PRO-003 :** le propriétaire peut créer et désactiver une prestation de détachage.

**PRO-004 :** le propriétaire peut configurer l’amidonnage sans modifier le catalogue d’un autre tenant.

**PRO-005 :** la saisie d’un poids invalide est rejetée.

**PRO-006 :** les tranches de poids qui se chevauchent sont rejetées.

**PRO-007 :** les modes `FLAT_RATE` et `PROGRESSIVE_TIERS` donnent des résultats conformes à leurs définitions respectives.

**PRO-008 :** une prestation sur devis ne peut pas être facturée automatiquement sans prix validé.

**PRO-009 :** une prestation sans règle tarifaire valide ne permet pas de confirmer la commande.

## D. Commandes et historique

**ORD-001 :** la réception enregistre les quantités de vêtements et les prestations sélectionnées.

**ORD-002 :** le serveur recalcule le total avant validation.

**ORD-003 :** le client ne peut pas imposer un total arbitraire en modifiant la requête frontend.

**ORD-004 :** l’enregistrement de la commande et de ses lignes est atomique.

**ORD-005 :** une panne pendant l’enregistrement ne laisse pas de commande partielle non maîtrisée.

**ORD-006 :** les anciennes commandes conservent leurs tarifs après une modification du catalogue.

**ORD-007 :** les paiements et le solde restent cohérents avec le système de paiement existant.

**ORD-008 :** le ticket reprend les données historisées.

## E. Sécurité et interface

**SEC-001 :** un tenant ne peut pas consulter les vêtements ou tarifs d’un autre tenant.

**SEC-002 :** un utilisateur sans permission ne peut pas modifier le catalogue.

**SEC-003 :** les règles tarifaires et les limites d’abonnement sont validées côté serveur.

**UI-001 :** chaque formulaire affiche ses erreurs et empêche une sauvegarde invalide.

**UI-002 :** une erreur réseau n’affiche pas un faux message de succès.

**UI-003 :** les montants et quantités affichés sont cohérents avec la réponse du backend.

**UI-004 :** le workflow de réception reste utilisable avec une souris et un clavier.

**INT-001 :** le parcours complet création du catalogue → dépôt → calcul → validation → ticket fonctionne avec la base PostgreSQL réelle.

Tu peux ajouter des cas de test supplémentaires après l’audit.

Tous les tests existants doivent également être exécutés pour vérifier l’absence de régression.

---

# 12. MÉTHODE D’IMPLÉMENTATION

Découpe le travail en phases indépendantes et vérifiables.

## Phase 1 — Audit

- Examiner le dépôt.
- Identifier les composants existants.
- Identifier les migrations et tables concernées.
- Déterminer les modifications nécessaires.
- Rédiger un rapport de compatibilité concis.

Ne modifie pas encore les tables avant cette analyse.

## Phase 2 — Base de données

- Créer les migrations additives.
- Ajouter ou adapter les tables.
- Ajouter les index et contraintes.
- Préparer les catégories, types de vêtements et prestations initiales.
- Vérifier les contraintes multi-tenant.
- Exécuter les tests de migration.

## Phase 3 — Backend

- Implémenter le modèle métier.
- Implémenter les repositories et services.
- Implémenter ou adapter les endpoints.
- Ajouter les validations.
- Créer le moteur de tarification.
- Intégrer les permissions et les limites de plan.
- Ajouter les tests unitaires et d’intégration.

## Phase 4 — Frontend

- Créer ou adapter les écrans de configuration.
- Connecter les écrans à l’API réelle.
- Gérer les erreurs, les états de chargement et les sauvegardes.
- Ajouter les tests frontend.
- Vérifier le comportement sur les petits écrans si l’application le permet.

## Phase 5 — Intégration du workflow

- Connecter les prestations et les forfaits au module de dépôt existant.
- Enregistrer le détail des vêtements.
- Faire calculer les prix par le backend.
- Persister les instantanés tarifaires.
- Vérifier le paiement, le ticket et la restitution selon le workflow existant.

## Phase 6 — Validation finale

- Exécuter les tests backend.
- Exécuter les tests frontend.
- Exécuter les tests d’intégration PostgreSQL.
- Exécuter les tests de sécurité multi-tenant.
- Vérifier les migrations sur une base de test.
- Vérifier la compilation du projet.
- Vérifier les fonctionnalités existantes de dépôt, paiement, impression et abonnement.
- Corriger les erreurs découvertes.
- Fournir le rapport final.

Ne déclare pas une phase terminée si les vérifications correspondantes n’ont pas été effectuées.

---

# 13. CRITÈRES DE LIVRAISON

Le travail est considéré comme terminé lorsque :

1. Les deux modèles d’exploitation fonctionnent.
2. Le modèle mixte peut proposer les deux systèmes sans mélanger leurs méthodes de calcul.
3. Les prestations sont configurables par établissement.
4. Les vêtements peuvent être enregistrés en quantité par catégorie.
5. Le modèle blanchisserie facture selon le nombre de vêtements inclus dans un forfait configuré.
6. Le modèle pressing professionnel gère les prestations à la pièce et au kilogramme prévues.
7. Les politiques de dépassement sont explicites et fonctionnelles.
8. Les prix et les règles sont modifiables sans changer le code.
9. Les commandes conservent le détail du linge et le prix effectivement appliqué.
10. Les données de chaque tenant sont isolées.
11. Les limites d’abonnement existantes sont respectées.
12. Les écrans sont connectés aux véritables endpoints.
13. Les commandes peuvent être créées, persistées et imprimées avec le workflow existant.
14. Les tests d’acceptation sont automatisés et leurs résultats sont documentés.
15. Aucun test existant n’a été supprimé pour masquer une régression.
16. Les migrations, les nouveaux fichiers, les choix techniques et les instructions de lancement sont documentés.

---

# 14. FORMAT DU RAPPORT FINAL

À la fin du travail, fournis obligatoirement :

### A. Audit initial

- Architecture découverte.
- Tables réutilisées.
- Tables créées ou adaptées.
- Risques identifiés et décisions prises.

### B. Modifications effectuées

- Liste des fichiers créés et modifiés.
- Résumé des modifications de base de données.
- Liste des endpoints ajoutés ou adaptés.
- Liste des écrans et composants concernés.

### C. Résultats des tests

Pour chaque commande exécutée, indique :

- La commande.
- Le résultat réel.
- Les tests réussis.
- Les tests échoués.
- Les vérifications non exécutées.

### D. Instructions de validation manuelle

Donne les étapes exactes pour vérifier dans l’application :

1. La création d’un modèle blanchisserie.
2. La création d’un forfait de 25 vêtements à 2 000 FCFA.
3. L’enregistrement d’un dépôt de 25 vêtements de catégories différentes.
4. La vérification du prix total.
5. L’enregistrement du dépôt et l’impression du ticket.
6. La configuration d’une prestation de pressing au kilo à 1 600 FCFA/kg.
7. La création d’un dépôt de 5 kg et la vérification du total de 8 000 FCFA.
8. La vérification qu’un autre tenant n’a pas accès au catalogue.
9. La vérification qu’une modification tarifaire ne change pas les anciennes commandes.

### E. État final

Conclure par l’un des états suivants :

- **TERMINÉ ET TESTÉ** : toutes les vérifications obligatoires ont été exécutées avec succès.
- **IMPLÉMENTÉ, VALIDATION INCOMPLÈTE** : le code est réalisé, mais certaines vérifications restent à effectuer.
- **BLOQUÉ** : une dépendance ou une contrainte empêche de terminer, avec une explication précise et les éléments déjà réalisés.

Ne prétends jamais qu’une fonctionnalité est opérationnelle uniquement parce que son interface a été créée.

---

# INSTRUCTION FINALE

Commence maintenant par auditer le dépôt PRESSPRO et identifier les fichiers réellement concernés.

Ensuite, implémente progressivement le système complet de gestion des modèles de pressing et blanchisserie, de leurs prestations, de leurs vêtements, des forfaits et du calcul de prix.

Conserve l’architecture et les fonctionnalités existantes. Privilégie les migrations additives, les modifications ciblées et les tests automatisés.

L’objectif n’est pas simplement d’enregistrer des prix dans une base de données. L’objectif est d’obtenir un workflow de réception fiable, où le réceptionniste sait exactement quel service appliquer, comment compter les vêtements, quelle règle tarifaire utiliser, quel montant annoncer au client et quelles informations conserver pour le traitement et la restitution du linge.

Commence par l’audit, puis avance jusqu’à une implémentation réellement testée, sans inventer de résultats et sans t’arrêter à une simple proposition d’architecture.

## Comment utiliser ce prompt

Transmets le prompt à ton agent IA depuis la racine du dépôt PRESSPRO, avec accès au code et à la base PostgreSQL de développement.

Le point essentiel est de lui faire commencer par l’audit du projet avant les migrations. Cela évite qu’il crée une seconde structure de commandes, de vêtements ou de prestations alors qu’une partie existe peut-être déjà.

Le premier test métier à exiger est simple : créer un forfait de 25 vêtements à 2 000 FCFA, enregistrer 25 vêtements de catégories différentes et vérifier que le dépôt est enregistré avec le bon total et le détail de tous les vêtements. Le deuxième test est de créer un service au kilo à 1 600 FCFA/kg, saisir 5 kg et obtenir 8 000 FCFA. Si ces deux parcours fonctionnent réellement de bout en bout, tu auras validé les deux fondations du système tarifaire.
