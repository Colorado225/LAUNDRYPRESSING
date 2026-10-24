import type { OrderPriceHistoryRow } from '@/types/database'
import { getSupabaseClient } from '@/lib/supabaseClient'
import { isSupabaseConfigured } from '@/lib/env'

/** Lit les anciennes corrections depuis le journal alimenté par le trigger SQL. */
export async function getOrderMeasurementHistory(
  tenantId: string,
  orderId: string,
): Promise<OrderPriceHistoryRow[]> {
  if (!isSupabaseConfigured) {
    throw new Error('L’historique sera disponible après la connexion au serveur.')
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('L’historique du serveur n’est pas accessible hors connexion.')
  }

  const { data, error } = await getSupabaseClient()
    .from('order_price_history')
    .select(
      'id, tenant_id, order_id, order_item_id, previous_price, new_price, reason, changed_by, changed_at, previous_snapshot, new_snapshot',
    )
    .eq('tenant_id', tenantId)
    .eq('order_id', orderId)
    .order('changed_at', { ascending: false })
    .limit(100)

  if (error) {
    throw new Error('Impossible de charger l’historique des mesures pour le moment.')
  }

  return (data ?? []) as OrderPriceHistoryRow[]
}
