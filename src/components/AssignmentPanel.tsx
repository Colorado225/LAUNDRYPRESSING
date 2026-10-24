import { useEffect, useState } from 'react'
import { Loader2, UserCheck, UserRound } from 'lucide-react'
import toast from 'react-hot-toast'
import { useUpdateOrderAssignment } from '@/db/hooks'
import type { LocalOrder } from '@/db/localDb'
import { can } from '@/lib/permissions'
import { useTenantStore } from '@/lib/tenantContext'
import { fetchTeamMembers, memberLabel, type TeamMember } from '@/services/tenantMembers'

/**
 * Attribution d'une commande à un employé (palier 2).
 *
 * Le propriétaire et le réceptionniste désignent librement ; l'atelier peut
 * seulement prendre une commande pour lui-même. La base vérifie de toute façon
 * que l'employé appartient au pressing (`guard_order_assignment`).
 */
export default function AssignmentPanel({ order }: { order: LocalOrder }) {
  const role = useTenantStore((state) => state.role)
  const userId = useTenantStore((state) => state.userId)
  const affecter = useUpdateOrderAssignment()

  const [membres, setMembres] = useState<TeamMember[]>([])
  const [chargement, setChargement] = useState(true)
  const [envoi, setEnvoi] = useState(false)

  const peutChoisir = can(role, 'orders.editDetails')
  const peutPrendre = role === 'artisan' && userId !== null && order.assignedTo !== userId
  const attribuee = order.assignedTo !== null

  useEffect(() => {
    let actif = true

    void fetchTeamMembers(order.tenantId)
      .catch(() => [] as TeamMember[])
      .then((liste) => {
        if (!actif) return
        setMembres(liste)
        setChargement(false)
      })

    return () => {
      actif = false
    }
  }, [order.tenantId])

  const membreCourant = membres.find((membre) => membre.userId === order.assignedTo)

  const changer = async (valeur: string) => {
    setEnvoi(true)
    try {
      await affecter(order.id, valeur === '' ? null : valeur)
      toast.success(valeur === '' ? 'Commande remise dans le pot commun' : 'Commande attribuée')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Attribution impossible')
    } finally {
      setEnvoi(false)
    }
  }

  const prendre = async () => {
    if (!userId) return
    setEnvoi(true)
    try {
      await affecter(order.id, userId)
      toast.success('Commande prise en charge', { icon: '🧺' })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Prise en charge impossible')
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
        <UserCheck size={16} aria-hidden /> Prise en charge
      </h2>

      <p className="mt-2 flex items-center gap-2 text-sm text-slate-700">
        <UserRound size={15} className="text-slate-400" aria-hidden />
        {attribuee
          ? membreCourant
            ? memberLabel(membreCourant, userId)
            : 'Employé attribué'
          : 'Aucun employé attribué'}
        {order.assignedAt && (
          <span className="text-xs text-slate-400">
            · depuis le {new Date(order.assignedAt).toLocaleDateString('fr-FR')}
          </span>
        )}
      </p>

      {peutChoisir && (
        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-semibold text-slate-600">
            Attribuer à
          </span>
          <select
            value={order.assignedTo ?? ''}
            disabled={envoi || chargement}
            onChange={(event) => void changer(event.target.value)}
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal disabled:opacity-60"
          >
            <option value="">Personne (pot commun)</option>
            {membres.map((membre) => (
              <option key={membre.userId} value={membre.userId}>
                {memberLabel(membre, userId)}
              </option>
            ))}
          </select>
          {chargement && (
            <span className="mt-1 flex items-center gap-1 text-xs text-slate-400">
              <Loader2 className="animate-spin" size={12} aria-hidden /> Chargement de l’équipe…
            </span>
          )}
          {!chargement && membres.length === 0 && (
            <span className="mt-1 block text-xs text-slate-400">
              Équipe indisponible hors ligne : l’attribution reprendra au retour du réseau.
            </span>
          )}
        </label>
      )}

      {peutPrendre && (
        <button
          type="button"
          onClick={() => void prendre()}
          disabled={envoi}
          className="mt-3 inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white hover:bg-brand-teal-dark disabled:opacity-60"
        >
          {envoi ? <Loader2 className="animate-spin" size={16} aria-hidden /> : null}
          Je prends cette commande
        </button>
      )}
    </section>
  )
}
