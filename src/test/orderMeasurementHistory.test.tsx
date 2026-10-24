import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OrderMeasurementHistory from '@/components/OrderMeasurementHistory'
import type { LocalOrderItem } from '@/db/localDb'
import type { OrderPriceHistoryRow } from '@/types/database'
import { getOrderMeasurementHistory } from '@/services/orderMeasurementHistory'

vi.mock('@/services/orderMeasurementHistory', () => ({
  getOrderMeasurementHistory: vi.fn(),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORDER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ITEM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const mockHistory = vi.mocked(getOrderMeasurementHistory)

const item: LocalOrderItem = {
  id: ITEM,
  orderId: ORDER,
  tenantId: TENANT,
  label: 'Couette',
  fabricType: null,
  specialInstructions: null,
  price: 10_500,
  quantity: 7,
  billedQuantity: 7,
  billingUnit: 'KG',
  unitPrice: 1_500,
  pricingMode: 'FROM',
  priceStatus: 'CONFIRMED',
  catalogEntryId: null,
  articleName: 'Couette',
  serviceName: 'Lavage au poids',
  familyNameSnapshot: null,
  catalogUnitPriceSnapshot: 1_500,
  minimumQuantitySnapshot: null,
  billingIncrementSnapshot: 0.5,
  minimumChargeSnapshot: null,
  conditionsSnapshot: null,
  priceReason: null,
}

const historyRow: OrderPriceHistoryRow = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  tenant_id: TENANT,
  order_id: ORDER,
  order_item_id: ITEM,
  previous_price: 9_750,
  new_price: 10_500,
  reason: null,
  changed_by: null,
  changed_at: '2026-03-14T10:00:00.000Z',
  previous_snapshot: {
    quantity: 6.4,
    billed_quantity: 6.5,
    billing_unit: 'KG',
    price_status: 'ESTIMATED',
  },
  new_snapshot: {
    quantity: 7,
    billed_quantity: 7,
    billing_unit: 'KG',
    price_status: 'CONFIRMED',
  },
}

let host: HTMLDivElement
let root: Root

async function mount(showAmounts = true) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(
      <OrderMeasurementHistory
        tenantId={TENANT}
        orderId={ORDER}
        items={[item]}
        showAmounts={showAmounts}
      />,
    )
  })
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
}

function unmount() {
  act(() => root.unmount())
  host.remove()
}

beforeEach(() => {
  mockHistory.mockReset()
})

describe('historique des mesures de commande', () => {
  it('affiche les anciennes et nouvelles mesures, prix et date', async () => {
    mockHistory.mockResolvedValue([historyRow])
    await mount()

    const texte = (host.textContent ?? '').replace(/\s/g, ' ')
    expect(texte).toContain('Historique des mesures et tarifs')
    expect(texte).toContain('Couette')
    expect(texte).toContain('Mesure : 6,4 → 7 kg')
    expect(texte).toContain('Quantité facturée : 6,5 → 7 kg')
    expect(texte).toContain('9 750 FCFA → 10 500 FCFA')
    expect(texte).toContain('État de la mesure : estimée → confirmée')
    expect(texte).toContain('2026')

    unmount()
  })

  it('masque les montants aux rôles qui ne peuvent pas les voir', async () => {
    mockHistory.mockResolvedValue([historyRow])
    await mount(false)

    expect(host.textContent).toContain('Montant : —')
    expect(host.textContent).not.toContain('9 750 FCFA')
    expect(host.textContent).not.toContain('10 500 FCFA')

    unmount()
  })

  it('signale simplement que le serveur est indisponible hors ligne', async () => {
    mockHistory.mockRejectedValue(new Error('L’historique du serveur n’est pas accessible hors connexion.'))
    await mount()

    expect(host.textContent).toContain('L’historique du serveur n’est pas accessible hors connexion.')

    unmount()
  })
})
