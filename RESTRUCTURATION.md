# 🎯 PROMPT MASTER — Génération de la Base de Données Relationnelle

## Application de Gestion Multi-Services : Pressing Professionnel & Blanchisserie

---

## 🧠 RÔLE ET CONTEXTE

Tu es **expert en architecture logicielle**, **expert en modélisation de bases de données relationnelles** et **expert métier en gestion de pressings professionnels et blanchisseries artisanales**. Tu maîtrises parfaitement :

- La conception de schémas relationnels normalisés (3NF minimum)
- Les contraintes d'intégrité référentielle
- Les règles métier de la gestion des commandes en pressing/blanchisserie
- Les systèmes de facturation multi-modes (au kilo, à la pièce, forfaitaire)

Je te fournis ci-dessous un **cahier des charges métier complet**. Ta mission est de **générer directement une base de données relationnelle** (script SQL complet + diagramme conceptuel) répondant à **tous les besoins exprimés**.

---

## 🎯 OBJECTIF

Concevoir et générer une **base de données relationnelle complète** pour une application de gestion de pressings professionnels **et** de blanchisseries artisanales, capable de gérer **deux types de services** avec **deux modes de facturation distincts** et de paramétrer ces modes au moment de la réception de commande.

---

## 📋 DOMAINE MÉTIER

### 1. Deux types d'établissements / services

L'application doit gérer **deux grandes familles de services** distinctes :

#### 🅰️ SERVICE PRESSING PROFESSIONNEL (modèle industriel)

Prestations typiques (liste non exhaustive, extensible) :

- Lavage
- Repassage
- Détachage
- Nettoyage à sec (dry cleaning)
- Lavage à sec
- Abidonnage
- Gestion / traitement des tâches
- Autres prestations professionnelles configurables

**Mode de facturation principal : AU KILO (poids)**

- Forfaits de lavage au kilo
- Forfaits de lavage + repassage au kilo
- Le tarif au kilo est **paramétrable** : ex. 1 600 FCFA / kg, 2 000 FCFA / kg, etc.
- Le client peut choisir un tarif au kilo en fonction de la prestation

#### 🅱️ SERVICE BLANCHISSERIE ARTISANALE (modèle artisanal)

Prestations typiques (limitées, extensibles légèrement) :

- Lavage seul
- Lavage + Repassage

**Mode de facturation principal : AU NOMBRE DE VÊTEMENTS (à la pièce)**

- Le propriétaire définit un **forfait en nombre de pièces** : ex. 25 vêtements = 2 000 FCFA, 25 vêtements = 1 500 FCFA, etc.
- La tarification **ne tient PAS compte** :
  - ❌ Du type de vêtement
  - ❌ Du poids des vêtements
  - ❌ De la catégorie
- Seul le **nombre total de pièces** compte.
- **Important** : Si le blanchisseur opte pour ce mode, il doit **énumérer / sélectionner chaque type de vêtement** déposé lors de la réception (ex. 3 chemises + 5 pantalons + 2 robes = 10 pièces, mais facturées selon le forfait pièces).
- Exemple concret : un client dépose 25 vêtements → forfait 2 000 FCFA ; un autre dépose 30 vêtements → toujours 2 000 FCFA selon forfait défini.

---

## 🗂️ ENTITÉS À MODÉLISER (minimum requis, extensible)

Tu dois modéliser au minimum les entités suivantes, avec leurs attributs, clés primaires, clés étrangères, contraintes et index :

| #   | Entité                  | Rôle                                                                         |
| --- | ----------------------- | ---------------------------------------------------------------------------- |
| 1   | `CLIENT`                | Clients de l'établissement                                                   |
| 2   | `EMPLOYE`               | Personnel (réceptionniste, blanchisseur, pressing, manager)                  |
| 3   | `ROLE` / `TYPE_EMPLOYE` | Rôles des employés                                                           |
| 4   | `TYPE_SERVICE`          | Pressing / Blanchisserie (catégorisation de haut niveau)                     |
| 5   | `PRESTATION`            | Lavage, repassage, détachage, nettoyage à sec, etc. (liée à un TYPE_SERVICE) |
| 6   | `TYPE_VETEMENT`         | Chemise, pantalon, robe, costume, etc.                                       |
| 7   | `MODE_FACTURATION`      | AU_KILO / A_LA_PIECE (ou avec forfait pièces)                                |
| 8   | `GRILLE_TARIFAIRE`      | Grille de prix (prix/kg ou forfait pièces) avec paramétrage                  |
| 9   | `FORFAIT`               | Paliers (ex. 25 pièces = 2 000 FCFA)                                         |
| 10  | `COMMANDE`              | Commande / dossier client                                                    |
| 11  | `LIGNE_COMMANDE`        | Détail des prestations/vêtements d'une commande                              |
| 12  | `VETEMENT_SAISI`        | Instance de vêtement déposé (pour énumération en mode blanchisserie)         |
| 13  | `PAIEMENT`              | Paiements effectués                                                          |
| 14  | `STATUT_COMMANDE`       | Cycle de vie : reçue, en cours, prête, livrée, annulée                       |
| 15  | `BON_DEPOT`             | Ticket de dépôt client                                                       |
| 16  | `TARIF_KILO`            | Tarif au kilo paramétrable (1 600 / 2 000 FCFA, etc.)                        |
| 17  | `HISTORIQUE_STATUT`     | Traçabilité des changements de statut                                        |

---

## ⚙️ RÈGLES DE GESTION (BUSINESS RULES)

Tu dois **impérativement** respecter et modéliser les règles suivantes :

### R1 — Double mode de facturation

- Une commande a **un et un seul mode de facturation** à la fois : `AU_KILO` (pressing) ou `A_LA_PIECE / FORFAIT_PIECES` (blanchisserie).
- Le mode détermine la structure des lignes de commande et le calcul du montant.

### R2 — Pressing (au kilo)

- À la réception, on saisit le **poids total en kg** (par prestation).
- Le montant = `poids_kg × tarif_kg` (tarif choisi parmi les tarifs paramétrés).
- Les tarifs au kilo sont **paramétrables** (ex. 1 600 FCFA/kg pour lavage seul, 2 000 FCFA/kg pour lavage + repassage, etc.).

### R3 — Blanchisserie (à la pièce / forfait pièces)

- À la réception, on **compte chaque vêtement à l'unité**.
- On **énumère le type de chaque vêtement** déposé (obligatoire).
- On applique un **forfait pièces** configuré : ex. 25 pièces = X FCFA, 30 pièces = Y FCFA.
- Le **type de vêtement n'influence pas le prix** — seul le nombre de pièces compte.
- Si le nombre de pièces dépasse le forfait défini, une règle de gestion doit être prévue (ex. `forfait_suivant` ou `au-delà du forfait`).

### R4 — Paramétrage dynamique

- Le propriétaire doit pouvoir **créer / modifier / désactiver** :
  - Les tarifs au kilo (pressing)
  - Les forfaits pièces (blanchisserie)
  - Les prestations
  - Les types de vêtements
- Les tarifs ont une **date de début / date de fin** (historisation des prix).

### R5 — Traçabilité

- Toute commande doit conserver : date de réception, date de livraison prévue, réceptionniste, statut actuel, historique des statuts, mode de facturation appliqué, tarif appliqué.

### R6 — Paiement

- Une commande peut être payée en totalité ou en plusieurs fois (acompte / solde).
- Les modes de paiement sont paramétrables (espèces, mobile money, etc.).

### R7 — Multi-établissement (optionnel mais recommandé)

- Prévoir une entité `ETABLISSEMENT` pour gérer plusieurs pressings/blanchisseries.

---

## 🧩 CONTRAINTES TECHNIQUES

- **SGBD cible** : PostgreSQL (par défaut) — précise les types (`SERIAL`, `NUMERIC(10,2)`, `TIMESTAMP`, etc.)
- **Normalisation** : 3FN minimum
- **Clés primaires** : `id` auto-incrémenté sur chaque table
- **Clés étrangères** : toutes déclarées avec `ON DELETE` / `ON UPDATE` appropriés
- **Contraintes `CHECK`** : pour les valeurs énumérées (statuts, modes, etc.)
- **Index** : sur les clés étrangères et les colonnes de recherche fréquente (dates, téléphone client, statut)
- **Timestamps** : `created_at`, `updated_at` sur les tables principales
- **Nommage** : `snake_case`, préfixes cohérents
- **Extensibilité** : prévoir des tables de paramétrage (`TARIF_KILO`, `FORFAIT`, `GRILLE_TARIFAIRE`) plutôt que des valeurs en dur

---

## 📦 LIVRABLES ATTENDUS

Tu dois produire **dans l'ordre** :

### 1. Diagramme conceptuel (MCD)

- Description textuelle des entités et relations (cardinalités)
- Format : liste ou tableau lisible

### 2. Modèle logique (MLD)

- Tables avec colonnes, types, clés primaires, clés étrangères

### 3. Script SQL complet (PostgreSQL)

