import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCreateOrder } from '@/db/hooks'
import { db } from '@/db/localDb'
import { parseQrString } from '@/services/qrService'
import { useTenantStore } from '@/lib/tenantContext'

/**
 * Tests du hook `useCreateOrder` (phase 6).
 *
 * C'est le geste le plus fréquent du réceptionniste : il doit fonctionner sans
 * réseau, calculer le total, générer le QR et rattacher la commande au bon
 * pressing. On vérifie aussi qu'aucune requête réseau n'est émise.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'

/** Mini `renderHook` : évite d'ajouter Testing Library pour trois tests. */
function renderHook<T>(hook: () => T) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const container: { current: T | null } = { current: null }

  function Probe() {
    container.current = hook()
    return null
  }

  act(() => {
    root.render(<Probe />)
  })

  return {
    result: () => {
      if (container.current === null) throw new Error('Hook non monté')
      return container.current
    },
    unmount: () => {
      act(() => root.unmount())
      host.remove()
    },
  }
}

const validInput = {
  customerName: '  Awa Koné  ',
  customerPhone: '+2250700000001',
  items: [
    {
      label: 'Chemise',
      fabricType: '  Bazin ',
      price: 2500,
      priceReason: 'Prestation de test',
    },
    {
      label: 'Pantalon',
      specialInstructions: '',
      price: 3500,
      priceReason: 'Prestation de test',
    },
  ],
}

beforeEach(async () => {
  await db.orders.clear()
  await db.orderItems.clear()
  useTenantStore.setState({ tenantId: TENANT, tenantName: 'Pressing Cocody', role: 'owner' })
})

describe('useCreateOrder', () => {
  it('refuse de créer une commande sans pressing sélectionné', async () => {
    useTenantStore.setState({ tenantId: null })
    const hook = renderHook(() => useCreateOrder())

    await expect(hook.result()(validInput)).rejects.toThrow('Aucun pressing sélectionné')
    expect(await db.orders.count()).toBe(0)

    hook.unmount()
  })

  it('enregistre la commande et ses vêtements en une seule opération', async () => {
    const hook = renderHook(() => useCreateOrder())

    const { order, items } = await hook.result()(validInput)

    expect(await db.orders.count()).toBe(1)
    expect(await db.orderItems.count()).toBe(2)

    expect(order.customerName).toBe('Awa Koné')
    expect(order.tenantId).toBe(TENANT)
    expect(order.status).toBe('received')
    expect(order.paymentStatus).toBe('pending')
    expect(order.paymentMethod).toBeNull()
    expect(order.synced).toBe(0)
    expect(order.syncedAt).toBeNull()

    // Le total est la somme des prix des vêtements, jamais saisi à la main.
    expect(order.totalAmount).toBe(6000)
    expect(items.reduce((total, item) => total + item.price, 0)).toBe(order.totalAmount)

    hook.unmount()
  })

  it('recalcule hors ligne le poids facturable depuis les instantanés du catalogue', async () => {
    const hook = renderHook(() => useCreateOrder())
    const result = await hook.result()({
      customerName: 'Awa Koné',
      customerPhone: '+2250700000001',
      items: [
        {
          label: 'Couette — lavage au poids',
          articleName: 'Couette',
          serviceName: 'Lavage au poids',
          catalogEntryId: '33333333-3333-4333-8333-333333333301',
          price: 1,
          quantity: 6.4,
          billingUnit: 'KG',
          unitPrice: 1_500,
          pricingMode: 'FROM',
          priceStatus: 'ESTIMATED',
          catalogUnitPriceSnapshot: 1_500,
          minimumQuantitySnapshot: 2,
          billingIncrementSnapshot: 0.5,
          minimumChargeSnapshot: 3_500,
          familyNameSnapshot: 'Linge de maison',
          conditionsSnapshot: 'Poids à confirmer avant traitement',
        },
      ],
    })

    expect(result.items[0]).toMatchObject({
      quantity: 6.4,
      billedQuantity: 6.5,
      billingUnit: 'KG',
      unitPrice: 1_500,
      price: 9_750,
      pricingMode: 'FROM',
      priceStatus: 'ESTIMATED',
      familyNameSnapshot: 'Linge de maison',
    })
    expect(result.order.totalAmount).toBe(9_750)
    hook.unmount()
  })

  it('refuse un devis dont le montant final n’a pas été confirmé avec le client', async () => {
    const hook = renderHook(() => useCreateOrder())

    await expect(
      hook.result()({
        customerName: 'Awa Koné',
        customerPhone: '+2250700000001',
        items: [
          {
            label: 'Couette — nettoyage sur devis',
            catalogEntryId: '33333333-3333-4333-8333-333333333302',
            articleName: 'Couette',
            serviceName: 'Nettoyage sur devis',
            price: 8_000,
            quantity: 1,
            billingUnit: 'FLAT',
            unitPrice: 8_000,
            pricingMode: 'QUOTE',
            priceStatus: 'ESTIMATED',
            catalogUnitPriceSnapshot: 0,
          },
        ],
      }),
    ).rejects.toThrow('Un devis doit avoir un montant confirmé.')
    expect(await db.orders.count()).toBe(0)
    hook.unmount()
  })

  it('accepte une ligne libre tarifée sans référence de catalogue', async () => {
    const hook = renderHook(() => useCreateOrder())

    const { order, items } = await hook.result()({
      customerName: 'Awa Koné',
      customerPhone: '+2250700000001',
      items: [{ label: 'Retouche', price: 700 }],
    })
    expect(order.totalAmount).toBe(700)
    expect(items[0]?.catalogEntryId).toBeNull()
    expect(await db.orders.count()).toBe(1)
    hook.unmount()
  })

  it('génère un QR exploitable qui pointe vers cette commande', async () => {
    const hook = renderHook(() => useCreateOrder())
    const { order } = await hook.result()(validInput)

    const parsed = parseQrString(order.qrCode)
    expect(parsed).not.toBeNull()
    expect(parsed?.orderId).toBe(order.id)
    expect(parsed?.tenantId).toBe(TENANT)

    hook.unmount()
  })

  it('nettoie les champs et convertit les valeurs vides en null', async () => {
    const hook = renderHook(() => useCreateOrder())
    const { items } = await hook.result()(validInput)

    expect(items[0]?.fabricType).toBe('Bazin')
    // Chaîne vide fournie par un formulaire → null, pas de '' en base.
    expect(items[1]?.specialInstructions).toBeNull()

    hook.unmount()
  })

  it('donne un identifiant et un QR différents à chaque commande', async () => {
    const hook = renderHook(() => useCreateOrder())

    const first = await hook.result()(validInput)
    const second = await hook.result()(validInput)

    expect(first.order.id).not.toBe(second.order.id)
    expect(first.order.qrCode).not.toBe(second.order.qrCode)
    expect(await db.orders.count()).toBe(2)

    hook.unmount()
  })

  it('n’émet aucune requête réseau : la création est purement locale', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const hook = renderHook(() => useCreateOrder())

    await hook.result()(validInput)

    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
    hook.unmount()
  })
})
