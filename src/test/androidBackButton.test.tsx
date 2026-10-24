import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAndroidBackButton } from '@/hooks/useAndroidBackButton'

const mocks = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('react-hot-toast', () => ({ default: mocks.toast }))

let host: HTMLDivElement
let root: Root

function BackHarness() {
  useAndroidBackButton()
  const location = useLocation()
  return <output data-testid="route">{location.pathname}</output>
}

async function mount(path: string) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <BackHarness />
      </MemoryRouter>,
    )
  })
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
}

function unmount() {
  act(() => root.unmount())
  host.remove()
}

beforeEach(() => {
  mocks.toast.mockReset()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  if (host?.isConnected) unmount()
})

describe('bouton Retour Android', () => {
  it('sur la liste principale, prévient avant de quitter', async () => {
    await mount('/commandes')

    act(() => window.dispatchEvent(new PopStateEvent('popstate')))

    expect(host.querySelector('[data-testid="route"]')?.textContent).toBe('/commandes')
    expect(mocks.toast).toHaveBeenCalledWith(
      'Appuyez à nouveau sur « Retour » pour quitter l’application.',
      expect.objectContaining({ id: 'android-back-exit' }),
    )

    unmount()
  })

  it('sur un lien profond, ramène à la liste sans quitter l’application', async () => {
    await mount('/atelier')

    act(() => window.dispatchEvent(new PopStateEvent('popstate')))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

    expect(host.querySelector('[data-testid="route"]')?.textContent).toBe('/commandes')
    expect(mocks.toast).not.toHaveBeenCalled()

    unmount()
  })
})
