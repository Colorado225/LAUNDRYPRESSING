import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Printer,
  RefreshCw,
  Trash2,
  MessageCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { formatGarmentComposition } from '@/constants/garmentTypes'
import PaymentButton from '@/components/PaymentButton'
import QrCodeDisplay from '@/components/QrCodeDisplay'
import OrderMeasurementEditor from '@/components/OrderMeasurementEditor'
import OrderItemsEditor from '@/components/OrderItemsEditor'
import OrderMeasurementHistory from '@/components/OrderMeasurementHistory'
import { useLocalOrder, useUpdateOrderDueDate, useUpdateOrderStatus } from '@/db/hooks'
import { useTenantStore } from '@/lib/tenantContext'
import {
  ORDER_FLOW,
  ORDER_STATUSES,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_BADGE_CLASS,
  PAYMENT_STATUS_LABELS,
  getNextStatus,
  getPreviousStatus,
  isOrderLate,
  todayIso,
} from '@/constants/orders'
import { formatDateFr, formatDateTimeFr, formatFcfa, formatPhoneCi } from '@/lib/formatters'
import { libelleUnite } from '@/lib/catalogPricing'
import { can, canSeeAmounts } from '@/lib/permissions'
import ConflictBanner from '@/components/ConflictBanner'
import CashPanel from '@/components/CashPanel'
import AssignmentPanel from '@/components/AssignmentPanel'
import IssuePanel from '@/components/IssuePanel'
import NotifyPanel from '@/components/NotifyPanel'
import { useState } from 'react'
import { checkOrderDeletion, deleteOrderEverywhere } from '@/services/orderAdminService'
import { syncOrderNow } from '@/sync/syncEngine'
import {
  generateReceiptText,
  generateWhatsAppUrl,
  generatePrintableReceipt,
  printReceipt,
} from '@/services/receiptService'

/**
 * Fiche commande : détail, avancement du statut et état de synchronisation.
 * Les changements de statut sont appliqués localement (mode avion compris).
 */
