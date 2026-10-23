import { newId, nowIso } from '@/lib/ids'
import type { CanalNotification, MotifNotification } from '@/lib/notifications'
import { db, type LocalNotification, type SyncFlag } from './localDb'

/**
 * Journal local des clients prévenus.
 *
 * Écrit **avant** tout réseau : le comptoir prévient un client souvent sans
 * couverture, et la trace ne doit pas dépendre du retour de la connexion. La
 * ligne part ensuite par le moteur de synchronisation, comme une réclamation.
 */

export interface NewNotificationInput {
  orderId: string | null
  channel: CanalNotification
  reason: MotifNotification
  customerName: string
  customerPhone: string
  message: string
}

export async function queueNotification(
  tenantId: string,
  input: NewNotificationInput,
): Promise<LocalNotification> {
  const notification: LocalNotification = {
    id: newId(),
    tenantId,
    orderId: input.orderId,
    channel: input.channel,
    reason: input.reason,
    customerName: input.customerName.trim() || 'Client',
    customerPhone: input.customerPhone.trim(),
    message: input.message,
    createdAt: nowIso(),
    synced: 0,
    lastError: null,
  }

  await db.notifications.add(notification)
  return notification
}

export async function getPendingNotifications(tenantId: string): Promise<LocalNotification[]> {
  return db.notifications.where('[tenantId+synced]').equals([tenantId, 0]).sortBy('createdAt')
}

export async function countPendingNotifications(tenantId: string): Promise<number> {
  return db.notifications.where('[tenantId+synced]').equals([tenantId, 0]).count()
}

export async function markNotificationSynced(notificationId: string): Promise<void> {
  await db.notifications.update(notificationId, { synced: 1 satisfies SyncFlag, lastError: null })
}

/**
 * Mémorise un refus du serveur.
 *
 * Une notification refusée définitivement (rôle, abonnement échu) n'a plus à
 * être renvoyée à chaque synchronisation : elle reste visible localement, avec
 * son motif, plutôt que de bloquer la file derrière elle.
 */
export async function markNotificationError(
  notificationId: string,
  message: string,
  definitive = false,
): Promise<void> {
  await db.notifications.update(notificationId, {
    lastError: message,
    ...(definitive ? { synced: 1 satisfies SyncFlag } : {}),
  })
}

/** Notifications d'une commande, les plus récentes d'abord. */
export async function listOrderNotifications(orderId: string): Promise<LocalNotification[]> {
  const lignes = await db.notifications.where('orderId').equals(orderId).toArray()
  return lignes.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