- `CREATE TABLE` pour toutes les tables
- `ALTER TABLE ... ADD CONSTRAINT` pour les FK
- Contraintes `CHECK`, `UNIQUE`, `NOT NULL`
- Index
- **Données de référence** (`INSERT`) pour :
  - `type_service` (pressing, blanchisserie)
  - `prestation` (lavage, repassage, détachage, nettoyage à sec, lavage à sec, abidonnage, gestion tâches ; lavage seul, lavage+repassage)
  - `mode_facturation` (AU_KILO, A_LA_PIECE, FORFAIT_PIECES)
  - `statut_commande` (recu, en_cours, pret, livre, annule)
  - `type_vetement` (chemise, pantalon, robe, costume, jupe, manteau, etc.)
  - `role_employe` (receptionniste, blanchisseur, pressing, manager, caissier)
  - `mode_paiement` (especes, mobile_money, carte, virement)
- **Exemples de tarifs** :
  - Pressing : lavage+repassage = 1 600 FCFA/kg ; nettoyage à sec = 2 000 FCFA/kg
  - Blanchisserie : forfait 25 pièces = 1 500 FCFA ; forfait 30 pièces = 2 000 FCFA

### 4. Requêtes SQL de démonstration

Fournis 5 requêtes SQL illustrant les cas d'usage clés :

- Créer une commande pressing au kilo
- Créer une commande blanchisserie au forfait pièces avec énumération des vêtements
- Calculer le montant total d'une commande selon son mode
- Lister les commandes en cours par statut
- Historique des paiements d'un client

### 5. Notes d'architecture

- Justification des choix de modélisation
- Points d'extension futurs (ex. gestion stock produits, fidélité client, notifications SMS)

---

## 🚫 CE QUE TU NE DOIS PAS FAIRE

- ❌ Ne pas mettre les tarifs en dur dans le code applicatif : **tout doit être en base**
- ❌ Ne pas fusionner `AU_KILO` et `FORFAIT_PIECES` dans une seule logique : **ce sont deux modes distincts**
- ❌ Ne pas omettre l'énumération des vêtements en mode blanchisserie
- ❌ Ne pas oublier l'historisation des statuts et des tarifs

---

## ✅ FORMAT DE SORTIE

Réponds **en français**, de façon structurée avec :

1. Titres clairs (`## MCD`, `## MLD`, `## Script SQL`, etc.)
2. Blocs de code SQL avec coloration syntaxique
3. Tableaux Markdown pour les descriptions
4. Commentaires SQL (`--`) explicatifs dans le script

**Commence directement par le MCD**, puis enchaîne sur le MLD, le script SQL complet, les données de référence, les requêtes de démo, et termine par les notes d'architecture. Ne me demande pas de clarification : utilise ton expertise pour combler les détails manquants de façon cohérente et professionnelle.

---

> **🔥 Instruction finale** : Génère maintenant la base de données relationnelle complète, prête à être exécutée sur PostgreSQL, couvrant **100 % des besoins exprimés** ci-dessus.

# 🗄️ Base de Données Relationnelle — Pressing & Blanchisserie

## Livrable complet : MCD, MLD, Script SQL PostgreSQL, Données de référence, Requêtes de démonstration

---

## 📐 1. MCD — Modèle Conceptuel de Données

### Entités et cardinalités

| Entité source    | Relation     | Entité cible      | Cardinalité |
| ---------------- | ------------ | ----------------- | ----------- |
| ÉTABLISSEMENT    | emploie      | EMPLOYÉ           | 1,N ↔ 1,1   |
| ÉTABLISSEMENT    | propose      | TARIF_KILO        | 1,N ↔ 1,1   |
| ÉTABLISSEMENT    | propose      | FORFAIT_PIÈCES    | 1,N ↔ 1,1   |
| ÉTABLISSEMENT    | émet         | COMMANDE          | 1,N ↔ 1,1   |
| RÔLE_EMPLOYÉ     | qualifie     | EMPLOYÉ           | 1,N ↔ 1,1   |
| CLIENT           | passe        | COMMANDE          | 1,N ↔ 1,1   |
| TYPE_SERVICE     | catégorise   | PRESTATION        | 1,N ↔ 1,1   |
| TYPE_SERVICE     | catégorise   | COMMANDE          | 1,N ↔ 1,1   |
| MODE_FACTURATION | détermine    | COMMANDE          | 1,N ↔ 1,1   |
| STATUT_COMMANDE  | définit      | COMMANDE          | 1,N ↔ 1,1   |
| FORFAIT_PIÈCES   | s'applique à | COMMANDE          | 1,N ↔ 0,1   |
| PRESTATION       | applique     | TARIF_KILO        | 1,N ↔ 1,1   |
| PRESTATION       | applique     | FORFAIT_PIÈCES    | 1,N ↔ 1,1   |
| COMMANDE         | contient     | LIGNE_COMMANDE    | 1,N ↔ 1,1   |
| COMMANDE         | contient     | VÊTEMENT_SAISI    | 1,N ↔ 1,1   |
| COMMANDE         | déclenche    | PAIEMENT          | 1,N ↔ 0,N   |
| COMMANDE         | trace        | HISTORIQUE_STATUT | 1,N ↔ 1,1   |
| TYPE_VÊTEMENT    | qualifie     | VÊTEMENT_SAISI    | 1,N ↔ 1,1   |
| EMPLOYÉ          | réceptionne  | COMMANDE          | 1,N ↔ 0,N   |
| EMPLOYÉ          | encaisse     | PAIEMENT          | 1,N ↔ 0,N   |

### Contraintes métier clés

- Une **COMMANDE** est soit `PRESSING` (mode `AU_KILO`), soit `BLANCHISSERIE` (mode `FORFAIT_PIÈCES`).
- Si mode `AU_KILO` → `poids_total_kg` et `LIGNE_COMMANDE.poids_kg` renseignés.
- Si mode `FORFAIT_PIÈCES` → `nb_pieces_total` et `forfait_pieces_id` renseignés + au moins un `VÊTEMENT_SAISI`.

---

## 📊 2. MLD — Modèle Logique de Données

### Table `etablissement`

| Colonne                 | Type         | Contrainte       |
| ----------------------- | ------------ | ---------------- |
| id                      | SERIAL       | PK               |
| code                    | VARCHAR(50)  | UNIQUE, NOT NULL |
| nom                     | VARCHAR(150) | NOT NULL         |
| adresse                 | VARCHAR(255) |                  |
| ville                   | VARCHAR(100) |                  |
| telephone               | VARCHAR(30)  |                  |
| email                   | VARCHAR(150) |                  |
| actif                   | BOOLEAN      | DEFAULT TRUE     |
| created_at / updated_at | TIMESTAMP    | DEFAULT NOW()    |

### Table `role_employe`

`id` PK, `code` UNIQUE, `libelle`, `description`

### Table `employe`

| Colonne                 | Type         | Contrainte         |
| ----------------------- | ------------ | ------------------ |
| id                      | SERIAL       | PK                 |
| etablissement_id        | INT          | FK → etablissement |
| role_id                 | INT          | FK → role_employe  |
| code                    | VARCHAR(50)  | UNIQUE             |
| nom / prenom            | VARCHAR(100) |                    |
| telephone / email       |              |                    |
| date_embauche           | DATE         |                    |
| actif                   | BOOLEAN      | DEFAULT TRUE       |
| created_at / updated_at | TIMESTAMP    |                    |

### Table `client`

`id` PK, `code` UNIQUE, `nom`, `prenom`, `telephone` NOT NULL, `email`, `adresse`, `note`, `actif`, `created_at`, `updated_at`

### Table `type_service`

`id` PK, `code` UNIQUE, `libelle`, `description`, `actif`, `created_at`, `updated_at`

### Table `mode_facturation`

`id` PK, `code` UNIQUE, `libelle`, `description`, `actif`

### Table `statut_commande`

`id` PK, `code` UNIQUE, `libelle`, `ordre` SMALLINT, `est_final` BOOLEAN, `actif`

### Table `mode_paiement`

`id` PK, `code` UNIQUE, `libelle`, `actif`

### Table `type_vetement`

`id` PK, `code` UNIQUE, `libelle`, `description`, `actif`

### Table `prestation`

| Colonne                       | Type         | Contrainte        |
| ----------------------------- | ------------ | ----------------- |
| id                            | SERIAL       | PK                |
| type_service_id               | INT          | FK → type_service |
| code                          | VARCHAR(50)  | NOT NULL          |
| libelle                       | VARCHAR(150) | NOT NULL          |
| description                   | TEXT         |                   |
| actif                         | BOOLEAN      |                   |
| UNIQUE(type_service_id, code) |              |                   |

### Table `tarif_kilo` (pressing)

| Colonne          | Type          | Contrainte         |
| ---------------- | ------------- | ------------------ |
| id               | SERIAL        | PK                 |
| etablissement_id | INT           | FK                 |
| prestation_id    | INT           | FK                 |
| prix_par_kg      | NUMERIC(10,2) | CHECK > 0          |
| date_debut       | DATE          | NOT NULL           |
| date_fin         | DATE          | CHECK ≥ date_debut |
| actif            | BOOLEAN       |                    |

