import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Check, Loader2, Package, Pencil, Plus, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import { formatFcfa } from '@/lib/formatters'
import {
  POLITIQUES_VENDABLES,
  resumerForfait,
  type Forfait,
  type PolitiqueDepassement,
} from '@/lib/packagePricing'
import {
  archiveCommercialPackage,
  createCommercialPackage,
  fetchCommercialPackages,
  updateCommercialPackage,
  type SaisieForfait,
} from '@/services/commercialPackages'

/**
 * Gestion des forfaits commerciaux (« Pack 10 pièces, 5 000 FCFA »).
 *
 * Le propriétaire fixe ici le prix global, le nombre de vêtements couverts et
 * ce qui se passe au-delà. Le comptoir ne fait que choisir un forfait : aucun
 * montant n'est calculé dans cet écran.
 *
 * Deux règles assumées :
 *  - un forfait ne s'**efface** pas, il se **retire** de la vente (archivage) :
 *    les commandes déjà encaissées gardent leur référence ;
 *  - rien n'est affiché comme enregistré avant la relecture serveur : après
 *    chaque écriture, la liste est rechargée depuis la base.
 */

interface ForfaitManagerProps {
  tenantId: string | null
  /** Seul le propriétaire peut modifier la configuration (la RLS le garantit). */
  peutGerer: boolean
}

const FORMULAIRE_VIDE = {
  name: '',
  priceXof: '',
  garmentsIncluded: '',
  overflowPolicy: 'PER_EXTRA_ITEM' as PolitiqueDepassement,
  overflowUnitPriceXof: '',
}

