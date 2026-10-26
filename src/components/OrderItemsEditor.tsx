import { useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAddOrderItem, useRemoveOrderItem } from '@/db/hooks'
import type { LocalOrder, LocalOrderItem } from '@/db/localDb'
import { formatFcfa } from '@/lib/formatters'

interface Props {
  order: LocalOrder
  items: LocalOrderItem[]
}

/**
 * Correction des articles d'une commande déjà déposée.
 *
 * Deux opérations, volontairement limitées au strict nécessaire au comptoir :
 *  - **ajouter** une pièce rapportée (ligne libre au prix fixé) ;
 *  - **retirer** une ligne saisie par erreur.
 *
 * Les champs tarifaires figés (catalogue, forfaits, mesures) ne sont pas
 * réécrits ici : ils se corrigent par l'éditeur de mesure ou en annulant la
 * commande. Chaque écriture part en file de synchronisation, puis
 * `pushOrder` aligne `order_items` côté serveur (ajout, mise à jour et purge
 * des lignes retirées).
 */
export default function OrderItemsEditor({ order, items }: Props) {
  const ajouterLigne = useAddOrderItem()
  const retirerLigne = useRemoveOrderItem()

  const [libelle, setLibelle] = useState('')
  const [quantite, setQuantite] = useState('1')
  const [prix, setPrix] = useState('')
  const [envoi, setEnvoi] = useState(false)
  const [ligneEnCours, setLigneEnCours] = useState<string | null>(null)

  const montant = Number(prix.replace(/\s/g, ''))
  const quantiteNombre = Number(quantite)

  const ajouter = async () => {
    if (!libelle.trim()) {
      toast.error('Indiquez le libellé de l’article.')
      return
    }
    if (!Number.isInteger(quantiteNombre) || quantiteNombre < 1) {
      toast.error('La quantité doit être un entier supérieur à zéro.')
      return
    }
    if (!Number.isInteger(montant) || montant < 0 || prix.trim() === '') {
      toast.error('Indiquez le prix unitaire, en FCFA.')
      return
    }

    setEnvoi(true)
    try {
      await ajouterLigne(order.id, {
        label: libelle,
        quantity: quantiteNombre,
        unitPrice: montant,
      })
      toast.success('Article ajouté à la commande', { icon: '🧺' })
      setLibelle('')
      setQuantite('1')
      setPrix('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ajout impossible')
    } finally {
      setEnvoi(false)
    }
  }

  const retirer = async (item: LocalOrderItem) => {
    const confirme = window.confirm(
      `Retirer « ${item.label} » de cette commande ? Le total sera recalculé.`,
    )
    if (!confirme) return

    setLigneEnCours(item.id)
    try {
      await retirerLigne(order.id, item.id)
      toast.success('Article retiré', { icon: '🗑️' })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Suppression impossible')
    } finally {
      setLigneEnCours(null)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
        <Plus size={16} aria-hidden /> Articles
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Une pièce rapportée au dépôt s’ajoute ici ; une ligne erronée se retire. Le total et le
        reçu suivent, la correction se synchronise comme le reste de la commande.
      </p>

      <ul className="mt-3 divide-y divide-slate-100">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">{item.label}</p>
              <p className="text-xs text-slate-500">
                {item.billedQuantity} × {formatFcfa(item.unitPrice)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-sm font-semibold text-brand-navy">{formatFcfa(item.price)}</span>
              <button
                type="button"
                onClick={() => void retirer(item)}
                disabled={ligneEnCours === item.id || items.length <= 1}
                aria-label={`Retirer l’article ${item.label}`}
                title={
                  items.length <= 1
                    ? 'Une commande doit garder au moins un article'
                    : 'Retirer cet article'
                }
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-rose-200 px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {ligneEnCours === item.id ? (
                  <Loader2 className="animate-spin" size={15} aria-hidden />
                ) : (
                  <Trash2 size={15} aria-hidden />
                )}
                Retirer
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_88px_120px_auto]">
        <label className="min-w-0">
          <span className="sr-only">Libellé de l’article</span>
          <input
            value={libelle}
            onChange={(event) => setLibelle(event.target.value)}
            placeholder="Article ajouté (ex. Chemise blanche)"
            maxLength={120}
            className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-brand-teal"
          />
        </label>

        <label>
          <span className="sr-only">Quantité</span>
          <input
            value={quantite}
            onChange={(event) => setQuantite(event.target.value)}
            inputMode="numeric"
            aria-label="Quantité"
            className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-brand-teal"
          />
        </label>

        <label>
          <span className="sr-only">Prix unitaire</span>
          <input
            value={prix}
            onChange={(event) => setPrix(event.target.value)}
            inputMode="numeric"
            placeholder="Prix unitaire"
            aria-label="Prix unitaire en FCFA"
            className="min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-brand-teal"
          />
        </label>

        <button
          type="button"
          onClick={() => void ajouter()}
          disabled={envoi}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white hover:bg-brand-teal-dark disabled:opacity-60"
        >
          {envoi ? (
            <Loader2 className="animate-spin" size={15} aria-hidden />
          ) : (
            <Plus size={15} aria-hidden />
          )}
          Ajouter
        </button>
      </div>
    </section>
  )
}
