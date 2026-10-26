import { describe, expect, it } from 'vitest'
import type { LocalOrder, LocalOrderItem } from '@/db/localDb'
import {
  escapeHtml,
  generatePrintableReceipt,
  generateReceiptText,
  generateWhatsAppUrl,
} from '@/services/receiptService'

/**
 * Reçu partageable (WhatsApp + impression 80 mm).
 *
 * Le point fragile : le HTML d'impression est assemblé par interpolation et
 * écrit via `document.write` dans une fenêtre de même origine. Toute valeur
 * saisie au comptoir (nom du client, libellé d'article, nom du pressing) doit
 * donc être échappée, sinon elle devient du balisage — reçu cassé au mieux,
 * script exécuté avec accès à la fenêtre parente au pire.
 */

const ORDER_ID = 'order-1'

function commande(partial: Partial<LocalOrder> = {}): LocalOrder {
  return {
    id: ORDER_ID,
    tenantId: 'tenant-1',
    customerName: 'Awa Koné',
    customerPhone: '0700000021',
    status: 'ready',
    qrCode: 'QR-ABC123',
    photoUrl: null,
    totalAmount: 3_000,
    paymentStatus: 'paid',
    paymentMethod: 'cash',
    createdAt: '2026-10-26T09:30:00.000Z',
    updatedAt: '2026-10-26T09:30:00.000Z',
    synced: 1,
    syncedAt: '2026-10-26T09:35:00.000Z',
    serverVersion: 1,
    syncError: null,
    syncConflict: null,
    dueDate: '2026-10-28',
    assignedTo: null,
    assignedAt: null,
    statusReason: null,
    ...partial,
  }
}

function ligne(partial: Partial<LocalOrderItem> & Pick<LocalOrderItem, 'id'>): LocalOrderItem {
  return {
    orderId: ORDER_ID,
    tenantId: 'tenant-1',
    label: 'Chemise',
    fabricType: null,
    specialInstructions: null,
    price: 1_500,
    quantity: 2,
    billedQuantity: 2,
    billingUnit: 'PIECE',
    unitPrice: 1_500,
    pricingMode: 'FIXED',
    priceStatus: 'CONFIRMED',
    catalogEntryId: null,
    articleName: 'Chemise',
    serviceName: 'Lavage',
    familyNameSnapshot: null,
    catalogUnitPriceSnapshot: null,
    minimumQuantitySnapshot: null,
    billingIncrementSnapshot: null,
    minimumChargeSnapshot: null,
    conditionsSnapshot: null,
    priceReason: null,
    ...partial,
  }
}

describe('escapeHtml', () => {
  it('neutralise les caractères significatifs en HTML', () => {
    expect(escapeHtml('<b>"A & B"</b> l\'atelier')).toBe(
      '&lt;b&gt;&quot;A &amp; B&quot;&lt;/b&gt; l&#39;atelier',
    )
  })
})

describe('generatePrintableReceipt', () => {
  it('échappe le nom du client, les libellés et le nom du pressing', () => {
    const html = generatePrintableReceipt(
      commande({ customerName: '<script>alert(1)</script>' }),
      [ligne({ id: 'l1', label: '<img src=x onerror=alert(1)>' })],
      'Pressing <b>Cocody</b>',
    )

    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('Pressing &lt;b&gt;Cocody&lt;/b&gt;')
  })

  it('affiche le total et le statut de paiement en français', () => {
    const html = generatePrintableReceipt(commande(), [ligne({ id: 'l1' })], 'Pressing Cocody')

    expect(html).toContain('Pressing Cocody')
    expect(html).toContain('QR-ABC123')
    expect(html).toContain('Payé')
    expect(html).toContain('FCFA')
  })
})

describe('generateReceiptText', () => {
  it('produit un texte WhatsApp avec lignes, total et statut', () => {
    const texte = generateReceiptText(commande(), [ligne({ id: 'l1' })], 'Pressing Cocody')

    expect(texte).toContain('Pressing Cocody')
    expect(texte).toContain('Chemise (2x)')
    expect(texte).toContain('TOTAL')
    expect(texte).toContain('Payé')
  })

  it('signale l’absence d’article plutôt qu’un blanc', () => {
    const texte = generateReceiptText(commande(), [], 'Pressing Cocody')

    expect(texte).toContain('Aucun article')
  })
})

describe('generateWhatsAppUrl', () => {
  it('normalise un numéro ivoirien local en format international', () => {
    expect(generateWhatsAppUrl('07 00 00 00 21', 'Bonjour')).toBe(
      'https://wa.me/225700000021?text=Bonjour',
    )
  })

  it('conserve un numéro déjà international et encode le texte', () => {
    expect(generateWhatsAppUrl('+2250700000021', 'Reçu prêt ✓')).toBe(
      `https://wa.me/2250700000021?text=${encodeURIComponent('Reçu prêt ✓')}`,
    )
  })
})
