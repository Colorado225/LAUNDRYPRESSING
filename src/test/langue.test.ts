import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Contrôle de langue du dépôt.
 *
 * Le cahier des charges impose le français partout : interface, messages
 * d'erreur, documentation, commentaires. Un copier-coller de source externe a
 * déjà introduit des titres en japonais dans `MAJ.md` : ce test empêche la
 * récidive en refusant tout caractère chinois, japonais ou coréen dans les
 * fichiers texte suivis par Git.
 *
 * Il ne juge pas l'anglais des identifiants techniques (`tenant_id`,
 * `createOrder`…) : c'est une convention de code, pas une traduction.
 */

const RACINE = join(__dirname, '..', '..')

const DOSSIERS = ['src', 'scripts', 'supabase', 'docs', '.github']

const FICHIERS_RACINE = ['README.md', 'MAJ.md', 'CHANGELOG.md', 'RESTRUCTURATION.md', 'index.html']

const EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.sql',
  '.md',
  '.json',
  '.yml',
  '.yaml',
  '.html',
  '.css',
  '.toml',
]

/** Chinois, japonais, coréen — et les formes de compatibilité. */
const CJK = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/

const IGNORES = new Set(['node_modules', 'dist', 'coverage', '.git', '.vite'])

function fichiersTexte(dossier: string): string[] {
  const chemin = join(RACINE, dossier)
  const resultat: string[] = []

  let entrees: string[]
  try {
    entrees = readdirSync(chemin)
  } catch {
    return resultat
  }

  for (const entree of entrees) {
    if (IGNORES.has(entree)) continue

    const complet = join(chemin, entree)
    const infos = statSync(complet)

    if (infos.isDirectory()) {
      resultat.push(...fichiersTexte(join(dossier, entree)))
    } else if (EXTENSIONS.some((extension) => entree.endsWith(extension))) {
      resultat.push(complet)
    }
  }

  return resultat
}

describe('Langue — aucun caractère chinois, japonais ou coréen', () => {
  const fichiers = [
    ...DOSSIERS.flatMap((dossier) => fichiersTexte(dossier)),
    ...FICHIERS_RACINE.map((fichier) => join(RACINE, fichier)).filter((chemin) => {
      try {
        return statSync(chemin).isFile()
      } catch {
        return false
      }
    }),
  ]

  it('analyse bien le dépôt (garde-fou contre un test vide)', () => {
    expect(fichiers.length).toBeGreaterThan(40)
  })

  it('ne trouve aucun caractère CJK dans les fichiers texte', () => {
    const coupables: string[] = []

    for (const fichier of fichiers) {
      const contenu = readFileSync(fichier, 'utf8')
      if (!CJK.test(contenu)) continue

      contenu.split('\n').forEach((ligne, index) => {
        if (CJK.test(ligne)) {
          coupables.push(`${relative(RACINE, fichier)}:${index + 1} — ${ligne.trim().slice(0, 100)}`)
        }
      })
    }

    expect(coupables).toEqual([])
  })
})
