import { describe, expect, it } from 'vitest'
import { empreinte, nomDeFichier, versionDuFichier, versionsLocales } from './migrations-distantes.mjs'

describe('versionDuFichier', () => {
  it('lit la version d’un nom horodaté comme d’un nom historique', () => {
    expect(versionDuFichier('20261026193632_catalogue_lot1.sql')).toBe('20261026193632')
    expect(versionDuFichier('026_client_sync_events.sql')).toBe('026')
  })
})

describe('versionsLocales', () => {
  it('ignore les fichiers qui ne sont pas du SQL', () => {
    const versions = versionsLocales(['026_client_sync_events.sql', 'README.md', '.DS_Store'])
    expect([...versions]).toEqual(['026'])
  })
})

describe('nomDeFichier', () => {
  it('assemble version et nom en un nom de fichier sûr', () => {
    expect(nomDeFichier('20261026193632', 'catalogue_lot1')).toBe('20261026193632_catalogue_lot1.sql')
  })

  it('neutralise les caractères inattendus', () => {
    expect(nomDeFichier('20261026200208', 'Tarification kilo (tranches)')).toBe(
      '20261026200208_tarification_kilo_tranches.sql',
    )
  })

  it('retombe sur un nom neutre quand la base ne fournit pas de nom', () => {
    expect(nomDeFichier('027', null)).toBe('027_migration.sql')
  })
})

describe('empreinte', () => {
  it('calcule le SHA-256 du texte UTF-8, accents compris', () => {
    // Valeur de référence : sha256 des octets UTF-8 de « Clôture ✓ ».
    expect(empreinte('Clôture ✓')).toBe(
      'fa62edf29b50d243e85c11beca0e38a0fb7d2c5f2b2605f3270ea45330d779d3',
    )
  })
})