export default function ForfaitManager({ tenantId, peutGerer }: ForfaitManagerProps) {
  const [forfaits, setForfaits] = useState<Forfait[]>([])
  const [chargement, setChargement] = useState(true)
  const [enregistrement, setEnregistrement] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [formulaire, setFormulaire] = useState({ ...FORMULAIRE_VIDE })
  const [edition, setEdition] = useState<{ id: string; valeurs: typeof FORMULAIRE_VIDE } | null>(null)

  const charger = useCallback(async () => {
    if (!tenantId) {
      setErreur('Aucun pressing actif. Reconnectez-vous pour continuer.')
      setChargement(false)
      return
    }
    setChargement(true)
    setErreur(null)
    try {
      setForfaits(await fetchCommercialPackages(tenantId))
    } catch (probleme) {
      setErreur(
        probleme instanceof Error
          ? probleme.message
          : 'Impossible de charger les forfaits de ce pressing.',
      )
    } finally {
      setChargement(false)
    }
  }, [tenantId])

  useEffect(() => {
    void charger()
  }, [charger])

  const actifs = useMemo(
    () => forfaits.filter((forfait) => forfait.isActive && forfait.archivedAt === null),
    [forfaits],
  )
  const retires = useMemo(
    () => forfaits.filter((forfait) => !forfait.isActive || forfait.archivedAt !== null),
    [forfaits],
  )

  /** Traduit le formulaire en saisie contrôlée ; `null` si un champ est vide. */
  const lireFormulaire = (valeurs: typeof FORMULAIRE_VIDE): SaisieForfait => {
    const prix = valeurs.priceXof.trim() === '' ? NaN : Number(valeurs.priceXof)
    const inclus = valeurs.garmentsIncluded.trim() === '' ? null : Number(valeurs.garmentsIncluded)
    const extra =
      valeurs.overflowUnitPriceXof.trim() === '' ? null : Number(valeurs.overflowUnitPriceXof)
    return {
      name: valeurs.name,
      description: null,
      priceXof: prix,
      garmentsIncluded: inclus,
      overflowPolicy: valeurs.overflowPolicy,
      overflowUnitPriceXof: valeurs.overflowPolicy === 'PER_EXTRA_ITEM' ? extra : null,
    }
  }

  const executer = async (action: () => Promise<void>, messageSucces: string) => {
    if (enregistrement) return
    setEnregistrement(true)
    setErreur(null)
    try {
      await action()
      toast.success(messageSucces)
    } catch (probleme) {
      const message =
        probleme instanceof Error ? probleme.message : 'L’opération a échoué. Réessayez.'
      setErreur(message)
      toast.error(message)
    } finally {
      setEnregistrement(false)
    }
  }

  const creer = (evenement: FormEvent) => {
    evenement.preventDefault()
    if (!tenantId || !peutGerer) return
    void executer(async () => {
      await createCommercialPackage(tenantId, lireFormulaire(formulaire))
      setFormulaire({ ...FORMULAIRE_VIDE })
      await charger()
    }, 'Forfait créé.')
  }

  const enregistrerEdition = (evenement: FormEvent) => {
    evenement.preventDefault()
    if (!tenantId || !edition || !peutGerer) return
    void executer(async () => {
      await updateCommercialPackage(tenantId, edition.id, lireFormulaire(edition.valeurs))
      setEdition(null)
      await charger()
    }, 'Forfait mis à jour.')
  }

  const retirer = (forfait: Forfait) => {
    if (!tenantId || !peutGerer) return
    if (
      !window.confirm(
        `Retirer « ${forfait.name} » de la vente ? Les commandes déjà enregistrées avec ce forfait ne changent pas.`,
      )
    ) {
      return
    }
    void executer(async () => {
      await archiveCommercialPackage(tenantId, forfait.id)
      await charger()
    }, 'Forfait retiré de la vente.')
  }

  const champs = (
    valeurs: typeof FORMULAIRE_VIDE,
    changer: (valeurs: typeof FORMULAIRE_VIDE) => void,
  ) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block space-y-1.5 sm:col-span-2">
        <span className="text-xs font-semibold text-slate-600">Nom du forfait</span>
        <input
          value={valeurs.name}
          onChange={(evenement) => changer({ ...valeurs, name: evenement.target.value })}
          maxLength={80}
          placeholder="Ex. Pack 10 pièces"
          aria-label="Nom du forfait"
          className="min-h-12 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-brand-teal"
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-slate-600">Prix global (FCFA)</span>
        <input
          type="number"
          min={1}
          max={10_000_000}
          inputMode="numeric"
          value={valeurs.priceXof}
          onChange={(evenement) => changer({ ...valeurs, priceXof: evenement.target.value })}
          placeholder="5000"
          aria-label="Prix du forfait (FCFA)"
          className="min-h-12 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-brand-teal"
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-slate-600">
          Vêtements inclus <span className="font-normal text-slate-500">(facultatif)</span>
        </span>
        <input
          type="number"
          min={1}
          max={10_000}
          inputMode="numeric"
          value={valeurs.garmentsIncluded}
          onChange={(evenement) => changer({ ...valeurs, garmentsIncluded: evenement.target.value })}
          placeholder="10"
          aria-label="Vêtements inclus"
          className="min-h-12 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-brand-teal"
        />
        <span className="block text-xs text-slate-500">
          Laisser vide : le forfait ne limite pas le nombre de vêtements.
        </span>
      </label>
      <label className="block space-y-1.5">
        <span className="text-xs font-semibold text-slate-600">Au-delà du nombre inclus</span>
        <select
          value={valeurs.overflowPolicy}
          onChange={(evenement) =>
            changer({ ...valeurs, overflowPolicy: evenement.target.value as PolitiqueDepassement })
          }
          aria-label="Au-delà du nombre inclus"
          className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 outline-none focus:border-brand-teal"
        >
          {POLITIQUES_VENDABLES.map((politique) => (
            <option key={politique} value={politique}>
              {politique === 'PER_EXTRA_ITEM'
                ? 'Facturer chaque pièce en plus'
                : 'Refuser la vente au-delà'}
            </option>
          ))}
        </select>
      </label>
      {valeurs.overflowPolicy === 'PER_EXTRA_ITEM' && (
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-slate-600">Prix d’une pièce en plus (FCFA)</span>
          <input
            type="number"
            min={1}
            max={10_000_000}
            inputMode="numeric"
            value={valeurs.overflowUnitPriceXof}
            onChange={(evenement) =>
              changer({ ...valeurs, overflowUnitPriceXof: evenement.target.value })
            }
            placeholder="300"
            aria-label="Prix d’une pièce supplémentaire (FCFA)"
            className="min-h-12 w-full rounded-xl border border-slate-300 px-3 outline-none focus:border-brand-teal"
          />
        </label>
      )}
    </div>
  )

  if (chargement) {
    return (
      <div
        className="flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white py-14 text-slate-500"
        role="status"
      >
        <Loader2 className="animate-spin" size={20} aria-hidden /> Chargement des forfaits…
      </div>
    )
  }

  return (
    <section role="tabpanel" aria-label="Forfaits" className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-brand-navy">Forfaits commerciaux</h2>
        <p className="mt-1 text-sm text-slate-500">
          Un forfait vend un nombre de vêtements pour un prix global : « 10 pièces pour
          5 000 FCFA ». La composition reste libre, le comptoir compte les vêtements réellement
          déposés.
        </p>
      </div>

      {erreur && (
        <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">
          {erreur}
        </p>
      )}

      {peutGerer ? (
        <form
          onSubmit={creer}
          className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h3 className="text-sm font-bold text-slate-700">Nouveau forfait</h3>
          {champs(formulaire, setFormulaire)}
          <button
            type="submit"
            disabled={enregistrement || formulaire.name.trim().length < 2}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-teal px-5 font-bold text-white hover:bg-brand-teal/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={17} aria-hidden /> Créer le forfait
          </button>
        </form>
      ) : (
        <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
          Seul le propriétaire du pressing peut modifier les forfaits.
        </p>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-bold text-slate-700">Forfaits en vente</h3>
        {actifs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            Aucun forfait en vente. Le comptoir facture au prix par article en attendant.
          </div>
        ) : (
          <ul className="space-y-3">
            {actifs.map((forfait) => (
              <li
                key={forfait.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                {edition?.id === forfait.id ? (
                  <form onSubmit={enregistrerEdition} className="space-y-3">
                    {champs(edition.valeurs, (valeurs) => setEdition({ id: forfait.id, valeurs }))}
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={enregistrement}
                        className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white disabled:opacity-50"
                      >
                        <Check size={16} aria-hidden /> Enregistrer
                      </button>
                      <button
                        type="button"
                        onClick={() => setEdition(null)}
                        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-600"
                      >
                        <X size={16} aria-hidden /> Annuler
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="flex items-center gap-2 font-bold text-slate-800">
                        <Package size={16} aria-hidden className="text-brand-teal" />
                        {forfait.name}
                      </h4>
                      <p className="mt-1 text-sm font-semibold text-brand-navy">
                        {formatFcfa(forfait.priceXof)}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{resumerForfait(forfait)}</p>
                    </div>
                    {peutGerer && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          aria-label={`Modifier le forfait ${forfait.name}`}
                          onClick={() =>
                            setEdition({
                              id: forfait.id,
                              valeurs: {
                                name: forfait.name,
                                priceXof: String(forfait.priceXof),
                                garmentsIncluded:
                                  forfait.garmentsIncluded === null
                                    ? ''
                                    : String(forfait.garmentsIncluded),
                                overflowPolicy: forfait.overflowPolicy,
                                overflowUnitPriceXof:
                                  forfait.overflowUnitPriceXof === null
                                    ? ''
                                    : String(forfait.overflowUnitPriceXof),
                              },
                            })
                          }
                          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          <Pencil size={15} aria-hidden /> Modifier
                        </button>
                        <button
                          type="button"
                          aria-label={`Retirer le forfait ${forfait.name}`}
                          onClick={() => retirer(forfait)}
                          disabled={enregistrement}
                          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-200 px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                        >
                          <Trash2 size={15} aria-hidden /> Retirer
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {retires.length > 0 && (
          <details className="rounded-2xl border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer text-sm font-semibold text-slate-600">
              {retires.length} forfait{retires.length > 1 ? 's' : ''} retiré
              {retires.length > 1 ? 's' : ''} de la vente
            </summary>
            <ul className="mt-2 space-y-1 text-sm text-slate-500">
              {retires.map((forfait) => (
                <li key={forfait.id}>
                  {forfait.name} — {formatFcfa(forfait.priceXof)} (archivé, historique conservé)
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  )
}
