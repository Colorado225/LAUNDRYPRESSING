import { useCallback, useEffect, useState } from 'react'
import { LifeBuoy, Loader2, Send, ShieldAlert } from 'lucide-react'
import toast from 'react-hot-toast'
import { useTenantStore } from '@/lib/tenantContext'
import { can } from '@/lib/permissions'
import { isSupabaseConfigured } from '@/lib/env'
import { formatDateTimeFr } from '@/lib/formatters'
import {
  SUPPORT_STATUS_LABELS,
  createSupportRequest,
  fetchMySupportRequests,
} from '@/services/platformService'
import type { SupportRequestRow } from '@/types/database'

/**
 * Support (palier 4).
 *
 * Le pressing ouvre une demande et suit la réponse de l'éditeur. Les demandes
 * sont cloisonnées par `tenant_id` (RLS) : aucun autre pressing ne les voit.
 * Fonctionne en ligne uniquement — une demande déposée hors ligne serait
 * perdue sans file d'attente dédiée, limite assumée et documentée.
 */
export default function Support() {
  const tenantId = useTenantStore((state) => state.tenantId)
  const role = useTenantStore((state) => state.role)
  const userId = useTenantStore((state) => state.userId)
  const tenantName = useTenantStore((state) => state.tenantName)

  const [demandes, setDemandes] = useState<SupportRequestRow[]>([])
  const [chargement, setChargement] = useState(true)
  const [erreur, setErreur] = useState<string | null>(null)
  const [sujet, setSujet] = useState('')
  const [message, setMessage] = useState('')
  const [envoi, setEnvoi] = useState(false)

  const charger = useCallback(async () => {
    if (!tenantId) {
      setChargement(false)
      return
    }

    try {
      setDemandes(await fetchMySupportRequests(tenantId))
      setErreur(null)
    } catch (error) {
      setErreur(error instanceof Error ? error.message : 'Chargement impossible.')
    } finally {
      setChargement(false)
    }
  }, [tenantId])

  useEffect(() => {
    void charger()
  }, [charger])

  const envoyer = async () => {
    if (!tenantId) return

    if (sujet.trim().length < 2) {
      toast.error('Précisez un sujet.')
      return
    }
    if (message.trim().length < 5) {
      toast.error('Décrivez le problème en quelques mots.')
      return
    }

    setEnvoi(true)
    try {
      await createSupportRequest({
        tenantId,
        authorId: userId,
        authorName: tenantName ? `Comptoir ${tenantName}` : null,
        subject: sujet,
        message,
      })
      toast.success('Demande envoyée au support', { icon: '🛟' })
      setSujet('')
      setMessage('')
      await charger()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Envoi impossible.')
    } finally {
      setEnvoi(false)
    }
  }

  if (!can(role, 'support.contact')) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <ShieldAlert className="mx-auto text-slate-400" size={28} aria-hidden />
        <p className="mt-2 font-semibold text-slate-800">Accès réservé</p>
        <p className="mt-1 text-sm text-slate-500">
          L’atelier ne contacte pas le support : passez par le comptoir ou le propriétaire.
        </p>
      </div>
    )
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <LifeBuoy className="mx-auto text-slate-400" size={28} aria-hidden />
        <p className="mt-2 font-semibold text-slate-800">Mode démonstration</p>
        <p className="mt-1 text-sm text-slate-500">
          Le support nécessite un projet Supabase configuré.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-brand-navy sm:text-2xl">
          <LifeBuoy size={22} aria-hidden /> Support
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Une panne, une question sur la facturation, un comportement étrange : écrivez-nous.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
          Nouvelle demande
        </h2>

        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-semibold text-slate-600">Sujet</span>
          <input
            value={sujet}
            onChange={(event) => setSujet(event.target.value)}
            maxLength={120}
            placeholder="Imprimante thermique muette"
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-semibold text-slate-600">Description</span>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="Depuis hier soir, le reçu ne sort plus après un encaissement espèces."
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-teal"
          />
        </label>

        <button
          type="button"
          onClick={() => void envoyer()}
          disabled={envoi}
          className="mt-3 inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white hover:bg-brand-teal-dark disabled:opacity-60"
        >
          {envoi ? (
            <Loader2 className="animate-spin" size={16} aria-hidden />
          ) : (
            <Send size={16} aria-hidden />
          )}
          Envoyer au support
        </button>
      </section>

      <section>
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
          Mes demandes
        </h2>

        {chargement ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="animate-spin" size={16} aria-hidden /> Chargement…
          </p>
        ) : erreur ? (
          <p className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            {erreur} Les demandes sont consultables en ligne uniquement.
          </p>
        ) : demandes.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">Aucune demande pour l’instant.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {demandes.map((demande) => (
              <li key={demande.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-semibold text-slate-800">{demande.subject}</p>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                      demande.status === 'closed'
                        ? 'bg-emerald-100 text-emerald-800'
                        : demande.status === 'in_progress'
                          ? 'bg-sky-100 text-sky-800'
                          : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {SUPPORT_STATUS_LABELS[demande.status]}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {formatDateTimeFr(demande.created_at)}
                </p>
                <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{demande.message}</p>
                {demande.response && (
                  <p className="mt-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                    <span className="font-semibold">Réponse du support : </span>
                    {demande.response}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
