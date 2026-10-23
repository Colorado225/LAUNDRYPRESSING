import { describe, expect, it } from 'vitest'
import {
  generateQrImage,
  generateQrString,
  parseQrString,
  shortOrderReference,
} from '@/services/qrService'

/**
 * Tests du module QR (phase 6).
 *
 * Le QR est la seule clé qui relie une étiquette physique à une commande : une
 * régression ici casse tout l'atelier. On vérifie donc le format, l'aller-retour
 * encodage/décodage et la robustesse face à un QR étranger.
 */

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORDER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001'

describe('generateQrString', () => {
  it('respecte le format TENANT-ORDER-TIMESTAMP', () => {
    expect(generateQrString(ORDER, TENANT, 1_764_000_000_000)).toBe(
      `${TENANT}-${ORDER}-1764000000000`,
    )
  })

  it('produit un code unique pour deux commandes du même pressing', () => {
    const first = generateQrString(ORDER, TENANT, 1_764_000_000_000)
    const second = generateQrString('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001', TENANT)

    expect(first).not.toBe(second)
  })

  it('change de code si la même commande est réimprimée plus tard', () => {
    // Le timestamp rend deux impressions distinctes : une étiquette égarée
    // reste datable même sans accès à la base.
    const matin = generateQrString(ORDER, TENANT, 1_764_000_000_000)
    const soir = generateQrString(ORDER, TENANT, 1_764_043_200_000)

    expect(matin).not.toBe(soir)
    expect(parseQrString(matin)?.orderId).toBe(parseQrString(soir)?.orderId)
  })
})

describe('parseQrString', () => {
  it("relit exactement ce que l'encodage a écrit", () => {
    const encoded = generateQrString(ORDER, TENANT, 1_764_000_000_000)

    expect(parseQrString(encoded)).toEqual({
      tenantId: TENANT,
      orderId: ORDER,
      timestamp: 1_764_000_000_000,
    })
  })

  it('tolère les espaces autour du code scanné', () => {
    const encoded = generateQrString(ORDER, TENANT, 1_764_000_000_000)

    expect(parseQrString(`  ${encoded}\n`)?.tenantId).toBe(TENANT)
  })

  it('accepte les UUID en majuscules', () => {
    const encoded = `${TENANT.toUpperCase()}-${ORDER.toUpperCase()}-1764000000000`

    expect(parseQrString(encoded)?.orderId).toBe(ORDER.toUpperCase())
  })

  it.each([
    ['chaîne vide', ''],
    ['texte libre', 'Pressing Pro'],
    ['URL', 'https://pressing.example/ticket/42'],
    ['UUID tronqué', `${TENANT.slice(0, 30)}-${ORDER}-1764000000000`],
    ['horodatage non numérique', `${TENANT}-${ORDER}-hier`],
    ['horodatage trop court', `${TENANT}-${ORDER}-123`],
    ['séparateur manquant', `${TENANT}${ORDER}1764000000000`],
    ['suffixe parasite', `${TENANT}-${ORDER}-1764000000000-extra`],
  ])('rejette : %s', (_label, input) => {
    // Un QR quelconque ne doit jamais faire planter l'atelier : on renvoie null.
    expect(parseQrString(input)).toBeNull()
  })
})

describe('shortOrderReference', () => {
  it('affiche les 6 derniers caractères en majuscules', () => {
    expect(shortOrderReference(ORDER)).toBe('CMD-AA0001')
  })

  it('ignore les tirets de l’UUID', () => {
    // 4 caractères de préfixe + 6 caractères significatifs.
    expect(shortOrderReference('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001')).toHaveLength(10)
  })
})

describe('generateQrImage', () => {
  it('renvoie une image PNG de 512 px', async () => {
    const dataUrl = await generateQrImage(generateQrString(ORDER, TENANT))

    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true)

    // En-tête PNG : signature 8 octets, puis IHDR (largeur/hauteur en big-endian
    // aux offsets 16 et 20). Vérifier les dimensions réelles évite de valider
    // une image vide ou d'une autre taille.
    const buffer = Buffer.from(dataUrl.split(',')[1] ?? '', 'base64')
    expect(buffer.subarray(1, 4).toString()).toBe('PNG')
    expect(buffer.readUInt32BE(16)).toBe(512)
    expect(buffer.readUInt32BE(20)).toBe(512)
  })

  it('refuse un contenu vide plutôt que de produire une image inutilisable', async () => {
    await expect(generateQrImage('   ')).rejects.toThrow('QR Code vide')
  })
})
