# Catalogue et formules commerciales — décisions de conception

## Décisions validées

- Le catalogue recommandé est copié dans chaque nouveau pressing, sans aucun tarif. Le propriétaire peut renommer, archiver, déplacer ou compléter ses copies.
- Les forfaits choisissent une base explicite : poids en kg ou nombre de pièces.
- La première version fournit des modèles professionnels réutilisables. Les contrats négociés individuellement avec chaque entreprise seront ajoutés ensuite.
- Une prestation composée reste une ligne commerciale unique. Les opérations de nettoyage et de finition sont conservées séparément pour l'atelier.
- Un forfait famille conserve sa composition : articles et quantités des pièces prises en charge, sans perdre le prix global du forfait.
- La réinitialisation des données métier distantes a été demandée séparément. Elle ne fait pas partie des migrations structurelles locales et ne doit pas supprimer les comptes, les pressings ou les paramètres de sécurité.

## Modèle métier

```text
Modèle de famille → Famille du pressing → Article du pressing → alias de recherche
Modèle de prestation → Prestation du pressing → opérations de l'atelier
Article + prestation → tarif (absent tant que le propriétaire ne l'a pas défini)
Modèle commercial → prestations incluses/supplémentaires + périmètre d'articles
Commande → lignes et instantanés du modèle / tarif réellement vendu
Forfait famille sur commande → ligne tarifée + composition détaillée des vêtements
Entreprise → modèle professionnel réutilisable (contrat nominatif ultérieur)
```

Les familles et articles initiaux sont des suggestions de saisie, pas un référentiel mondial imposé. Chaque tenant possède ses propres copies. Les alias facilitent les recherches locales (« t-shirt », « tee shirt », « grand boubou ») sans multiplier les articles ni confondre les termes locaux.

## Taxonomie de départ sans prix

Familles proposées :

- Hauts : tee-shirt, polo, chemise, blouse, pull.
- Bas : pantalon, jean, short, jupe.
- Robes et ensembles : robe, veste, costume, ensemble tailleur.
- Tenues traditionnelles : boubou, grand boubou, kaba, caftan, pagne / tenue en pagne.
- Linge de maison : drap, taie, nappe, rideau, couverture, couette.
- Accessoires et pièces spéciales : cravate, foulard, chaussures, sac.

Prestations proposées : lavage et repassage, lavage seul, repassage seul, nettoyage à sec, nettoyage délicat, détachage, amidonnage, repassage vapeur, express, collecte, livraison et retouches. Le pressing configure les prix et peut désactiver les prestations qu'il ne propose pas.

Les prestations sont les offres visibles au client; leurs opérations internes guidant l'atelier (`WASH`, `DRY`, `IRON`, `STAIN_TREATMENT`, `FOLD`, `DRY_CLEAN`, `REPAIR`, `PACK`) sont conservées séparément. Elles ne déclenchent pas de consommation de stock automatique.

## Formules de poids et forfaits famille

- Au kilo : mesure du poids réel, minimum et incrément éventuels, prix/kg et minimum de facturation.
- Forfait de poids : prix de base, poids compris, règle de dépassement en FCFA/kg.
- Forfait famille : prix global, quantité de pièces comprise, périmètre d'articles éligibles et tarif ou validation des pièces supplémentaires.
- Modèles professionnels réutilisables : audience et règles communes; un contrat nominatif, son échéance et sa facturation récurrente restent une phase séparée.

Un forfait famille est vendu comme une ligne globale mais sa composition est stockée dans une table fille. Les noms d'articles, quantités, instructions et opérations sont figés à la commande. Ainsi, l'atelier voit les pièces et le reçu/facture garde un prix global.

## Invariants de données

1. Toute référence client porte un `tenant_id`; les relations croisées tenant sont interdites par FKs composites et RLS.
2. Les modèles globaux sont en lecture seule pour les pressings. Leur application clone des références tenant-scoped; elle n'écrase jamais une personnalisation et ne crée aucun prix.
3. Une même prestation peut correspondre à plusieurs opérations internes; les opérations ne sont pas facturées deux fois par défaut.
4. Les tarifs et modèles doivent être explicitement configurés avant leur proposition en commande.
5. Les commandes figent libellés, quantités, unités, tarifs, opérations, périmètre et conditions; une édition future du catalogue ne réécrit pas l'historique.
6. Toute réinitialisation distante efface les données métier seulement après validation de la liste précise des tables; elle conserve comptes Auth, pressings, membres, rôles, plans et configuration.

## État d'implémentation local

La migration `019_catalogue_commercial_models.sql` ajoute des modèles génériques de catalogue sans prix, une bibliothèque de modèles professionnels sans colonnes de prix et leurs RPC de clonage/configuration, un import idempotent par propriétaire (initialisé au premier accès au catalogue quand il est vide), des alias tenant-scoped, et les opérations d'atelier attachées aux prestations. Les modèles `FAMILY_PACKAGE` sont facturés à la pièce : une ligne garde le prix global, tandis que les tables filles conservent les articles, quantités et instantanés d'opérations. Un RPC crée ligne et composition dans une transaction unique; les déclencheurs valident le périmètre et le calcul global. Les fonctions d'édition n'acceptent que le tenant courant.

L'interface de configuration, la réception, les instantanés hors ligne, la synchronisation et l'affichage du reçu/détail sont intégrés. Le schéma a été appliqué au projet Supabase `Pressing_Pro` le 24 octobre 2026 (migration `catalogue_commercial_models`, version `20261024195229`) après avoir comparé les contraintes existantes. Les vérifications SQL correspondantes restent dans `supabase/tests/catalogue_commercial_models.sql` et dans `scripts/sql-verify.sh`; elles n'ont pas été rejouées sur une base PostgreSQL locale dans cet environnement. Aucune purge n'a été faite : les deux commandes et les deux lignes existantes ont été conservées, et aucune donnée de forfait de démonstration n'a été insérée.

## Déploiement progressif

1. Schéma, templates sans prix, opérations, alias, RPC idempotent de clonage et RLS — appliqués au projet distant.
2. Référentiel et interface d'import/édition; tarifs saisis par les propriétaires — intégrés.
3. Formules famille/poids, composition de forfait et validation serveur; instantanés et affichage dans les commandes/reçus — intégrés et déployés.
4. Contrats individualisés d'entreprise — restent à définir, après validation de leur facturation, échéances et volumes.

Toute nouvelle écriture Supabase reste limitée aux migrations explicitement autorisées. Aucune purge n'est incluse dans une demande de migration.
