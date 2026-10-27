import { Navigate } from 'react-router-dom'

/**
 * Ancien écran de grille de vêtements.
 *
 * Il n'était atteignable par aucun lien de l'application et sa sélection était
 * perdue en route : il transmettait une composition à `/commandes/nouvelle`,
 * qui ne la lisait jamais. Le parcours de commande intègre désormais la grille
 * (écran « Articles »), avec le même geste tactile et les mêmes icônes.
 *
 * L'adresse reste valide pour les favoris et les tablettes qui l'auraient
 * enregistrée : elle ouvre directement le parcours blanchisserie, au lieu de
 * laisser une page morte.
 */
export default function BlanchisserieGrid() {
  return <Navigate to="/commandes/nouvelle?service=blanchisserie" replace />
}
