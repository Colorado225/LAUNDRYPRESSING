import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type LocalOrder, type LocalOrderIssue } from '@/db/localDb'
import { checkOrderDeletion, deleteOrderEverywhere } from '@/services/orderAdminService'
import { deleteOrderIssue, resolveOrderIssue } from '@/services/issueService'

/**
 * Suppression d'une commande et clôture d'une réclamation, **sans backend**.
 *
 * Ce mode correspond au fonctionnement hors ligne (et à la démonstration
 * locale) : une commande créée sur la tablette n'existe nulle part ailleurs.
 * Ce qui compte ici :
 *  - une commande déjà envoyée ne se supprime pas sans connexion, sinon elle
 *    réapparaîtrait à la synchronisation suivante ;
 *  - une commande qui porte de l'argent ne se supprime jamais ;
 *  - le nettoyage local enlève les dépendances, sans laisser d'orphelins dans
 *    les agrégats de caisse ou de rapports.
 */

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: false }))

const TENANT = '11111111-1111-4111-8111-111111111111'

function commande(patch: Partial<LocalOrder> & Pick<LocalOrder, 'id'>): LocalOrder {
  return {
    tenantId: TENANT,
    customerName: 'Awa Koné',
    customerPhone: '0700000021',
    status: 'received',
    qrCode: `CMD-${patch.id}`,
    photoUrl: null,
    totalAmount: 5_000,
    paymentStatus: 'pending',
    paymentMethod: null,
    createdAt: '2026-10-23T08:00:00.000Z',
    updatedAt: '2026-10-23T08:00:00.000Z',
    synced: 0,
    syncedAt: null,
    serverVersion: 0,
    syncError: null,
    syncConflict: null,
    dueDate: null,
    assignedTo: null,
    assignedAt: null,
    statusReason: null,
    ...patch,
  }
}

function reclamation(orderId: string, patch: Partial<LocalOrderIssue> = {}): LocalOrderIssue {
  return {
    id: `issue-${orderId}`,
    orderId,
    tenantId: TENANT,
    orderItemId: null,
    kind: 'stained',
    severity: 'minor',
    stage: 'reception',
    description: 'Tache constatée avec le client.',
    resolution: null,
    resolutionNote: null,
    resolvedAt: null,
    reportedBy: null,
    createdAt: '2026-10-23T08:00:00.000Z',
    synced: 0,
    lastError: null,
    ...patch,
  }
}

beforeEach(async () => {
  await Promise.all([
    db.orders.clear(),
    db.orderItems.clear(),
    db.cashPayments.clear(),
    db.orderIssues.clear(),
    db.notifications.clear(),
    db.pendingPayments.clear(),
    db.refunds.clear(),
  ])
  vi.restoreAllMocks()
})

