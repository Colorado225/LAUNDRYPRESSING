import { describe, expect, it } from 'vitest'
import { DEFAULT_PAGE_SIZE, paginate } from '@/lib/pagination'

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
