import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import AppLayout from '@/components/AppLayout'
import { useTenantStore } from '@/lib/tenantContext'

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
        <AppLayout>
          <p>Contenu de l'écran</p>
        </AppLayout>
      </MemoryRouter>,
    )
  })
  await act(async () => {
    await new Promise((resoudre) => setTimeout(resoudre, 0))
  })
}

function demonter() {
  act(() => racine.unmount())
  hote.remove()
}

function bouton(attribut: string, valeur: string): HTMLButtonElement {
  const trouve = hote.querySelector<HTMLButtonElement>(`[${attribut}="${valeur}"]`)
  if (!trouve) throw new Error(`Bouton introuvable : ${valeur}`)
  return trouve
}

beforeEach(() => {
  useTenantStore.setState({
    tenantId: TENANT,
    tenantName: 'Pressing Cocody',
    role: 'owner',
    userId: 'user-1',
  })
})

afterEach(() => {
  if (hote?.isConnected) demonter()
})

describe('AppLayout — navigation mobile en tiroir', () => {
  it('ne laisse pas les onglets étalés horizontalement', async () => {
    await monter()
    // Le bouton menu est la seule porte d'accès aux onglets sur mobile :
    // aucun lien de navigation n'est affiché en permanence dans la barre.
    expect(hote.querySelector('[aria-label="Ouvrir le menu"]')).not.toBeNull()
    expect([...hote.querySelectorAll('header nav a')]).toHaveLength(0)
    demonter()
  })

  it('affiche les onglets dans un tiroir ouvert par le bouton menu', async () => {
    await monter()
    expect(hote.querySelector('[aria-label="Menu de navigation"]')).toBeNull()

    await act(async () => bouton('aria-label', 'Ouvrir le menu').click())

    const tiroir = hote.querySelector<HTMLElement>('[aria-label="Menu de navigation"]')
    expect(tiroir).not.toBeNull()
    expect(tiroir?.textContent).toContain('Catalogue')
    expect(tiroir?.textContent).toContain('Atelier')
    expect(bouton('aria-label', 'Ouvrir le menu').getAttribute('aria-expanded')).toBe('true')
    demonter()
  })

  it('ferme le tiroir au clic sur un onglet et au clic sur l’ombre', async () => {
    await monter()
    const menu = bouton('aria-label', 'Ouvrir le menu')

    await act(async () => menu.click())
    expect(hote.querySelector('[aria-label="Menu de navigation"]')).not.toBeNull()

    // Un onglet navigue vers une autre page et le tiroir se referme.
    const lien = [...hote.querySelectorAll('a')].find((element) =>
      element.textContent?.includes('Catalogue'),
    )
    expect(lien).toBeDefined()
    await act(async () => lien?.click())
    expect(menu.getAttribute('aria-expanded')).toBe('false')

    // Réouverture, puis fermeture par l’ombre.
    await act(async () => menu.click())
    expect(hote.querySelector('[aria-label="Menu de navigation"]')).not.toBeNull()
    const ombre = hote.querySelector<HTMLElement>('.bg-slate-900\\/50')
    expect(ombre).not.toBeNull()
    await act(async () => ombre?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(menu.getAttribute('aria-expanded')).toBe('false')
    demonter()
  })
})
