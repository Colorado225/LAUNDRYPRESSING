import QRCode from 'qrcode'
import { buildQrString } from '@/lib/ids'

/**
 * Service QR Code.
 *
 * Un code QR identifie UNE commande d'UN pressing. Son format est imposé par
 * le cahier des charges : `TENANTID-ORDERID-TIMESTAMP`.
 *
 * Pourquoi le timestamp en plus des deux UUID ? Il rend le code unique même si
 * une étiquette est réimprimée après une duplication de commande, et il permet
 * de dater une étiquette retrouvée hors système.
 */

/** Options de rendu : correction d'erreur moyenne (étiquette imprimée, usée). */
const QR_RENDER_OPTIONS: QRCode.QRCodeToDataURLOptions = {
  errorCorrectionLevel: 'M',
  margin: 1,
  width: 512,
  color: {
    dark: '#0f172a',
    light: '#ffffff',
  },
}

/**
 * Construit la chaîne encodée dans le QR.
 * Signature conforme au cahier des charges : `generateQrString(orderId, tenantId)`.
 */
export function generateQrString(orderId: string, tenantId: string, timestamp: number = Date.now()): string {
  return buildQrString(tenantId, orderId, timestamp)
}

/** Génère l'image du QR sous forme de DataURL PNG (utilisable en `<img src>`). */
export async function generateQrImage(text: string): Promise<string> {
  if (!text.trim()) {
    throw new Error('Impossible de générer un QR Code vide.')
  }
  return QRCode.toDataURL(text, QR_RENDER_OPTIONS)
}

export interface ParsedQrCode {
  tenantId: string
  orderId: string
  timestamp: number
}

/**
 * Analyse une chaîne scannée.
 *
 * Les UUID contiennent des tirets : un `split('-')` naïf serait ambigu.
 * On s'appuie donc sur des groupes de longueur fixe (36 caractères par UUID)
 * suivis d'un horodatage numérique.
 *
 * Retourne `null` si la chaîne ne respecte pas le format — le scan d'un QR
 * quelconque (affiche publicitaire, code-barres d'un concurrent) ne doit jamais
 * faire planter l'atelier.
 */
export function parseQrString(decodedText: string): ParsedQrCode | null {
  const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(\d{10,16})$/i.exec(
    decodedText.trim(),
  )

  if (!match) return null

  const [, tenantId, orderId, rawTimestamp] = match
  if (!tenantId || !orderId || !rawTimestamp) return null

  return {
    tenantId,
    orderId,
    timestamp: Number(rawTimestamp),
  }
}

/**
 * Référence lisible affichée sur l'étiquette (ex. `CMD-7F3A2B`).
 * Purement cosmétique : l'identification fiable reste le QR.
 */
export function shortOrderReference(orderId: string): string {
  const compact = orderId.replace(/-/g, '')
  return `CMD-${compact.slice(-6).toUpperCase()}`
}
