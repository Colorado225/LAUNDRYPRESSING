import { useCallback } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { OrderStatus } from '@/types/database'
import type { UpdateOrderItemMeasurementInput } from '@/schemas/order'
import { useTenantStore } from '@/lib/tenantContext'
import {
  countPendingOrders,
  createOrderLocal,
  updateOrderAssignmentLocal,
  updateOrderItemMeasurementLocal,
  updateOrderStatusLocal,
  updateOrderDueDateLocal,
} from './ordersRepository'
import { queueCashPayment } from './cashRepository'
import {
  db,
  type LocalCashPayment,
  type LocalOrder,
  type LocalOrderIssue,
  type LocalOrderItem,
  type LocalNotification,
  type LocalRefund,
} from './localDb'

/**
 * Hooks React du mode offline-first.
 *
 * `useLiveQuery` (dexie-react-hooks) recâble automatiquement l'UI dès qu'une
 * écriture IndexedDB a lieu — y compris une écriture faite par le moteur de
 * synchronisation en arrière-plan. Aucun rafraîchissement manuel n'est requis.
 */

/**
 * Commandes du pressing courant, les plus récentes d'abord.
 * Retourne `undefined` pendant le premier chargement (convention Dexie).
 */
export function useLocalOrders(): LocalOrder[] | undefined {
  const tenantId = useTenantStore((state) => state.tenantId)

  return useLiveQuery(async () => {
    if (!tenantId) return []
    const orders = await db.orders.where('tenantId').equals(tenantId).toArray()
    return orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [tenantId])
}

/** Tous les encaissements espèces du pressing (tableau de bord). */
export function useAllCashPayments(): LocalCashPayment[] {
  return useLiveQuery(async () => db.cashPayments.toArray(), []) ?? []
}

/** Tous les vêtements du pressing (utilisé par le tableau de bord). */
export function useAllLocalItems(): LocalOrderItem[] {
  return useLiveQuery(async () => db.orderItems.toArray(), []) ?? []
}

/** Une commande et ses vêtements, réactifs aux écritures locales. */
export function useLocalOrder(orderId: string | undefined) {
  return useLiveQuery(async () => {
    if (!orderId) return null
    const order = await db.orders.get(orderId)
    if (!order) return null
    const items = await db.orderItems.where('orderId').equals(orderId).toArray()
    return { order, items }
  }, [orderId])
}

/** Nombre de commandes en attente d'envoi (alimente le badge hors ligne). */
export function usePendingOrderCount(): number {
  const tenantId = useTenantStore((state) => state.tenantId)

  return (
    useLiveQuery(async () => {
      if (!tenantId) return 0
      return countPendingOrders(tenantId)
    }, [tenantId]) ?? 0
  )
}

/**
 * Création de commande locale.
 * Fonctionne sans réseau : aucune requête n'est émise ici.
 */
export function useCreateOrder() {
  const tenantId = useTenantStore((state) => state.tenantId)

  return useCallback(
    async (input: Parameters<typeof createOrderLocal>[1]) => {
      if (!tenantId) {
        throw new Error(
          "Aucun pressing sélectionné : impossible d'enregistrer la commande.",
        )
      }
      return createOrderLocal(tenantId, input)
    },
    [tenantId],
  )
}

/** Confirme ou corrige une mesure locale; la ligne et son total restent hors ligne. */
export function useUpdateOrderItemMeasurement() {
  const tenantId = useTenantStore((state) => state.tenantId)

  return useCallback(
    async (orderId: string, itemId: string, input: UpdateOrderItemMeasurementInput) => {
      if (!tenantId) throw new Error('Aucun pressing sélectionné.')
      return updateOrderItemMeasurementLocal(tenantId, orderId, itemId, input)
    },
    [tenantId],
  )
}

/** Changement de statut local (reste fonctionnel en mode avion). */
export function useUpdateOrderStatus() {
  return useCallback(async (orderId: string, status: OrderStatus, reason: string | null = null) => {
    return updateOrderStatusLocal(orderId, status, reason)
  }, [])
}

/** Encaissements connus d'une commande, réactifs aux écritures locales. */
export function useCashPayments(orderId: string | undefined): LocalCashPayment[] {
  return (
    useLiveQuery(async () => {
      if (!orderId) return []
      return db.cashPayments.where('orderId').equals(orderId).sortBy('receivedAt')
    }, [orderId]) ?? []
  )
}

/** Réclamations d'une commande, les plus récentes d'abord. */
export function useOrderIssues(orderId: string | undefined): LocalOrderIssue[] {
  return (
    useLiveQuery(async () => {
      if (!orderId) return []
      const lignes = await db.orderIssues.where('orderId').equals(orderId).toArray()
      return lignes.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    }, [orderId]) ?? []
  )
}

/** Remboursements enregistrés pour une commande. */
export function useOrderRefunds(orderId: string | undefined): LocalRefund[] {
  return (
    useLiveQuery(async () => {
      if (!orderId) return []
      return db.refunds.where('orderId').equals(orderId).sortBy('refundedAt')
    }, [orderId]) ?? []
  )
}

/** Attribution d'une commande à un employé (écriture locale immédiate). */
export function useUpdateOrderAssignment() {
  return useCallback(
    async (orderId: string, assignedTo: string | null) =>
      updateOrderAssignmentLocal(orderId, assignedTo),
    [],
  )
}

/** Enregistre un encaissement au comptoir (écriture locale immédiate). */
export function useQueueCashPayment() {
  const tenantId = useTenantStore((state) => state.tenantId)

  return useCallback(
    async (orderId: string, amount: number, note: string | null) => {
      if (!tenantId) {
        throw new Error("Aucun pressing sélectionné : impossible d'encaisser.")
      }
      return queueCashPayment(tenantId, orderId, amount, note)
    },
    [tenantId],
  )
}

/** Modifie l'échéance d'une commande (local, synchronisé ensuite). */
export function useUpdateOrderDueDate() {
  return useCallback(async (orderId: string, dueDate: string | null) => {
    return updateOrderDueDateLocal(orderId, dueDate)
  }, [])
}

/** Clients prévenus pour une commande, les plus récents d'abord. */
export function useOrderNotifications(orderId: string | undefined): LocalNotification[] {
  return (
    useLiveQuery(async () => {
      if (!orderId) return []
      const lignes = await db.notifications.where('orderId').equals(orderId).toArray()
      return lignes.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    }, [orderId]) ?? []
  )
}

/**
 * Tout le journal du pressing, le plus récent d'abord.
 *
 * Volontairement borné : au-delà de quelques milliers de lignes, un journal
 * complet n'a plus d'intérêt au comptoir. C'est la date du dernier contact par
 * commande qui décide qui reste à prévenir — pas la liste entière.
 */
export function useRecentNotifications(limit = 200): LocalNotification[] {
  const tenantId = useTenantStore((state) => state.tenantId)

  return (
    useLiveQuery(async () => {
      if (!tenantId) return []
      const lignes = await db.notifications.where('tenantId').equals(tenantId).toArray()
      return lignes.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
    }, [tenantId, limit]) ?? []
  )
}
