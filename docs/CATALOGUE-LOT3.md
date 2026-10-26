# Catalogue — Lot 3 : forfaits au nombre de vêtements et modèle d’exploitation

Migration **030**, écran `/catalogue` (onglet « Forfaits »), mode
« Forfait (comptage) » de la nouvelle commande et réglage du modèle
d’exploitation dans `/parametres`.

Le Lot 3 met en œuvre les choix validés pour `STRUCTURATIONDB.md` :

- périmètre complet : forfaits au nombre de vêtements, modèle
  d’exploitation, écran de comptage, audit et documents ;
- modèle d’exploitation **doux** : il propose un mode de saisie par
  défaut, mais n’interdit jamais les autres modes ;
- politique de dépassement par défaut `PER_EXTRA_ITEM`, configurable
  forfait par forfait ;
- **tous les articles actifs du catalogue** peuvent être comptés dans un
  forfait. La composition d’un forfait reste indicative : elle peut
  pré-remplir le comptage, mais ne limite pas les articles admissibles.

## 1. Données ajoutées par la migration 030

### Pressing

`tenants.business_model` vaut `PRESSING_PRO`, `BLANCHISSERIE` ou `MIXTE`
(valeur par défaut). À la nouvelle commande :

- `BLANCHISSERIE` ouvre l’étape vêtements sur « Forfait (comptage) » ;
- `PRESSING_PRO` et `MIXTE` ouvrent sur « À la pièce / au kilo » ;
- l’opérateur peut toujours changer de mode pour un dépôt donné.

### Forfaits commerciaux

`commercial_packages` reçoit :

- `tenant_service_id` : prestation imposée par l’offre, ou `NULL` si elle
  est choisie au dépôt ;
- `garments_included` : nombre de vêtements inclus, entier de 1 à 10 000.
  `NULL` conserve un ancien forfait global sans tarif au comptage ;
- `overflow_policy` : politique appliquée au-delà du nombre inclus ;
- `overflow_unit_price_xof` : prix d’un vêtement supplémentaire pour
  `PER_EXTRA_ITEM`.

Les anciens forfaits reçoivent la politique par défaut
`PER_EXTRA_ITEM`, mais leur `garments_included` reste `NULL` : ils ne
changent donc pas de prix et ne deviennent pas automatiquement des
forfaits au comptage.

### Lignes de commande

Un forfait vendu n’est jamais transformé en prix unitaire par article.
Il est représenté par :

1. **une ligne porteuse** (`commercial_package_id`) qui porte le seul
   montant facturé, le nombre total de vêtements et le résumé du devis
   dans `conditions_snapshot` ;
2. **une ligne de détail par article compté** (`package_line_id`), avec
   sa quantité réelle et un prix de 0 FCFA.

La clé composite différée entre détail et porteuse garantit qu’ils
appartiennent à la même commande et au même pressing, y compris lors
d’un envoi groupé hors ligne.

## 2. Calcul du prix

Le calcul serveur `compute_package_price` et son miroir client
`src/lib/prixForfait.ts` ne dépendent que du **nombre total** de
vêtements. La répartition entre chemises, pantalons, robes ou autres
articles actifs ne change pas le montant.

Exemple de test : forfait de 25 vêtements à 2 000 FCFA.

| Politique | 25 vêtements | 30 vêtements |
|---|---:|---:|
| `PER_EXTRA_ITEM` à 100 FCFA | 2 000 FCFA | 2 500 FCFA |
| `REPEAT_PACKAGE` | 2 000 FCFA | 4 000 FCFA (2 forfaits) |
| `REJECT_OVER_LIMIT` | 2 000 FCFA | refusé |
| `MANUAL_QUOTE` | 2 000 FCFA, sans saisie | montant total saisi et validé au comptoir |

`MANUAL_QUOTE` ne demande un montant que si le nombre inclus est
réellement dépassé. Lors d’une correction ultérieure qui maintient un
dépassement, le montant déjà validé est conservé ; si le comptage
revient dans la limite incluse, le prix de base redevient applicable.

