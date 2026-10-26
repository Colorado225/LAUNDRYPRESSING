import { db, type LocalOrder } from '@/db/localDb'
import { deleteOrderLocal } from '@/db/ordersRepository'
import { isSupabaseConfigured } from '@/lib/env'
import { getSupabaseClient } from '@/lib/supabaseClient'

/**
 * Suppression définitive d'une commande (propriétaire uniquement).
 *
 * Décision de conception : une commande se **supprime** seulement quand elle ne
 * porte aucune trace d'argent. Dès qu'un encaissement, un remboursement ou une
 * transaction Mobile Money existe, il faut passer par l'annulation
 * (`status = 'cancelled'`), qui conserve l'historique comptable.
 *
 * Ordre des opérations :
 *   1. contrôles locaux et distants (argent rattaché) ;
 *   2. suppression **distante** d'abord, pour qu'un échec réseau ne laisse pas
 *      la tablette croire que la commande a disparu alors qu'elle existe
 *      encore sur les autres appareils ;
 *   3. nettoyage local (lignes, réclamations, notifications, file).
 *
 * Une commande jamais synchronisée se supprime hors ligne : elle n'existe que
 * sur cette tablette.
 */

/**
 * Traduit un refus serveur de suppression en message exploitable au comptoir.
 *
 * Les déclencheurs `orders_guard_delete` et la RLS renvoient des messages
 * différents : on isole la phrase métier plutôt que d'afficher le préfixe
 * technique de PostgREST.
 */
export function orderDeletionErrorMessage(message: string): string {
  if (/row-level security|42501/i.test(message)) {
    return 'Votre rôle ne permet pas de supprimer cette commande.'
  }

  const metier = /((?:Cette commande|Une commande)[^.]*\.)/i.exec(message)
  if (metier && /23503|annulez|encaissement|remboursement/i.test(message)) {
    return metier[1]
  }

  return `Suppression serveur impossible : ${message}`
}

export interface OrderDeletionCheck {
  autorisee: boolean
  raison?: string
}

/** Vérifie localement puis sur le serveur qu'aucun argent n'est rattaché. */
export async function checkOrderDeletion(order: LocalOrder): Promise<OrderDeletionCheck> {
  const [encaissements, remboursements] = await Promise.all([
    db.cashPayments.where('orderId').equals(order.id).count(),
    db.refunds.where('orderId').equals(order.id).count(),
  ])

  if (encaissements > 0) {
    return {
      autorisee: false,
      raison:
        'Des encaissements espèces sont rattachés à cette commande. Annulez-la pour conserver l’historique de caisse.',
    }
  }

  if (remboursements > 0) {
    return {
      autorisee: false,
      raison: 'Un remboursement existe sur cette commande : elle ne peut plus être supprimée.',
    }
  }

  if (order.synced === 1) {
    if (!navigator.onLine) {
      return {
        autorisee: false,
        raison:
          'Cette commande est enregistrée sur le serveur : la supprimer nécessite une connexion.',
      }
    }

    if (isSupabaseConfigured) {
      const supabase = getSupabaseClient()
      const [paiements, refunds] = await Promise.all([
        supabase
          .from('payment_transactions')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', order.tenantId)
          .eq('order_id', order.id),
        supabase
          .from('payment_refunds')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', order.tenantId)
          .eq('order_id', order.id),
      ])

      if (paiements.error || refunds.error) {
        return {
          autorisee: false,
          raison:
            'Impossible de vérifier les paiements de cette commande. Réessayez avec une connexion stable.',
        }
      }

      if ((paiements.count ?? 0) > 0 || (refunds.count ?? 0) > 0) {
        return {
          autorisee: false,
          raison:
            'Un paiement Mobile Money ou un remboursement est rattaché à cette commande. Annulez-la plutôt que de la supprimer.',
        }
      }
    }
  }

  return { autorisee: true }
}

/**
 * Supprime la commande partout. L'appelant doit avoir affiché la confirmation
 * et vérifié `checkOrderDeletion` au préalable.
 */
export async function deleteOrderEverywhere(order: LocalOrder): Promise<void> {
  const controle = await checkOrderDeletion(order)
  if (!controle.autorisee) {
    throw new Error(controle.raison ?? 'Suppression impossible.')
  }

  if (order.synced === 1 && isSupabaseConfigured) {
    const supabase = getSupabaseClient()
    const { data, error } = await supabase
      .from('orders')
      .delete()
      .eq('tenant_id', order.tenantId)
      .eq('id', order.id)
      .select('id')

    if (error) {
      throw new Error(orderDeletionErrorMessage(error.message))
    }

    // Sans ligne renvoyée, la RLS a laissé passer la requête sans rien
    // supprimer : vérifier que la commande n'existe plus avant d'effacer la
    // copie locale, sinon elle réapparaîtrait à la synchronisation suivante.
    if ((data ?? []).length === 0) {
      const { data: restante, error: erreurLecture } = await supabase
        .from('orders')
        .select('id')
        .eq('tenant_id', order.tenantId)
        .eq('id', order.id)
        .maybeSingle()

      if (!erreurLecture && restante) {
        throw new Error('Votre rôle ne permet pas de supprimer cette commande.')
      }
    }
  }

  await deleteOrderLocal(order.id)
}
