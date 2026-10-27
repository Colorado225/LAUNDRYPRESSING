import { beforeEach, describe, expect, it } from 'vitest'
import {
  CLE_CACHE_PAIEMENT,
  DUREE_CACHE_MS,
  lireDisponibiliteMemoisee,
  lireReponse,
  memoriserDisponibilite,
  oublierDisponibilite,
  paiementIndisponible,
  type DisponibilitePaiement,
} from '@/services/paymentAvailability'

/**
 * Sonde de disponibilité du guichet CinetPay : lecture de la réponse serveur,
 * cache de session et règle de masquage du bouton.
 *
 * Rappel de la règle testée : seul un refus **explicite** du serveur masque le
 * bouton. Un état inconnu ne doit jamais retirer l'action, sinon une panne
 * réseau ferait disparaître un paiement parfaitement fonctionnel.
 */

const presente: DisponibilitePaiement = { configured: true, mode: 'test', missing: [] }
const absente: DisponibilitePaiement = {
  configured: false,
  mode: 'production',
  missing: ['CINETPAY_API_KEY', 'CINETPAY_SITE_ID', 'CINETPAY_SECRET_KEY'],
}

beforeEach(() => {
  window.sessionStorage.clear()
})

describe('lireReponse', () => {
  it('accepte une réponse complète du serveur', () => {
    expect(lireReponse({ configured: false, mode: 'test', missing: ['CINETPAY_API_KEY'] })).toEqual({
      configured: false,
      mode: 'test',
      missing: ['CINETPAY_API_KEY'],
    })
  })

  it('rejette une réponse sans booléen `configured`', () => {
    expect(lireReponse(null)).toBeNull()
    expect(lireReponse({ mode: 'test' })).toBeNull()
    expect(lireReponse({ configured: 'oui' })).toBeNull()
    expect(lireReponse('configured')).toBeNull()
  })

  it('retombe sur `production` et sur une liste vide quand les champs sont absents', () => {
    expect(lireReponse({ configured: true })).toEqual({
      configured: true,
      mode: 'production',
      missing: [],
    })
  })

  it('ignore les entrées non textuelles de `missing`', () => {
    expect(lireReponse({ configured: false, missing: ['CINETPAY_API_KEY', 42, null] })?.missing).toEqual(
      ['CINETPAY_API_KEY'],
    )
  })
})

describe('cache de session', () => {
  it('relit une réponse fraîche', () => {
    memoriserDisponibilite(absente, 1_000)
    expect(lireDisponibiliteMemoisee(2_000)).toEqual(absente)
  })

  it('oublie une réponse périmée', () => {
    memoriserDisponibilite(presente, 1_000)
    expect(lireDisponibiliteMemoisee(1_000 + DUREE_CACHE_MS + 1)).toBeNull()
    expect(window.sessionStorage.getItem(CLE_CACHE_PAIEMENT)).toBeNull()
  })

  it('se tait sur un contenu corrompu', () => {
    window.sessionStorage.setItem(CLE_CACHE_PAIEMENT, '{pas du json')
    expect(lireDisponibiliteMemoisee()).toBeNull()
  })

  it('se tait sur un cache sans horodatage', () => {
    window.sessionStorage.setItem(CLE_CACHE_PAIEMENT, JSON.stringify(absente))
    expect(lireDisponibiliteMemoisee()).toBeNull()
  })

  it('s’efface sur demande', () => {
    memoriserDisponibilite(presente)
    oublierDisponibilite()
    expect(lireDisponibiliteMemoisee()).toBeNull()
  })
})

describe('paiementIndisponible', () => {
  it('ne masque que sur un refus explicite du serveur', () => {
    expect(paiementIndisponible(absente)).toBe(true)
    expect(paiementIndisponible(presente)).toBe(false)
    // État inconnu : le bouton doit rester proposé.
    expect(paiementIndisponible(null)).toBe(false)
  })
})
