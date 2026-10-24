import { newId, nowIso } from '@/lib/ids'
import { db, type LocalOrder } from '@/db/localDb'
import { chargeableAmount, PaymentError } from '@/services/paymentService'

/**
 * Paiement Mobile Money simulé — en attendant la clé marchande.
 *
 * Pourquoi ce module existe
 * -----------------------------------------------------------------------------
 * Tant que `CINETPAY_API_KEY` n'est pas installée, l'Edge Function répond 503 et
 * la tablette affiche une erreur technique. Le comptoir ne peut donc pas montrer
 * le parcours à un client, ni vérifier que le reste de l'écran réagit.
 *
 * La simulation comble ce trou **sans mentir** :
 *   • elle écrit une trace locale (`status: 'simulated'`) visible dans la fiche ;
 *   • elle ne touche PAS au statut de paiement de la commande — aucune recette
 *     fictive, et le serveur interdit de toute façon au client de le modifier
 *     (`guard_order_update`, migration 003) ;
 *   • elle ne part jamais vers Supabase : ce n'est pas une synchronisation.
 *
 * Dès que la clé est installée, l'appel réel réussit et plus rien n'est simulé :
 * aucun réglage à changer, aucun script à modifier.
 */

/** Référence lisible d'un paiement simulé, impossible à confondre avec CinetPay. */
export function referenceSimulee(maintenant: Date = new Date()): string {
  const horodatage = maintenant.toISOString().replace(/\D/g, '').slice(0, 14)
  return `SIM-${horodatage}`
}

export interface SimulationResultat {
  reference: string
  /** Montant qui aurait été débité (multiple de 5, comme CinetPay). */
  montant: number
}

/**
 * Enregistre un paiement simulé pour une commande.
 *
 * Idempotent par commande : recliquer ne crée pas une seconde ligne, sinon la
 * fiche afficherait plusieurs « simulations » pour un seul geste.
 */
export async function simulerPaiement(order: LocalOrder): Promise<SimulationResultat> {
  const existante = await db.pendingPayments.where('orderId').equals(order.id).toArray()
  const dejaSimulee = existante.find((ligne) => ligne.status === 'simulated')

  if (dejaSimulee) {
    return { reference: dejaSimulee.reference ?? referenceSimulee(), montant: dejaSimulee.amount }
  }

  const montant = chargeableAmount(order.totalAmount)
  const reference = referenceSimulee()

  await db.pendingPayments.put({
    id: newId(),
    orderId: order.id,
    tenantId: order.tenantId,
    amount: montant,
    method: 'wave',
    status: 'simulated',
    reference,
    createdAt: nowIso(),
    lastError: null,
  })

  return { reference, montant }
}

/** Dernière simulation connue pour une commande, s'il y en a une. */
export async function simulationExistante(orderId: string): Promise<SimulationResultat | null> {
  const lignes = await db.pendingPayments.where('orderId').equals(orderId).toArray()
  const simulee = lignes.find((ligne) => ligne.status === 'simulated')
  if (!simulee) return null
  return { reference: simulee.reference ?? referenceSimulee(), montant: simulee.amount }
}

/**
 * Reconnaît un échec qui signifie « CinetPay n'est pas encore installé ».
 *
 * Trois cas, tous normaux avant la mise en service :
 *  - la fonction répond 503 `provider_not_configured` (clés absentes des
 *    secrets Supabase) ;
 *  - la fonction n'est pas déployée : la passerelle répond 404 ;
 *  - la passerelle est injoignable (`FunctionsFetchError`).
 *
 * Tout autre échec (refus, montant invalide, droits) reste une vraie erreur et
 * ne doit surtout pas être masqué par une simulation.
 */
export function cinetpayIndisponible(error: unknown): boolean {
  // Ne jamais simuler sur une panne réseau transitoire : le comptoir pourrait
  // croire que la tentative est passée et demander au client de payer deux fois.
  // Seules l'absence explicite de clés et la fonction non encore déployée
  // sont des états de démonstration prévus.
  return (
    error instanceof PaymentError &&
    ['provider_not_configured', 'function_not_deployed', 'supabase_unconfigured'].includes(
      error.code,
    )
  )
}
