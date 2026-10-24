import { useState } from 'react'
import { MessageCircle, Phone, Send, ShieldAlert } from 'lucide-react'
import toast from 'react-hot-toast'
import { useOrderNotifications } from '@/db/hooks'
import { queueNotification } from '@/db/notificationRepository'
import type { LocalOrder } from '@/db/localDb'
import {
  CANAUX,
  MOTIFS,
  lienAppel,
  lienWhatsApp,
  messageNotification,
  motifPour,
  numeroInternational,
  type CanalNotification,
  type MotifNotification,
} from '@/lib/notifications'
import { formatDateTimeFr } from '@/lib/formatters'
import { can } from '@/lib/permissions'
import { useTenantStore } from '@/lib/tenantContext'
import { todayIso } from '@/constants/orders'

/**
 * Prévenir le client (WhatsApp ou appel).
 *
 * Aucun message ne part d'ici : le composant **ouvre** WhatsApp avec le texte
 * déjà écrit, et le comptoir envoie depuis son propre numéro. Le client voit
 * donc arriver un message d'un numéro qu'il connaît, ce qui compte plus qu'un
 * expéditeur inconnu — et cela ne coûte rien par message.
 *
 * La ligne n'est écrite qu'après l'ouverture du lien : le journal doit refléter
 * une sollicitation réelle, pas une intention.
 */
export default function NotifyPanel({ order }: { order: LocalOrder }) {
  const role = useTenantStore((state) => state.role)
  const pressing = useTenantStore((state) => state.tenantName)
  const notifications = useOrderNotifications(order.id)

  const motifPropose = motifPour(order, todayIso())
  const [motif, setMotif] = useState<MotifNotification>(motifPropose ?? 'pret')
  const [envoi, setEnvoi] = useState(false)

  const autorise = can(role, 'notifications.send')
  const numero = numeroInternational(order.customerPhone)

  const message = messageNotification(motif, {
    customerName: order.customerName,
    pressing: pressing ?? '',
    orderId: order.id,
    dueDate: order.dueDate,
    status: order.status,
  })

  const derniere = notifications[0]

  const envoyer = async (canal: CanalNotification) => {
    const lien =
      canal === 'whatsapp' ? lienWhatsApp(order.customerPhone, message) : lienAppel(order.customerPhone)

    if (!lien) {
      toast.error('Numéro de téléphone inexploitable pour ce client.')
      return
    }

    setEnvoi(true)
    try {
      // `noopener` : la page ouverte ne doit pas pouvoir manipuler l'onglet du
      // pressing (ni son stockage local).
      window.open(lien, '_blank', 'noopener,noreferrer')

      await queueNotification(order.tenantId, {
        orderId: order.id,
        channel: canal,
        reason: motif,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        message,
      })

      toast.success(
        canal === 'whatsapp' ? 'WhatsApp ouvert — message prêt à envoyer' : 'Appel lancé',
        { icon: canal === 'whatsapp' ? '💬' : '📞' },
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Enregistrement impossible')
    } finally {
      setEnvoi(false)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
        <MessageCircle size={16} aria-hidden /> Prévenir le client
      </h2>

      {derniere ? (
        <p className="mt-2 text-sm text-slate-700">
          Dernier contact : {CANAUX[derniere.channel].toLowerCase()} le{' '}
          {formatDateTimeFr(derniere.createdAt)} — {MOTIFS[derniere.reason].label.toLowerCase()}.
        </p>
      ) : (
        <p className="mt-2 text-sm text-slate-500">Ce client n’a encore jamais été prévenu.</p>
      )}

      {!autorise ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
          <ShieldAlert size={15} aria-hidden /> Seul le comptoir prévient les clients.
        </p>
      ) : !numero ? (
        <p className="mt-3 text-sm text-amber-800">
          Numéro incomplet : corrigez le téléphone du client pour pouvoir le prévenir.
        </p>
      ) : (
        <>
          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Motif du message</span>
            <select
              value={motif}
              onChange={(event) => setMotif(event.target.value as MotifNotification)}
              disabled={envoi}
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal disabled:opacity-60"
            >
              {(Object.keys(MOTIFS) as MotifNotification[]).map((valeur) => (
                <option key={valeur} value={valeur}>
                  {MOTIFS[valeur].label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-xs text-slate-500">{MOTIFS[motif].description}</span>
          </label>

          {/* Le texte est visible AVANT l'envoi : le comptoir doit pouvoir
              relire ce qui partira au nom du pressing. */}
          <p className="mt-3 whitespace-pre-line rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
            {message}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void envoyer('whatsapp')}
              disabled={envoi}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white hover:bg-brand-teal-dark disabled:opacity-60"
            >
              <Send size={16} aria-hidden /> Envoyer sur WhatsApp
            </button>

            <button
              type="button"
              onClick={() => void envoyer('appel')}
              disabled={envoi}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <Phone size={16} aria-hidden /> Appeler
            </button>
          </div>

          <p className="mt-2 text-xs text-slate-400">
            WhatsApp s’ouvre avec le message pré-rempli : appuyez sur envoyer dans l’application.
            Aucun message n’est expédié automatiquement.
          </p>
        </>
      )}
    </section>
  )
}
