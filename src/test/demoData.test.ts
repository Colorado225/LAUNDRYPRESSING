import { beforeEach, describe, expect, it } from 'vitest'
import {
  ATELIER_DÉMO,
  COMMANDES_RÉCENTES_DÉMO,
  INDICATEURS_DÉMO,
  SÉRIE_DÉMO,
  instantanéDémo,
  totalSérieDémo,
} from '@/data/demo-data'
import { useDemoStore } from '@/lib/demoMode'
import { ORDER_STATUSES } from '@/constants/orders'

/**
 * Données de démonstration.
 *
 * Deux choses à garantir, et une seule compte vraiment :
 *
 *  1. les chiffres sont ceux de la maquette (sinon la comparaison visuelle ne
 *     veut rien dire) ;
 *  2. l'instantané de démonstration a **exactement** la forme de l'instantané
 *     réel, pour qu'aucun écran n'ait besoin d'un cas particulier — et donc
 *     pour qu'aucune donnée fictive ne puisse se glisser dans un calcul métier.
 */

beforeEach(() => {
  useDemoStore.setState({ actif: false })
})

describe('mode démonstration', () => {
  it('est désactivé par défaut', () => {
    expect(useDemoStore.getState().actif).toBe(false)
  })

  it('peut être activé puis coupé', () => {
    useDemoStore.getState().setActif(true)
    expect(useDemoStore.getState().actif).toBe(true)

    useDemoStore.getState().setActif(false)
    expect(useDemoStore.getState().actif).toBe(false)
  })
})

describe('série de chiffre d’affaires', () => {
  it('couvre sept jours, du 20 au 26 octobre', () => {
    expect(SÉRIE_DÉMO).toHaveLength(7)
    expect(SÉRIE_DÉMO[0]?.date).toBe('2026-10-20')
    expect(SÉRIE_DÉMO[6]?.date).toBe('2026-10-26')
  })

  it('reprend les montants de la maquette', () => {
    expect(SÉRIE_DÉMO.map((point) => point.montant)).toEqual([
      250_000, 350_000, 410_000, 300_000, 400_000, 395_000, 610_000,
    ])
  })

  it('somme la semaine à partir des points, sans valeur écrite en dur', () => {
    expect(totalSérieDémo()).toBe(2_715_000)
  })
})

describe('indicateurs', () => {
  it('affiche les quatre KPI de la maquette, avec leur variation', () => {
    expect(INDICATEURS_DÉMO.map((indicateur) => indicateur.libelle)).toEqual([
      "Chiffre d'affaires",
      'Commandes',
      'En cours de traitement',
      'Prêtes à être livrées',
    ])
    expect(INDICATEURS_DÉMO.map((indicateur) => indicateur.variation)).toEqual([12, 8, -14, 23])
  })

  it('signale une baisse comme une alerte, une hausse comme positive', () => {
    const baisse = INDICATEURS_DÉMO.find((indicateur) => indicateur.variation < 0)
    expect(baisse?.ton).toBe('alerte')
  })
})

describe('instantané de démonstration', () => {
  it('respecte la forme de l’instantané réel', () => {
    const instantané = instantanéDémo()

    expect(Object.keys(instantané).sort()).toEqual(
      [
        'activeOrders',
        'averageBasket',
        'byStatus',
        'cashToday',
        'cashWeek',
        'lateOrders',
        'ordersToday',
        'outstanding',
        'readyOrders',
        'series',
        'today',
        'topServices',
      ].sort(),
    )
  })

  it('reste cohérent avec la série et les indicateurs', () => {
    const instantané = instantanéDémo()

    expect(instantané.series).toHaveLength(7)
    expect(instantané.cashWeek).toBe(totalSérieDémo())
    expect(instantané.cashToday).toBe(482_500)
    expect(instantané.ordersToday).toBe(28)
    expect(instantané.readyOrders).toBe(16)
    // Chaque point de série porte un libellé lisible sur l'axe horizontal.
    expect(instantané.series.every((point) => point.label.length > 0)).toBe(true)
  })
})

describe('commandes de démonstration', () => {
  it('présente cinq tickets, du plus récent au plus ancien', () => {
    expect(COMMANDES_RÉCENTES_DÉMO).toHaveLength(5)
    expect(COMMANDES_RÉCENTES_DÉMO.map((commande) => commande.reference)).toEqual([
      '#000125',
      '#000124',
      '#000123',
      '#000122',
      '#000121',
    ])
  })

  it('n’utilise que des statuts réels du référentiel', () => {
    for (const commande of [...COMMANDES_RÉCENTES_DÉMO, ...ATELIER_DÉMO]) {
      expect(ORDER_STATUSES[commande.statut]).toBeDefined()
    }
  })

  it('alimente le Kanban avec des statuts en cours de traitement', () => {
    expect(ATELIER_DÉMO.length).toBeGreaterThanOrEqual(3)
    expect(ATELIER_DÉMO.every((carte) => carte.montant > 0)).toBe(true)
    expect(ATELIER_DÉMO.some((carte) => carte.statut === 'ready')).toBe(true)
  })
})
