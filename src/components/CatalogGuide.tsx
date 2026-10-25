/**
 * Guide contextuel de création du catalogue (onboarding).
 *
 * Affiche une étape à la fois avec :
 *   • la définition de l'étape en cours
 *   • un exemple concret adapté à un pressing ivoirien
 *   • un conseil d'utilisation
 *
 * Le guide disparaît définitivement après la création de la première
 * entrée de catalogue (mémorisé dans localStorage).
 */
import { useState } from 'react'
import { ArrowRight, CheckCircle2, ChevronRight, FolderTree, BookOpen, Scissors } from 'lucide-react'
import { Button } from '@/components/ui'

type Etape = 'categorie' | 'article' | 'prestation'

const ETAPES: Record<
  Etape,
  {
    titre: string
    definition: string
    exemple: string
    conseil: string
    icone: React.ElementType
  }
> = {
  categorie: {
    titre: "Étape 1 — Créer une catégorie",
    definition:
      "Une catégorie regroupe plusieurs articles de même nature (ex. : « Linge de maison », « Tenues de travail »). Elle sert à organiser le catalogue.",
    exemple: '« Linge de maison », « Tenues de travail », « Vêtements délicats »',
    conseil:
      "Commencez par 2 ou 3 catégories larges. Vous pourrez toujours en ajouter ou en renommer plus tard.",
    icone: FolderTree,
  },
  article: {
    titre: "Étape 2 — Créer un article",
    definition:
      "Un article est un type de vêtement ou d'objet (ex. : « Chemise », « Costume », « Rideau »). Il appartient à une catégorie et possède une unité de défaut.",
    exemple: '« Chemise », « Pantalon », « Robe », « Couverture »',
    conseil:
      "Choisissez l'unité par défaut qui correspond à votre facturation (pièce, kilogramme, etc.).",
    icone: BookOpen,
  },
  prestation: {
    titre: "Étape 3 — Créer une prestation",
    definition:
      "Une prestation est le traitement appliqué à l'article (ex. : « Lavage », « Nettoyage à sec », « Repassage »). C'est elle qui porte le tarif.",
    exemple: '« Lavage », « Repassage », « Détachage », « Nettoyage à sec »',
    conseil:
      'Saisissez d\'abord le tarif, puis confirmez-le en cliquant sur « Modifier » si nécessaire.',
    icone: Scissors,
  },
}

interface Props {
  /**
   * Appelé quand l'utilisateur crée sa première entrée de catalogue :
   * le guide se ferme définitivement.
   */
  onPremiereCreation: () => void
}

export function CatalogGuide({ onPremiereCreation }: Props) {
  const [etape, setEtape] = useState<Etape>('categorie')

  const estDerniereEtape = etape === 'prestation'

  const next = () => {
    if (estDerniereEtape) return
    setEtape((e) => (e === 'categorie' ? 'article' : 'prestation'))
  }

  const terminer = () => {
    try {
      localStorage.setItem('catalogue-guide-termine', '1')
    } catch {
      // localStorage indisponible : on ignore silencieusement
    }
    onPremiereCreation()
  }

  const courant = ETAPES[etape]

  return (
    <section
      className="fixed top-4 right-4 z-50 w-[380px] rounded-2xl border border-slate-200 bg-white shadow-xl p-0 sm:p-0"
      role="region"
      aria-label="Guide de création du catalogue"
    >
      {/* En-tête du guide */}
      <div className="rounded-2xl-t bg-brand-navy p-4 flex items-center gap-3 text-white">
        <courant.icone className="size-5 shrink-0" aria-hidden />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Guide de création
          </p>
          <p className="text-sm font-medium">{courant.titre}</p>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Définition */}
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            C'est quoi ?
          </p>
          <p className="mt-1 text-sm text-slate-800">{courant.definition}</p>
        </div>

        {/* Exemple */}
        <div className="rounded-xl border border-brand-teal/20 bg-brand-teal/5 p-3">
          <p className="text-xs font-semibold text-brand-teal uppercase tracking-wide">
            Exemple
          </p>
          <p className="mt-1 text-sm text-slate-700">{courant.exemple}</p>
        </div>

        {/* Conseil */}
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
            💡 Conseil
          </p>
          <p className="mt-1 text-sm text-amber-800">{courant.conseil}</p>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() =>
              setEtape((e) => (e === 'article' ? 'categorie' : 'prestation'))
            }
            disabled={etape === 'categorie'}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none"
          >
            <ChevronRight size={12} className={etape === 'categorie' ? 'rotate-180' : ''} aria-hidden />
            Précédent
          </button>

          <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            {etape === 'categorie' ? '1 / 3' : etape === 'article' ? '2 / 3' : '3 / 3'}
          </span>

          {estDerniereEtape ? (
            <Button type="button" onClick={terminer} className="min-h-10 px-3 py-1 text-xs" size="sm">
              <CheckCircle2 size={14} className="mr-1.5" aria-hidden />
              J'ai créé mon premier tarif
            </Button>
          ) : (
            <Button type="button" onClick={next} className="min-h-10 px-3 py-1 text-xs" size="sm">
              Étape suivante
              <ArrowRight size={12} className="ml-1.5" aria-hidden />
            </Button>
          )}
        </div>
      </div>

      {/* Bouton fermer (en haut à droite) */}
      <button
        type="button"
        onClick={terminer}
        className="absolute top-2 right-2 p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
        aria-label="Fermer le guide"
      >
        <span className="sr-only">Fermer le guide</span>
        <ChevronRight size={16} className="rotate-45" aria-hidden />
      </button>
    </section>
  )
}

export default CatalogGuide
