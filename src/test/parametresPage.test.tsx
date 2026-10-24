import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import Parametres from '@/pages/Parametres'
import { db } from '@/db/localDb'
import { useTenantStore } from '@/lib/tenantContext'

/**
 * Montage réel de l'écran Paramètres enrichi.
 *
 * Les règles pures sont couvertes par `parametres.test.ts` et la purge par
 * `maintenance.test.ts`. Ici, on vérifie ce qu'un utilisateur voit : le
 * formulaire de renommage réservé au propriétaire, la section des données
 * locales, l'équipe — et l'absence de plantage quand IndexedDB est vide.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'

let racine: Root
let hote: HTMLDivElement

async function monter() {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  await act(async () => {
    racine.render(
      <MemoryRouter>
        <Parametres />
      </MemoryRouter>,
    )
  })
  // `resumerDonneesLocales` est asynchrone : on laisse la boucle se vider.
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
  useTenantStore.setState({
    tenantId: TENANT,
    tenantName: 'Pressing Cocody',
    role: 'owner',
    userId: 'user-1',
    shops: [{ tenantId: TENANT, tenantName: 'Pressing Cocody', role: 'owner' }],
  })
})

describe('page Paramètres', () => {
  it('affiche les quatre sections et le nom du pressing', async () => {
    await monter()
    const texte = hote.textContent ?? ''

    expect(texte).toContain('Paramètres')
    expect(texte).toContain('Pressing Cocody')
    expect(texte).toContain('Équipe')
    expect(texte).toContain('Synchronisation')
    expect(texte).toContain('Données sur cet appareil')
    expect(texte).toContain('Version')

    demonter()
  })

  it('propose le renommage au propriétaire seulement', async () => {
    await monter()
    expect(hote.textContent).toContain('Modifier')
    demonter()

    useTenantStore.setState({ role: 'receptionist' })
    await monter()
    expect(hote.textContent).not.toContain('Modifier')
    expect(hote.textContent).toContain('Seul le propriétaire peut renommer le pressing.')
    demonter()
  })

  it('désactive l’effacement quand rien n’est purgeable', async () => {
    await monter()

    const boutons = [...hote.querySelectorAll('button')]
    const effacer = boutons.find((bouton) =>
      (bouton.textContent ?? '').includes('Effacer les commandes synchronisées'),
    )

    expect(effacer).toBeDefined()
    expect(effacer?.disabled).toBe(true)

    demonter()
  })

  it('ne plante pas avec un cache local vide', async () => {
    await monter()
    expect(hote.textContent).toContain('Effaçables sans perte')
    demonter()
  })
})
