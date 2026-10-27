-- =============================================================================
-- 027_restructure_services_per_restructuration.sql
-- Refonte complète selon RESTRUCTURATION.md
-- - Supprime les données des services/activités déjà implémentées
-- - Installe le nouveau schéma relationnel pour Pressing + Blanchisserie
-- =============================================================================
BEGIN;

-- 1) Nettoyage des données existantes liées aux services/activités
DELETE FROM public.order_items WHERE tenant_service_id IS NOT NULL;
UPDATE public.order_items SET tenant_service_id = NULL;
DELETE FROM public.tenant_services;
DELETE FROM public.tenant_activities;

-- Nettoyage éventuel des fonctions/colonnes liées si nécessaire
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_tenant_service_fk;
DROP INDEX IF EXISTS public.order_items_tenant_service_idx;
ALTER TABLE public.order_items DROP COLUMN IF EXISTS tenant_service_id;
ALTER TABLE public.order_items DROP COLUMN IF EXISTS tenant_service_name_snapshot;
ALTER TABLE public.order_items DROP COLUMN IF EXISTS activity_name_snapshot;

-- 2) Nettoyage des anciennes structures si elles existent
DROP TABLE IF EXISTS public.historique_statut CASCADE;
DROP TABLE IF EXISTS public.paiement CASCADE;
DROP TABLE IF EXISTS public.vetement_saisi CASCADE;
DROP TABLE IF EXISTS public.ligne_commande CASCADE;
DROP TABLE IF EXISTS public.commande CASCADE;
DROP TABLE IF EXISTS public.forfait_pieces CASCADE;
DROP TABLE IF EXISTS public.tarif_kilo CASCADE;
DROP TABLE IF EXISTS public.prestation CASCADE;
DROP TABLE IF EXISTS public.client CASCADE;
DROP TABLE IF EXISTS public.employe CASCADE;
DROP TABLE IF EXISTS public.etablissement CASCADE;
DROP TABLE IF EXISTS public.type_vetement CASCADE;
DROP TABLE IF EXISTS public.role_employe CASCADE;
DROP TABLE IF EXISTS public.mode_paiement CASCADE;
DROP TABLE IF EXISTS public.statut_commande CASCADE;
DROP TABLE IF EXISTS public.mode_facturation CASCADE;
DROP TABLE IF EXISTS public.type_service CASCADE;