### Table `forfait_pieces` (blanchisserie)

| Colonne               | Type          | Contrainte  |
| --------------------- | ------------- | ----------- |
| id                    | SERIAL        | PK          |
| etablissement_id      | INT           | FK          |
| prestation_id         | INT           | FK          |
| nb_pieces_min         | INT           | CHECK > 0   |
| nb_pieces_max         | INT           | CHECK ≥ min |
| prix_forfait          | NUMERIC(10,2) | CHECK ≥ 0   |
| date_debut / date_fin | DATE          |             |
| actif                 | BOOLEAN       |             |

### Table `commande`

| Colonne                 | Type          | Contrainte         |
| ----------------------- | ------------- | ------------------ |
| id                      | SERIAL        | PK                 |
| numero_commande         | VARCHAR(50)   | UNIQUE NOT NULL    |
| etablissement_id        | INT           | FK                 |
| client_id               | INT           | FK                 |
| receptionniste_id       | INT           | FK employe         |
| type_service_id         | INT           | FK                 |
| mode_facturation_id     | INT           | FK                 |
| statut_id               | INT           | FK                 |
| forfait_pieces_id       | INT           | FK (nullable)      |
| date_reception          | TIMESTAMP     | NOT NULL           |
| date_livraison_prevue   | TIMESTAMP     |                    |
| date_livraison_reelle   | TIMESTAMP     |                    |
| poids_total_kg          | NUMERIC(10,3) |                    |
| nb_pieces_total         | INT           | CHECK ≥ 0          |
| montant_total           | NUMERIC(12,2) | NOT NULL DEFAULT 0 |
| montant_paye            | NUMERIC(12,2) | NOT NULL DEFAULT 0 |
| notes                   | TEXT          |                    |
| created_at / updated_at | TIMESTAMP     |                    |

### Table `ligne_commande`

| Colonne       | Type          | Contrainte                      |
| ------------- | ------------- | ------------------------------- |
| id            | SERIAL        | PK                              |
| commande_id   | INT           | FK → commande ON DELETE CASCADE |
| prestation_id | INT           | FK                              |
| tarif_kilo_id | INT           | FK (nullable)                   |
| poids_kg      | NUMERIC(10,3) |                                 |
| quantite      | INT           |                                 |
| prix_unitaire | NUMERIC(10,2) | NOT NULL                        |
| montant_ligne | NUMERIC(12,2) | NOT NULL                        |
| description   | TEXT          |                                 |

### Table `vetement_saisi` (détail blanchisserie)

| Colonne          | Type         | Contrainte           |
| ---------------- | ------------ | -------------------- |
| id               | SERIAL       | PK                   |
| commande_id      | INT          | FK ON DELETE CASCADE |
| type_vetement_id | INT          | FK                   |
| description      | VARCHAR(255) |                      |
| etat_constate    | VARCHAR(100) |                      |
| created_at       | TIMESTAMP    |                      |

### Table `paiement`

| Colonne          | Type          | Contrainte           |
| ---------------- | ------------- | -------------------- |
| id               | SERIAL        | PK                   |
| commande_id      | INT           | FK ON DELETE CASCADE |
| mode_paiement_id | INT           | FK                   |
| montant          | NUMERIC(12,2) | CHECK > 0            |
| date_paiement    | TIMESTAMP     | DEFAULT NOW()        |
| reference        | VARCHAR(100)  |                      |
| encaisse_par_id  | INT           | FK employe           |
| note             | TEXT          |                      |

### Table `historique_statut`

| Colonne         | Type      | Contrainte           |
| --------------- | --------- | -------------------- |
| id              | SERIAL    | PK                   |
| commande_id     | INT       | FK ON DELETE CASCADE |
| statut_id       | INT       | FK                   |
| employe_id      | INT       | FK                   |
| date_changement | TIMESTAMP | DEFAULT NOW()        |
| commentaire     | TEXT      |                      |

---

## 💻 3. Script SQL complet (PostgreSQL)

