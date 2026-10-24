import { describe, expect, it } from 'vitest'
import {
  ORDER_FLOW,
  allowedStatusTargets,
  isOrderLate,
  orderStatusRank,
  todayIso,
} from '@/constants/orders'
import { memberLabel } from '@/services/tenantMembers'
import {
  MIN_PAYMENT,
  canAcceptPayment,
  clampPaymentAmount,
  computeBalance,
  formatDifference,
} from '@/services/cashService'
import {
  defaultCatalog,
  servicesForArticle,
  uniqueArticles,
} from '@/db/catalogRepository'
import type { LocalCatalogEntry } from '@/db/localDb'
import type { OrderStatus } from '@/types/database'

/**
 * Règles métier du palier 2, testées sans interface ni réseau.
 *
 * Le solde et le retard sont les deux calculs qui décident de ce qu'on annonce
 * au client : ils doivent rester purs et couverts.
 */

describe('computeBalance — solde d’une commande', () => {
  it('calcule le reste à payer après un acompte en espèces', () => {
    const solde = computeBalance(10_000, 'partial', [
      { amount: 3_000, synced: 1, lastError: null },
    ])

    expect(solde).toEqual({ paid: 3_000, remaining: 7_000, settled: false })
  })

  it('cumule plusieurs encaissements', () => {
    const solde = computeBalance(10_000, 'partial', [
      { amount: 2_000, synced: 1, lastError: null },
      { amount: 1_500, synced: 0, lastError: null },
    ])

    expect(solde.paid).toBe(3_500)
    expect(solde.remaining).toBe(6_500)
  })

  it('considère une commande « payée » comme soldée même sans trace locale', () => {
    // Cas du paiement Mobile Money confirmé par le webhook : la tablette n'a
    // aucun encaissement en espèces, la commande est pourtant réglée.
    const solde = computeBalance(8_500, 'paid', [])

    expect(solde).toEqual({ paid: 8_500, remaining: 0, settled: true })
  })

  it('ne descend jamais sous zéro', () => {
    const solde = computeBalance(5_000, 'partial', [
      { amount: 6_000, synced: 1, lastError: null },
    ])

    expect(solde.remaining).toBe(0)
    expect(solde.settled).toBe(true)
  })

  it('compte un encaissement refusé par le serveur : l’argent a été reçu', () => {
    const solde = computeBalance(10_000, 'pending', [
      { amount: 4_000, synced: 1, lastError: 'Refusé par le serveur' },
    ])

    expect(solde.paid).toBe(4_000)
    expect(solde.remaining).toBe(6_000)
  })

  it('une commande à zéro est déjà soldée', () => {
    expect(computeBalance(0, 'pending', []).settled).toBe(true)
  })
})

describe('canAcceptPayment', () => {
  const soldeOuvert = { paid: 0, remaining: 5_000, settled: false }

  it('accepte une commande en cours non soldée', () => {
    expect(
      canAcceptPayment({ status: 'ready', totalAmount: 5_000, paymentStatus: 'pending' }, soldeOuvert),
    ).toBe(true)
  })

  it('refuse une commande annulée', () => {
    expect(
      canAcceptPayment({ status: 'cancelled', totalAmount: 5_000, paymentStatus: 'pending' }, soldeOuvert),
    ).toBe(false)
  })

  it('refuse une commande déjà payée', () => {
    expect(
      canAcceptPayment({ status: 'ready', totalAmount: 5_000, paymentStatus: 'paid' }, soldeOuvert),
    ).toBe(false)
  })

  it('refuse quand le solde est nul', () => {
    expect(
      canAcceptPayment(
        { status: 'ready', totalAmount: 5_000, paymentStatus: 'pending' },
        { paid: 5_000, remaining: 0, settled: true },
      ),
    ).toBe(false)
  })
})

describe('clampPaymentAmount', () => {
  it('borne le montant au reste à payer', () => {
    expect(clampPaymentAmount(9_000, 5_000)).toBe(5_000)
  })

  it('refuse les valeurs négatives ou non numériques', () => {
    expect(clampPaymentAmount(-100, 5_000)).toBe(0)
    expect(clampPaymentAmount(Number.NaN, 5_000)).toBe(0)
  })

  it('arrondit à l’entier inférieur (le FCFA n’a pas de centime)', () => {
    expect(clampPaymentAmount(1_234.9, 5_000)).toBe(1_234)
  })

  it('le minimum encaissable reste cohérent', () => {
    expect(MIN_PAYMENT).toBeGreaterThan(0)
  })
})

describe('formatDifference', () => {
  it('affiche un écart nul sans signe', () => {
    expect(formatDifference(0)).toBe('0')
  })

  it('affiche un excédent et un manque avec leur signe', () => {
    // `toLocaleString` insère une espace insécable étroite : on la normalise
    // pour que l'assertion ne dépende pas de la version d'ICU.
    const normalise = (valeur: string) => valeur.replace(/[\u00a0\u202f]/g, ' ')

    expect(normalise(formatDifference(2_000))).toBe('+2 000')
    expect(formatDifference(-500)).toBe('−500')
  })
})

