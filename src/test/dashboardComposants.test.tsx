import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MetricCard from '@/components/dashboard/MetricCard'
import RecentOrdersTable, {
  type LigneCommandeRecente,
} from '@/components/dashboard/RecentOrdersTable'
import RevenueChart from '@/components/dashboard/RevenueChart'
import { variationPourcent } from '@/services/dashboardService'
import { useDemoStore } from '@/lib/demoMode'

/**
 * Composants du tableau de bord.
 *
 * Le contrat vérifié ici est celui qui compte pour la refonte : les cartes
 * affichent ce qu'on leur donne **sans rien inventer** (pas de variation quand
 * la veille est à zéro), le tableau ne propose des actions que sur une vraie
 * commande, et le graphique reste lisible autrement qu'à l'œil (résumé
 * textuel pour les lecteurs d'écran).
 */

let racine: Root | null = null
let hote: HTMLDivElement | null = null

async function monter(element: React.ReactElement) {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  await act(async () => {
    racine!.render(<MemoryRouter>{element}</MemoryRouter>)
  })
}

afterEach(() => {
  if (racine) act(() => racine!.unmount())
  hote?.remove()
  racine = null
  hote = null
})

beforeEach(() => {
  useDemoStore.setState({ actif: false })
  // Recharts mesure son conteneur : jsdom n'implémente pas ResizeObserver.
  if (!('ResizeObserver' in globalThis)) {
    class Observateur {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', { value: Observateur, configurable: true })
  }
})

function texte(): string {
  return (hote?.textContent ?? '').replace(/[\u00a0\u202f]/g, ' ')
}

describe('MetricCard', () => {
  it('affiche libellé, valeur et détail', async () => {
    await monter(
      <MetricCard
        libelle="Chiffre d’affaires"
        valeur="482 500 FCFA"
        detail="Espèces encaissées aujourd’hui"
        icone={<span aria-hidden>•</span>}
      />,
    )

    expect(texte()).toContain('Chiffre d’affaires')
    expect(texte()).toContain('482 500 FCFA')
    expect(texte()).toContain('Espèces encaissées aujourd’hui')
  })

  it('affiche une hausse en vert et une baisse en rouge', async () => {
    await monter(
      <MetricCard libelle="Hausse" valeur="10" variation={12} icone={<span aria-hidden>•</span>} />,
    )
    expect(texte()).toContain('+12 %')

    await monter(
      <MetricCard libelle="Baisse" valeur="8" variation={-14} icone={<span aria-hidden>•</span>} />,
    )
    expect(texte()).toContain('-14 %')
  })

  it('n’affiche aucune variation quand la comparaison est impossible', async () => {
    await monter(
      <MetricCard libelle="Sans base" valeur="0" variation={null} icone={<span aria-hidden>•</span>} />,
    )

    expect(texte()).not.toContain('%')
  })

  it('marque les chiffres de démonstration', async () => {
    await monter(
      <MetricCard libelle="CA" valeur="482 500 FCFA" variation={12} demo icone={<span aria-hidden>•</span>} />,
    )

    expect(texte()).toContain('démo')
  })

  it('trace une courbe de tendance seulement quand la série est exploitable', async () => {
    await monter(
      <MetricCard
        libelle="CA"
        valeur="1"
        serie={[10, 20, 15, 30]}
        icone={<span aria-hidden>•</span>}
      />,
    )
    expect(hote?.querySelector('svg polyline')).not.toBeNull()

    await monter(<MetricCard libelle="CA" valeur="1" serie={[10]} icone={<span aria-hidden>•</span>} />)
    expect(hote?.querySelector('svg polyline')).toBeNull()
  })
})

describe('variationPourcent', () => {
  it('calcule une hausse et une baisse arrondies', () => {
    expect(variationPourcent(120, 100)).toBe(20)
    expect(variationPourcent(86, 100)).toBe(-14)
  })

  it('renvoie null quand la veille est nulle ou négative', () => {
    expect(variationPourcent(500, 0)).toBeNull()
    expect(variationPourcent(0, 0)).toBeNull()
    expect(variationPourcent(10, -5)).toBeNull()
  })
})

describe('RevenueChart', () => {
  const points = [
    { label: '20 oct.', montant: 250_000 },
    { label: '21 oct.', montant: 350_000 },
    { label: '26 oct.', montant: 610_000 },
  ]

  it('résume la courbe pour les lecteurs d’écran', async () => {
    await monter(<RevenueChart points={points} variation={18} />)

    expect(hote?.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain(
      'du 20 oct. au 26 oct.',
    )
    // Les valeurs sont aussi disponibles hors du SVG.
    // `textContent` brut contient des espaces fines insécables : on les
    // ramène à un espace normal avant de comparer un montant formaté.
    const liste = (hote?.querySelector('figcaption')?.textContent ?? '').replace(
      /[\u00a0\u202f]/g,
      ' ',
    )
    expect(liste).toContain('21 oct.')
    expect(liste).toContain('350 000 FCFA')
  })

  it('affiche la variation et la marque de démonstration', async () => {
    await monter(<RevenueChart points={points} variation={18} demo />)
    expect(texte()).toContain('+18 %')
    expect(texte()).toContain('démo')
  })
})

describe('RecentOrdersTable', () => {
  const lignes: LigneCommandeRecente[] = [
    {
      id: 'a',
      reference: 'CMD-000125',
      client: 'Awa Koné',
      articles: '3 pièces',
      montant: 7500,
      statut: 'received',
      date: '2026-10-26',
      to: '/commandes/a',
    },
    {
      id: 'b',
      reference: '#000124',
      client: 'Koffi Bah',
      articles: '1 costume',
      montant: 12_000,
      statut: 'ready',
      date: '2026-10-26',
    },
  ]

  it('affiche toutes les colonnes attendues', async () => {
    await monter(<RecentOrdersTable lignes={lignes} />)

    expect(texte()).toContain('N° commande')
    expect(texte()).toContain('Client')
    expect(texte()).toContain('Articles')
    expect(texte()).toContain('Montant')
    expect(texte()).toContain('Statut')
    expect(texte()).toContain('Date')

    expect(texte()).toContain('7 500 FCFA')
    expect(texte()).toContain('3 pièces')
    // Le statut est rendu avec son libellé français, pas sa valeur technique.
    expect(texte()).toContain('Reçue')
    expect(texte()).toContain('Prête')
  })

  it('ne propose des actions que sur une commande réelle', async () => {
    await monter(<RecentOrdersTable lignes={lignes} />)

    expect(hote?.querySelector('[aria-label="Actions pour CMD-000125"]')).not.toBeNull()
    // La seconde ligne vient de la démonstration : rien à ouvrir.
    expect(hote?.querySelector('[aria-label="Actions pour #000124"]')).toBeNull()
    expect(texte()).toContain('—')
  })

  it('explique une liste vide au lieu d’afficher un tableau nu', async () => {
    await monter(<RecentOrdersTable lignes={[]} />)

    expect(texte()).toContain('Aucune commande enregistrée.')
    expect(hote?.querySelector('table')).toBeNull()
  })

  it('propose toujours « Voir tout » vers la liste complète', async () => {
    await monter(<RecentOrdersTable lignes={lignes} />)

    const lien = [...(hote?.querySelectorAll('a') ?? [])].find((element) =>
      element.textContent?.includes('Voir tout'),
    )
    expect(lien?.getAttribute('href')).toBe('/commandes')
  })
})
