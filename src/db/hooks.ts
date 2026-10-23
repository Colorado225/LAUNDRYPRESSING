import { useCallback } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { OrderStatus } from '@/types/database'
import { useTenantStore } from '@/lib/tenantContext'
import {
  countPendingOrders,
  createOrderLocal,
  updateOrderStatusLocal,
  updateOrderDueDateLocal,
} from './ordersRepository'
import { queueCashPayment } from './cashRepository'
import { db, type LocalCashPayment, type LocalOrder } from './localDb'

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

/** Changement de statut local (reste fonctionnel en mode avion). */
export function useUpdateOrderStatus() {
  return useCallback(async (orderId: string, status: OrderStatus) => {
    return updateOrderStatusLocal(orderId, status)
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
