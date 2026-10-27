import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Mode démonstration — affichage de données fictives.
 *
 * Décision de la refonte (cf. `docs/AUDIT-REFONTE-INTERFACE.md` §5) : la
 * maquette présente des chiffres inventés (« 482 500 FCFA », « #000125 ») qui
 * ne doivent **jamais** pouvoir être pris pour l'activité réelle d'un pressing.
 *
 * D'où trois règles, tenues par ce module et par les écrans qui le lisent :
 *
 *  1. le mode est **désactivé par défaut** ;
 *  2. quand il est actif, un bandeau permanent dit que les chiffres sont
 *     fictifs — il ne peut pas être fermé ;
 *  3. les **actions** (enregistrer une commande, changer un statut, encaisser)
 *     restent interdites en mode démonstration : on montre, on ne fait pas
 *     semblant d'agir.
 *
 * La préférence est mémorisée dans le navigateur : un formateur qui présente
 * l'application retrouve son mode au rechargement, et le comptoir qui rouvre
 * l'onglet le lendemain le retrouve aussi — d'où le bandeau, qui ne laisse
 * jamais de doute.
 */
interface DemoState {
  actif: boolean
  setActif: (valeur: boolean) => void
}

export const useDemoStore = create<DemoState>()(
  persist(
    (set) => ({
      actif: false,
      setActif: (actif) => set({ actif }),
    }),
    { name: 'pressing-pro-mode-demo' },
  ),
)

/** Lecture hors composant (services, tests). */
export function modeDemoActif(): boolean {
  return useDemoStore.getState().actif
}