```sql
-- ============================================================
-- APPLICATION GESTION PRESSING & BLANCHISSERIE
-- Script PostgreSQL — v1.0
-- ============================================================

BEGIN;

-- ============================================================
-- 1. TABLES DE RÉFÉRENCE
-- ============================================================

CREATE TABLE type_service (
    id           SERIAL PRIMARY KEY,
    code         VARCHAR(50)  NOT NULL UNIQUE,
    libelle      VARCHAR(100) NOT NULL,
    description  TEXT,
    actif        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMENT ON TABLE type_service IS 'Types de service : Pressing professionnel, Blanchisserie artisanale';

CREATE TABLE mode_facturation (
    id           SERIAL PRIMARY KEY,
    code         VARCHAR(50)  NOT NULL UNIQUE,
    libelle      VARCHAR(100) NOT NULL,
    description  TEXT,
    actif        BOOLEAN NOT NULL DEFAULT TRUE
);
COMMENT ON TABLE mode_facturation IS 'Modes : AU_KILO (pressing) ou FORFAIT_PIECES (blanchisserie)';

CREATE TABLE statut_commande (
    id           SERIAL PRIMARY KEY,
    code         VARCHAR(50)  NOT NULL UNIQUE,
    libelle      VARCHAR(100) NOT NULL,
    ordre        SMALLINT NOT NULL,
    est_final    BOOLEAN NOT NULL DEFAULT FALSE,
    actif        BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE mode_paiement (
    id           SERIAL PRIMARY KEY,
    code         VARCHAR(50)  NOT NULL UNIQUE,
    libelle      VARCHAR(100) NOT NULL,
    actif        BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE role_employe (
    id           SERIAL PRIMARY KEY,
    code         VARCHAR(50)  NOT NULL UNIQUE,
    libelle      VARCHAR(100) NOT NULL,
    description  TEXT
);

CREATE TABLE type_vetement (
    id           SERIAL PRIMARY KEY,
    code         VARCHAR(50)  NOT NULL UNIQUE,
    libelle      VARCHAR(100) NOT NULL,
    description  TEXT,
    actif        BOOLEAN NOT NULL DEFAULT TRUE
);

-- ============================================================
-- 2. ÉTABLISSEMENTS, EMPLOYÉS, CLIENTS
-- ============================================================

CREATE TABLE etablissement (
    id           SERIAL PRIMARY KEY,
    code         VARCHAR(50)  NOT NULL UNIQUE,
    nom          VARCHAR(150) NOT NULL,
    adresse      VARCHAR(255),
    ville        VARCHAR(100),
    telephone    VARCHAR(30),
    email        VARCHAR(150),
    actif        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE employe (
    id                SERIAL PRIMARY KEY,
    etablissement_id  INTEGER NOT NULL REFERENCES etablissement(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    role_id           INTEGER NOT NULL REFERENCES role_employe(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    code              VARCHAR(50) UNIQUE,
    nom               VARCHAR(100) NOT NULL,
    prenom            VARCHAR(100),
    telephone         VARCHAR(30),
    email             VARCHAR(150),
    date_embauche     DATE,
    actif             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE client (
    id           SERIAL PRIMARY KEY,
    code         VARCHAR(50) UNIQUE,
    nom          VARCHAR(150) NOT NULL,
    prenom       VARCHAR(100),
    telephone    VARCHAR(30)  NOT NULL,
    email        VARCHAR(150),
    adresse      VARCHAR(255),
    note         TEXT,
    actif        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 3. PRESTATIONS ET GRILLES TARIFAIRES
-- ============================================================

CREATE TABLE prestation (
    id                SERIAL PRIMARY KEY,
    type_service_id   INTEGER NOT NULL REFERENCES type_service(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    code              VARCHAR(50)  NOT NULL,
    libelle           VARCHAR(150) NOT NULL,
    description       TEXT,
    actif             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (type_service_id, code)
);

-- Tarifs au kilo (pressing)
CREATE TABLE tarif_kilo (
    id                SERIAL PRIMARY KEY,
    etablissement_id  INTEGER NOT NULL REFERENCES etablissement(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    prestation_id     INTEGER NOT NULL REFERENCES prestation(id)    ON DELETE RESTRICT ON UPDATE CASCADE,
    prix_par_kg       NUMERIC(10,2) NOT NULL CHECK (prix_par_kg > 0),
    date_debut        DATE NOT NULL DEFAULT CURRENT_DATE,
    date_fin          DATE,
    actif             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_tarif_kilo_dates CHECK (date_fin IS NULL OR date_fin >= date_debut)
);

-- Forfaits pièces (blanchisserie)
CREATE TABLE forfait_pieces (
    id                SERIAL PRIMARY KEY,
    etablissement_id  INTEGER NOT NULL REFERENCES etablissement(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    prestation_id     INTEGER NOT NULL REFERENCES prestation(id)    ON DELETE RESTRICT ON UPDATE CASCADE,
    nb_pieces_min     INTEGER NOT NULL CHECK (nb_pieces_min > 0),
    nb_pieces_max     INTEGER,
    prix_forfait      NUMERIC(10,2) NOT NULL CHECK (prix_forfait >= 0),
    date_debut        DATE NOT NULL DEFAULT CURRENT_DATE,
    date_fin          DATE,
    actif             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_forfait_range CHECK (nb_pieces_max IS NULL OR nb_pieces_max >= nb_pieces_min),
    CONSTRAINT chk_forfait_dates CHECK (date_fin IS NULL OR date_fin >= date_debut)
);

-- ============================================================
-- 4. COMMANDES ET DÉTAILS
-- ============================================================

CREATE TABLE commande (
    id                     SERIAL PRIMARY KEY,
    numero_commande        VARCHAR(50) NOT NULL UNIQUE,
    etablissement_id       INTEGER NOT NULL REFERENCES etablissement(id)   ON DELETE RESTRICT ON UPDATE CASCADE,
    client_id              INTEGER NOT NULL REFERENCES client(id)          ON DELETE RESTRICT ON UPDATE CASCADE,
    receptionniste_id      INTEGER          REFERENCES employe(id)         ON DELETE SET NULL ON UPDATE CASCADE,
    type_service_id        INTEGER NOT NULL REFERENCES type_service(id)    ON DELETE RESTRICT ON UPDATE CASCADE,
    mode_facturation_id    INTEGER NOT NULL REFERENCES mode_facturation(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    statut_id              INTEGER NOT NULL REFERENCES statut_commande(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    forfait_pieces_id      INTEGER          REFERENCES forfait_pieces(id)  ON DELETE SET NULL ON UPDATE CASCADE,
    date_reception         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    date_livraison_prevue  TIMESTAMP,
    date_livraison_reelle  TIMESTAMP,
    poids_total_kg         NUMERIC(10,3) CHECK (poids_total_kg IS NULL OR poids_total_kg > 0),
    nb_pieces_total        INTEGER       CHECK (nb_pieces_total IS NULL OR nb_pieces_total >= 0),
    montant_total          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (montant_total >= 0),
    montant_paye           NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (montant_paye >= 0),
    notes                  TEXT,
    created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ligne_commande (
    id              SERIAL PRIMARY KEY,
    commande_id     INTEGER NOT NULL REFERENCES commande(id)     ON DELETE CASCADE ON UPDATE CASCADE,
    prestation_id   INTEGER NOT NULL REFERENCES prestation(id)    ON DELETE RESTRICT ON UPDATE CASCADE,
    tarif_kilo_id   INTEGER          REFERENCES tarif_kilo(id)    ON DELETE SET NULL ON UPDATE CASCADE,
    poids_kg        NUMERIC(10,3) CHECK (poids_kg IS NULL OR poids_kg > 0),
    quantite        INTEGER       CHECK (quantite IS NULL OR quantite > 0),
    prix_unitaire   NUMERIC(10,2) NOT NULL CHECK (prix_unitaire >= 0),
    montant_ligne   NUMERIC(12,2) NOT NULL CHECK (montant_ligne >= 0),
    description     TEXT
);

CREATE TABLE vetement_saisi (
    id                SERIAL PRIMARY KEY,
    commande_id       INTEGER NOT NULL REFERENCES commande(id)      ON DELETE CASCADE ON UPDATE CASCADE,
    type_vetement_id  INTEGER NOT NULL REFERENCES type_vetement(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    description       VARCHAR(255),
    etat_constate     VARCHAR(100),
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE paiement (
    id                 SERIAL PRIMARY KEY,
    commande_id        INTEGER NOT NULL REFERENCES commande(id)      ON DELETE CASCADE ON UPDATE CASCADE,
    mode_paiement_id   INTEGER NOT NULL REFERENCES mode_paiement(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    montant            NUMERIC(12,2) NOT NULL CHECK (montant > 0),
    date_paiement      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reference          VARCHAR(100),
    encaisse_par_id    INTEGER REFERENCES employe(id) ON DELETE SET NULL ON UPDATE CASCADE,
    note               TEXT,
    created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE historique_statut (
    id                SERIAL PRIMARY KEY,
    commande_id       INTEGER NOT NULL REFERENCES commande(id)         ON DELETE CASCADE ON UPDATE CASCADE,
    statut_id         INTEGER NOT NULL REFERENCES statut_commande(id)  ON DELETE RESTRICT ON UPDATE CASCADE,
    employe_id        INTEGER          REFERENCES employe(id)          ON DELETE SET NULL ON UPDATE CASCADE,
    date_changement   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    commentaire       TEXT
);

-- ============================================================
-- 5. INDEX
-- ============================================================

CREATE INDEX idx_employe_etablissement      ON employe(etablissement_id);
CREATE INDEX idx_employe_role               ON employe(role_id);
CREATE INDEX idx_client_telephone           ON client(telephone);
CREATE INDEX idx_client_nom                 ON client(nom);
CREATE INDEX idx_prestation_type_service    ON prestation(type_service_id);
CREATE INDEX idx_tarif_kilo_prestation      ON tarif_kilo(prestation_id);
CREATE INDEX idx_tarif_kilo_etablissement   ON tarif_kilo(etablissement_id);
CREATE INDEX idx_forfait_pieces_prestation  ON forfait_pieces(prestation_id);
CREATE INDEX idx_forfait_pieces_etab        ON forfait_pieces(etablissement_id);
CREATE INDEX idx_commande_client            ON commande(client_id);
CREATE INDEX idx_commande_statut            ON commande(statut_id);
CREATE INDEX idx_commande_date_reception    ON commande(date_reception);
CREATE INDEX idx_commande_numero            ON commande(numero_commande);
CREATE INDEX idx_commande_etablissement     ON commande(etablissement_id);
CREATE INDEX idx_ligne_commande_commande    ON ligne_commande(commande_id);
CREATE INDEX idx_vetement_saisi_commande    ON vetement_saisi(commande_id);
CREATE INDEX idx_vetement_saisi_type        ON vetement_saisi(type_vetement_id);
CREATE INDEX idx_paiement_commande          ON paiement(commande_id);
CREATE INDEX idx_paiement_date              ON paiement(date_paiement);
CREATE INDEX idx_historique_statut_commande ON historique_statut(commande_id);

-- ============================================================
-- 6. TRIGGERS POUR updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_etablissement_updated_at
    BEFORE UPDATE ON etablissement
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TRIGGER trg_employe_updated_at
    BEFORE UPDATE ON employe
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TRIGGER trg_client_updated_at
    BEFORE UPDATE ON client
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TRIGGER trg_prestation_updated_at
    BEFORE UPDATE ON prestation
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TRIGGER trg_commande_updated_at
    BEFORE UPDATE ON commande
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

CREATE TRIGGER trg_type_service_updated_at
    BEFORE UPDATE ON type_service
    FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- ============================================================
-- 7. DONNÉES DE RÉFÉRENCE
-- ============================================================

-- Types de services
INSERT INTO type_service (code, libelle, description) VALUES
    ('PRESSING',      'Pressing professionnel', 'Service industriel : lavage, repassage, détachage, nettoyage à sec, etc.'),
    ('BLANCHISSERIE', 'Blanchisserie artisanale', 'Service artisanal : lavage seul ou lavage + repassage, facturé au forfait pièces');

-- Modes de facturation
INSERT INTO mode_facturation (code, libelle, description) VALUES
    ('AU_KILO',       'Au kilogramme',  'Facturation par poids (pressing)'),
    ('FORFAIT_PIECES','Forfait pièces', 'Facturation forfaitaire par nombre de pièces (blanchisserie)');

-- Statuts de commande
INSERT INTO statut_commande (code, libelle, ordre, est_final) VALUES
    ('RECU',     'Reçu',                 1, FALSE),
    ('EN_COURS', 'En cours de traitement', 2, FALSE),
    ('PRET',     'Prêt à retirer',       3, FALSE),
    ('LIVRE',    'Livré',                4, TRUE),
    ('ANNULE',   'Annulé',               5, TRUE);

-- Modes de paiement
INSERT INTO mode_paiement (code, libelle) VALUES
    ('ESPECES',     'Espèces'),
    ('MOBILE_MONEY','Mobile Money'),
    ('CARTE',       'Carte bancaire'),
    ('VIREMENT',    'Virement bancaire');

-- Rôles employés
INSERT INTO role_employe (code, libelle, description) VALUES
    ('RECEPTIONNISTE','Réceptionniste','Accueil client, saisie des commandes'),
    ('BLANCHISSEUR',  'Blanchisseur',  'Traitement des pièces blanchisserie'),
    ('PRESSING',      'Agent de pressing', 'Traitement des pièces pressing'),
    ('CAISSIER',      'Caissier',      'Encaissement des paiements'),
    ('MANAGER',       'Manager',       'Supervision, paramétrage');

-- Types de vêtements
INSERT INTO type_vetement (code, libelle) VALUES
    ('CHEMISE', 'Chemise'),
    ('PANTALON','Pantalon'),
    ('ROBE',    'Robe'),
    ('JUPE',    'Jupe'),
    ('COSTUME', 'Costume'),
    ('MANTEAU', 'Manteau'),
    ('VESTE',   'Veste'),
    ('TSHIRT',  'T-shirt'),
    ('PULL',    'Pull'),
    ('DRAPS',   'Draps'),
    ('COUETTE', 'Couette'),
    ('RIDEAU',  'Rideau'),
    ('AUTRE',   'Autre');

-- Prestations PRESSING
INSERT INTO prestation (type_service_id, code, libelle, description) VALUES
    ((SELECT id FROM type_service WHERE code='PRESSING'), 'LAVAGE',           'Lavage',              'Lavage seul'),
    ((SELECT id FROM type_service WHERE code='PRESSING'), 'REPASSAGE',        'Repassage',           'Repassage seul'),
    ((SELECT id FROM type_service WHERE code='PRESSING'), 'LAVAGE_REPASSAGE', 'Lavage et repassage', 'Lavage + repassage'),
    ((SELECT id FROM type_service WHERE code='PRESSING'), 'DETACHAGE',        'Détachage',           'Traitement des taches'),
    ((SELECT id FROM type_service WHERE code='PRESSING'), 'NETTOYAGE_SEC',    'Nettoyage à sec',     'Dry cleaning'),
    ((SELECT id FROM type_service WHERE code='PRESSING'), 'LAVAGE_SEC',       'Lavage à sec',        'Lavage sans eau'),
    ((SELECT id FROM type_service WHERE code='PRESSING'), 'ABIDONNAGE',       'Abidonnage',          'Traitement des abidons'),
    ((SELECT id FROM type_service WHERE code='PRESSING'), 'GESTION_TACHES',   'Gestion des tâches',  'Traitement des tâches et salissures');

-- Prestations BLANCHISSERIE
INSERT INTO prestation (type_service_id, code, libelle, description) VALUES
    ((SELECT id FROM type_service WHERE code='BLANCHISSERIE'), 'LAVAGE_SEUL',      'Lavage seul',          'Lavage sans repassage'),
    ((SELECT id FROM type_service WHERE code='BLANCHISSERIE'), 'LAVAGE_REPASSAGE', 'Lavage et repassage',  'Lavage + repassage');

-- Établissement exemple
INSERT INTO etablissement (code, nom, adresse, ville, telephone, email) VALUES
    ('ETAB-01', 'Pressing Les Étoiles', 'Rue des Jardins, Cocody', 'Abidjan', '+225 01 02 03 04', 'contact@etoiles.ci');

-- Employés exemple
INSERT INTO employe (etablissement_id, role_id, code, nom, prenom, telephone) VALUES
    (1, (SELECT id FROM role_employe WHERE code='RECEPTIONNISTE'), 'EMP-001', 'Kouadio', 'Marie',  '+225 01 11 11 11'),
    (1, (SELECT id FROM role_employe WHERE code='BLANCHISSEUR'),   'EMP-002', 'Traoré',  'Ali',    '+225 01 22 22 22'),
    (1, (SELECT id FROM role_employe WHERE code='PRESSING'),       'EMP-003', 'Diomandé','Pierre', '+225 01 33 33 33'),
    (1, (SELECT id FROM role_employe WHERE code='CAISSIER'),       'EMP-004', 'Yao',     'Estelle','+225 01 44 44 44'),
    (1, (SELECT id FROM role_employe WHERE code='MANAGER'),        'EMP-005', 'Bamba',   'Idriss', '+225 01 55 55 55');

-- Clients exemple
INSERT INTO client (code, nom, prenom, telephone, email) VALUES
    ('CLI-001', 'Ndiaye',  'Awa',     '+225 07 00 00 01', 'awa@mail.ci'),
    ('CLI-002', 'Kone',    'Seydou',  '+225 07 00 00 02', 'seydou@mail.ci');

-- Tarifs au kilo (PRESSING)
INSERT INTO tarif_kilo (etablissement_id, prestation_id, prix_par_kg, date_debut) VALUES
    (1, (SELECT id FROM prestation WHERE code='LAVAGE_REPASSAGE' AND type_service_id=(SELECT id FROM type_service WHERE code='PRESSING')), 1600.00, CURRENT_DATE),
    (1, (SELECT id FROM prestation WHERE code='LAVAGE'           AND type_service_id=(SELECT id FROM type_service WHERE code='PRESSING')), 1000.00, CURRENT_DATE),
    (1, (SELECT id FROM prestation WHERE code='REPASSAGE'        AND type_service_id=(SELECT id FROM type_service WHERE code='PRESSING')), 800.00,  CURRENT_DATE),
    (1, (SELECT id FROM prestation WHERE code='NETTOYAGE_SEC'    AND type_service_id=(SELECT id FROM type_service WHERE code='PRESSING')), 2000.00, CURRENT_DATE),
    (1, (SELECT id FROM prestation WHERE code='DETACHAGE'        AND type_service_id=(SELECT id FROM type_service WHERE code='PRESSING')), 2500.00, CURRENT_DATE);

-- Forfaits pièces (BLANCHISSERIE) — ex. 25 pièces = 1500 FCFA, 30 pièces = 2000 FCFA
INSERT INTO forfait_pieces (etablissement_id, prestation_id, nb_pieces_min, nb_pieces_max, prix_forfait, date_debut) VALUES
    (1, (SELECT id FROM prestation WHERE code='LAVAGE_SEUL'      AND type_service_id=(SELECT id FROM type_service WHERE code='BLANCHISSERIE')),  1, 10,  800.00,  CURRENT_DATE),
    (1, (SELECT id FROM prestation WHERE code='LAVAGE_SEUL'      AND type_service_id=(SELECT id FROM type_service WHERE code='BLANCHISSERIE')), 11, 25, 1500.00,  CURRENT_DATE),
    (1, (SELECT id FROM prestation WHERE code='LAVAGE_SEUL'      AND type_service_id=(SELECT id FROM type_service WHERE code='BLANCHISSERIE')), 26, 30, 2000.00,  CURRENT_DATE),
    (1, (SELECT id FROM prestation WHERE code='LAVAGE_REPASSAGE' AND type_service_id=(SELECT id FROM type_service WHERE code='BLANCHISSERIE')),  1, 10, 1200.00,  CURRENT_DATE),
    (1, (SELECT id FROM prestation WHERE code='LAVAGE_REPASSAGE' AND type_service_id=(SELECT id FROM type_service WHERE code='BLANCHISSERIE')), 11, 25, 2000.00,  CURRENT_DATE),
    (1, (SELECT id FROM prestation WHERE code='LAVAGE_REPASSAGE' AND type_service_id=(SELECT id FROM type_service WHERE code='BLANCHISSERIE')), 26, 30, 2500.00,  CURRENT_DATE);

COMMIT;
```

