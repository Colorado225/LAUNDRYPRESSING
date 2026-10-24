import { useCallback, useEffect, useState } from 'react'
import { CloudOff, History, Loader2, Lock, ShieldCheck } from 'lucide-react'
import { can } from '@/lib/permissions'
import { useTenantStore } from '@/lib/tenantContext'
import { formatDateTimeFr } from '@/lib/formatters'
import { isSupabaseConfigured } from '@/lib/env'
import {
  FAMILLES_AUDIT,
  TAILLE_PAGE_AUDIT,
  decrireDetails,
  libelleAction,
  libelleAuteur,
  listAuditPage,
  type FamilleAudit,
} from '@/services/auditService'
import type { Curseur } from '@/lib/pagination'
import type { AuditLogRow } from '@/types/database'

/**
 * Journal d'audit (palier 5).
 *
 * Écran du propriétaire : il répond à la question « qui a changé ce tarif, ce
 * rôle, cette clôture ? ». La RLS n'accorde la lecture qu'au propriétaire, et
 * l'écran masque le reste — les deux garde-fous sont indépendants.
 *
 * Deux partis pris d'affichage :
 *  - la **date complète** (jour et heure) plutôt qu'un « il y a 5 minutes » :
 *    en cas de litige avec un client, on cite un instant précis ;
 *  - le **détail champ par champ**, jamais le JSON : un gérant n'a pas à lire
 *    `{"price":{"avant":1000,"apres":1500}}`.
 */
export default function Audit() {
  const tenantId = useTenantStore((state) => state.tenantId)
  const role = useTenantStore((state) => state.role)
  const autorise = can(role, 'audit.view')

  const [lignes, setLignes] = useState<AuditLogRow[]>([])
  const [chargement, setChargement] = useState(true)
  const [chargementSuite, setChargementSuite] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [curseur, setCurseur] = useState<Curseur | null>(null)
  const [aPlus, setAPlus] = useState(false)
  const [famille, setFamille] = useState<FamilleAudit | 'toutes'>('toutes')

  const charger = useCallback(async () => {
    if (!tenantId || !autorise || !isSupabaseConfigured) {
      setChargement(false)
      return
    }

    setChargement(true)
    setErreur(null)

    try {
      const page = await listAuditPage(tenantId, {
        famille: famille === 'toutes' ? null : famille,
        limite: TAILLE_PAGE_AUDIT,
      })
      setLignes(page.lignes)
      setCurseur(page.curseur)
      setAPlus(page.aPlus)
    } catch (error) {
      setErreur(error instanceof Error ? error.message : 'Chargement impossible.')
    } finally {
      setChargement(false)
    }
  }, [tenantId, autorise, famille])

  useEffect(() => {
    void charger()
  }, [charger])

  const chargerSuite = async () => {
    if (!tenantId || !curseur || chargementSuite) return
    setChargementSuite(true)
    setErreur(null)

    try {
      const page = await listAuditPage(tenantId, {
        curseur,
        famille: famille === 'toutes' ? null : famille,
        limite: TAILLE_PAGE_AUDIT,
      })
      setLignes((precedentes) => [...precedentes, ...page.lignes])
      setCurseur(page.curseur)
      setAPlus(page.aPlus)
    } catch (error) {
      setErreur(error instanceof Error ? error.message : 'Chargement impossible.')
    } finally {
      setChargementSuite(false)
    }
  }

  if (!autorise) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <Lock size={32} className="mx-auto text-slate-400" aria-hidden />
        <h1 className="mt-3 text-lg font-bold text-brand-navy">Journal réservé au propriétaire</h1>
        <p className="mt-2 text-sm text-slate-600">
          Le journal retrace les tarifs, les rôles et les mouvements de caisse du pressing.
          Demandez au propriétaire s’il vous en faut un extrait.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-brand-navy">
            <History size={24} aria-hidden /> Journal d’audit
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Qui a changé un tarif, un rôle, une clôture ou un abonnement — et quand.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Catégorie</span>
          <select
            value={famille}
            onChange={(evenement) => setFamille(evenement.target.value as FamilleAudit | 'toutes')}
            className="min-h-12 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-brand-teal"
          >
            <option value="toutes">Toutes</option>
            {FAMILLES_AUDIT.map((entree) => (
              <option key={entree.valeur} value={entree.valeur}>
                {entree.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <p className="mb-4 flex items-start gap-2 rounded-xl bg-slate-100 p-3 text-xs leading-relaxed text-slate-600">
        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-brand-teal" aria-hidden />
        Le journal s’écrit tout seul côté serveur : personne ne peut y ajouter, modifier ou effacer
        une ligne depuis l’application. Il conserve le nom et le rôle de l’auteur au moment de
        l’action.
      </p>

      {!isSupabaseConfigured && (
        <p className="mb-4 flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <CloudOff size={16} aria-hidden /> Mode démonstration : le journal n’existe qu’avec un
          projet Supabase configuré.
        </p>
      )}

      {erreur && (
        <p role="alert" className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-800">
          {erreur}
        </p>
      )}

      {chargement ? (
        <p className="flex items-center gap-2 rounded-2xl bg-white p-6 text-sm text-slate-500 ring-1 ring-slate-200">
          <Loader2 size={16} className="animate-spin" aria-hidden /> Chargement du journal…
        </p>
      ) : lignes.length === 0 ? (
        <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
          <History size={28} className="mx-auto text-slate-300" aria-hidden />
          <p className="mt-3 text-sm font-semibold text-brand-navy">Aucun événement</p>
          <p className="mt-1 text-sm text-slate-500">
            Les modifications de tarifs, de rôles, de caisse et d’abonnement apparaîtront ici
            automatiquement.
          </p>
        </div>
      ) : (
        <ol className="space-y-3">
          {lignes.map((ligne) => (
            <LigneJournal key={ligne.id} ligne={ligne} />
          ))}
        </ol>
      )}

      {aPlus && (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => void chargerSuite()}
            disabled={chargementSuite}
            className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-brand-navy ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-60"
          >
            {chargementSuite && <Loader2 size={15} className="animate-spin" aria-hidden />}
            Afficher les événements plus anciens
          </button>
        </div>
      )}
    </div>
  )
}

/** Une entrée du journal : qui, quoi, quand, et le détail des colonnes. */
function LigneJournal({ ligne }: { ligne: AuditLogRow }) {
  const auteur = libelleAuteur(ligne)
  const details = decrireDetails(ligne)
  const danger = ligne.action.endsWith('.delete') || ligne.action === 'payment_refunds.insert'

  return (
    <li className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            className={`text-sm font-bold ${danger ? 'text-rose-700' : 'text-brand-navy'}`}
          >
            {libelleAction(ligne.action)}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {auteur.nom}
            {auteur.role && <span className="text-slate-400"> · {auteur.role}</span>}
          </p>
        </div>
        <time dateTime={ligne.created_at} className="shrink-0 text-xs text-slate-400">
          {formatDateTimeFr(ligne.created_at)}
        </time>
      </div>

      {details.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {details.map((phrase) => (
            <li
              key={phrase}
              className="rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-700 ring-1 ring-slate-200/70"
            >
              {phrase}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
