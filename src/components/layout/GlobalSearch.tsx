import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, LayoutGrid, Search, X } from 'lucide-react'
import { useLocalOrders } from '@/db/hooks'
import { rechercherGlobalement, type ResultatRecherche } from '@/services/globalSearch'

/**
 * Recherche globale de l'en-tête.
 *
 * Elle travaille sur les commandes déjà présentes dans IndexedDB
 * (`useLocalOrders`) : elle répond donc instantanément, y compris en mode
 * avion. Les résultats sont un vrai menu de navigation (flèches haut/bas,
 * Entrée pour ouvrir, Échap pour fermer), pas une liste décorative.
 *
 * Ce que l'interface annonce est exactement ce qu'elle fait : « commande ou
 * client » cherche dans les commandes de l'appareil ; il n'existe pas de
 * répertoire clients serveur dans le schéma.
 */
export default function GlobalSearch({ onNavigate }: { onNavigate?: () => void }) {
  const orders = useLocalOrders()
  const navigate = useNavigate()
  const [terme, setTerme] = useState('')
  const [ouvert, setOuvert] = useState(false)
  const [actif, setActif] = useState(0)
  const champ = useRef<HTMLInputElement>(null)

  const resultats = useMemo(
    () => rechercherGlobalement(terme, orders ?? []),
    [terme, orders],
  )

  const afficher = ouvert && terme.trim().length >= 2

  const ouvrir = (resultat: ResultatRecherche | undefined) => {
    if (!resultat) return
    navigate(resultat.to)
    setTerme('')
    setOuvert(false)
    onNavigate?.()
    champ.current?.blur()
  }

  const surTouche = (evenement: React.KeyboardEvent<HTMLInputElement>) => {
    if (evenement.key === 'Escape') {
      setOuvert(false)
      return
    }
    if (evenement.key === 'Enter') {
      evenement.preventDefault()
      ouvrir(resultats[actif])
      return
    }
    if (!afficher || resultats.length === 0) return
    if (evenement.key === 'ArrowDown') {
      evenement.preventDefault()
      setActif((index) => (index + 1) % resultats.length)
    }
    if (evenement.key === 'ArrowUp') {
      evenement.preventDefault()
      setActif((index) => (index - 1 + resultats.length) % resultats.length)
    }
  }

  return (
    <div className="relative w-full">
      <div className="relative">
        <Search
          size={16}
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          ref={champ}
          type="search"
          value={terme}
          onChange={(evenement) => {
            setTerme(evenement.target.value)
            setOuvert(true)
            setActif(0)
          }}
          onFocus={() => setOuvert(true)}
          onBlur={() => window.setTimeout(() => setOuvert(false), 120)}
          onKeyDown={surTouche}
          placeholder="Rechercher une commande, un client…"
          aria-label="Rechercher une commande, un client"
          aria-expanded={afficher}
          aria-controls="resultats-recherche-globale"
          role="combobox"
          aria-autocomplete="list"
          className="min-h-11 w-full rounded-xl border border-input bg-slate-50 pl-9 pr-9 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-brand-teal focus:bg-white"
        />
        {terme !== '' && (
          <button
            type="button"
            onClick={() => {
              setTerme('')
              champ.current?.focus()
            }}
            aria-label="Effacer la recherche"
            className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={14} aria-hidden />
          </button>
        )}
      </div>

      {afficher && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
          {resultats.length === 0 ? (
            <p className="px-3 py-3 text-sm text-slate-500" role="status">
              Aucun résultat pour « {terme} ».
            </p>
          ) : (
            <ul id="resultats-recherche-globale" role="listbox" aria-label="Résultats de recherche">
              {resultats.map((resultat, index) => {
                const Icone = resultat.type === 'commande' ? FileText : LayoutGrid
                return (
                  <li key={`${resultat.type}-${resultat.id}`} role="option" aria-selected={index === actif}>
                    <button
                      type="button"
                      // `onMouseDown` devance le `blur` du champ : sans cela, la
                      // liste se ferme avant que le clic n'atteigne la ligne.
                      onMouseDown={(evenement) => {
                        evenement.preventDefault()
                        ouvrir(resultat)
                      }}
                      onMouseEnter={() => setActif(index)}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${
                        index === actif ? 'bg-accent text-accent-foreground' : 'text-slate-700'
                      }`}
                    >
                      <Icone size={15} aria-hidden className="shrink-0 text-slate-400" />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{resultat.titre}</span>
                        <span className="block truncate text-xs text-slate-500">{resultat.detail}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
