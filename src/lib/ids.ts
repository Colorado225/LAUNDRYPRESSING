/**
 * Génération d'identifiants et de codes QR.
 *
 * Les identifiants sont créés CÔTÉ CLIENT : c'est la condition pour pouvoir
 * enregistrer une commande hors ligne et la synchroniser plus tard sans
 * risquer de doublons (l'`upsert` s'appuie sur cet UUID).
 */

/** UUID v4 avec repli pour les WebView Android anciennes sans `crypto.randomUUID`. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  // Repli RFC 4122 v4 à partir de getRandomValues
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Code QR d'une commande, au format imposé : `TENANTID-ORDERID-TIMESTAMP`.
 * Le timestamp garantit l'unicité lors d'une réimpression ou d'une duplication.
 */
export function buildQrString(tenantId: string, orderId: string, timestamp: number = Date.now()): string {
  return `${tenantId}-${orderId}-${timestamp}`
}

/** Horodatage ISO (stocké tel quel dans IndexedDB et envoyé à Supabase). */
export function nowIso(): string {
  return new Date().toISOString()
}
