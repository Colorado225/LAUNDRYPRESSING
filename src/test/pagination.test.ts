import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PAGE_SIZE,
  decouperPageCurseur,
  filtreCurseur,
  paginate,
  type Curseur,
} from '@/lib/pagination'

/**
 * Pagination locale de la liste des commandes.
 *
 * Ce qui compte : le bornage. Un filtre qui réduit la liste alors que
 * l'utilisateur est page 5 ne doit jamais produire une page vide ni un numéro
 * de page supérieur au nombre de pages.
 */

const liste = Array.from({ length: 45 }, (_, index) => index + 1)

describe('paginate', () => {
  it('découpe selon la taille de page', () => {
    const premiere = paginate(liste, 1, 20)
    expect(premiere.items).toHaveLength(20)
    expect(premiere.items[0]).toBe(1)
    expect(premiere.items.at(-1)).toBe(20)
    expect(premiere.pageCount).toBe(3)
    expect(premiere.total).toBe(45)
    expect(premiere.from).toBe(1)
    expect(premiere.to).toBe(20)
  })

  it('tronque la dernière page au reste', () => {
    const derniere = paginate(liste, 3, 20)
    expect(derniere.items).toEqual([41, 42, 43, 44, 45])
    expect(derniere.from).toBe(41)
    expect(derniere.to).toBe(45)
  })

  it('borne une page trop grande', () => {
    const page = paginate(liste, 99, 20)
    expect(page.page).toBe(3)
    expect(page.items).toHaveLength(5)
  })

  it('borne une page nulle ou négative', () => {
    expect(paginate(liste, 0, 20).page).toBe(1)
    expect(paginate(liste, -4, 20).page).toBe(1)
  })

  it('traite une page non finie comme la première', () => {
    expect(paginate(liste, Number.NaN, 20).page).toBe(1)
  })

  it('renvoie une page vide cohérente pour une liste vide', () => {
    const page = paginate([], 1, 20)
    expect(page.items).toEqual([])
    expect(page.page).toBe(1)
    expect(page.pageCount).toBe(1)
    expect(page.from).toBe(0)
    expect(page.to).toBe(0)
  })

  it('accepte une taille de page absurde sans casser', () => {
    const page = paginate(liste, 1, 0)
    expect(page.items).toHaveLength(1)
    expect(page.pageCount).toBe(45)
  })

  it('utilise 20 par défaut', () => {
    expect(paginate(liste, 1).items).toHaveLength(DEFAULT_PAGE_SIZE)
    expect(DEFAULT_PAGE_SIZE).toBe(20)
  })

  it('ne modifie pas la liste reçue', () => {
    const copie = [...liste]
    paginate(liste, 2, 10)
    expect(liste).toEqual(copie)
  })
})

/**
 * Pagination par curseur (listes alimentées par le serveur).
 *
 * Deux propriétés à garantir : la ligne supplémentaire ne sert qu'à savoir
 * s'il y a une suite, et le filtre produit par `filtreCurseur` décrit bien
 * « strictement après » — pas « après ou égal », qui bouclerait sur la même
 * ligne à chaque page.
 */

function ligne(id: string, valeur: string) {
  return { id, created_at: valeur }
}

describe('decouperPageCurseur', () => {
  it('ne renvoie que la page demandée et signale la suite', () => {
    const recues = [ligne('a', '2026-10-23T10:00:00Z'), ligne('b', '2026-10-22T10:00:00Z'), ligne('c', '2026-10-21T10:00:00Z')]
    const page = decouperPageCurseur(recues, 2, (l) => l.created_at)

    expect(page.lignes).toHaveLength(2)
    expect(page.lignes.map((l) => l.id)).toEqual(['a', 'b'])
    expect(page.aPlus).toBe(true)
    expect(page.curseur).toEqual({ valeur: '2026-10-22T10:00:00Z', id: 'b' })
  })

  it('ne signale pas de suite quand la page est incomplète', () => {
    const page = decouperPageCurseur([ligne('a', '2026-10-23T10:00:00Z')], 25, (l) => l.created_at)
    expect(page.aPlus).toBe(false)
    expect(page.lignes).toHaveLength(1)
  })

  it('signale encore une suite quand le serveur renvoie exactement une page pleine plus une', () => {
    const recues = Array.from({ length: 26 }, (_, i) => ligne(`id-${i}`, `2026-10-${String(23 - i).padStart(2, '0')}T10:00:00Z`))
    const page = decouperPageCurseur(recues, 25, (l) => l.created_at)
    expect(page.lignes).toHaveLength(25)
    expect(page.aPlus).toBe(true)
    expect(page.curseur?.id).toBe('id-24')
  })

  it('renvoie un curseur nul sur une page vide', () => {
    const page = decouperPageCurseur<{ id: string; created_at: string }>([], 25, (l) => l.created_at)
    expect(page).toEqual({ lignes: [], curseur: null, aPlus: false })
  })

  it('borne une limite absurde à une ligne', () => {
    const page = decouperPageCurseur([ligne('a', 'x'), ligne('b', 'y')], 0, (l) => l.created_at)
    expect(page.lignes).toHaveLength(1)
    expect(page.aPlus).toBe(true)
  })
})

describe('filtreCurseur', () => {
  const curseur: Curseur = { valeur: '2026-10-22T10:00:00Z', id: 'b' }

  it('exige un horodatage strictement antérieur, ou un identifiant plus petit', () => {
    expect(filtreCurseur('created_at', curseur)).toBe(
      'created_at.lt.2026-10-22T10:00:00Z,and(created_at.eq.2026-10-22T10:00:00Z,id.lt.b)',
    )
  })

  it('n’utilise jamais l’égalité seule, qui bouclerait', () => {
    expect(filtreCurseur('created_at', curseur)).not.toBe('created_at.eq.2026-10-22T10:00:00Z')
  })

  it('retire les caractères qui casseraient la syntaxe PostgREST', () => {
    expect(filtreCurseur('created_at', { valeur: 'a,b(c)', id: 'x,y' })).toBe(
      'created_at.lt.abc,and(created_at.eq.abc,id.lt.xy)',
    )
  })
})
