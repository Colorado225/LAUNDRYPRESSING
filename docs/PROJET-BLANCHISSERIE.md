# Projet Blanchisserie — analyse et refonte du modèle de données

**Date :** 26 octobre 2026
**Origine :** deux grilles tarifaires de pressings/blanchisseries abidjanaises (captures d'écran)
**Statut :** proposition de conception, en attente d'arbitrages (voir § 8)

---

## 1. Analyse de l'existant

### 1.1 Architecture générale

Pressing Pro est une PWA **offline-first multi-tenant** :

| Couche | Technologie | Rôle |
|---|---|---|
| Interface | React 19, TypeScript strict, Vite, Tailwind | Écrans métier, formulaires de commande |
| Données locales | Dexie / IndexedDB (`src/db/localDb.ts`, schéma v1→v15) | Écriture systématique avant tout envoi |
| Synchronisation | `src/sync/syncEngine.ts` + repositories | Poussée immédiate puis différée, conflits arbitrés |
| Serveur | Supabase PostgreSQL, RLS, fonctions `security definer` | Source d'autorisation, migrations 001→026 |
| Paiement | CinetPay (Edge Functions), espèces en caisse | Encaissements, remboursements, abonnements SaaS |

### 1.2 Le modèle de données actuel lié aux prestations

```
tenant_activities (022)
  id, tenant_id, name, legacy_code ('pressing' | 'blanchisserie' | ...), sort_order
        │ 1
        │
        │ n
tenant_services (021→023→024)
  id, tenant_id, activity_id (FK composite), activity_code (hérité),
  service_name, billing_unit ('PIECE' | 'KG'), unit_price (TARIF KG SEULEMENT),
  sort_order
        │ 1
        │ n (lien facultatif, ON DELETE SET NULL)
order_items (001→024)
  label (saisi librement), quantity, billed_quantity, billing_unit,
  unit_price, price (= quantité facturée × prix unitaire, contrôlé par trigger),
  pricing_mode, price_status, tenant_service_id, activity_name_snapshot,
  service_name, garment_details jsonb (composition d'un lot au kilo),
  snapshots génériques (minimum, incrément, conditions…), price_reason
```

Points clés :

- **Le code `blanchisserie` existe déjà** comme activité (dans `TenantActivityCode`, les migrations 021/022 et `src/lib/tenantActivities.ts`), avec des suggestions de prestations (« Linge au kilo », « Linge de maison », « Linge professionnel »).
- Une prestation à la pièce **ne peut pas porter de prix** : la contrainte `tenant_services_unit_price_check` (migration 023) impose `unit_price IS NULL` quand `billing_unit = 'PIECE'`. Le prix est toujours retapé au comptoir.
- `order_items` accepte déjà 8 unités (`PIECE, PAIR, SET, KG, M2, METER, PACKAGE, FLAT`) et les modes `FIXED, FROM, QUOTE, UNCONFIGURED`, mais l'écran de configuration n'expose que `PIECE` et `KG`.
- `garment_details` est un tableau JSON validé par la fonction SQL `valid_order_garment_details`, avec un enum de **12 types** : `CHEMISE, T_SHIRT, PANTALON, JEAN, ROBE, JUPE, VESTE, COSTUME, BOUBOU, DRAP, SERVIETTE, AUTRE`.
- Toute ligne garde des **instantanés** (nom d'activité, nom de prestation) : les reçus survivent aux renommages/suppressions de configuration.

### 1.3 Historique à ne pas répéter

Les migrations 013, 016, 017 et 019 avaient construit un système très complet : catalogue article/famille/prestation, templates, aliases, modèles commerciaux `PER_KG`, `WEIGHT_PACKAGE`, `FAMILY_PACKAGE`, forfaits famille avec composition. **La migration 020 l'a supprimé définitivement** pour cause de complexité excessive, au profit de lignes libres et d'un référentiel léger (`tenant_activities` / `tenant_services`).

> **Contrainte de conception forte :** la nouvelle fonctionnalité blanchisserie doit rester *légère, tenant-scoped, optionnelle et non destructive*. Il ne faut pas recréer le catalogue de 2019, mais étendre le référentiel existant avec le minimum de colonnes/tables nécessaires.

---

## 2. Besoins exprimés par les deux grilles tarifaires

### 2.1 Grille 1 — tarification à la pièce et au kilo

**Tarifs à la pièce / à la paire / à l'ensemble**

| Article | Tarif (FCFA) | Forme |
|---|---|---|
| Couette | 3 000 | « à partir de » |
| Drap | 1 000 | fixe |
| Serviette | 500 | « à partir de » |
| Pantalon | 500 | fixe |
| Chemise | 500 | fixe |
| Polo | 500 | fixe |
| Tee-shirt | 300 | « à partir de » |
| Ensemble dame | 1 000 | « à partir de » |
| Blouson | 1 000 | fixe |
| Manteau | 1 500 | fixe |
| Costume | 2 000 | fixe |
| Chaussettes (la paire) | 250 | **paire** |
| Chaussures (la paire) | 1 000 | **paire** |
| Amidonnage | 1 000 | « à partir de » |
| Repassage | 100 | « à partir de » |
| Débardeur | 300 | fixe |
| Culotte | 300 | fixe |
| Jeans | 500 | fixe |
| Jupe | 500 | fixe |
| Robe simple | 500 | fixe |
| Robe longue | 1 000 | fixe |
| Robe de soirée | 1 500 | fixe |

**Forfaits au kilo par paliers**

| Prestation | 10 kg | 15 kg | 20 kg |
|---|---|---|---|
| Laver repasser | 15 000 | 22 000 | 28 500 |
| Laver plier | 12 000 | 16 000 | 20 000 |

### 2.2 Grille 2 — « Les Pressing Cleaner »

- **Double colonne de prix par article** : `Laver – Repasse` d'une part, `Repassage seul` d'autre part (ex. chemise 500/100, veston 1500/300, costume 2000/500, chaussures 1000/300, robe 500-1500/500, couette 3000).
- **Ensembles / parures** : « 1 drap + 2 taies » 1 000, « 2 draps + 2 taies » 2 000 (unité `SET`).
- **Fourchettes « petite – grande »** : serviette 500-1 500, robe 500-1 500 (prix `FROM`, confirmé à la réception).
- **Services adjacents** : amidonnage, nettoyage à sec, lavage express, teinture, repassage.
- **Abonnement mensuel** : 14 000 F/mois = 3 ramassages par personne, quantité illimité.
- **Ramassage et livraison à domicile**.

### 2.3 Synthèse des structures tarifaires à couvrir

1. Prix **fixe à la pièce** (le plus courant).
2. Prix **« à partir de »** (FROM), montant estimé puis confirmé.
3. Facturation **à la paire** et **à l'ensemble/parure**.
4. **Paliers de poids forfaitaires** (10/15/20 kg) par variante de traitement (laver-repasser, laver-plier).
5. **Variantes de traitement** sur un même article (lavage+repassage, repassage seul, plus tard lavage express…).
6. Tarif **linéaire au kilo** déjà existant (conservé tel quel).
7. **Abonnement mensuel avec crédit de ramassages** (besoin distinct, plus lourd).
8. **Collecte/livraison à domicile** (adresse, créneau, rattachement à une commande).

---

## 3. Écarts entre l'existant et le besoin

| # | Besoin | Existant | Écart |
|---|---|---|---|
| 1 | Prix de référence à la pièce | `unit_price` interdit pour `PIECE` | Assouplir la contrainte et ajouter un mode de prix |
| 2 | Prix « à partir de » | `pricing_mode` existe sur `order_items` mais pas sur `tenant_services` | Ajouter `pricing_mode` aux prestations configurées |
| 3 | Unités paire / ensemble / forfait | Config limitée à `PIECE`/`KG` (les unités existent déjà côté lignes) | Ouvrir `PAIR`, `SET`, `PACKAGE` dans `tenant_services` |
| 4 | Paliers 10/15/20 kg | Tarif kilo linéaire uniquement | Nouvelle table de paliers + snapshot sur la ligne |
| 5 | Variantes laver-repasser / laver-plier / repassage seul | Prestations indépendantes sans lien entre elles | Regroupement optionnel par article (ou prestations séparées, voir arbitrage § 8) |
| 6 | Types de linge manquants (couette, polo, chaussettes, chaussures, blouson, manteau, ensemble, débardeur, culotte, taie, tapis…) | Enum de 12 types | Étendre l'enum SQL + Zod + libellés |
| 7 | Abonnement mensuel + 3 ramassages | Aucun modèle | Tables dédiées (phase 2) |
| 8 | Ramassage à domicile | `due_date` seulement, pas d'adresse ni de mode de remise | Colonnes adresse/créneau sur `orders` (phase 2) |
| 9 | Démarrage rapide avec les tarifs des captures | Aucun tarif prédéfini (philosophie 021) | Bibliothèque de suggestions importables, jamais imposée |

---

## 4. Modèle cible proposé (additif, migrations 027+)

Principe directeur : **aucune suppression**, tout est optionnel et rétrocompatible ; les lignes libres actuelles restent le filet de sécurité.

### 4.1 Faire évoluer `tenant_services` (migration 027)

```sql
alter table public.tenant_services
  add column pricing_mode text not null default 'FIXED'
    check (pricing_mode in ('FIXED', 'FROM')),
  add column article_group text,            -- ex. « Chemise », pour griser les variantes
  add column is_active boolean not null default true;

-- Ouverture des unités et des prix à la pièce :
alter table public.tenant_services
  drop constraint tenant_services_billing_unit_check,
  add constraint tenant_services_billing_unit_check
    check (billing_unit in ('PIECE', 'PAIR', 'SET', 'KG', 'PACKAGE'));

alter table public.tenant_services
  drop constraint tenant_services_unit_price_check,
  add constraint tenant_services_unit_price_check
    check (unit_price is null or (unit_price between 1 and 10000000));
```

- `unit_price` devient le **prix de référence** (toutes unités), toujours modifiable au comptoir ; `FROM` le pré-remplit en prix estimé (`price_status = 'ESTIMATED'`).
- `article_group` est un simple libellé de regroupement (pas de table articles) : l'écran présente ensemble les prestations qui partagent le même groupe, ce qui rend la lecture en colonnes type grille 2 sans réintroduire de catalogue.
- RLS et accès owner-only inchangés ; l'écriture directe via la table est déjà en place (le RPC `save_tenant_services` reste pour l'onboarding, avec des colonnes optionnelles couvertes par les défauts).

### 4.2 Nouvelle table des paliers de poids (migration 027)

```sql
create table public.tenant_weight_tiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  tenant_service_id uuid not null,
  label text not null check (char_length(btrim(label)) between 1 and 40), -- « 10 kg »
  weight_kg numeric(7,2) not null check (weight_kg > 0),
  price_fcfa integer not null check (price_fcfa between 1 and 10000000),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint weight_tiers_service_fk
    foreign key (tenant_service_id, tenant_id)
    references public.tenant_services (id, tenant_id) on delete cascade
);
```

Même pattern que `tenant_services` : RLS membre en lecture, propriétaire en écriture, index `(tenant_id, tenant_service_id, sort_order)`.

### 4.3 Instantané de forfait sur `order_items` (migration 027)

Une seule colonne JSON, dans l'esprit de `garment_details`, pour figer le palier choisi :

```sql
alter table public.order_items
  add column package_snapshot jsonb;
-- { "tier_id": "…", "label": "10 kg", "weight_kg": 10, "price_fcfa": 15000,
--   "service_name": "Laver repasser" }
```

La ligne correspondante est facturée en `billing_unit = 'PACKAGE'`, `quantity = 1`, `unit_price = price_fcfa`, et le trigger existant `guard_order_item_price` continue de vérifier l'égalité `price = billed_quantity × unit_price` sans changement. Le kilo linéaire existant n'est pas touché.

### 4.4 Élargir les types de vêtements (migration 027)

Ajouts proposés à l'enum de `valid_order_garment_details` :

`COUETTE, POLO, DEBARDEUR, CULOTTE, CHAUSSETTES, CHAUSSURES, BLOUSON, MANTEAU, ENSEMBLE, TAIE, TAPIS, LINGE_DE_MAISON`

(`AUTRE` est conservé.) La contrainte `order_items_garment_details_check` est recréée après remplacement de la fonction. Côté client : même liste dans `src/schemas/order.ts` et `src/constants/garmentTypes.ts`.

### 4.5 Synchronisation et cache local (Dexie v16)

- Nouvelle table locale `tenantWeightTiers` (cache de configuration, comme `tenantServices`).
- `upgrade` Dexie v16 : ajout de `packageSnapshot` et des nouveaux champs sur `orderItems` ; valeurs par défaut pour les anciennes lignes.
- `fetchTenantServiceConfiguration` charge aussi les paliers ; la création de commande hors ligne garde le même fonctionnement qu'aujourd'hui (configuration en cache).
- `toSupabaseOrderItem` transporte `package_snapshot` ; le moteur de synchro n'a pas d'autre changement.

### 4.6 Phase 2 — abonnements et ramassage à domicile

Si le besoin est confirmé, deux tables plus des colonnes sur `orders` :

```sql
-- Abonnement mensuel d'un client (ex. 14 000 F, 3 ramassages, illimité en pièces)
create table public.customer_laundry_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id, tenant_id) on delete cascade,
  monthly_price_fcfa integer not null check (monthly_price_fcfa > 0),
  pickups_included integer not null default 3 check (pickups_included between 0 and 31),
  starts_on date not null,
  ends_on date,
  status text not null default 'active' check (status in ('active','paused','ended')),
  notes text,
  created_at timestamptz not null default now()
);

-- Ramassage planifié / réalisé
create table public.pickups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null references public.customers(id, tenant_id) on delete cascade,
  subscription_id uuid references public.customer_laundry_subscriptions(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  scheduled_date date not null,
  address text not null,
  status text not null default 'planifie'
    check (status in ('planifie','collecte','livre','annule')),
  created_by uuid,
  created_at timestamptz not null default now()
);

alter table public.orders
  add column delivery_mode text not null default 'COUNTER'
    check (delivery_mode in ('COUNTER','PICKUP_DELIVERY')),
  add column address text,
  add column pickup_date date,
  add column delivery_date date;
```

Une fonction SQL `consume_pickup_credit(subscription_id)` vérifierait le solde de ramassages de la période (3 par mois dans l'exemple) et refuserait le dépassement, en laissant le propriétaire passer outre avec un motif.

---

## 5. Parcours produit impacté

| Écran | Évolution |
|---|---|
| **Services & activités** (`/prestations`) | Pour l'activité Blanchisserie : édition du prix de référence, du mode FIXE/FROM, de l'unité (pièce/paire/ensemble/kilo/forfait), du groupe d'article ; sous-tableau des paliers de poids ; bouton « Importer la grille type d'Abidjan » (peuplement en un clic, modifiable) |
| **Nouvelle commande** (`/commandes/nouvelle`) | La sélection d'une prestation pré-remplit libellé, unité et prix (modifiable, avec motif de dérogation déjà obligatoire) ; sélecteur de palier pour les forfaits kilo ; composition du lot avec l'enum élargi ; variantes regroupées par article |
| **Fiche commande / mesure** | Le palier figé s'affiche en lecture seule ; le kilo linéaire garde l'éditeur de mesure existant |
| **Reçu / facture / étiquette** | Aucun changement de structure : tout passe par les snapshots déjà imprimés (`service_name`, `activity_name_snapshot`, libellés) |
| **Rapports** | Déjà agrégés sur `service_name || label` : les nouvelles prestations apparaissent sans développement |
| **Atelier** | Statuts existants (`washing → drying → ironing → quality_check`) adaptés au linge ; aucun nouveau statut requis |

## 6. Données d'amorçage (suggestions, jamais imposées)

Créer `src/constants/laundryPriceSuggestions.ts` reprenant les deux grilles en données structurées :

- prestations à la pièce avec `billing_unit` (`PIECE`/`PAIR`/`SET`), `pricing_mode` (`FIXED`/`FROM`) et prix ;
- deux prestations au kilo « Laver repasser » et « Laver plier » avec leurs trois paliers ;
- entrées « Repassage seul » liées par `article_group` ;
- services adjacents (amidonnage, express, teinture…).

Le propriétaire importe tout ou partie, puis ajuste. Aucun prix n'est écrit par une migration : le principe de la migration 021 (« aucun tarif prédéfini ») est respecté.

## 7. Stratégie de test et de livraison

1. **Migration 027 additive** : contraintes assouplies (pas de rupture), table `tenant_weight_tiers`, colonne `package_snapshot`, enum élargi.
2. **Tests SQL** `supabase/tests/weight_tiers.sql` : RLS owner/membre, FK composite, suppression en cascade, ligne de commande avec snapshot, refus d'un snapshot mal formé.
3. **Vitest** : schéma Zod (PACKAGE + snapshot, enum élargi), pré-remplissage du formulaire, calcul de ligne, cache Dexie v16, import des suggestions.
4. **Types** : mise à jour de `src/types/database.ts` et des interfaces Dexie.
5. Vérification habituelle : `npm run typecheck`, `lint`, `test`, `build`, puis `npm run sql:verify` (PostgreSQL 16 dans la CI).

## 8. Décisions à trancher avant implémentation

1. **Périmètre de l'itération** : grille pièce/paliers seule, ou inclure d'emblée abonnements + ramassage à domicile (phase 2) ?
2. **Variantes de traitement** : prestations séparées (le plus simple, conforme à l'existant) ou grille matricielle article × variantes via `article_group` ?
3. **Statut des prix** : suggestions importables et modifiables (recommandé) ou grille imposée par l'éditeur ?
4. **Livrable attendu maintenant** : valider ce document, ou lancer directement l'implémentation (migration 027, types, écrans, tests) ?

## 9. État d'implémentation — 26 octobre 2026

Itération livrée sur la branche `arena/b9750e79-laundrypressing`, en évolution de
l'application existante (aucune reconstruction, aucune fonctionnalité retirée).

### Livrés

- **SQL** : `supabase/migrations/027_catalogue_categories_forfaits.sql` (strictement
  additive) et `supabase/tests/catalogue_prestations.sql` — 17 vérifications PGlite
  vertes (contraintes CHECK, RLS owner/membre, FK composites, cascade de suppression,
  snapshots, refus serveur d'un forfait mal formé).
- **Types et schémas** : `src/types/database.ts`, schémas Zod de `src/schemas/order.ts`
  (une ligne `PACKAGE` exige `packageSnapshot`, quantité 1, prix égal au palier,
  `priceStatus` non estimé ; `QUOTE` impose un prix nul), constantes de vêtements
  étendues.
- **Dexie v16** : stores `tenantActivities`, `tenantServiceCategories`,
  `tenantServices` (index `categoryId` pour le détachement) et `tenantServiceTiers` ;
  les commandes hors ligne gardent leurs snapshots et ne sont jamais recalculées.
- **Services** : `src/services/tenantServices.ts` (CRUD online/offline,
  `fetchTenantServiceConfiguration`, duplication, import idempotent des suggestions,
  onboarding) et `src/constants/laundryCatalogSuggestions.ts` (les deux grilles
  fournies, importables sur action explicite du propriétaire — jamais automatiques).
- **Écrans** : `ServicesPressing.tsx` (onglets Activités / Catégories / Prestations,
  six unités, trois modes de tarification, paliers de poids, garde owner) et
  `OrderForm.tsx` (sélecteur d'activité, prestations groupées par catégories,
  kilo linéaire, forfait avec palier figé à la création, devis, ligne libre `__free__`
  historique conservée, tarifs de référence en lecture seule pour le réceptionniste).
- **Affichage** : forfait (palier + poids) montré sur la fiche commande, le reçu et la
  facture ; l'éditeur de mesure est désactivé pour les lignes `PACKAGE`.
- **Règles** : montants FCFA entiers (`1..10 000 000`), durée `1..1440` min, paliers
  uniquement sur `PACKAGE`, un seul poids par palier d'un service, QUOTE ⇒ prix nul.

### Recette

- `npx tsc --noEmit` : 0 erreur ; `npm run lint` : 0 problème ; `npm run build` : OK.
- Tests : 63 fichiers, **672 tests verts** (656 de base préservés + 16 nouveaux, dont
  `catalogueLocal.test.ts`, `catalogueCommande.test.tsx`, les tests réécrits de
  `servicesPressing.test.tsx` et le cas forfait de `facturation.test.ts`).

### Hors périmètre de cette itération

Abonnements mensuels et ramassage à domicile (non demandés dans le périmètre validé).