Le RPC `quote_package_price(package, garments, manual_amount?)` expose
le même devis que la garde serveur. À la synchronisation, PostgreSQL
recalcule la porteuse et refuse un détail tarifé, un comptage fractionné,
un forfait archivé ou un dépassement interdit. Le client ne génère
aucun motif de prix automatique pour contourner ce contrôle.

## 3. Écrans

### Catalogue → Forfaits

Le propriétaire peut définir :

- le prix du forfait ;
- une prestation associée facultative ;
- le nombre de vêtements inclus (vide pour un forfait global) ;
- la politique de dépassement et, si nécessaire, le prix du vêtement
  supplémentaire ;
- une composition indicative.

Un simulateur montre le montant pour un comptage donné, y compris le
montant manuel requis en cas de dépassement `MANUAL_QUOTE`.

Seuls les forfaits actifs et correctement configurés avec un nombre
inclus sont proposés dans le mode comptage.

### Nouvelle commande → Forfait (comptage)

L’opérateur choisit le forfait et la prestation (si l’offre ne l’impose
pas), puis compte les articles actifs par catégorie avec les boutons
+/− ou une saisie directe. Le total et le devis se mettent à jour en
temps réel. Le montant manuel n’apparaît qu’en dépassement réel d’un
forfait `MANUAL_QUOTE`.

### Paramètres

Le propriétaire choisit le modèle d’exploitation du pressing. Le choix
est conservé par boutique dans le store local et ne bloque aucun mode
de vente.

### Documents et fiche commande

Les détails comptés s’affichent avec la mention **« Inclus »** ou
**« inclus dans le forfait »**, jamais comme une vente autonome à
0 FCFA : reçu texte/HTML, reçu React, facture A4, détail de commande et
éditeur d’articles.

## 4. Hors ligne et corrections

Dexie passe en version **18** avec le cache `catalogPackages`.
`fetchForfaits` rafraîchit ce cache en ligne et le relit hors ligne.

Après le dépôt :

- corriger la quantité d’un détail recalcule la porteuse et le total de
  la commande depuis le forfait en cache ;
- la porteuse ne se corrige pas directement : l’interface renvoie vers
  un article inclus ;
- retirer un détail re-tarife la porteuse sur le comptage restant ;
- retirer la porteuse supprime tout son groupe ;
- retirer le dernier détail supprime aussi la porteuse, sauf si la
  commande deviendrait vide ;
- sans forfait en cache, une correction qui changerait le prix est
  refusée avec un message explicite plutôt qu’approximée.

Comme pour les autres tarifs, une configuration modifiée entre la
création locale et la synchronisation peut entraîner un refus serveur
explicite. Les commandes déjà synchronisées ne sont pas réécrites
rétroactivement.

## 5. Audit

La migration 030 étend `audit_row_change()` aux tables du catalogue des
lots 1 à 3 : catégories, articles, prix, règles au kilo, modèles,
forfaits et compositions. Les tables filles sans `tenant_id` restent
volontairement exclues, la fonction d’audit générique n’y aurait pas de
pressing fiable à journaliser.

## 6. Vérifications

- SQL : `supabase/tests/catalogue_lot3.sql`, intégré à
  `scripts/sql-verify.sh` après toutes les migrations 001→030 ;
- calcul : `src/test/prixForfait.test.ts` ;
- dépôt local : `src/test/orderForfait.test.ts` (création du groupe,
  recalcul, retraits, cache absent, correspondance Supabase) ;
- écrans et documents : `orderForm.test.tsx`, `parametresPage.test.tsx`,
  `facturation.test.ts` et `receiptService.test.ts`.

## 7. Déploiement

Appliquer la migration **030 avant de déployer le frontend** : le client
sélectionne les nouvelles colonnes dès son chargement. Aucune donnée
commerciale n’est supprimée et aucun prix historique n’est recalculé.

Ordre recommandé :

1. CI verte, y compris le job PostgreSQL réel ;
2. application de `030_forfaits_quantite_modele_exploitation.sql` sur le
   projet Supabase cible ;
3. vérification des colonnes, fonctions et triggers ;
4. déploiement/fusion du frontend ;
5. création d’un forfait au comptage puis commande de contrôle.
