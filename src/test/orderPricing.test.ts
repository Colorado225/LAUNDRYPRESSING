import { describe, expect, it } from 'vitest'
import {
  LONGUEUR_MIN_MOTIF,
  MOTIF_LIGNE_LIBRE,
  motifPrixServeur,
  problemeTarifaire,
} from '@/lib/orderPricing'

/**
 * Règles de prix partagées avec le déclencheur `guard_order_item_price`.
 *
 * Ces tests verrouillent l'alignement frontend ↔ base : sans motif de prix, une
 * ligne libre est refusée par PostgreSQL, et la commande restait bloquée en file
 * de synchronisation sans que le comptoir le sache.
 */

describe('motif de prix envoyé au serveur', () => {
  it('conserve un motif saisi suffisamment long', () => {
    expect(
      motifPrixServeur({ label: 'Chemise', catalogEntryId: null, priceReason: 'Tarif négocié client fidèle' }),
    ).toBe('Tarif négocié client fidèle')
  })

  it('produit un motif conforme pour une ligne libre sans motif', () => {
    const motif = motifPrixServeur({ label: 'Chemise blanche', catalogEntryId: null, priceReason: null })

    expect(motif).toContain(MOTIF_LIGNE_LIBRE)
    expect(motif).toContain('Chemise blanche')
    expect((motif ?? '').length).toBeGreaterThanOrEqual(LONGUEUR_MIN_MOTIF)
  })

  it('remplace un motif trop court plutôt que de laisser échouer la synchronisation', () => {
    const motif = motifPrixServeur({ label: 'Robe', catalogEntryId: null, priceReason: 'prix' })

    expect(motif).toContain(MOTIF_LIGNE_LIBRE)
    expect((motif ?? '').length).toBeGreaterThanOrEqual(LONGUEUR_MIN_MOTIF)
  })

  it('n’impose aucun motif à une ligne issue du catalogue', () => {
    expect(
      motifPrixServeur({
        label: 'Chemise',
        catalogEntryId: '11111111-1111-4111-8111-111111111111',
        priceReason: null,
      }),
    ).toBeNull()
  })

  it('borne le motif à la longueur de la colonne', () => {
    const motif = motifPrixServeur({
      label: 'x'.repeat(400),
      catalogEntryId: null,
      priceReason: null,
    })

    expect((motif ?? '').length).toBeLessThanOrEqual(300)
  })
})

describe('contrôle tarifaire avant écriture', () => {
  it('refuse une ligne à 0 FCFA, que PostgreSQL rejetterait aussi', () => {
    expect(
      problemeTarifaire({ label: 'Chemise', unitPrice: 0, price: 0 }),
    ).toContain('prix unitaire')
  })

  it('accepte une ligne correctement chiffrée', () => {
    expect(problemeTarifaire({ label: 'Chemise', unitPrice: 2500, price: 5000 })).toBeNull()
  })
})
