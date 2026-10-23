import { useState } from 'react'
import { AlertTriangle, Check, Loader2, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import { useOrderIssues } from '@/db/hooks'
import { queueOrderIssue, type NewIssueInput } from '@/db/issueRepository'
import type { LocalOrder, LocalOrderItem } from '@/db/localDb'
import { useTenantStore } from '@/lib/tenantContext'
import { formatDateTimeFr } from '@/lib/formatters'

/**
 * Réclamations et vêtements abîmés (palier 2).
 *
 * Le constat se fait **devant le client**, à la réception : c'est la seule
 * preuve qu'une tache ou une déchirure préexistait. L'atelier peut aussi
 * signaler un dommage apparu pendant le traitement ; seul le comptoir clôture.
 */
const KINDS: Array<{ value: NewIssueInput['kind']; label: string }> = [
  { value: 'stained', label: 'Tache' },
  { value: 'torn', label: 'Déchirure' },
  { value: 'discoloured', label: 'Décoloration' },
  { value: 'missing', label: 'Pièce manquante' },
  { value: 'other', label: 'Autre' },
]

const STAGES: Array<{ value: NewIssueInput['stage']; label: string }> = [
  { value: 'reception', label: 'À la réception' },
  { value: 'treatment', label: 'Pendant le traitement' },
  { value: 'delivery', label: 'À la remise' },
]

const RESOLUTIONS: Record<string, string> = {
  repaired: 'Réparé',
  compensated: 'Dédommagé',
  rejected: 'Sans suite',
}

export default function IssuePanel({
  order,
  items,
}: {
  order: LocalOrder
  items: LocalOrderItem[]
}) {
  const role = useTenantStore((state) => state.role)
  const issues = useOrderIssues(order.id)

  const [ouvert, setOuvert] = useState(false)
  const [kind, setKind] = useState<NewIssueInput['kind']>('stained')
  const [stage, setStage] = useState<NewIssueInput['stage']>('reception')
  const [severity, setSeverity] = useState<NewIssueInput['severity']>('minor')
  const [itemId, setItemId] = useState('')
  const [description, setDescription] = useState('')
  const [envoi, setEnvoi] = useState(false)

  const peutDeclarer = role !== null && order.status !== 'cancelled'

  const enregistrer = async () => {
    if (description.trim().length < 5) {
      toast.error('Décrivez le dommage en quelques mots.')
      return
    }

    setEnvoi(true)
    try {
      await queueOrderIssue(order.tenantId, order.id, {
        orderItemId: itemId || null,
        kind,
        severity,
        stage,
        description,
      })
      toast.success('Réclamation enregistrée', { icon: '⚠️' })
      setDescription('')
      setItemId('')
      setOuvert(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Enregistrement impossible')
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
          <AlertTriangle size={16} aria-hidden /> Réclamations
          {issues.length > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
              {issues.length}
            </span>
          )}
        </h2>

        {peutDeclarer && !ouvert && (
          <button
            type="button"
            onClick={() => setOuvert(true)}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:border-brand-teal"
          >
            <Plus size={15} aria-hidden />
            Signaler
          </button>
        )}
      </div>

      {issues.length === 0 && !ouvert && (
        <p className="mt-2 text-sm text-slate-500">
          Aucun dommage constaté sur cette commande.
        </p>
      )}

      {issues.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100">
          {issues.map((issue) => (
            <li key={issue.id} className="py-2.5">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
                {KINDS.find((k) => k.value === issue.kind)?.label ?? 'Dommage'}
                {issue.severity === 'major' && (
                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-800">
                    Important
                  </span>
                )}
                {issue.resolution && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                    <Check size={11} aria-hidden />
                    {RESOLUTIONS[issue.resolution] ?? issue.resolution}
                  </span>
                )}
              </p>
              <p className="text-sm text-slate-600">{issue.description}</p>
              <p className="mt-0.5 text-xs text-slate-400">
                {STAGES.find((s) => s.value === issue.stage)?.label} ·{' '}
                {formatDateTimeFr(issue.createdAt)}
                {issue.synced === 0 ? ' · en attente d’envoi' : ''}
              </p>
              {issue.lastError && (
                <p className="mt-1 text-xs font-semibold text-rose-700">{issue.lastError}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {ouvert && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Dommage</span>
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as NewIssueInput['kind'])}
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-amber-500"
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Constaté</span>
              <select
                value={stage}
                onChange={(event) => setStage(event.target.value as NewIssueInput['stage'])}
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-amber-500"
              >
                {STAGES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Vêtement</span>
              <select
                value={itemId}
                onChange={(event) => setItemId(event.target.value)}
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-amber-500"
              >
                <option value="">Toute la commande</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">Gravité</span>
              <select
                value={severity}
                onChange={(event) => setSeverity(event.target.value as NewIssueInput['severity'])}
                className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-amber-500"
              >
                <option value="minor">Mineur</option>
                <option value="major">Important</option>
              </select>
            </label>
          </div>

          <label className="mt-2 block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">
              Description (constatée avec le client)
            </span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Ex. : tache de graisse sur la manche droite, vue avec le client"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500"
            />
          </label>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void enregistrer()}
              disabled={envoi}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-amber-600 px-4 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-60"
            >
              {envoi ? <Loader2 className="animate-spin" size={16} aria-hidden /> : null}
              Enregistrer la réclamation
            </button>

            <button
              type="button"
              onClick={() => setOuvert(false)}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