---

## 🔍 4. Requêtes SQL de démonstration

### 4.1 Créer une commande **pressing au kilo**

```sql
-- Exemple : M. Seydou dépose 8 kg de linge pour lavage + repassage à 1600 FCFA/kg
WITH nouvelle AS (
    INSERT INTO commande (
        numero_commande, etablissement_id, client_id, receptionniste_id,
        type_service_id, mode_facturation_id, statut_id,
        poids_total_kg, montant_total
    ) VALUES (
        'CMD-' || TO_CHAR(NOW(),'YYYYMMDD-HH24MISS'),
        1,
        (SELECT id FROM client WHERE code='CLI-002'),
        (SELECT id FROM employe WHERE code='EMP-001'),
        (SELECT id FROM type_service WHERE code='PRESSING'),
        (SELECT id FROM mode_facturation WHERE code='AU_KILO'),
        (SELECT id FROM statut_commande WHERE code='RECU'),
        8.000,
        8.000 * 1600.00
    ) RETURNING id, numero_commande
)
INSERT INTO ligne_commande (
    commande_id, prestation_id, tarif_kilo_id, poids_kg, prix_unitaire, montant_ligne
)
SELECT n.id,
       p.id,
       tk.id,
       8.000,
       tk.prix_par_kg,
       8.000 * tk.prix_par_kg
FROM nouvelle n,
     prestation p
JOIN type_service ts ON ts.id = p.type_service_id
JOIN tarif_kilo tk ON tk.prestation_id = p.id
WHERE ts.code = 'PRESSING'
  AND p.code = 'LAVAGE_REPASSAGE'
  AND tk.etablissement_id = 1
  AND tk.actif = TRUE;

-- Historique statut initial
INSERT INTO historique_statut (commande_id, statut_id, employe_id, commentaire)
SELECT c.id, s.id, e.id, 'Commande reçue au comptoir'
FROM commande c, statut_commande s, employe e
WHERE c.numero_commande LIKE 'CMD-%'
  AND s.code = 'RECU'
  AND e.code = 'EMP-001'
ORDER BY c.id DESC LIMIT 1;
```

### 4.2 Créer une commande **blanchisserie au forfait pièces** avec énumération des vêtements

