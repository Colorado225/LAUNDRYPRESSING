import { createPortal } from 'react-dom'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download, Loader2, Printer } from 'lucide-react'
import { useCashPayments, useLocalOrder } from '@/db/hooks'
import { useTenantStore } from '@/lib/tenantContext'
import { formatDateFr, formatDateTimeFr, formatFcfa, formatPhoneCi } from '@/lib/formatters'
import { construireFacture } from '@/lib/facturation'
import { libelleUnite } from '@/lib/catalogPricing'
import { imprimerDocument } from '@/lib/impression'

/**
 * Facture A4 d'une commande.
 *
 * Différence avec le reçu 80 mm (`/commandes/:id/recu`) : le reçu est le ticket
 * de dépôt remis au client au comptoir ; la facture est le document que le
 * pressing archive, transmet à une entreprise cliente ou joint à une demande de
 * remboursement. Elle tient sur une page A4, avec l'en-tête du pressing, le
 * détail groupé des prestations, les acomptes datés et le total en toutes
 * lettres.
 *
 * Rien n'est envoyé au serveur : le document est construit depuis Dexie, donc
 * disponible hors ligne. Le « PDF » s'obtient via la boîte d'impression du
 * navigateur (« Enregistrer au format PDF ») : un PDF **texte**, sélectionnable
 * et lisible par un lecteur d'écran, sans ajouter 300 ko de bibliothèque.
 */