-- 3) Création du nouveau schéma (inspiré de RESTRUCTURATION.md)
CREATE TABLE type_service (
    id           SERIAL PRIMARY KEY,
    code         VARCHAR(50)  NOT NULL UNIQUE,
    libelle      VARCHAR(100) NOT NULL,
    description  TEXT,
    actif        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE mode_facturation (
    id           SERIAL PRIMARY KEY,
    code         VARCHAR(50)  NOT NULL UNIQUE,
    libelle      VARCHAR(100) NOT NULL,
    description  TEXT,
    actif        BOOLEAN NOT NULL DEFAULT TRUE
);

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

-- Index
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

-- Triggers updated_at
CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_etablissement_updated_at BEFORE UPDATE ON etablissement FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_employe_updated_at BEFORE UPDATE ON employe FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_client_updated_at BEFORE UPDATE ON client FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_prestation_updated_at BEFORE UPDATE ON prestation FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_commande_updated_at BEFORE UPDATE ON commande FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();
CREATE TRIGGER trg_type_service_updated_at BEFORE UPDATE ON type_service FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- Données de référence
INSERT INTO type_service (code, libelle, description) VALUES
('PRESSING', 'Pressing professionnel', 'Services de pressing, nettoyage à sec, repassage'),
('BLANCHISSERIE', 'Blanchisserie artisanale', 'Blanchisserie au forfait pièces');

INSERT INTO mode_facturation (code, libelle, description) VALUES
('AU_KILO', 'Au kilo', 'Facturation au poids pour le pressing'),
('A_LA_PIECE', 'À la pièce', 'Facturation à l’unité'),
('FORFAIT_PIECES', 'Forfait pièces', 'Facturation par forfait selon le nombre total de pièces');

INSERT INTO statut_commande (code, libelle, ordre, est_final) VALUES
('RECU', 'Reçu', 1, FALSE),
('EN_COURS', 'En cours', 2, FALSE),
('PRET', 'Prêt', 3, FALSE),
('LIVRE', 'Livré', 4, TRUE),
('ANNULE', 'Annulé', 5, TRUE);

INSERT INTO mode_paiement (code, libelle) VALUES
('ESPECES', 'Espèces'),
('MOBILE_MONEY', 'Mobile Money'),
('CARTE', 'Carte bancaire'),
('VIREMENT', 'Virement');

INSERT INTO role_employe (code, libelle, description) VALUES
('RECEPTIONNISTE', 'Réceptionniste', 'Accueil et réception des commandes'),
('BLANCHISSEUR', 'Blanchisseur', 'Traitement du linge'),
('PRESSING', 'Pressing', 'Pressing, repassage, détachage'),
('CAISSIER', 'Caissier', 'Encaissement et paiements'),
('MANAGER', 'Manager', 'Supervision et gestion');

INSERT INTO type_vetement (code, libelle) VALUES
('CHEMISE', 'Chemise'),
('PANTALON', 'Pantalon'),
('JEAN', 'Jean'),
('ROBE', 'Robe'),
('JUPE', 'Jupe'),
('COSTUME', 'Costume'),
('VESTE', 'Veste'),
('MANTEAU', 'Manteau'),
('TSHIRT', 'T-shirt'),
('PULL', 'Pull'),
('SOUS_VETEMENT', 'Sous-vêtement'),
('DRAP', 'Drap/Linge de maison'),
('AUTRE', 'Autre');

INSERT INTO prestation (type_service_id, code, libelle, description) VALUES
((SELECT id FROM type_service WHERE code='PRESSING'), 'LAVAGE', 'Lavage', 'Lavage seul'),
((SELECT id FROM type_service WHERE code='PRESSING'), 'REPASSAGE', 'Repassage', 'Repassage seul'),
((SELECT id FROM type_service WHERE code='PRESSING'), 'LAVAGE_REPASSAGE', 'Lavage + Repassage', 'Lavage et repassage'),
((SELECT id FROM type_service WHERE code='PRESSING'), 'DETACHAGE', 'Détachage', 'Traitement des tâches'),
((SELECT id FROM type_service WHERE code='PRESSING'), 'NETTOYAGE_SEC', 'Nettoyage à sec', 'Dry cleaning'),
((SELECT id FROM type_service WHERE code='PRESSING'), 'LAVAGE_SEC', 'Lavage à sec', 'Lavage à sec spécifique'),
((SELECT id FROM type_service WHERE code='PRESSING'), 'ABIDONNAGE', 'Abidonnage', 'Abidonnage / finition'),
((SELECT id FROM type_service WHERE code='PRESSING'), 'GESTION_TACHES', 'Gestion des tâches', 'Suivi/travail des tâches'),
((SELECT id FROM type_service WHERE code='BLANCHISSERIE'), 'LAVAGE_SEUL', 'Lavage seul', 'Blanchisserie lavage seul'),
((SELECT id FROM type_service WHERE code='BLANCHISSERIE'), 'LAVAGE_REPASSAGE_BL', 'Lavage + Repassage', 'Blanchisserie lavage et repassage');

-- Données exemples
INSERT INTO etablissement (code, nom, adresse, ville, telephone) VALUES
('ETB-001', 'Pressing Principal', '123 Avenue de la République', 'Abidjan', '+225 01 02 03 04 05');

INSERT INTO role_employe (code, libelle) VALUES ('RECEPTIONNISTE','Réceptionniste') ON CONFLICT DO NOTHING;
INSERT INTO role_employe (code, libelle) VALUES ('CAISSIER','Caissier') ON CONFLICT DO NOTHING;

INSERT INTO employe (etablissement_id, role_id, code, nom, prenom, telephone)
VALUES
((SELECT id FROM etablissement WHERE code='ETB-001'), (SELECT id FROM role_employe WHERE code='RECEPTIONNISTE'), 'EMP-001', 'KOUASSI', 'Jean', '+225 07 11 22 33 44'),
((SELECT id FROM etablissement WHERE code='ETB-001'), (SELECT id FROM role_employe WHERE code='CAISSIER'), 'EMP-002', 'TRAORE', 'Aminata', '+225 07 55 66 77 88');

INSERT INTO client (code, nom, prenom, telephone)
VALUES
('CLI-001', 'DUPONT', 'Marc', '+225 05 44 33 22 11'),
('CLI-002', 'KONE', 'Fatou', '+225 05 66 77 88 99');

-- Tarifs exemples
INSERT INTO tarif_kilo (etablissement_id, prestation_id, prix_par_kg, date_debut)
VALUES
((SELECT id FROM etablissement WHERE code='ETB-001'), (SELECT id FROM prestation WHERE code='LAVAGE_REPASSAGE'), 1600.00, CURRENT_DATE),
((SELECT id FROM etablissement WHERE code='ETB-001'), (SELECT id FROM prestation WHERE code='NETTOYAGE_SEC'), 2000.00, CURRENT_DATE);

-- Forfaits exemples
INSERT INTO forfait_pieces (etablissement_id, prestation_id, nb_pieces_min, nb_pieces_max, prix_forfait, date_debut)
VALUES
((SELECT id FROM etablissement WHERE code='ETB-001'), (SELECT id FROM prestation WHERE code='LAVAGE_SEUL'), 1, 25, 1500.00, CURRENT_DATE),
((SELECT id FROM etablissement WHERE code='ETB-001'), (SELECT id FROM prestation WHERE code='LAVAGE_REPASSAGE_BL'), 1, 30, 2000.00, CURRENT_DATE);

COMMIT;