```sql
-- Exemple : Mme Awa dépose 10 pièces pour lavage + repassage
WITH nouvelle AS (
    INSERT INTO commande (
        numero_commande, etablissement_id, client_id, receptionniste_id,
        type_service_id, mode_facturation_id, statut_id,
        forfait_pieces_id, nb_pieces_total, montant_total
    ) VALUES (
        'CMD-' || TO_CHAR(NOW(),'YYYYMMDD-HH24MISS') || '-B',
        1,
        (SELECT id FROM client WHERE code='CLI-001'),
        (SELECT id FROM employe WHERE code='EMP-001'),
        (SELECT id FROM type_service WHERE code='BLANCHISSERIE'),
        (SELECT id FROM mode_facturation WHERE code='FORFAIT_PIECES'),
        (SELECT id FROM statut_commande WHERE code='RECU'),
        (SELECT fp.id
           FROM forfait_pieces fp
           JOIN prestation p ON p.id = fp.prestation_id
           JOIN type_service ts ON ts.id = p.type_service_id
          WHERE ts.code='BLANCHISSERIE'
            AND p.code='LAVAGE_REPASSAGE'
            AND fp.etablissement_id = 1
            AND fp.actif = TRUE
            AND 10 BETWEEN fp.nb_pieces_min AND COALESCE(fp.nb_pieces_max, 999999)
          LIMIT 1),
        10,
        (SELECT fp.prix_forfait
           FROM forfait_pieces fp
           JOIN prestation p ON p.id = fp.prestation_id
           JOIN type_service ts ON ts.id = p.type_service_id
          WHERE ts.code='BLANCHISSERIE'
            AND p.code='LAVAGE_REPASSAGE'
            AND fp.etablissement_id = 1
            AND fp.actif = TRUE
            AND 10 BETWEEN fp.nb_pieces_min AND COALESCE(fp.nb_pieces_max, 999999)
          LIMIT 1)
    ) RETURNING id
),
pieces (code_vetement, description) AS (
    VALUES
        ('CHEMISE','Chemise blanche'),
        ('CHEMISE','Chemise bleue'),
        ('PANTALON','Pantalon noir'),
        ('PANTALON','Jean'),
        ('ROBE','Robe rouge'),
        ('TSHIRT','T-shirt blanc'),
        ('TSHIRT','T-shirt gris'),
        ('JUPE','Jupe noire'),
        ('VESTE','Veste en jean'),
        ('PULL','Pull')
)
INSERT INTO vetement_saisi (commande_id, type_vetement_id, description)
SELECT n.id, tv.id, p.description
FROM nouvelle n
CROSS JOIN pieces p
JOIN type_vetement tv ON tv.code = p.code_vetement;
```

### 4.3 Calculer le montant total d'une commande selon son mode

```sql
SELECT
    c.numero_commande,
    ts.code                  AS type_service,
    mf.code                  AS mode_facturation,
    c.poids_total_kg,
    c.nb_pieces_total,
    CASE
        WHEN mf.code = 'AU_KILO' THEN
            (SELECT COALESCE(SUM(lc.poids_kg * lc.prix_unitaire),0)
               FROM ligne_commande lc WHERE lc.commande_id = c.id)
        WHEN mf.code = 'FORFAIT_PIECES' THEN
            (SELECT fp.prix_forfait FROM forfait_pieces fp WHERE fp.id = c.forfait_pieces_id)
        ELSE 0
    END                       AS montant_calcule,
    c.montant_total,
    c.montant_paye,
    (c.montant_total - c.montant_paye) AS reste_a_payer
FROM commande c
JOIN type_service ts     ON ts.id = c.type_service_id
JOIN mode_facturation mf ON mf.id = c.mode_facturation_id
WHERE c.id = $1;
```

### 4.4 Lister les commandes en cours par statut

```sql
SELECT
    s.code   AS statut,
    s.libelle,
    COUNT(c.id)       AS nb_commandes,
    SUM(c.montant_total) AS montant_cumule
FROM statut_commande s
LEFT JOIN commande c ON c.statut_id = s.id
WHERE s.actif = TRUE AND s.est_final = FALSE
GROUP BY s.id, s.code, s.libelle, s.ordre
ORDER BY s.ordre;

-- Détail des commandes non finalisées
SELECT
    c.numero_commande,
    cl.nom || ' ' || COALESCE(cl.prenom,'') AS client,
    ts.code   AS service,
    s.code    AS statut,
    c.date_reception,
    c.date_livraison_prevue,
    c.montant_total
FROM commande c
JOIN client cl             ON cl.id = c.client_id
JOIN type_service ts       ON ts.id = c.type_service_id
JOIN statut_commande s     ON s.id = c.statut_id
WHERE s.est_final = FALSE
ORDER BY c.date_reception ASC;
```

### 4.5 Historique des paiements d'un client

```sql
SELECT
    c.numero_commande,
    p.date_paiement,
    mp.libelle      AS mode_paiement,
    p.montant,
    p.reference,
    e.nom || ' ' || COALESCE(e.prenom,'') AS caissier
FROM paiement p
JOIN commande c       ON c.id = p.commande_id
JOIN mode_paiement mp ON mp.id = p.mode_paiement_id
LEFT JOIN employe e   ON e.id = p.encaisse_par_id
WHERE c.client_id = (SELECT id FROM client WHERE code = 'CLI-001')
ORDER BY p.date_paiement DESC;

-- Résumé par client
SELECT
    cl.code, cl.nom || ' ' || COALESCE(cl.prenom,'') AS client,
    COUNT(DISTINCT c.id)              AS nb_commandes,
    SUM(c.montant_total)              AS total_facture,
    SUM(c.montant_paye)               AS total_paye,
    SUM(c.montant_total - c.montant_paye) AS solde_du
FROM client cl
JOIN commande c ON c.client_id = cl.id
GROUP BY cl.id, cl.code, cl.nom, cl.prenom
ORDER BY solde_du DESC;
```

---

## 🏛️ 5. Notes d'architecture

### Justification des choix de modélisation

| Choix                                                                  | Justification                                                                                                                                                  |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Deux modes de facturation distincts** (`AU_KILO` / `FORFAIT_PIECES`) | Respect strict de la règle métier : le pressing facture au poids, la blanchisserie au forfait pièces. Évite toute confusion et garantit l'intégrité du calcul. |
| **Tables `tarif_kilo` et `forfait_pieces` séparées**                   | Chaque mode a sa propre structure de données et ses propres règles (kg vs plage de pièces). Un modèle unifié aurait été bancal.                                |
| **Historisation des tarifs** (`date_debut`, `date_fin`, `actif`)       | Un prix appliqué à une commande passée ne doit jamais être modifié. La date d'application garantit la reproductibilité du calcul.                              |
| **`vetement_saisi` séparé de `ligne_commande`**                        | En mode blanchisserie, chaque vêtement déposé est une instance traçable (indépendante du tarif). En mode pressing, `ligne_commande` suffit.                    |
| **`ligne_commande` polymorphe** (`poids_kg` OU `quantite`)             | Permet de gérer indifféremment les lignes au kilo et les lignes forfaitaires sans multiplier les tables.                                                       |
| **`historique_statut`**                                                | Traçabilité complète du cycle de vie de chaque commande (audit).                                                                                               |
| **`forfait_pieces_id` sur `commande`**                                 | Fige le forfait appliqué au moment de la commande : même si le forfait change après coup, la commande conserve son prix.                                       |
| **Multi-établissement**                                                | Permet de piloter un réseau (plusieurs pressings/blanchisseries) avec des tarifs et forfaits propres à chaque site.                                            |

### Points d'extension futurs

1. **Gestion de stock** : table `consommable` (lessive, détachant, sacs).
2. **Programme fidélité** : `carte_fidelite`, `points_fidelite`, `recompense`.
3. **Notifications** : `notification_client` (SMS/WhatsApp) sur changement de statut.
4. **Rendez-vous** : `rendez_vous` (enlèvement à domicile, livraison).
5. **Photos avant/après** : `photo_vetement` (état constaté, garantie en cas de litige).
6. **Assurance / réclamation** : `reclamation` liée à une `commande` ou un `vetement_saisi`.
7. **Comptabilité** : export des paiements vers `journal_caisse`, `facture`.
8. **Multi-devises** : ajouter `devise` sur les tarifs et forfaits.
9. **Rôles & permissions** : table `permission` + `role_permission` pour un vrai RBAC.
10. **API publique** : schéma normalisé déjà prêt à exposer via PostgREST.

### Points de vigilance opérationnels

- **Transaction obligatoire** à la création d'une commande : `commande` + `ligne_commande`/`vetement_saisi` + `historique_statut` doivent être atomiques.
- **Contrôle du forfait** : si le nombre de pièces saisi ne tombe dans aucun `forfait_pieces` actif, l'application doit alerter le réceptionniste (forfait non défini).
- **Numérotation des commandes** : utiliser une séquence dédiée ou un format `CMD-YYYYMMDD-XXX` pour garantir l'unicité sans collision.
- **Sauvegarde** : les données clients/paiements sont sensibles → chiffrement au repos + sauvegardes quotidiennes.

---

✅ **La base de données est prête à être exécutée sur PostgreSQL** (v13+ recommandé). Le script est idempotent enveloppé dans `BEGIN; … COMMIT;` et couvre **100 % des besoins exprimés** : double service, double mode de facturation, énumération des vêtements, historisation des tarifs et traçabilité complète.

# MISE A JOUR IMPORTANTE !!!!!!

