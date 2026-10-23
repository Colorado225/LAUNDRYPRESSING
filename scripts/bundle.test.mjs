import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assembler,
  extraireImports,
  nomsExportes,
  ordreDependances,
  resoudre,
} from '../scripts/lib/bundle.mjs'
import { FONCTIONS } from '../scripts/deploy-fonctions.mjs'

/**
 * Assembleur des Edge Functions.
 *
 * Ce qu'on protège : le fichier envoyé à Supabase doit être **autonome**. Un
 * import relatif oublié ne se voit pas au déploiement — il échoue à la première
 * requête d'un vrai client. C'est exactement le genre de défaut qu'un test doit
 * attraper avant la production.
 */

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lire = (chemin) => readFileSync(chemin, 'utf8')

describe('extraireImports', () => {
  it('extrait les imports relatifs et retire la ligne', () => {
    const source = [
      "import { json } from '../_shared/http.ts'",
      "import type { Foo } from './foo.ts'",
      '',
      'const x = 1',
    ].join('\n')

    const { relatifs, source: reste } = extraireImports(source)

    expect(relatifs).toEqual(['../_shared/http.ts', './foo.ts'])
    expect(reste).not.toContain('import')
    expect(reste).toContain('const x = 1')
  })

  it('reconnaît un import coupé sur plusieurs lignes', () => {
    const source = [
      'import {',
      '  creerClientAdmin,',
      '  creerClientUtilisateur,',
      "} from '../_shared/supabaseClients.ts'",
      '',
      'const x = 1',
    ].join('\n')

    const { relatifs, source: reste } = extraireImports(source)

    expect(relatifs).toEqual(['../_shared/supabaseClients.ts'])
    expect(reste).not.toContain('supabaseClients.ts')
    expect(reste).toContain('const x = 1')
  })

  it('reconnaît un import à effet de bord et un ré-export', () => {
    const source = ["import './polyfill.ts'", "export { a } from './a.ts'", 'const x = 1'].join('\n')

    const { relatifs, source: reste } = extraireImports(source)

    expect(relatifs).toEqual(['./polyfill.ts', './a.ts'])
    expect(reste).not.toContain('.ts')
    expect(reste).toContain('const x = 1')
  })

  it('conserve les imports distants, que Deno sait résoudre', () => {
    const source = "import { createClient } from 'npm:@supabase/supabase-js@2.118.0'"
    const { relatifs, source: reste } = extraireImports(source)

    expect(relatifs).toEqual([])
    expect(reste).toBe(source)
  })
})

describe('ordreDependances', () => {
  it('place les dépendances avant le module qui les utilise', () => {
    const fichiers = {
      '/a/index.ts': "import { b } from './b.ts'\nimport { c } from './c.ts'\n",
      '/a/b.ts': '',
      '/a/c.ts': "import { b } from './b.ts'\n",
    }

    const ordre = ordreDependances('/a/index.ts', (chemin) => fichiers[chemin] ?? '')

    // `b` avant `c` (qui l'importe) et avant `index` ; une seule fois.
    expect(ordre).toEqual(['/a/b.ts', '/a/c.ts', '/a/index.ts'])
  })

  it('refuse un import circulaire au lieu de boucler', () => {
    const fichiers = {
      '/x/index.ts': "import './y.ts'",
      '/x/y.ts': "import './index.ts'",
    }

    expect(() => ordreDependances('/x/index.ts', (chemin) => fichiers[chemin] ?? '')).toThrow(
      /circulaire/i,
    )
  })
})

describe('assembler — fonctions réelles du dépôt', () => {
  for (const { slug } of FONCTIONS) {
    const entree = resolve(RACINE, 'supabase/functions', slug, 'index.ts')

    it(`${slug} : aucun import relatif ne subsiste`, () => {
      const { code } = assembler(entree, { lire })
      expect(code).not.toMatch(/from\s+['"]\.\.?\//)
    })

    it(`${slug} : les modules partagés sont inclus une seule fois`, () => {
      const { code, fichiers } = assembler(entree, { lire })
      expect(new Set(fichiers).size).toBe(fichiers.length)

      const enTetes = code.match(/^\/\/ (http|cinetpay|supabaseClients|index)\.ts$/gm) ?? []
      expect(new Set(enTetes).size).toBe(enTetes.length)
    })

    it(`${slug} : le fichier assemble garde le point d'entrée Deno`, () => {
      const { code } = assembler(entree, { lire })
      expect(code).toContain('Deno.serve(')
      expect(code.startsWith('// Fichier assemblé automatiquement')).toBe(true)
    })
  }

  it('n’a aucun nom exporté en double entre les modules partagés', () => {
    // Un doublon produirait un fichier qui ne compile pas chez Deno, au moment
    // du déploiement et non avant.
    const modules = ['http.ts', 'cinetpay.ts', 'supabaseClients.ts']
    const vus = new Map()

    for (const module of modules) {
      const source = lire(resolve(RACINE, 'supabase/functions/_shared', module))
      for (const nom of nomsExportes(source)) {
        const dejaVu = vus.get(nom)
        expect(dejaVu, `« ${nom} » exporté par ${dejaVu} et ${module}`).toBeUndefined()
        vus.set(nom, module)
      }
    }
  })
})

describe('resoudre', () => {
  it('résout un chemin relatif depuis le fichier importateur', () => {
    expect(resoudre('/projet/supabase/functions/init/index.ts', '../_shared/http.ts')).toBe(
      '/projet/supabase/functions/_shared/http.ts',
    )
  })
})
