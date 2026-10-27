-- Migration 028: Grille de vêtements cliquables pour blanchisserie
BEGIN;

-- Enrichir type_vetement
ALTER TABLE type_vetement
    ADD COLUMN IF NOT EXISTS icone_url        VARCHAR(500),
    ADD COLUMN IF NOT EXISTS icone_svg        TEXT,
    ADD COLUMN IF NOT EXISTS couleur_hex      VARCHAR(7) DEFAULT '#3B82F6',
    ADD COLUMN IF NOT EXISTS categorie_visuelle VARCHAR(50) DEFAULT 'AUTRE',
    ADD COLUMN IF NOT EXISTS ordre_affichage  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS favori           BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS raccourci_clavier CHAR(2);

CREATE INDEX IF NOT EXISTS idx_type_vetement_categorie ON type_vetement(categorie_visuelle);
CREATE INDEX IF NOT EXISTS idx_type_vetement_ordre     ON type_vetement(ordre_affichage);

-- Table categorie_vetement
CREATE TABLE IF NOT EXISTS categorie_vetement (
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
    ('AUTRE',      'Autres',     99)
ON CONFLICT (code) DO NOTHING;

-- Contrainte FK
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_type_vetement_categorie'
    ) THEN
        ALTER TABLE type_vetement
            ADD CONSTRAINT fk_type_vetement_categorie
            FOREIGN KEY (categorie_visuelle)
            REFERENCES categorie_vetement(code)
            ON UPDATE CASCADE ON DELETE SET DEFAULT;
    END IF;
END $$;

-- Statistiques d'utilisation
CREATE TABLE IF NOT EXISTS statistiques_vetement (
    etablissement_id INTEGER NOT NULL REFERENCES etablissement(id) ON DELETE CASCADE,
    type_vetement_id INTEGER NOT NULL REFERENCES type_vetement(id) ON DELETE CASCADE,
    nb_utilisations  INTEGER NOT NULL DEFAULT 0,
    derniere_utilisation TIMESTAMP,
    PRIMARY KEY (etablissement_id, type_vetement_id)
);

CREATE INDEX IF NOT EXISTS idx_stats_vetement_usage ON statistiques_vetement(etablissement_id, nb_utilisations DESC);

-- Mettre à jour les types existants avec valeurs visuelles
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
WHERE code IN ('PANTALON', 'JEAN');

UPDATE type_vetement SET
    icone_url = '/icons/robe.svg',
    couleur_hex = '#8B5CF6',
    categorie_visuelle = 'ROBES',
    ordre_affichage = 30,
    favori = TRUE,
    raccourci_clavier = 'RO'
WHERE code = 'ROBE';

UPDATE type_vetement SET
    icone_url = '/icons/jupe.svg',
    couleur_hex = '#8B5CF6',
    categorie_visuelle = 'ROBES',
    ordre_affichage = 31
WHERE code = 'JUPE';

UPDATE type_vetement SET
    icone_url = '/icons/costume.svg',
    couleur_hex = '#F59E0B',
    categorie_visuelle = 'MANTEAUX',
    ordre_affichage = 40,
    favori = TRUE
WHERE code = 'COSTUME';

UPDATE type_vetement SET
    icone_url = '/icons/veste.svg',
    couleur_hex = '#F59E0B',
    categorie_visuelle = 'MANTEAUX',
    ordre_affichage = 41
WHERE code = 'VESTE';

UPDATE type_vetement SET
    icone_url = '/icons/manteau.svg',
    couleur_hex = '#F59E0B',
    categorie_visuelle = 'MANTEAUX',
    ordre_affichage = 42
WHERE code = 'MANTEAAU';

UPDATE type_vetement SET
    icone_url = '/icons/tshirt.svg',
    couleur_hex = '#3B82F6',
    categorie_visuelle = 'HAUTS',
    ordre_affichage = 15,
    favori = TRUE
WHERE code = 'TSHIRT';

UPDATE type_vetement SET
    icone_url = '/icons/pull.svg',
    couleur_hex = '#3B82F6',
    categorie_visuelle = 'HAUTS',
    ordre_affichage = 16
WHERE code = 'PULL';

UPDATE type_vetement SET
    icone_url = '/icons/drap.svg',
    couleur_hex = '#EC4899',
    categorie_visuelle = 'LITERIE',
    ordre_affichage = 50
WHERE code = 'DRAP';

UPDATE type_vetement SET
    icone_url = '/icons/autre.svg',
    couleur_hex = '#64748B',
    categorie_visuelle = 'AUTRE',
    ordre_affichage = 99
WHERE code = 'AUTRE';

COMMIT;
