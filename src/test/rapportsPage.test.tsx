import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Rapports from '@/pages/Rapports'
import { db } from '@/db/localDb'
import { useTenantStore } from '@/lib/tenantContext'

/**
 * Mode démonstration forcé : avec un `.env` réel, la section « équipe »
 * chargerait ses membres depuis Supabase (inaccessible en test) et resterait
 * bloquée sur « Chargement de l’équipe… ». Les tests de rendu reposent sur
 * les données locales.
 */
vi.mock('@/lib/env', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/env')>()
  return {
    ...original,
    isSupabaseConfigured: false,
  }
})

/**
 * Vérification de montage de l'écran 11.
 *
 * Les calculs sont couverts par `rapports.test.ts` ; ce qui se teste ici, c'est
 * que la page **se monte réellement** : JSX, graphique SVG, tableaux, et le
 * cloisonnement par rôle. Un écran qui plante au rendu passerait tous les tests
 * de calcul pur.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'

let racine: Root
let hote: HTMLDivElement

async function monter() {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  await act(async () => {
    racine.render(<Rapports />)
  })
  // Les hooks Dexie (`useLiveQuery`) résolvent leur première lecture en
  // asynchrone : on laisse tourner la boucle avant d'inspecter le DOM.
  await act(async () => {
    await new Promise((resoudre) => setTimeout(resoudre, 0))
  })
}

function demonter() {
  act(() => racine.unmount())
  hote.remove()
}

beforeEach(async () => {
  await db.orders.clear()
  await db.orderItems.clear()
  await db.cashPayments.clear()
  useTenantStore.setState({ tenantId: TENANT, tenantName: 'Pressing Cocody', role: 'owner' })
})

describe('page Rapports', () => {
  it('affiche les indicateurs et la période par défaut', async () => {
    const aujourdhui = new Date().toISOString()
    await db.orders.add({
      id: 'c1',
      tenantId: TENANT,
      customerName: 'Awa Koné',
      customerPhone: '0700000021',
      status: 'ready',
      qrCode: 'CMD-c1',
      photoUrl: null,
      totalAmount: 6_000,
      paymentStatus: 'pending',
      paymentMethod: null,
      createdAt: aujourdhui,
      updatedAt: aujourdhui,
      synced: 1,
      syncedAt: aujourdhui,
      serverVersion: 1,
      syncError: null,
      syncConflict: null,
      dueDate: null,
      assignedTo: null,
      assignedAt: null,
      statusReason: null,
    })

    await monter()
    const texte = hote.textContent ?? ''

    expect(texte).toContain('Rapports')
    expect(texte).toContain('Facturé')
    // `Intl.NumberFormat('fr-CI')` sépare les milliers par une espace fine
    // insécable (U+202F) : on normalise avant de comparer.
    expect(texte.replace(/\s/g, ' ')).toContain('6 000 FCFA')
    expect(texte).toContain('7 jours')
    expect(texte).toContain('Exporter en CSV')
    expect(texte).toContain('Charge et activité par membre')
    expect(texte).toContain('Sans attribution')
    // Le graphique est un SVG accessible, pas une image opaque.
    expect(hote.querySelector('svg[role="img"]')).not.toBeNull()

    demonter()
  })

  it('refuse l’accès à un réceptionniste', async () => {
    useTenantStore.setState({ role: 'receptionist' })
    await monter()
    expect(hote.textContent).toContain('Accès réservé')
    demonter()
  })

  it('se monte sans aucune commande, sans erreur', async () => {
    await monter()
    expect(hote.textContent).toContain('Aucune commande sur la période.')
    demonter()
  })
})