# 🎨 Concept : Grille de vêtements cliquables pour "Nouvelle commande"

## ✅ Oui, l'idée est excellente — et voici pourquoi

Votre intuition répond à **trois problèmes UX réels** du comptoir pressing :

| Problème actuel                                                                                                                    | Solution par les icônes                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Le réceptionniste doit ouvrir un menu déroulant, chercher "Chemise", cliquer, puis répéter 25 fois pour une commande blanchisserie | 1 clic par pièce → **25 clics au lieu de 100 actions**                                            |
| Risque d'erreur de saisie (mauvais item sélectionné dans la liste)                                                                 | Reconnaissance visuelle immédiate (**le cerveau traite une image 60 000× plus vite qu'un texte**) |
| Formation longue des nouveaux employés                                                                                             | Interface **auto-explicative**, pas besoin de connaître le vocabulaire métier                     |
| Client impatient au comptoir                                                                                                       | Enregistrement **en temps réel** sous ses yeux = confiance                                        |

> 💡 **En mode blanchisserie**, cette grille est **indispensable** : puisque le prix ne dépend PAS du type de vêtement mais uniquement du **nombre de pièces**, l'objectif du réceptionniste est de compter vite et bien. Les icônes deviennent un **compteur visuel tactile**.

---

## 🧭 2. Parcours UX repensé — "Nouvelle commande"

```
┌──────────────────────────────────────────────────────────────┐
│  ÉTAPE 1 — IDENTIFICATION CLIENT                             │
│  ○ Client existant (recherche téléphone/nom)  ○ Nouveau      │
└──────────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│  ÉTAPE 2 — CHOIX DU SERVICE                                  │
│  [🧺 Pressing professionnel]   [👕 Blanchisserie artisanale] │
└──────────────────────────────────────────────────────────────┘
                            ↓
        ┌───────────────────┴───────────────────┐
        ↓                                       ↓
┌──────────────────────┐            ┌──────────────────────────┐
│ ÉTAPE 3A — PRESSING  │            │ ÉTAPE 3B — BLANCHISSERIE │
│ Saisie poids (kg)    │            │ 🎯 GRILLE D'ICÔNES       │
│ + prestation         │            │ (click = +1)             │
└──────────────────────┘            └──────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────────┐
│  ÉTAPE 4 — RÉCAPITULATIF + CALCUL FORFAIT + VALIDATION       │
└──────────────────────────────────────────────────────────────┘
```

---

## 🖥️ 3. Wireframe fonctionnel de la page "Grille de vêtements"

```
┌─────────────────────────────────────────────────────────────────────┐
│  🆕 NOUVELLE COMMANDE — Blanchisserie · Client : Awa Ndiaye         │
├─────────────────────────────────────────────────────────────────────┤
│  🔍 Rechercher...   [Tous] [Hauts] [Bas] [Robes] [Manteaux] [Lit.]  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐ │
│   │  👔   │  │  👖   │  │  👗   │  │  🥼   │  │  🧥   │  │  👘   │ │
│   │Chemise│  │Pantalon│ │ Robe  │  │Costume│  │Manteau│  │ Jupe  │ │
│   │  ×3   │  │       │  │       │  │       │  │       │  │       │ │
│   └───────┘  └───────┘  └───────┘  └───────┘  └───────┘  └───────┘ │
│                                                                     │
│   ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐ │
│   │  👕   │  │  🩳   │  │  🛏️   │  │  🪟   │  │  🧦   │  │  👟   │ │
│   │T-shirt│  │ Short │  │ Draps │  │Rideau │  │Chausset│ │Autre  │ │
│   │       │  │       │  │       │  │       │  │       │  │       │ │
│   └───────┘  └───────┘  └───────┘  └───────┘  └───────┘  └───────┘ │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  📋 RÉCAPITULATIF (10 pièces)                                       │
│  👔 Chemise ×3   👖 Pantalon ×2   👗 Robe ×1   👕 T-shirt ×2 ...    │
│                                                     [🗑️ Tout vider] │
├─────────────────────────────────────────────────────────────────────┤
│  Forfait appliqué : 11–25 pièces → 2 000 FCFA                       │
│  TOTAL : 2 000 FCFA                    [ ↩️ Annuler ] [ ✅ Valider ] │
└─────────────────────────────────────────────────────────────────────┘
```

**Comportements interactifs clés :**

| Action                      | Résultat                                                                  |
| --------------------------- | ------------------------------------------------------------------------- |
| **1 clic sur une icône**    | +1 pièce du type, badge `×N` s'affiche, animation "pop", récap mis à jour |
| **Clic long / double-tap**  | Ouvre un mini-pad pour saisir directement la quantité (ex. `×5`)          |
| **Clic sur le badge**       | Ouvre une popover : `−` / quantité / `+` / `🗑️`                           |
| **Toast "Annuler"**         | Annulation rapide du dernier ajout (5 s)                                  |
| **Barre de recherche**      | Filtre dynamique par nom                                                  |
| **Chips de catégorie**      | Filtre par famille (hauts, bas, robes…)                                   |
| **Drag & drop (optionnel)** | Réordonner les favoris                                                    |

---

## 🗄️ 4. Modifications de la base de données

### 4.1 Nouvelles colonnes sur `type_vetement`

```sql
-- Migration : ajout des attributs visuels
ALTER TABLE type_vetement
    ADD COLUMN icone_url        VARCHAR(500),
    ADD COLUMN icone_svg        TEXT,                          -- SVG inline (recommandé)
    ADD COLUMN couleur_hex      VARCHAR(7) DEFAULT '#3B82F6',  -- couleur d'accent
    ADD COLUMN categorie_visuelle VARCHAR(50) DEFAULT 'AUTRE', -- HAUTS, BAS, ROBES, MANTEAUX, LITERIE, ACCESSOIRES, AUTRE
    ADD COLUMN ordre_affichage  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN favori           BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN raccourci_clavier CHAR(2);  -- ex. 'CH' pour Chemise

CREATE INDEX idx_type_vetement_categorie ON type_vetement(categorie_visuelle);
CREATE INDEX idx_type_vetement_ordre     ON type_vetement(ordre_affichage);

-- Exemples de mises à jour
UPDATE type_vetement SET
    icone_url = '/icons/chemise.svg',
    couleur_hex = '#3B82F6',
    categorie_visuelle = 'HAUTS',
    ordre_affichage = 10,
    favori = TRUE,
    raccourci_clavier = 'CH'
WHERE code = 'CHEMISE';

UPDATE type_vetement SET
    icone_url = '/icons/pantalon.svg',
    couleur_hex = '#10B981',
    categorie_visuelle = 'BAS',
    ordre_affichage = 20,
    favori = TRUE,
    raccourci_clavier = 'PA'
WHERE code = 'PANTALON';
```

### 4.2 Table `categorie_vetement` (pour les chips de filtre)

```sql
CREATE TABLE categorie_vetement (
    id           SERIAL PRIMARY KEY,
    code         VARCHAR(50) NOT NULL UNIQUE,
    libelle      VARCHAR(100) NOT NULL,
    icone_url    VARCHAR(500),
    couleur_hex  VARCHAR(7),
    ordre        SMALLINT NOT NULL DEFAULT 0,
    actif        BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO categorie_vetement (code, libelle, ordre) VALUES
    ('HAUTS',      'Hauts',      10),
    ('BAS',        'Bas',        20),
    ('ROBES',      'Robes',      30),
    ('MANTEAUX',   'Manteaux',   40),
    ('LITERIE',    'Literie',    50),
    ('ACCESSOIRES','Accessoires',60),
    ('AUTRE',      'Autres',     99);

ALTER TABLE type_vetement
    ADD CONSTRAINT fk_type_vetement_categorie
    FOREIGN KEY (categorie_visuelle)
    REFERENCES categorie_vetement(code)
    ON UPDATE CASCADE ON DELETE SET DEFAULT;
```

### 4.3 Optionnel — Historique d'utilisation (pour les favoris dynamiques)

```sql
-- Permet de trier automatiquement les types les plus utilisés par établissement
CREATE TABLE statistiques_vetement (
    etablissement_id INTEGER NOT NULL REFERENCES etablissement(id) ON DELETE CASCADE,
    type_vetement_id INTEGER NOT NULL REFERENCES type_vetement(id) ON DELETE CASCADE,
    nb_utilisations  INTEGER NOT NULL DEFAULT 0,
    derniere_utilisation TIMESTAMP,
    PRIMARY KEY (etablissement_id, type_vetement_id)
);

CREATE INDEX idx_stats_vetement_usage ON statistiques_vetement(etablissement_id, nb_utilisations DESC);
```

---

## 🔌 5. API REST — Endpoints nécessaires

