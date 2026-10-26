# Analyse de `STRUCTURATIONDB.md` et plan d'intégration à Pressing Pro

Analyse réalisée le 2026-10-26, sur la branche `arena/98b2545e-laundrypressing`
(HEAD = fusion PR #12, migrations 001→029 en production sur `Pressing_Pro`).

## 1. Nature du document

`STRUCTURATIONDB.md` (1067 lignes, ~6 000 mots) est un **« prompt master »
de spécification** destiné à un agent IA : 14 sections qui décrivent un
système complet de gestion de pressings/blanchisseries (« PRESSPRO »),
pensé pour un dépôt distinct (`ErwinsS225/PRESSPRO`) avec un backend **Go**
et une API REST classique.

Il n'est donc **pas applicable tel quel** ici : Pressing Pro est une PWA
React/TypeScript **offline-first** (Dexie + synchronisation) adossée à
**Supabase** (PostgREST + RLS + RPC + triggers), sans serveur applicatif Go.
En revanche, ses **exigences métier** sont presque toutes transposables —
et une grande partie est **déjà implémentée** par les Lots 1 et 2 du
catalogue, car le cahier des charges Catalogue/Tarification déjà traité
recouvrait les mêmes concepts.

Le fichier SQL de référence cité en §1 règle 6
(`presspro_modele_pressing_blanchisserie.sql`) est **absent du dépôt** :
l'analyse se fait donc uniquement à partir du texte.

## 2. Contenu du document, section par section

| § | Contenu | Idée directrice |
|---|---|---|
| 1 | Rôle de l'agent, 12 règles impératives | Auditer avant de toucher, réutiliser l'existant, serveur = autorité des prix, ne jamais annoncer de test non exécuté |
| 2 | **Deux modèles d'exploitation** : pressing pro (§2.1) et blanchisserie artisanale (§2.2), plus un mode `MIXTE`. Pressing : pièce, kilo, tranches, devis, forfaits. Blanchisserie : **forfait au nombre de vêtements** (25 pièces = 2 000 FCFA, toutes catégories confondues) avec **politique de dépassement configurable** (`PER_EXTRA_ITEM`, `REPEAT_PACKAGE`, `MANUAL_QUOTE`, `REJECT_OVER_LIMIT`) | Ne jamais inventer la facturation d'un dépassement |
| 3 | Concepts à modéliser : catégories/types de vêtements, catégories de prestations, prestations, **modèle de blanchisserie** (config complète), règle tarifaire | Distinguer les concepts, catalogue extensible |
| 4 | Audit du dépôt avant modification, livrable = tableau fonctionnalité/fichier/état/modification/risque/tests | — |
| 5 | Schéma PostgreSQL cible, 10 contraintes (tenant, XOF entiers, poids décimaux, seeds idempotents…), **copie par tenant des données système**, instantanés sur les commandes | Ne jamais partager un catalogue mutable |
| 6 | **Moteur de tarification** séparé : pièce (§6.1), kilo `FLAT_RATE`/`PROGRESSIVE_TIERS` (§6.2), **nombre de vêtements** (§6.3 : un forfait ≠ prix unitaire déduit), mélange sans double facturation (§6.4) | Serveur calcule, frontend propose |
| 7 | Workflow de réception en 7 étapes, dont **cas C : comptage par catégorie** avec total et recherche de forfaits compatibles ; création transactionnelle ; ticket 80 mm | Rapidité au comptoir |
| 8 | Contrat d'API (modèles, vêtements, prestations, tarification, commandes) | Ne pas dupliquer l'API commandes |
| 9 | 6 écrans : A paramétrage du modèle d'exploitation, B vêtements, C prestations, D tarifs (formulaire adaptatif), E modèles, F réception | « Ne présente jamais une valeur manquante comme 0 FCFA » |
| 10 | Sécurité multi-tenant, audit des changements de tarifs, **limites des plans SaaS vérifiées côté serveur** | — |
| 11 | **40 tests d'acceptation** : CAT-001→008, BL-001→010, PRO-001→009, ORD-001→008, SEC-001→003, UI-001→004, INT-001 | Les deux parcours de référence : 25 vêtements → 2 000 FCFA ; 5 kg × 1 600 → 8 000 FCFA |
| 12 | Méthode en 6 phases (audit → DB → backend → frontend → intégration → validation) | — |
| 13 | 16 critères de livraison | — |
| 14 | Format du rapport final, 3 états possibles | — |

## 3. Cartographie avec l'existant (audit §4 de la spec)

État constaté dans ce dépôt (migrations 001→029, Dexie v17, page
`/catalogue` à 5 onglets : Articles, Tarifs, Au kilo, Modèles, Forfaits).

| Fonctionnalité (spec) | Existant Pressing Pro | État | Modification nécessaire | Risque | Tests |
|---|---|---|---|---|---|
| Catégories + types de vêtements, codes, copies tenant (§3 A/B) | 027 : `garment_categories`, `garment_types`, seed système 12 catégories/46 articles **sans prix**, RPC `install_catalog_reference()` | ✅ Fait | — | — | SQL `catalogue_lot1.sql` (CI PG16) |
| Prestations personnalisables (§3 D) | `tenant_services` (021/022, `code` en 027), CRUD existant | ✅ Fait | — | — | Existant |
| Catégories de prestations (§3 C) | « Activités » tenant (021/022, snapshot `activityNameSnapshot` en 024) jouent ce rôle | 🟡 Équivalent | Aucune si on acte l'équivalence dans la doc | Faible | — |
| Tarifs par pièce, matrice prestation×article (§6.1) | 027 : `service_garment_prices` + garde serveur `guard_order_item_catalog` (prix grille ou motif ≥ 10 car.) | ✅ Fait | — | — | SQL + Vitest `catalogue` |
| Kilo + tranches `FLAT_RATE`/`PROGRESSIVE` (§6.2) | 028 : `pricing_rules/tiers`, `compute_weight_price`, RPC `quote_weight_price`, miroir `src/lib/prixKilo.ts`, cache Dexie v17 | ✅ Fait | — | — | Vitest `prixKilo`, SQL `catalogue_lot2.sql` |
| Modèles de blanchisserie (§3 E) | 029 : `laundry_profiles` (4 gabarits système), duplication par code, onglet Modèles | 🟡 Partiel | Nos modèles sont **présentatifs** (aucun prix, ne pilotent ni services ni tarifs) ; la spec veut une config complète | Moyen si on durcit | SQL lot2 |
| Forfaits (§2.2, §6.3) | 029 : `commercial_packages` (`price_xof` global) + items de composition, onglet Forfaits (créer/archiver) | 🟡 Squelette | **Manquent** : nombre de vêtements inclus, politique de dépassement, admissibilité, moteur, vente au comptoir | Élevé (cœur Lot 3) | BL-001→010 à écrire |
| Modèle d'exploitation tenant (§2, écran A) | **Absent** (seul le gabarit `BLANCHISSERIE_KILO` existe) | ❌ Manquant | Colonne tenant + écran de paramétrage + filtrage réception | Moyen | À écrire |
| Comptage rapide par catégorie (§7 cas C, écran F) | `OrderForm` ligne par ligne (grille + devis kilo) | ❌ Manquant | Nouveau mode de saisie « comptage » dans OrderForm | Élevé (refonte UI dépôt) | BL-001, UI |
| Simulation/validation serveur du prix (§7 étape 5) | RPC `quote_weight_price` (kilo) ; grille revérifiée par trigger à la synchro | 🟡 Partiel | RPC `quote_package_price` équivalente pour les forfaits | Faible | SQL |
| Instantanés commande (§5) | 024/027/028 : libellés, prix catalogue, `conditions_snapshot`, `billed_quantity` | ✅ Fait | Ajouter les champs forfait (id, inclus, supplément, politique) | Faible | ORD-006 |
| Création atomique (§7 étape 6) | Transaction Dexie locale + upsert sync ; garde serveur refuse l'incohérent à l'envoi | 🟡 Adapté offline | Le refus arrive à la synchro, pas à la frappe — inhérent à l'offline-first | Moyen (UX file de synchro) | Existant |
| Ticket 80 mm (§7 étape 7) | Service d'impression existant, échappement HTML corrigé (PR #10) | ✅ Fait | Ajouter la mention forfait appliqué (BL-009) | Faible | Vitest reçus |
| API (§8) | PostgREST + RPC (install, duplicate, quote) — pas de REST Go | ✅ Transposé | 1 RPC de devis forfait à ajouter | — | — |
| Multi-tenant (§10) | RLS owner-write/member-read sur toutes les tables 027→029, test statique `tenantIsolation` | ✅ Fait | — | — | 29 tests d'isolation |
| Audit des tarifs (§10) | Tables d'audit (009) **non étendues** aux tables catalogue | 🟡 Limitation connue (Lot 1) | Étendre les triggers d'audit à 027→030 | Faible | SQL |
| Limites de plan (§10, SEC-003) | Plans SaaS (007/008) + `subscriptionService`, aucune limite sur le catalogue | 🟡 Partiel | Décider si les forfaits/modèles entrent dans les limites de plan | Faible | À écrire si retenu |
| Prix « sur devis » (§6, PRO-008) | Dérogation avec motif ≥ 10 caractères tracé sur la ligne | 🟡 Équivalent | Documenter l'équivalence | — | Guard SQL |

### Couverture des tests d'acceptation (§11) aujourd'hui

- **CAT-001→008** : couverts (modèles présentatifs compris), sauf l'acception
  « config complète » du modèle.
- **BL-001→010** : **aucun** — c'est précisément le pan manquant.
- **PRO-001→009** : couverts (kilo 5×1 600 = 8 000 est un cas du moteur ;
  chevauchements rejetés ; sans règle = blocage).
- **ORD-001→008** : couverts dans l'adaptation offline (recalcul serveur à la
  synchro, historique figé, ticket depuis snapshots).
