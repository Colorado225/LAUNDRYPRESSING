/**
 * Impression de documents (étiquette 80 mm, facture A4).
 *
 * Pourquoi ne pas simplement ajouter un `@media print` de plus dans
 * `index.css` ? Parce que la taille du papier (`@page { size: … }`) ne peut pas
 * dépendre d'une classe du `body` : une feuille imprimée n'a pas de DOM. On
 * injecte donc une feuille de style **au moment de l'impression**, qui prend le
 * pas sur la règle statique, puis on la retire. L'étiquette continue de sortir
 * en 80 mm, la facture en A4, sans que l'une casse l'autre.
 *
 * Aucune bibliothèque PDF : le navigateur propose « Enregistrer au format
 * PDF » dans sa boîte d'impression, ce qui donne un PDF texte (sélectionnable,
 * donc lisible par un lecteur d'écran) plutôt qu'une image. Une librairie comme
 * jsPDF aurait ajouté ~300 ko au bundle et produit un PDF moins accessible.
 */

export type FormatImpression = 'A4' | 'etiquette'

export interface OptionsImpression {
  format?: FormatImpression
  /** Classe posée sur `body` pendant l'impression (masque l'application). */
  classe?: string
}

export const CLASSE_IMPRESSION = 'impression-document'
export const STYLE_IMPRESSION_ID = 'style-impression-document'

/** Feuille de style d'impression, en fonction du format. */
export function feuilleDeStyleImpression(format: FormatImpression): string {
  if (format === 'A4') {
    return `@page { size: A4 portrait; margin: 12mm; }
body.${CLASSE_IMPRESSION} #root { display: none !important; }
body.${CLASSE_IMPRESSION} #print-root { display: block !important; }
body.${CLASSE_IMPRESSION} { background: #ffffff; }`
  }

  return `@page { size: 80mm auto; margin: 0; }
body.${CLASSE_IMPRESSION} #root { display: none !important; }
body.${CLASSE_IMPRESSION} #print-root { display: block !important; }
body.${CLASSE_IMPRESSION} { background: #ffffff; }`
}

/**
 * Imprime le contenu monté dans `#print-root`, au format demandé.
 *
 * `window.print()` est bloquant : au retour, le nettoyage a déjà eu lieu. Le
 * `setTimeout` de sécurité couvre les navigateurs qui ne déclenchent pas
 * `afterprint` (Safari ancien, aperçu intégré).
 */
export function imprimerDocument(options: OptionsImpression = {}): void {
  const format = options.format ?? 'A4'
  const classe = options.classe ?? CLASSE_IMPRESSION

  // Une impression précédente interrompue (Safari ancien ne déclenche pas
  // toujours `afterprint`) ne doit pas laisser deux jeux de règles.
  document.getElementById(STYLE_IMPRESSION_ID)?.remove()

  const style = document.createElement('style')
  style.id = STYLE_IMPRESSION_ID
  style.textContent = feuilleDeStyleImpression(format)
  document.head.appendChild(style)
  document.body.classList.add(classe)

  let nettoye = false
  const nettoyer = () => {
    if (nettoye) return
    nettoye = true
    document.body.classList.remove(classe)
    document.getElementById(STYLE_IMPRESSION_ID)?.remove()
    window.removeEventListener('afterprint', nettoyer)
  }

  window.addEventListener('afterprint', nettoyer)

  try {
    window.print()
  } finally {
    window.setTimeout(nettoyer, 2000)
  }
}
