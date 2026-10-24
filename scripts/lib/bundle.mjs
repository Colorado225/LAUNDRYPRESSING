/**
 * Assemblage des Edge Functions en un fichier unique.
 *
 * Pourquoi assembler soi-même plutôt qu'installer esbuild ?
 *  - les trois modules partagés (`http.ts`, `cinetpay.ts`, `supabaseClients.ts`)
 *    n'ont aucune dépendance externe : un assembleur de 60 lignes suffit ;
 *  - l'API d'administration Supabase attend **un seul corps de fichier**, et un
 *    import relatif `../_shared/http.ts` n'y résout rien ;
 *  - moins de dépendances de build, et un comportement lisible en cas d'erreur.
 *
 * Ce que l'assembleur fait, et ne fait pas :
 *  ✓ résout les imports relatifs, dans l'ordre des dépendances, sans doublon ;
 *  ✓ conserve les imports `npm:` et `https:` tels quels (Deno les résout) ;
 *  ✗ ne renomme rien : deux modules ne doivent pas exporter le même nom — un
 *    test le vérifie (`scripts/bundle.test.mjs`).
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Chemin absolu d'un module, à partir du fichier qui l'importe. */
export function resoudre(importateur, specificateur) {
  return resolve(dirname(importateur), specificateur)
}

/**
 * Extrait les imports relatifs d'un source.
 *
 * Les imports à spécificateur distant (`npm:`, `https:`, `jsr:`) sont laissés
 * au runtime : ce sont justement ceux que Deno sait résoudre seul.
 *
 * Le motif accepte plusieurs lignes : Prettier coupe volontiers un import long
 * en `{ a, b }` sur trois lignes. Un assembleur qui ne reconnaît que la forme
 * sur une seule ligne laisse alors un `from '../_shared/x.ts'` dans le fichier
 * envoyé à Supabase, et l'erreur n'apparaît qu'à la première requête réelle.
 */
export function extraireImports(source) {
  const relatifs = []
  const motifs = [
    // import './x.ts' — import à effet de bord (traité en premier : il n'a pas
    // de `from`, et le motif multi-lignes ci-dessous l'avalerait en passant
    // par-dessus un saut de ligne).
    /^[ \t]*import\s+['"](\.[^'"]+)['"][ \t]*;?[ \t]*$/gm,
    // import { a, b } from './x.ts' — sur une ou plusieurs lignes, sans jamais
    // franchir le début d'une autre déclaration import/export.
    /^[ \t]*import\s+(?:(?!^[ \t]*(?:import|export)\s)[\s\S])*?from\s+['"](\.[^'"]+)['"][ \t]*;?[ \t]*$/gm,
    // export { a } from './x.ts' — ré-export.
    /^[ \t]*export\s+(?:(?!^[ \t]*(?:import|export)\s)[\s\S])*?from\s+['"](\.[^'"]+)['"][ \t]*;?[ \t]*$/gm,
  ]

  let reste = source
  for (const motif of motifs) {
    reste = reste.replace(motif, (ligne, specificateur) => {
      relatifs.push(specificateur)
      return ''
    })
  }

  // Une ligne vidée laisse un trou : on évite d'empiler trois lignes blanches.
  return { relatifs, source: reste.replace(/\n{3,}/g, '\n\n') }
}

/**
 * Ordre d'inclusion : les dépendances AVANT le module qui les utilise, sans
 * doublon. Un module partagé par deux fonctions n'apparaît qu'une fois.
 */
export function ordreDependances(entree, lire = (chemin) => readFileSync(chemin, 'utf8')) {
  const ordre = []
  const vus = new Set()
  const enCours = new Set()

  function visiter(chemin) {
    if (vus.has(chemin)) return
    if (enCours.has(chemin)) {
      throw new Error(`Import circulaire détecté sur ${chemin}`)
    }

    enCours.add(chemin)
    const { relatifs } = extraireImports(lire(chemin))

    for (const relatif of relatifs) {
      visiter(resoudre(chemin, relatif))
    }

    enCours.delete(chemin)
    vus.add(chemin)
    ordre.push(chemin)
  }

  visiter(resolve(entree))
  return ordre
}

/**
 * Assemble une fonction.
 *
 * Le bandeau de tête indique d'où vient le fichier : le code déployé sur
 * Supabase est souvent consulté des mois plus tard, hors du dépôt.
 */
export function assembler(entree, options = {}) {
  const lire = options.lire ?? ((chemin) => readFileSync(chemin, 'utf8'))
  const fichiers = ordreDependances(entree, lire)

  const morceaux = fichiers.map((fichier) => {
    const source = lire(fichier)
    const { source: sansImports } = extraireImports(source)
    const nom = fichier.split(/[\\/]/).slice(-1)[0]
    return `// ${'='.repeat(74)}\n// ${nom}\n// ${'='.repeat(74)}\n${sansImports.trim()}\n`
  })

  const bandeau = [
    '// Fichier assemblé automatiquement par scripts/deploy-fonctions.mjs.',
    '// Ne pas modifier ici : la source vit dans supabase/functions/.',
    `// Modules inclus : ${fichiers.map((f) => f.split(/[\\/]/).slice(-1)[0]).join(', ')}`,
    '',
  ].join('\n')

  return { code: bandeau + '\n' + morceaux.join('\n'), fichiers }
}

/** Noms exportés par un module, pour détecter les collisions. */
export function nomsExportes(source) {
  const noms = new Set()
  const motif = /^\s*export\s+(?:async\s+)?(?:function|const|let|class|interface|type)\s+([A-Za-z_$][\w$]*)/gm

  for (const correspondance of source.matchAll(motif)) {
    noms.add(correspondance[1])
  }

  return [...noms]
}

/** Chemin du fichier courant, pour les appels en ligne de commande. */
export function racineDepuis(metaUrl) {
  return resolve(dirname(fileURLToPath(metaUrl)), '..', '..')
}