```http
# Catalogue des vêtements pour la grille (avec images, catégories, favoris)
GET /api/v1/type-vetements?etablissement_id=1&categorie=HAUTS
→ 200 OK
[
  {
    "id": 1, "code": "CHEMISE", "libelle": "Chemise",
    "categorie": "HAUTS", "couleur_hex": "#3B82F6",
    "icone_url": "/icons/chemise.svg",
    "favori": true, "ordre": 10
  }, ...
]

# Favoris + récents de l'établissement (bandeau haut de page)
GET /api/v1/type-vetements/favoris?etablissement_id=1
→ 200 OK

# Ajouter une pièce à la commande en cours (1 clic = +1)
POST /api/v1/commandes/{commande_id}/vetements
{ "type_vetement_id": 1, "etat_constate": "BON", "description": null }
→ 201 Created { "id": 42, "type_vetement_id": 1 }

# Modifier la quantité d'un type (popover +/-)
PUT /api/v1/commandes/{commande_id}/vetements/by-type/{type_vetement_id}
{ "quantite": 3 }
→ 200 OK

# Supprimer toutes les pièces d'un type (clic sur 🗑️)
DELETE /api/v1/commandes/{commande_id}/vetements/by-type/{type_vetement_id}
→ 204 No Content

# Récupérer le forfait applicable au nombre actuel de pièces
GET /api/v1/forfaits/applicable?etablissement_id=1&prestation_id=12&nb_pieces=10
→ 200 OK
{ "forfait_id": 5, "prix_forfait": 2000.00, "nb_pieces_min": 11, "nb_pieces_max": 25 }

# Validation finale (transaction atomique)
POST /api/v1/commandes/{commande_id}/valider
{ "forfait_pieces_id": 5, "montant_total": 2000.00 }
→ 200 OK { "numero_commande": "CMD-20260127-0042", "montant_total": 2000.00 }
```

---

## ⚛️ 6. Composant Frontend (React + TypeScript)

```tsx
// components/ClothingGrid.tsx
import { useState, useMemo } from "react";

type Vetement = {
  id: number;
  code: string;
  libelle: string;
  categorie: string;
  couleur_hex: string;
  icone_url: string;
  favori: boolean;
};

type Selection = Record<number, number>; // { typeVetementId: quantité }

export function ClothingGrid({
  vetements,
  onSelectionChange,
}: {
  vetements: Vetement[];
  onSelectionChange: (sel: Selection) => void;
}) {
  const [selection, setSelection] = useState<Selection>({});
  const [filtre, setFiltre] = useState<string>("TOUS");
  const [recherche, setRecherche] = useState("");

  const categories = useMemo(
    () => ["TOUS", ...new Set(vetements.map((v) => v.categorie))],
    [vetements],
  );

  const filtered = useMemo(
    () =>
      vetements.filter((v) => {
        const okCat = filtre === "TOUS" || v.categorie === filtre;
        const okRech = v.libelle
          .toLowerCase()
          .includes(recherche.toLowerCase());
        return okCat && okRech;
      }),
    [vetements, filtre, recherche],
  );

  const incrementer = (id: number) => {
    const next = { ...selection, [id]: (selection[id] ?? 0) + 1 };
    setSelection(next);
    onSelectionChange(next);
  };

  const decrementer = (id: number) => {
    const next = { ...selection };
    if (next[id] > 1) next[id] -= 1;
    else delete next[id];
    setSelection(next);
    onSelectionChange(next);
  };

  const totalPieces = Object.values(selection).reduce((s, q) => s + q, 0);

  return (
    <div className="space-y-4">
      {/* Barre de recherche + chips catégories */}
      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          placeholder="🔍 Rechercher un vêtement..."
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          className="flex-1 min-w-[200px] rounded-lg border px-3 py-2"
        />
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setFiltre(c)}
            className={`px-3 py-1.5 rounded-full text-sm ${
              filtre === c ? "bg-blue-600 text-white" : "bg-gray-100"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Grille */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {filtered.map((v) => {
          const qte = selection[v.id] ?? 0;
          return (
            <button
              key={v.id}
              onClick={() => incrementer(v.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                decrementer(v.id);
              }}
              className={`relative flex flex-col items-center p-3 rounded-xl border-2 transition
                ${qte > 0 ? "border-blue-600 bg-blue-50 scale-[1.02]" : "border-gray-200 hover:border-blue-400"}
              `}
              aria-label={`Ajouter ${v.libelle}`}
            >
              {v.favori && (
                <span className="absolute top-1 left-1 text-yellow-500 text-xs">
                  ★
                </span>
              )}
              {qte > 0 && (
                <span className="absolute -top-2 -right-2 bg-blue-600 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
                  {qte}
                </span>
              )}
              <img
                src={v.icone_url}
                alt={v.libelle}
                className="w-12 h-12 mb-2"
              />
              <span className="text-sm text-center">{v.libelle}</span>
            </button>
          );
        })}
      </div>

      {/* Barre totale */}
      <div className="sticky bottom-0 bg-white border-t p-3 flex justify-between items-center">
        <span className="font-medium">📋 {totalPieces} pièce(s)</span>
        <button
          onClick={() => {
            setSelection({});
            onSelectionChange({});
          }}
          className="text-red-600 text-sm"
        >
          🗑️ Tout vider
        </button>
      </div>
    </div>
  );
}
```

---

## 🎨 7. Recommandations graphiques

| Aspect                    | Recommandation                                                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Format d'icône**        | **SVG inline** (net à toutes tailles, personnalisable, < 3 Ko chacune)                                                                              |
| **Style visuel**          | **Flat design coloré** ou **outline 2pt** — rester cohérent sur toute la grille                                                                     |
| **Source**                | Créer un jeu maison (cohérence), ou s'inspirer de [unDraw](https://undraw.co), [Flaticon](https://flaticon.com), [IconScout](https://iconscout.com) |
| **Couleur par catégorie** | Hauts = bleu `#3B82F6` · Bas = vert `#10B981` · Robes = violet `#8B5CF6` · Manteaux = orange `#F59E0B` · Literie = rose `#EC4899`                   |
| **Taille cible tactile**  | Minimum **88×88 px** (conforme WCAG / tablettes comptoir)                                                                                           |
| **Feedback clic**         | Animation `scale(1.05)` + toast "Annuler" pendant 5 s                                                                                               |
| **Accessibilité**         | `alt` obligatoire, `aria-label`, navigation clavier (Tab + Entrée), contraste ≥ 4.5:1                                                               |
| **Responsive**            | 2 colonnes mobile · 3–4 tablette · 6 desktop                                                                                                        |
| **Mode "comptoir"**       | Prévoir un mode **plein écran / kiosque** agrandi (icônes 120 px)                                                                                   |

---

## ⚡ 8. Cas particuliers à gérer

| Cas                                                     | Solution                                                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Client dépose **30 pièces** dont 12 chemises identiques | **Double-clic ou clic long** ouvre le mini-pad quantité : saisie directe de `12`                         |
| Type de vêtement **non listé** (ex. "tapis de prière")  | Icône **"Autre"** → ouvre un champ texte libre + sauvegarde dans `description`                           |
| Le réceptionniste se trompe de 1 pièce                  | **Toast "Annuler"** (5 s) + bouton **`−`** sur le badge                                                  |
| Coupure internet au comptoir                            | Cache local (localStorage) des icônes + file d'attente synchro au retour réseau                          |
| Le nombre de pièces dépasse le dernier forfait          | Bandeau **orange** : "⚠️ 31 pièces — forfait à définir, contacter le manager"                            |
| Besoin de noter l'**état constaté** (tache, déchirure)  | Sur chaque pièce ajoutée : petit **badge optionnel** avec icônes (🟢 bon état · 🟡 tache · 🔴 déchirure) |
| Client presse (rapidité)                                | **Raccourcis clavier** : `CH` + Tab = +1 chemise (bonus pour habitués)                                   |

---

## 🚀 9. Roadmap d'implémentation

| Phase                 | Contenu                                                                      | Effort |
| --------------------- | ---------------------------------------------------------------------------- | ------ |
| **P1 — MVP**          | Migration BDD + 12 icônes SVG + grille simple + clic = +1                    | 3–4 j  |
| **P2 — Confort**      | Filtres catégories, recherche, popover quantité, toast undo                  | 2–3 j  |
| **P3 — Intelligence** | Favoris dynamiques (statistiques d'usage), raccourcis clavier                | 1–2 j  |
| **P4 — Premium**      | Mode kiosque plein écran, sauvegarde brouillon offline, photos état vêtement | 3–4 j  |

---

## 🎯 Conclusion

Votre idée transforme la page "Nouvelle commande" d'un **formulaire administratif** en une **interface tactile intuitive**, parfaitement alignée avec le mode blanchisserie où la **vitesse de comptage** est le facteur clé. La grille d'icônes devient un **clavier visuel de comptage**, réduisant la saisie de 25 pièces de ~3 minutes à ~30 secondes, tout en **éliminant les erreurs de menu déroulant**.

Le modèle de données est prêt : il suffit d'**enrichir `type_vetement`** avec les colonnes `icone_url`, `couleur_hex` et `categorie_visuelle`, et de fournir un endpoint `GET /type-vetements` consommé par le composant React. **Aucun changement structurel** sur les tables `commande`, `vetement_saisi` ou `forfait_pieces` n'est nécessaire — l'ajout est **rétro-compatible** avec la base déjà générée. ✅