- **SEC-001→002** : couverts. **SEC-003** : partiel (plans).
- **UI-001→004, INT-001** : couverts pour pièce/kilo ; à étendre aux forfaits.

## 4. Ce qu'il reste réellement à intégrer

La spec se réduit, compte tenu de l'existant, à **quatre chantiers** :

1. **Forfaits au nombre de vêtements de bout en bout** (le cœur) : schéma
   (nombre inclus, politique de dépassement, prix du vêtement supplémentaire,
   articles admissibles), moteur SQL `compute_package_price` + RPC
   `quote_package_price`, miroir client `prixForfait.ts`, nouvelle branche
   dans la garde `guard_order_item_catalog`, vente au comptoir avec détail
   des vêtements conservé, snapshots forfait. **Point délicat** : la garde
   « catalogue obligatoire » (027) exige un prix de grille par ligne à la
   pièce. Représentation recommandée, fidèle au §6.3 (« un forfait n'est pas
   un prix unitaire déduit ») : **une ligne porteuse du forfait** (montant
   global, `commercial_package_id`) + **les lignes de détail par article**
   (quantités réelles, montant 0, rattachées à la ligne forfait) pour
   l'atelier et la restitution (BL-008). La garde apprend ce cas comme elle
   a appris le cas KG en 028.