export default function OrderDetail() {
  const navigate = useNavigate()
  const { orderId } = useParams<{ orderId: string }>()
  const [searchParams] = useSearchParams()
  // Retour de la création de commande avec « encaisser maintenant » : le
  // panneau s'ouvre déjà, le montant est pré-rempli.
  const reglerMaintenant = searchParams.get('regler') === '1'
  const data = useLocalOrder(orderId)
  const updateStatus = useUpdateOrderStatus()
  const updateDueDate = useUpdateOrderDueDate()
  const tenantName = useTenantStore((state) => state.tenantName)
  const role = useTenantStore((state) => state.role)
  const seeAmounts = canSeeAmounts(role)

  // Déclarés AVANT tout retour anticipé : l'ordre des hooks doit rester stable
  // entre le chargement et l'affichage de la fiche.
  const [annulationOuverte, setAnnulationOuverte] = useState(false)
  const [motifAnnulation, setMotifAnnulation] = useState('')
  const [suppressionEnCours, setSuppressionEnCours] = useState(false)
  const [synchronisationEnCours, setSynchronisationEnCours] = useState(false)
  const [echeanceOuverte, setEcheanceOuverte] = useState(false)
  const [echeanceSaisie, setEcheanceSaisie] = useState('')

  if (data === undefined) {
    return (
      <div className="flex items-center justify-center gap-3 py-20 text-slate-500">
        <Loader2 className="animate-spin" size={18} aria-hidden />
        Chargement de la commande…
      </div>
    )
  }

  if (data === null) {
    return (
      <div className="space-y-4">
        <BackButton />
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-16 text-center">
          <p className="font-semibold text-slate-700">Commande introuvable</p>
          <p className="mt-1 text-sm text-slate-500">
            Elle a peut-être été créée sur un autre appareil.
          </p>
        </div>
      </div>
    )
  }

  const { order, items } = data
  const mesureAConfirmer = items.some((item) => item.priceStatus === 'ESTIMATED')
  const statusMeta = ORDER_STATUSES[order.status]
  const nextStatus = getNextStatus(order.status)
  const previousStatus = getPreviousStatus(order.status)
  const enRetard = isOrderLate(order, todayIso())
  // La marche arrière est réservée au propriétaire par `guard_order_update` :
  // afficher le bouton aux autres rôles ne produirait qu'une erreur serveur.
  const peutReculer = can(role, 'orders.editDetails') && role === 'owner'
  const peutAnnuler = can(role, 'orders.updateStatus') && role !== 'artisan'
  const peutSupprimer = can(role, 'orders.delete')
  // Corriger les articles ou l'échéance engage le montant de la commande :
  // même droit que l'éditeur de mesure (`orders.editDetails`), et le serveur
  // refuse de toute façon ces changements à un artisan (`guard_order_update`).
  const peutCorriger = can(role, 'orders.editDetails') && !order.syncConflict
  const correctionBloquee =
    order.status === 'delivered' || order.status === 'cancelled' || order.paymentStatus === 'paid'

  const synchroniser = async () => {
    setSynchronisationEnCours(true)
    try {
      const resultat = await syncOrderNow(order.id)
      if (resultat.statut === 'synced') {
        toast.success('Commande synchronisée avec le serveur.', { icon: '✅' })
      } else if (resultat.statut === 'conflict') {
        toast.error(resultat.message)
      } else {
        toast.error(resultat.message)
      }
    } finally {
      setSynchronisationEnCours(false)
    }
  }

  const enregistrerEcheance = async (valeur: string | null) => {
    try {
      await updateDueDate(order.id, valeur)
      toast.success(valeur ? 'Échéance mise à jour' : 'Échéance retirée', { icon: '📅' })
      setEcheanceOuverte(false)
      setEcheanceSaisie('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Mise à jour impossible')
    }
  }

  const supprimerCommande = async () => {
    const controle = await checkOrderDeletion(order)
    if (!controle.autorisee) {
      toast.error(controle.raison ?? 'Suppression impossible.')
      return
    }

    const confirme = window.confirm(
      `Supprimer définitivement la commande de ${order.customerName} ? Les lignes et l’historique local seront effacés. Une commande avec encaissement doit être annulée, pas supprimée.`,
    )
    if (!confirme) return

    setSuppressionEnCours(true)
    try {
      await deleteOrderEverywhere(order)
      toast.success('Commande supprimée')
      navigate('/commandes')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Suppression impossible')
    } finally {
      setSuppressionEnCours(false)
    }
  }

  const changeStatus = async (status: typeof order.status, reason: string | null = null) => {
    try {
      await updateStatus(order.id, status, reason)
      toast.success(`Statut mis à jour : ${ORDER_STATUSES[status].label}`, { icon: '✅' })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Mise à jour impossible')
    }
  }

  return (
    <div className="space-y-4">
      <BackButton />

      {/* En-tête */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-brand-navy sm:text-2xl">{order.customerName}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {formatPhoneCi(order.customerPhone)} · créée le {formatDateTimeFr(order.createdAt)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-semibold ${statusMeta.badgeClass}`}
            >
              {statusMeta.label}
            </span>

            {enRetard && (
              <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-100 px-3 py-1.5 text-sm font-semibold text-rose-800">
                En retard
              </span>
            )}
          </div>
        </div>

        <p className="mt-3 text-sm text-slate-600">{statusMeta.description}</p>

        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-slate-50 p-3">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Total</dt>
            <dd className="text-lg font-bold text-brand-navy">
              {seeAmounts ? formatFcfa(order.totalAmount) : '—'}
            </dd>
          </div>

          <div className="rounded-xl bg-slate-50 p-3">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Livraison promise</dt>
            <dd className={`text-sm font-semibold ${enRetard ? 'text-rose-700' : 'text-slate-800'}`}>
              {order.dueDate ? formatDateFr(order.dueDate) : 'Non précisée'}
            </dd>

            {peutCorriger && !correctionBloquee && (
              <dd className="mt-2">
                {echeanceOuverte ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="date"
                      value={echeanceSaisie || order.dueDate || ''}
                      onChange={(event) => setEcheanceSaisie(event.target.value)}
                      aria-label="Nouvelle date de livraison"
                      className="min-h-10 rounded-xl border border-slate-300 px-2 text-sm outline-none focus:border-brand-teal"
                    />
                    <button
                      type="button"
                      onClick={() => void enregistrerEcheance(echeanceSaisie || null)}
                      className="inline-flex min-h-10 items-center rounded-xl bg-brand-teal px-3 text-sm font-semibold text-white hover:bg-brand-teal-dark"
                    >
                      Enregistrer
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEcheanceOuverte(false)
                        setEcheanceSaisie('')
                      }}
                      className="inline-flex min-h-10 items-center rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700"
                    >
                      Annuler
                    </button>
                    {order.dueDate && (
                      <button
                        type="button"
                        onClick={() => void enregistrerEcheance(null)}
                        className="inline-flex min-h-10 items-center rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Retirer
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEcheanceSaisie(order.dueDate ?? '')
                      setEcheanceOuverte(true)
                    }}
                    className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    <CalendarClock size={15} aria-hidden />
                    {order.dueDate ? 'Modifier l’échéance' : 'Programmer une échéance'}
                  </button>
                )}
              </dd>
            )}
          </div>

          <div className="rounded-xl bg-slate-50 p-3">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Paiement</dt>
            <dd className="mt-0.5">
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${PAYMENT_STATUS_BADGE_CLASS[order.paymentStatus]}`}
              >
                {PAYMENT_STATUS_LABELS[order.paymentStatus]}
              </span>
              {order.paymentMethod && (
                <span className="ml-2 text-xs text-slate-500">
                  via {PAYMENT_METHOD_LABELS[order.paymentMethod]}
                </span>
              )}
            </dd>
          </div>
        </dl>

        <p className="mt-3 flex items-center gap-2 text-xs text-slate-500">
          <span className="font-mono break-all">{order.qrCode}</span>
        </p>
      </section>

      {/* Conflit de synchronisation : arbitrage explicite obligatoire */}
      <ConflictBanner order={order} />

      {/* Synchronisation */}
      <section
        className={`rounded-2xl border p-4 ${order.synced === 1
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
          : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
      >
        <p className="flex items-center gap-2 text-sm font-semibold">
          {order.synced === 1 ? (
            <>
              <CheckCircle2 size={18} aria-hidden />
              Synchronisée avec le serveur
              {order.syncedAt ? ` le ${formatDateTimeFr(order.syncedAt)}` : ''}
            </>
          ) : (
            <>
              <RefreshCw size={18} aria-hidden />
              En attente de synchronisation
            </>
          )}
        </p>
        {order.syncError && <p className="mt-1 text-xs">{order.syncError}</p>}

        {/* Envoi immédiat : le comptoir ne dépend plus du minuteur de fond.
            Le bouton reste utile après un échec réseau ou un refus serveur. */}
        {order.synced !== 1 && !order.syncConflict && (
          <button
            type="button"
            onClick={() => void synchroniser()}
            disabled={synchronisationEnCours}
            className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            {synchronisationEnCours ? (
              <Loader2 className="animate-spin" size={15} aria-hidden />
            ) : (
              <RefreshCw size={15} aria-hidden />
            )}
            {synchronisationEnCours ? 'Envoi en cours…' : 'Synchroniser maintenant'}
          </button>
        )}
      </section>

      {/* Vêtements */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">
          Lignes de commande ({items.length})
        </h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="font-medium text-slate-800">{item.label}</p>
                {item.serviceName && item.serviceName !== item.label && <p className="text-xs text-slate-600">Prestation : {item.serviceName}</p>}
                {item.activityNameSnapshot && <p className="text-xs text-slate-600">Activité : {item.activityNameSnapshot}</p>}
                {formatGarmentComposition(item.garmentDetails) && <p className="text-xs text-slate-600">Vêtements : {formatGarmentComposition(item.garmentDetails)}</p>}
                <p className="text-xs text-slate-500">
                  {item.familyPackageSnapshot
                    ? `${item.familyPackageSnapshot.pieceCount} pièce(s) · ${item.laundryPriceBreakdownSnapshot ?? 'forfait famille'}`
                    : item.laundryModelId
                      ? `${item.laundryWeightKg} kg · ${item.laundryPriceBreakdownSnapshot ?? 'modèle commercial'}`
                      : item.billingUnit === 'FLAT'
                        ? `Forfait · ${formatFcfa(item.unitPrice)}`
                        : `${item.quantity} ${libelleUnite(item.billingUnit)} mesuré · ${item.billedQuantity} facturé · ${formatFcfa(item.unitPrice)}/${libelleUnite(item.billingUnit)}`}
                  {item.priceStatus === 'ESTIMATED' ? ' · ESTIMÉ — à confirmer' : ''}
                </p>
                <p className="text-xs text-slate-500">
                  {[item.fabricType, item.specialInstructions].filter(Boolean).join(' · ') || '—'}
                </p>
                {item.laundryServicesSnapshot && <p className="text-xs text-slate-500">Prestations : {item.laundryServicesSnapshot}</p>}
                {item.familyPackageSnapshot && <ul className="mt-1 text-xs text-slate-600" aria-label="Composition du forfait famille">
                  {item.familyPackageSnapshot.contents.map((content) => <li key={content.articleId}>{content.quantity} × {content.articleName} · {content.familyName}</li>)}
                </ul>}
                <OrderMeasurementEditor
                  orderId={order.id}
                  item={item}
                  editable={
                    can(role, 'orders.editDetails') &&
                    !order.syncConflict &&
                    order.status !== 'delivered' &&
                    order.status !== 'cancelled' &&
                    order.paymentStatus !== 'paid'
                  }
                />
              </div>
              <span className="font-semibold text-brand-navy">
                {seeAmounts ? formatFcfa(item.price) : '—'}
              </span>
            </li>
          ))}
        </ul>
        {mesureAConfirmer && (
          <p role="alert" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            Facturation bloquée : confirmez ou corrigez chaque mesure estimée ci-dessus avant
            d’encaisser ou d’émettre une facture.
          </p>
        )}
      </section>

      {/* Correction des articles (pièce rapportée, ligne erronée) */}
      {peutCorriger && !correctionBloquee && <OrderItemsEditor order={order} items={items} />}

      <OrderMeasurementHistory
        tenantId={order.tenantId}
        orderId={order.id}
        items={items}
        showAmounts={seeAmounts}
      />

      {/* Prise en charge : attribution à un employé */}
      <AssignmentPanel order={order} />

      {/* Réclamations et vêtements abîmés */}
      <IssuePanel order={order} items={items} />

      {/* Prévenir le client : WhatsApp ou appel, message pré-rempli */}
      <NotifyPanel order={order} />

      {/* Caisse : espèces, acompte, solde et reçu */}
      {seeAmounts && !mesureAConfirmer && <CashPanel order={order} autoOpen={reglerMaintenant} />}

      {/* Paiement Mobile Money — initiation réservée au comptoir */}
      {can(role, 'payments.initiate') && !mesureAConfirmer && <PaymentButton order={order} />}

      {/* Étiquette QR — impression 80 mm */}
      <QrCodeDisplay order={order} items={items} tenantName={tenantName} />

      {/* Panneau de partage du reçu */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Partager le reçu</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          <a
            href={generateWhatsAppUrl(
              order.customerPhone,
              generateReceiptText(order, items, tenantName ?? 'Pressing')
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl bg-green-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-green-600"
          >
            <MessageCircle size={18} />
            Envoyer par WhatsApp
          </a>
          <button
            onClick={() => {
              try {
                const receiptHtml = generatePrintableReceipt(order, items, tenantName ?? 'Pressing')
                printReceipt(receiptHtml)
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Impression impossible")
              }
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
          >
            <Printer size={18} />
            Imprimer le reçu
          </button>
        </div>
      </section>

      {/* Progression */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Avancement</h2>

        <ol className="mt-3 flex flex-wrap items-center gap-2">
          {ORDER_FLOW.map((status) => {
            const meta = ORDER_STATUSES[status]
            const isCurrent = status === order.status
            return (
              <li key={status}>
                <span
                  className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${isCurrent ? meta.badgeClass : 'border-slate-200 bg-white text-slate-500'
                    }`}
                >
                  {meta.label}
                </span>
              </li>
            )
          })}
        </ol>

        <div className="mt-4 flex flex-wrap gap-2">
          {previousStatus && peutReculer && (
            <button
              type="button"
              onClick={() => void changeStatus(previousStatus)}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:border-slate-400"
            >
              <ChevronLeft size={18} aria-hidden />
              Revenir à « {ORDER_STATUSES[previousStatus].shortLabel} »
            </button>
          )}

          {nextStatus && (
            <button
              type="button"
              onClick={() => void changeStatus(nextStatus)}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white hover:bg-brand-teal-dark"
            >
              Passer à « {ORDER_STATUSES[nextStatus].label} »
              <ChevronRight size={18} aria-hidden />
            </button>
          )}

          {peutAnnuler &&
            order.status !== 'cancelled' &&
            order.status !== 'delivered' &&
            !annulationOuverte && (
              <button
                type="button"
                onClick={() => setAnnulationOuverte(true)}
                className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-rose-200 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-50"
              >
                Annuler la commande
              </button>
            )}
        </div>

        {annulationOuverte && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-rose-900">
                Motif de l’annulation (recommandé, conservé dans l’historique)
              </span>
              <textarea
                value={motifAnnulation}
                onChange={(event) => setMotifAnnulation(event.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Ex. : client absent depuis trois semaines, vêtements rendus au dépôt"
                className="w-full rounded-xl border border-rose-300 bg-white px-3 py-2 text-sm outline-none focus:border-rose-500"
              />
            </label>

            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  void changeStatus('cancelled', motifAnnulation)
                  setAnnulationOuverte(false)
                  setMotifAnnulation('')
                }}
                className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-rose-700 px-4 text-sm font-bold text-white hover:bg-rose-800"
              >
                Confirmer l’annulation
              </button>

              <button
                type="button"
                onClick={() => {
                  setAnnulationOuverte(false)
                  setMotifAnnulation('')
                }}
                className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700"
              >
                Retour
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Suppression réservée au propriétaire (`orders.delete`). Une commande
          qui porte de l'argent s'annule, elle ne s'efface pas. */}
      {peutSupprimer && (
        <section className="rounded-2xl border border-rose-200 bg-rose-50/40 p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-rose-800">
            <Trash2 size={16} aria-hidden /> Supprimer la commande
          </h2>
          <p className="mt-1 text-sm text-rose-900">
            Suppression définitive, réservée au propriétaire. Si la commande a été payée ou
            remboursée, annulez-la : le journal de caisse doit rester complet.
          </p>
          <button
            type="button"
            onClick={() => void supprimerCommande()}
            disabled={suppressionEnCours}
            className="mt-3 inline-flex min-h-12 items-center gap-2 rounded-xl border border-rose-300 bg-white px-4 text-sm font-bold text-rose-800 hover:bg-rose-100 disabled:opacity-60"
          >
            {suppressionEnCours ? (
              <Loader2 className="animate-spin" size={16} aria-hidden />
            ) : (
              <Trash2 size={16} aria-hidden />
            )}
            Supprimer définitivement
          </button>
        </section>
      )}
    </div>
  )
}

function BackButton() {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={() => navigate('/commandes')}
      className="inline-flex min-h-12 items-center gap-2 text-sm font-semibold text-slate-600 hover:text-brand-navy active:text-brand-navy"
    >
      <ArrowLeft size={16} aria-hidden />
      Retour aux commandes
    </button>
  )
}