describe('suppression d’une commande hors ligne', () => {
  it('accepte une commande jamais synchronisée, même sans réseau', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await db.orders.add(commande({ id: 'commande-locale', synced: 0 }))

    await expect(
      checkOrderDeletion(commande({ id: 'commande-locale', synced: 0 })),
    ).resolves.toEqual({ autorisee: true })
  })

  it('refuse une commande déjà envoyée sans connexion', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const enLigne = commande({ id: 'commande-serveur', synced: 1, serverVersion: 3 })

    const controle = await checkOrderDeletion(enLigne)

    expect(controle.autorisee).toBe(false)
    expect(controle.raison).toContain('nécessite une connexion')
  })

  it('refuse dès qu’un encaissement espèces est rattaché', async () => {
    await db.orders.add(commande({ id: 'commande-payee' }))
    await db.cashPayments.add({
      id: 'paiement-1',
      orderId: 'commande-payee',
      tenantId: TENANT,
      amount: 2_000,
      method: 'cash',
      note: null,
      receivedAt: '2026-10-23T08:30:00.000Z',
      synced: 1,
      lastError: null,
    })

    const controle = await checkOrderDeletion(commande({ id: 'commande-payee' }))

    expect(controle.autorisee).toBe(false)
    expect(controle.raison).toContain('Annulez-la')
  })

  it('refuse dès qu’un remboursement existe', async () => {
    await db.refunds.add({
      id: 'remboursement-1',
      orderId: 'commande-remboursee',
      tenantId: TENANT,
      amount: 1_000,
      channel: 'cash',
      reason: 'Tache non retirée, geste commercial.',
      refundedAt: '2026-10-23T09:00:00.000Z',
      refundedBy: null,
    })

    const controle = await checkOrderDeletion(commande({ id: 'commande-remboursee' }))

    expect(controle.autorisee).toBe(false)
    expect(controle.raison).toContain('remboursement')
  })

  it('nettoie la commande et toutes ses dépendances locales', async () => {
    await db.orders.add(commande({ id: 'commande-a-supprimer' }))
    await db.orderItems.add({
      id: 'ligne-1',
      orderId: 'commande-a-supprimer',
      tenantId: TENANT,
      label: 'Chemise',
      articleName: null,
      serviceName: null,
      fabricType: null,
      specialInstructions: null,
      quantity: 1,
      billedQuantity: 1,
      billingUnit: 'PIECE',
      unitPrice: 5_000,
      price: 5_000,
      pricingMode: 'FIXED',
      priceStatus: 'CONFIRMED',
      priceReason: null,
      catalogEntryId: null,
      familyNameSnapshot: null,
      catalogUnitPriceSnapshot: null,
      minimumQuantitySnapshot: null,
      billingIncrementSnapshot: null,
      minimumChargeSnapshot: null,
      conditionsSnapshot: null,
      tenantServiceId: null,
      activityNameSnapshot: null,
      garmentDetails: [],
    })
    await db.orderIssues.add(reclamation('commande-a-supprimer'))
    await db.notifications.add({
      id: 'notification-1',
      tenantId: TENANT,
      orderId: 'commande-a-supprimer',
      channel: 'appel',
      reason: 'pret',
      customerName: 'Awa Koné',
      customerPhone: '0700000021',
      message: 'Commande prête.',
      createdAt: '2026-10-23T09:00:00.000Z',
      synced: 0,
      lastError: null,
    })

    await deleteOrderEverywhere(commande({ id: 'commande-a-supprimer', synced: 0 }))

    expect(await db.orders.count()).toBe(0)
    expect(await db.orderItems.count()).toBe(0)
    expect(await db.orderIssues.count()).toBe(0)
    expect(await db.notifications.count()).toBe(0)
  })
})

describe('réclamations sans backend', () => {
  it('clôture une réclamation localement avec sa note', async () => {
    const issue = reclamation('commande-1')
    await db.orderIssues.add(issue)

    await resolveOrderIssue(issue, 'compensated', '  Geste commercial de 2 000 FCFA  ')

    const enregistree = await db.orderIssues.get(issue.id)
    expect(enregistree?.resolution).toBe('compensated')
    expect(enregistree?.resolutionNote).toBe('Geste commercial de 2 000 FCFA')
    expect(enregistree?.resolvedAt).not.toBeNull()
  })

  it('rouvre une réclamation et efface la note', async () => {
    const issue = reclamation('commande-2', {
      resolution: 'repaired',
      resolutionNote: 'Reprise faite',
      resolvedAt: '2026-10-23T10:00:00.000Z',
    })
    await db.orderIssues.add(issue)

    await resolveOrderIssue(issue, null, null)

    const enregistree = await db.orderIssues.get(issue.id)
    expect(enregistree?.resolution).toBeNull()
    expect(enregistree?.resolutionNote).toBeNull()
    expect(enregistree?.resolvedAt).toBeNull()
  })

  it('supprime une réclamation jamais envoyée', async () => {
    const issue = reclamation('commande-3')
    await db.orderIssues.add(issue)

    await deleteOrderIssue(issue)

    expect(await db.orderIssues.get(issue.id)).toBeUndefined()
  })
})