2. **Modèle d'exploitation par établissement** (`PRESSING_PRO` /
   `BLANCHISSERIE` / `MIXTE`) : colonne sur le tenant, écran de paramétrage
   (écran A), et pilotage *doux* de la réception (l'écran de dépôt met en
   avant le mode pertinent — comptage pour une blanchisserie, pièce/kilo
   pour un pressing — sans interdire les autres en `MIXTE`). Changement de
   modèle = simple configuration, jamais destructif.
3. **Écran de réception « comptage »** (écran F cas C) : grille d'articles
   admissibles avec +/− rapides, total en temps réel, forfaits compatibles
   proposés, détail de calcul (inclus/supplément/politique) avant validation.
4. **Finitions transverses** : audit des tables 027→030, mention du forfait
   sur le ticket, documenter l'équivalence « activités = catégories de
   prestations » et « dérogation motivée = prix sur devis ».

## 5. Différences d'architecture actées (non transposées telles quelles)

- **Pas d'API REST Go** : PostgREST + RPC SECURITY DEFINER + triggers,
  comme 027→029. La section §8 devient une liste de RPC/services existants.
- **« Le serveur calcule tout » devient « le serveur revérifie tout »** :
  l'offline-first impose un devis client immédiat (miroir TypeScript testé
  contre les mêmes exemples que le SQL) ; la garde serveur recalcule et
  refuse à la synchronisation. C'est le patron déjà en production pour le
  kilo — on l'étend, on ne le remplace pas.
