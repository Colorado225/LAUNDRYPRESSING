/**
 * Palette sémantique et déterminée pour les catégories et prestations du catalogue.
 * Fournit un indicateur visuel (pastille de couleur / badge) immédiat pour le repérage
 * rapide (ex : Bleu pour Lavage, Vert pour Repassage, Violet pour Nettoyage à sec).
 */

export interface ColorDef {
  name: string
  dot: string
  bg: string
  text: string
  border: string
  ring: string
}

const SERVICE_PALETTES = {
  lavage: {
    name: 'Lavage',
    dot: 'bg-blue-500',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
    ring: 'ring-blue-500/20',
  },
  repassage: {
    name: 'Repassage',
    dot: 'bg-emerald-500',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    ring: 'ring-emerald-500/20',
  },
  nettoyage_sec: {
    name: 'Nettoyage à sec',
    dot: 'bg-purple-500',
    bg: 'bg-purple-50',
    text: 'text-purple-700',
    border: 'border-purple-200',
    ring: 'ring-purple-500/20',
  },
  soin_detachage: {
    name: 'Détachage & Soin',
    dot: 'bg-amber-500',
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-200',
    ring: 'ring-amber-500/20',
  },
  retouche: {
    name: 'Retouche & Couture',
    dot: 'bg-orange-500',
    bg: 'bg-orange-50',
    text: 'text-orange-800',
    border: 'border-orange-200',
    ring: 'ring-orange-500/20',
  },
  logistique: {
    name: 'Logistique & Express',
    dot: 'bg-teal-500',
    bg: 'bg-teal-50',
    text: 'text-teal-800',
    border: 'border-teal-200',
    ring: 'ring-teal-500/20',
  },
  option: {
    name: 'Option & Finition',
    dot: 'bg-indigo-500',
    bg: 'bg-indigo-50',
    text: 'text-indigo-800',
    border: 'border-indigo-200',
    ring: 'ring-indigo-500/20',
  },
  delicat: {
    name: 'Traitement Délicat',
    dot: 'bg-rose-500',
    bg: 'bg-rose-50',
    text: 'text-rose-800',
    border: 'border-rose-200',
    ring: 'ring-rose-500/20',
  },
} satisfies Record<string, ColorDef>

const CATEGORY_PALETTES: ColorDef[] = [
  {
    name: 'Indigo',
    dot: 'bg-indigo-500',
    bg: 'bg-indigo-50',
    text: 'text-indigo-700',
    border: 'border-indigo-200',
    ring: 'ring-indigo-500/20',
  },
  {
    name: 'Cyan',
    dot: 'bg-cyan-500',
    bg: 'bg-cyan-50',
    text: 'text-cyan-800',
    border: 'border-cyan-200',
    ring: 'ring-cyan-500/20',
  },
  {
    name: 'Emeraude',
    dot: 'bg-emerald-500',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    ring: 'ring-emerald-500/20',
  },
  {
    name: 'Ambre',
    dot: 'bg-amber-500',
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-200',
    ring: 'ring-amber-500/20',
  },
  {
    name: 'Rose',
    dot: 'bg-rose-500',
    bg: 'bg-rose-50',
    text: 'text-rose-700',
    border: 'border-rose-200',
    ring: 'ring-rose-500/20',
  },
  {
    name: 'Violet',
    dot: 'bg-purple-500',
    bg: 'bg-purple-50',
    text: 'text-purple-700',
    border: 'border-purple-200',
    ring: 'ring-purple-500/20',
  },
  {
    name: 'Teal',
    dot: 'bg-teal-500',
    bg: 'bg-teal-50',
    text: 'text-teal-800',
    border: 'border-teal-200',
    ring: 'ring-teal-500/20',
  },
  {
    name: 'Bleu',
    dot: 'bg-blue-500',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    border: 'border-blue-200',
    ring: 'ring-blue-500/20',
  },
]

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

/**
 * Retourne la pastille de couleur pour une prestation (ex: Bleu pour 'Lavage', Vert pour 'Repassage').
 */
export function getServiceColor(serviceName?: string | null, serviceType?: string | null): ColorDef {
  const nom = (serviceName ?? '').trim().toLowerCase()

  if (nom.includes('lav') || nom.includes('wash') || nom.includes('blanchiss') || nom.includes('eau')) {
    return SERVICE_PALETTES.lavage
  }
  if (nom.includes('repass') || nom.includes('iron') || nom.includes('pressage') || nom.includes('pliage')) {
    return SERVICE_PALETTES.repassage
  }
  if (nom.includes('sec') || nom.includes('dry') || nom.includes('chimique')) {
    return SERVICE_PALETTES.nettoyage_sec
  }
  if (nom.includes('tache') || nom.includes('détach') || nom.includes('soin')) {
    return SERVICE_PALETTES.soin_detachage
  }
  if (nom.includes('coutur') || nom.includes('retouch') || nom.includes('ourlet') || nom.includes('reparation')) {
    return SERVICE_PALETTES.retouche
  }
  if (nom.includes('livr') || nom.includes('collec') || nom.includes('express') || serviceType === 'logistics') {
    return SERVICE_PALETTES.logistique
  }
  if (nom.includes('amidon') || nom.includes('option') || nom.includes('parfum') || serviceType === 'option') {
    return SERVICE_PALETTES.option
  }
  if (nom.includes('soie') || nom.includes('cuir') || nom.includes('daim') || nom.includes('delicat')) {
    return SERVICE_PALETTES.delicat
  }

  // Type fallback
  if (serviceType === 'treatment') return SERVICE_PALETTES.lavage

  // Hachage déterministe si aucune règle textuelle
  const index = hashString(nom || 'autre') % CATEGORY_PALETTES.length
  return CATEGORY_PALETTES[index]
}

/**
 * Retourne la pastille de couleur pour une catégorie de linge / articles.
 */
export function getCategoryColor(categoryName?: string | null): ColorDef {
  const nom = (categoryName ?? '').trim().toLowerCase()
  if (!nom) {
    return {
      name: 'Général',
      dot: 'bg-slate-400',
      bg: 'bg-slate-50',
      text: 'text-slate-600',
      border: 'border-slate-200',
      ring: 'ring-slate-400/20',
    }
  }

  if (nom.includes('vetement') || nom.includes('vêtement') || nom.includes('habit') || nom.includes('chemise')) {
    return CATEGORY_PALETTES[0] // Indigo
  }
  if (nom.includes('lit') || nom.includes('couette') || nom.includes('drap') || nom.includes('oreiller')) {
    return CATEGORY_PALETTES[1] // Cyan
  }
  if (nom.includes('maison') || nom.includes('serviette') || nom.includes('linge')) {
    return CATEGORY_PALETTES[2] // Emeraude
  }
  if (nom.includes('rideau') || nom.includes('ameublement') || nom.includes('tapis') || nom.includes('coussin')) {
    return CATEGORY_PALETTES[3] // Ambre
  }
  if (nom.includes('ceremonie') || nom.includes('cérémonie') || nom.includes('fete') || nom.includes('tradition')) {
    return CATEGORY_PALETTES[4] // Rose
  }
  if (nom.includes('cuir') || nom.includes('daim') || nom.includes('chaussure')) {
    return CATEGORY_PALETTES[5] // Violet
  }

  const index = hashString(nom) % CATEGORY_PALETTES.length
  return CATEGORY_PALETTES[index]
}