export default function Facture() {
  const { orderId } = useParams<{ orderId: string }>()
  const data = useLocalOrder(orderId)
  const paiements = useCashPayments(orderId)
  const tenantName = useTenantStore((state) => state.tenantName)

  if (data === undefined) {
    return (
      <div className="flex items-center justify-center gap-3 py-20 text-slate-500">
        <Loader2 className="animate-spin" size={18} aria-hidden /> Préparation de la facture…
      </div>
    )
  }

  if (data === null) {
    return (
      <div className="space-y-4">
        <Link
          to="/commandes"
          className="inline-flex min-h-12 items-center gap-2 text-sm font-semibold text-slate-600"
        >
          <ArrowLeft size={16} aria-hidden /> Retour aux commandes
        </Link>
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-16 text-center">
          <p className="font-semibold text-slate-700">Commande introuvable</p>
          <p className="mt-1 text-sm text-slate-500">
            Elle a peut-être été effacée de la tablette après synchronisation
            (Paramètres → Effacer les commandes synchronisées).
          </p>
        </div>
      </div>
    )
  }

  const { order, items } = data
  const mesureAConfirmer = items.some((item) => item.priceStatus === 'ESTIMATED')

  if (mesureAConfirmer) {
    return (
      <div className="space-y-4">
        <Link
          to={`/commandes/${order.id}`}
          className="inline-flex min-h-12 items-center gap-2 text-sm font-semibold text-slate-600"
        >
          <ArrowLeft size={16} aria-hidden /> Retour à la commande
        </Link>
        <section role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
          <h1 className="text-lg font-bold">Facture en attente de confirmation</h1>
          <p className="mt-2 text-sm">
            Au moins une mesure est encore estimée. Confirmez ou corrigez toutes les lignes dans le
            détail de la commande avant d’émettre la facture.
          </p>
        </section>
      </div>
    )
  }

  const facture = construireFacture(order, items, paiements)

  const imprimer = () => imprimerDocument({ format: 'A4' })

  const contenu = (
    <article className="mx-auto w-[210mm] min-h-[274mm] bg-white p-[12mm] text-[11px] leading-relaxed text-slate-900">
      {/* En-tête : pressing à gauche, identification du document à droite. */}
      <header className="flex items-start justify-between gap-6 border-b-2 border-brand-navy pb-4">
        <div>
          <p className="text-[16px] font-bold uppercase tracking-wide text-brand-navy">
            {tenantName ?? 'Pressing'}
          </p>
          <p className="mt-1 text-[10px] text-slate-600">Pressing — prestations de lavage</p>
          {order.tenantId && (
            <p className="mt-1 font-mono text-[9px] text-slate-500">ID {order.tenantId}</p>
          )}
        </div>

        <div className="text-right">
          <p className="text-[15px] font-bold uppercase">Facture</p>
          <p className="mt-1 font-mono text-[12px] font-semibold">{facture.numero}</p>
          <p className="mt-1 text-[10px] text-slate-600">
            Émise le {formatDateTimeFr(facture.emisLe)}
          </p>
          <p className="text-[10px] text-slate-600">Commande {facture.referenceCommande}</p>
        </div>
      </header>

      {/* Client et livraison. */}
      <section className="mt-5 grid grid-cols-2 gap-6">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">Client</p>
          <p className="mt-1 font-semibold">{facture.client.nom}</p>
          <p className="text-slate-600">{formatPhoneCi(facture.client.telephone)}</p>
        </div>
        <div>
          <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">
            Suivi de la commande
          </p>
          <p className="mt-1">
            Statut : <span className="font-semibold">{facture.statut}</span>
          </p>
          {facture.livraisonPromise && (
            <p className="text-slate-600">
              Livraison promise : {formatDateFr(facture.livraisonPromise)}
            </p>
          )}
        </div>
      </section>

      {/* Détail des prestations. */}
      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr className="border-b border-slate-300 text-left text-[9px] uppercase tracking-wide text-slate-500">
            <th scope="col" className="py-2 font-semibold">Désignation</th>
            <th scope="col" className="w-24 py-2 text-center font-semibold">Qté facturée</th>
            <th scope="col" className="w-28 py-2 text-right font-semibold">Prix unitaire</th>
            <th scope="col" className="w-28 py-2 text-right font-semibold">Montant</th>
          </tr>
        </thead>
        <tbody>
          {facture.lignes.map((ligne, index) => (
            <tr key={`${ligne.libelle}-${ligne.poidsKg ?? ''}-${ligne.prixUnitaire}-${index}`} className="border-b border-slate-100">
              <td className="py-2 pr-2">
                {ligne.libelle}
                {ligne.activiteSnapshot && (
                  <span className="block text-[8px] text-slate-500">Activité : {ligne.activiteSnapshot}</span>
                )}
                {ligne.compositionVetements && (
                  <span className="block text-[8px] text-slate-500">Vêtements : {ligne.compositionVetements}</span>
                )}
                {ligne.prixStatut === 'ESTIMATED' && (
                  <span className="block text-[8px] font-semibold uppercase text-amber-700">
                    Quantité estimée — à confirmer
                  </span>
                )}
                {ligne.quantiteMesuree !== ligne.quantite && (
                  <span className="block text-[8px] text-slate-500">
                    Mesuré : {ligne.quantiteMesuree} {libelleUnite(ligne.unite)}
                  </span>
                )}
                {ligne.poidsKg !== undefined && (
                  <span className="block text-[8px] text-slate-500">
                    Poids : {ligne.poidsKg} kg{ligne.detailCommercial ? ` · ${ligne.detailCommercial}` : ''}
                  </span>
                )}
                {ligne.prestationsCommerciales && (
                  <span className="block text-[8px] text-slate-500">Prestations : {ligne.prestationsCommerciales}</span>
                )}
              </td>
              <td className="py-2 text-center">
                {ligne.unite === 'FLAT' || ligne.unite === 'PACKAGE'
                  ? 'Forfait'
                  : `${ligne.quantite} ${libelleUnite(ligne.unite)}`}
              </td>
              <td className="py-2 text-right whitespace-nowrap">{formatFcfa(ligne.prixUnitaire)}</td>
              <td className="py-2 text-right font-medium whitespace-nowrap">
                {formatFcfa(ligne.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totaux et acomptes. */}
      <section className="mt-5 flex justify-end">
        <table className="w-[80mm] border-collapse">
          <tbody>
            <tr>
              <th scope="row" className="py-1 text-left font-normal text-slate-600">
                Total des prestations
              </th>
              <td className="py-1 text-right font-semibold">{formatFcfa(facture.total)}</td>
            </tr>
            <tr>
              <th scope="row" className="py-1 text-left font-normal text-slate-600">
                Acomptes versés
              </th>
              <td className="py-1 text-right font-semibold">{formatFcfa(facture.verse)}</td>
            </tr>
            <tr className="border-t-2 border-brand-navy">
              <th scope="row" className="py-2 text-left font-bold">
                {facture.reste > 0 ? 'Reste à payer' : 'Solde'}
              </th>
              <td className="py-2 text-right text-[13px] font-bold">
                {formatFcfa(facture.reste)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <p className="mt-3 text-[10px] text-slate-700">
        Arrêtée à la somme de <span className="font-semibold">{facture.totalEnLettres}</span>.
      </p>

      {facture.acquittee && (
        <p className="mt-1 text-[10px] font-semibold text-emerald-800">
          Facture acquittée — aucun montant restant dû.
        </p>
      )}

      {/* Détail daté des acomptes, pour la comptabilité du client. */}
      {facture.acomptes.length > 0 && (
        <section className="mt-5">
          <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500">
            Détail des règlements
          </p>
          <table className="mt-1 w-full border-collapse text-[10px]">
            <tbody>
              {facture.acomptes.map((acompte) => (
                <tr key={acompte.id} className="border-b border-slate-100">
                  <td className="py-1">{formatDateFr(acompte.date)}</td>
                  <td className="py-1 text-slate-600">{acompte.moyen}</td>
                  <td className="py-1 text-right font-medium">{formatFcfa(acompte.montant)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Mentions : ce que l'application sait, et ce qu'elle ne sait pas. */}
      <footer className="mt-8 border-t border-slate-300 pt-3 text-[9px] leading-snug text-slate-600">
        <p>
          Montants exprimés en francs CFA (XOF). Les paiements Mobile Money confirmés par
          l’opérateur sont enregistrés côté serveur et ne figurent pas dans le détail des règlements
          de cette facture, sauf s’ils ont été encaissés au comptoir.
        </p>
        <p className="mt-1">
          Facture émise à partir des données de la tablette du pressing. Document à conserver sans
          limitation de durée.
        </p>
        <p className="mt-2 font-mono text-[8px] text-slate-400">
          {facture.numero} · {facture.referenceCommande} · {order.id}
        </p>
      </footer>
    </article>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link
          to={`/commandes/${order.id}`}
          className="inline-flex min-h-12 items-center gap-2 text-sm font-semibold text-slate-600 hover:text-brand-navy"
        >
          <ArrowLeft size={16} aria-hidden /> Retour à la commande
        </Link>

        <div className="flex flex-wrap gap-2">
          <Link
            to={`/commandes/${order.id}/recu`}
            className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Reçu 80 mm
          </Link>
          <button
            type="button"
            onClick={imprimer}
            className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-navy px-4 text-sm font-bold text-white hover:bg-brand-slate"
          >
            <Printer size={16} aria-hidden /> Imprimer
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        {contenu}
      </div>

      {/* Le document est monté directement dans `body`, masqué à l'écran et
          affiché à l'impression. Pas de conteneur créé à la main, donc pas
          d'état à synchroniser : le rendu reste pur. */}
      {createPortal(<div className="hidden print:block">{contenu}</div>, document.body)}

      <p className="flex items-center justify-center gap-2 text-center text-xs text-slate-500 print:hidden">
        <Download size={14} aria-hidden />
        Pour un PDF : Imprimer, puis « Enregistrer au format PDF » dans la destination. Le texte
        reste sélectionnable.
      </p>
    </div>
  )
}