- **Seeds sans prix** (décision Lot 1, maintenue) : les montants cités par la
  spec (1 600, 2 000 FCFA…) restent des *exemples de tests*, jamais des
  valeurs par défaut. La spec dit la même chose (« ne doivent jamais être
  imposés ») ; notre règle est simplement plus stricte.
- **Modèles présentatifs** (029) : la spec §3 E décrit un modèle « config
  complète ». Notre modèle d'exploitation (chantier 2) + forfaits
  (chantier 1) couvrent le besoin réel sans transformer les modèles en
  conteneurs de prix — ce qui réintroduirait le couplage évité en 029.

## 6. Plan d'intégration proposé (« Lot 3 »)

| Phase | Contenu | Livrables |
|---|---|---|
| 3.0 Décisions | Périmètre, modèle d'exploitation contraignant ou doux, politique de dépassement par défaut | Ce document validé |
| 3.1 Base (migration **030**) | Colonnes `commercial_packages` : `garments_included int`, `overflow_policy text` (4 valeurs), `overflow_unit_price_xof int null` ; admissibilité via `commercial_package_items` (garment_type_id) ; `compute_package_price` + RPC `quote_package_price` ; colonnes ligne `commercial_package_id`, `package_line_id` ; branche forfait de la garde ; `tenants.business_model` ; audit étendu | SQL + tests `supabase/tests/catalogue_lot3.sql` (BL-002/003/005/006 côté serveur) |
| 3.2 Client | Dexie **v18** (cache forfaits), `src/lib/prixForfait.ts` (miroir), service forfaits étendu, onglet Forfaits (formulaire complet + simulateur), OrderForm mode comptage + ligne forfait, ticket (mention forfait) | Vitest BL-001→010 |
| 3.3 Pilotage | Écran A (choix du modèle d'exploitation), mise en avant du mode de réception, avertissements d'incompatibilité | Tests UI |
| 3.4 Validation | typecheck/lint/tests/build, CI (job SQL PG16 rejoue 030 + tests BL), application prod via connecteur *après* CI verte — même procédure que 027→029 | PR + rapport §14 |

Risques principaux : (a) lignes à montant 0 dans le détail — vérifier que
totaux commande, encaissements et rapports les tolèrent (le total reste porté
par la ligne forfait) ; (b) refus de garde à la synchro pour un forfait créé
hors-ligne avec cache périmé — même traitement d'erreur que le kilo ;
(c) `OrderForm` devient multi-modes — régression possible sur pièce/kilo,
à couvrir par les tests existants (688 verts à ce jour).

## 7. Conclusion

`STRUCTURATIONDB.md` est une spec de grande qualité, mais **~60 % de son
périmètre est déjà en production** dans Pressing Pro (catalogue, matrice,
kilo par tranches, modèles, snapshots, RLS). Sa valeur ajoutée réelle pour
ce projet tient en **une fonctionnalité métier absente — la facturation au
nombre de vêtements avec politiques de dépassement — et un concept de
pilotage — le modèle d'exploitation**. L'intégration est donc un **Lot 3
additif** (migration 030), pas une refonte : aucune table existante n'a
besoin d'être remplacée, et le patron technique (SQL autorité + miroir TS +
cache Dexie + garde serveur) est déjà éprouvé deux fois.