describe('isOrderLate — alertes de retard', () => {
  const aujourdhui = '2026-10-23'

  it('signale une échéance dépassée', () => {
    expect(isOrderLate({ dueDate: '2026-10-22', status: 'washing' }, aujourdhui)).toBe(true)
  })

  it('ne signale rien le jour même', () => {
    expect(isOrderLate({ dueDate: '2026-10-23', status: 'washing' }, aujourdhui)).toBe(false)
  })

  it('ignore une commande livrée ou annulée', () => {
    expect(isOrderLate({ dueDate: '2026-10-01', status: 'delivered' }, aujourdhui)).toBe(false)
    expect(isOrderLate({ dueDate: '2026-10-01', status: 'cancelled' }, aujourdhui)).toBe(false)
  })

  it('ignore l’absence d’échéance', () => {
    expect(isOrderLate({ dueDate: null, status: 'ready' }, aujourdhui)).toBe(false)
  })

  it('produit une date au format attendu par PostgreSQL', () => {
    expect(todayIso(new Date('2026-10-23T23:30:00Z'))).toBe('2026-10-23')
  })
})

describe('orderStatusRank — parcours complet', () => {
  it('numérote les huit étapes dans l’ordre', () => {
    const rangs = ORDER_FLOW.map((statut) => orderStatusRank(statut))
    expect(rangs).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('n’attribue aucun rang à une annulation', () => {
    expect(orderStatusRank('cancelled')).toBeNull()
  })

  it('couvre tri, séchage et contrôle qualité', () => {
    const etapes: OrderStatus[] = ['sorting', 'drying', 'quality_check']
    etapes.forEach((etape) => expect(orderStatusRank(etape)).not.toBeNull())
  })
})

describe('catalogue — jeu de départ et sélecteurs', () => {
  const entrees = defaultCatalog()

  it('propose 8 articles × 5 prestations', () => {
    expect(entrees).toHaveLength(40)
  })

  it('arrondit tous les prix à 50 FCFA', () => {
    entrees.forEach((entree) => expect(entree.price % 50).toBe(0))
  })

  it('ne contient aucun doublon (article, prestation)', () => {
    const cles = entrees.map((entree) => `${entree.article}|${entree.service}`)
    expect(new Set(cles).size).toBe(cles.length)
  })

  it('propose un tarif supérieur pour le nettoyage à sec', () => {
    const lavage = entrees.find((e) => e.article === 'Chemise' && e.service === 'Lavage')
    const sec = entrees.find((e) => e.article === 'Chemise' && e.service === 'Nettoyage à sec')

    expect(lavage?.price).toBe(1_500)
    expect(sec?.price).toBeGreaterThan(lavage?.price ?? 0)
  })

  const cache: LocalCatalogEntry[] = [
    { id: '1', tenantId: 't', article: 'Chemise', service: 'Lavage', price: 1500, isActive: true, sortOrder: 0 },
    { id: '2', tenantId: 't', article: 'Chemise', service: 'Repassage seul', price: 750, isActive: true, sortOrder: 1 },
    { id: '3', tenantId: 't', article: 'Pantalon', service: 'Lavage', price: 1500, isActive: true, sortOrder: 2 },
    { id: '4', tenantId: 't', article: 'Ancien article', service: 'Lavage', price: 100, isActive: false, sortOrder: 3 },
  ]

  it('liste les articles actifs, sans doublon et triés', () => {
    expect(uniqueArticles(cache)).toEqual(['Chemise', 'Pantalon'])
  })

  it('liste les prestations d’un article', () => {
    expect(servicesForArticle(cache, 'Chemise').map((e) => e.service)).toEqual([
      'Lavage',
      'Repassage seul',
    ])
  })
})


describe('allowedStatusTargets — ce que l’interface propose', () => {
  it('l’atelier ne reçoit que l’avancement', () => {
    const cibles = allowedStatusTargets('washing', 'artisan')

    expect(cibles).toEqual(['drying', 'ironing', 'quality_check', 'ready', 'delivered'])
    expect(cibles).not.toContain('cancelled')
  })

  it('le comptoir peut annuler mais pas revenir en arrière', () => {
    const cibles = allowedStatusTargets('ironing', 'receptionist')

    expect(cibles).toContain('cancelled')
    expect(cibles).not.toContain('washing')
  })

  it('une commande livrée est définitive pour le comptoir', () => {
    expect(allowedStatusTargets('delivered', 'receptionist')).toEqual([])
  })

  it('le propriétaire peut revenir en arrière', () => {
    const cibles = allowedStatusTargets('quality_check', 'owner')

    expect(cibles).toEqual([
      'received',
      'sorting',
      'washing',
      'drying',
      'ironing',
      'ready',
      'delivered',
      'cancelled',
    ])
  })

  it('seul le propriétaire rouvre une commande annulée', () => {
    expect(allowedStatusTargets('cancelled', 'receptionist')).toEqual([])
    expect(allowedStatusTargets('cancelled', 'owner')).toEqual([...ORDER_FLOW])
  })

  it('sans rôle reconnu, aucune transition n’est proposée', () => {
    expect(allowedStatusTargets('received', null)).toEqual([])
  })
})

describe('memberLabel — équipe du pressing', () => {
  it('préfère le nom affiché au rôle', () => {
    expect(
      memberLabel(
        { userId: 'u1', role: 'receptionist', displayName: 'Awa' },
        'u2',
      ),
    ).toBe('Awa')
  })

  it('retombe sur le rôle quand le nom manque', () => {
    expect(
      memberLabel({ userId: 'u1', role: 'artisan', displayName: null }, 'u2'),
    ).toBe('Atelier')
  })

  it('signale le compte courant', () => {
    expect(
      memberLabel({ userId: 'u1', role: 'owner', displayName: 'Koffi' }, 'u1'),
    ).toBe('Koffi (moi)')
  })
})
