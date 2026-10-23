import { describe, expect, it } from 'vitest'
import type { LocalOrder } from '@/db/localDb'
import {
  clientsAPrevenir,
  lienAppel,
  lienWhatsApp,
  messageNotification,
  motifPour,
  numeroInternational,
  type ContexteMessage,
} from '@/lib/notifications'

/**
 * Prévenir le client — logique des messages et des liens.
 *
 * Ce qui peut mal tourner sans test :
 *  - un numéro mal normalisé ouvre WhatsApp sur un contact inexistant, et le
 *    comptoir croit avoir prévenu le client ;
 *  - un message dont les accents ne survivent pas à l'encodage arrive en
 *    charabia ;
 *  - une commande en retard reçoit le texte « votre linge est prêt », ce qui
 *    fait déplacer un client pour rien.
 */

function commande(surcharge: Partial<LocalOrder> = {}): LocalOrder {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    tenantId: '11111111-1111-4111-8111-111111111111',
    customerName: 'Awa Koné',
    customerPhone: '0707070707',
    status: 'ready',
    qrCode: 'CMD-EEEEEE',
    photoUrl: null,
    totalAmount: 15000,
    paymentStatus: 'pending',
    paymentMethod: null,
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-21T09:00:00.000Z',
    synced: 1,
    syncedAt: '2026-10-21T09:01:00.000Z',
    serverVersion: 1,
    syncError: null,
    syncConflict: null,
    dueDate: '2026-10-22',
    assignedTo: null,
    assignedAt: null,
    statusReason: null,
    ...surcharge,
  }
}

const contexte: ContexteMessage = {
  customerName: 'Awa Koné',
  pressing: 'Pressing Cocody',
  orderId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  dueDate: '2026-10-22',
  status: 'ready',
}

describe('numeroInternational', () => {
  it('préfixe un numéro ivoirien de dix chiffres', () => {
    expect(numeroInternational('0707070707')).toBe('2250707070707')
  })

  it('accepte les espaces, points et tirets', () => {
    expect(numeroInternational('+225 07 07 07 07 07')).toBe('2250707070707')
    expect(numeroInternational('07.07.07.07.07')).toBe('2250707070707')
  })

  it('ne double pas un indicatif déjà présent', () => {
    expect(numeroInternational('2250707070707')).toBe('2250707070707')
  })

  it('refuse un numéro absent ou trop court', () => {
    expect(numeroInternational(null)).toBeNull()
    expect(numeroInternational('')).toBeNull()
    expect(numeroInternational('12 34')).toBeNull()
  })
})

describe('liens', () => {
  it('construit un lien WhatsApp encodé', () => {
    const lien = lienWhatsApp('0707070707', 'Bonjour Awa, votre linge est prêt !')

    expect(lien).toBe(
      `https://wa.me/2250707070707?text=${encodeURIComponent('Bonjour Awa, votre linge est prêt !')}`,
    )
    // Les accents doivent survivre à l'encodage, sinon le message arrive cassé.
    expect(decodeURIComponent(lien?.split('text=')[1] ?? '')).toContain('prêt')
  })

  it('refuse un numéro inexploitable au lieu d’ouvrir une conversation vide', () => {
    expect(lienWhatsApp('inconnu', 'Bonjour')).toBeNull()
    expect(lienAppel(null)).toBeNull()
  })

  it('construit un lien d’appel avec indicatif', () => {
    expect(lienAppel('07 07 07 07 07')).toBe('tel:+2250707070707')
  })
})

describe('messageNotification', () => {
  it('s’adresse au client par son prénom', () => {
    expect(messageNotification('pret', contexte)).toMatch(/^Bonjour Awa,/)
  })

  it('reste neutre quand le nom manque', () => {
    expect(messageNotification('pret', { ...contexte, customerName: '  ' })).toMatch(/^Bonjour,/)
  })

  it('annonce la commande prête avec la référence et le pressing', () => {
    const message = messageNotification('pret', contexte)

    expect(message).toContain('CMD-EEEEEE')
    expect(message).toContain('Pressing Cocody')
    expect(message).toContain('prêt')
  })

  it('dit l’inverse pour un retard : la commande n’est PAS prête', () => {
    const message = messageNotification('retard', { ...contexte, status: 'washing' })

    expect(message).toContain('retard')
    expect(message).toContain('22/10/2026')
    expect(message).not.toContain('votre linge est prêt')
  })

  it('rappelle une commande prête mais non retirée', () => {
    const message = messageNotification('relance', contexte)

    expect(message).toContain('vous attend')
    expect(message).toContain('22/10/2026')
  })

  it('ne parle jamais d’argent', () => {
    for (const motif of ['pret', 'retard', 'relance'] as const) {
      expect(messageNotification(motif, contexte)).not.toMatch(/FCFA|F CFA|montant/i)
    }
  })

  it('remplace une échéance absente par une formule neutre', () => {
    expect(messageNotification('relance', { ...contexte, dueDate: null })).toContain(
      'la date convenue',
    )
  })
})

describe('motifPour', () => {
  it('propose « prête » pour une commande prête dans les délais', () => {
    expect(motifPour(commande({ dueDate: '2026-10-25' }), '2026-10-23')).toBe('pret')
  })

  it('propose « relance » quand une commande prête a dépassé son échéance', () => {
    expect(motifPour(commande({ dueDate: '2026-10-20' }), '2026-10-23')).toBe('relance')
  })

  it('propose « retard » quand la commande n’est pas prête et l’échéance passée', () => {
    expect(motifPour(commande({ status: 'ironing', dueDate: '2026-10-20' }), '2026-10-23')).toBe(
      'retard',
    )
  })

  it('ne propose rien pour une commande en cours dans les délais', () => {
    expect(motifPour(commande({ status: 'washing', dueDate: '2026-10-30' }), '2026-10-23')).toBeNull()
  })

  it('ne propose rien pour une commande livrée ou annulée, même en retard', () => {
    expect(motifPour(commande({ status: 'delivered', dueDate: '2026-10-01' }), '2026-10-23')).toBeNull()
    expect(motifPour(commande({ status: 'cancelled', dueDate: '2026-10-01' }), '2026-10-23')).toBeNull()
  })

  it('ne signale rien sans échéance ni statut prêt', () => {
    expect(motifPour(commande({ status: 'received', dueDate: null }), '2026-10-23')).toBeNull()
  })
})

describe('clientsAPrevenir', () => {
  const options = { today: '2026-10-23', pressing: 'Pressing Cocody' }

  it('liste une commande prête jamais signalée', () => {
    const propositions = clientsAPrevenir([commande()], [], options)

    expect(propositions).toHaveLength(1)
    expect(propositions[0].motif).toBe('relance')
    expect(propositions[0].whatsapp).toContain('https://wa.me/2250707070707')
    expect(propositions[0].appel).toBe('tel:+2250707070707')
  })

  it('sort de la liste un client prévenu depuis le dernier changement', () => {
    const notifications = [
      {
        orderId: commande().id,
        reason: 'pret' as const,
        createdAt: '2026-10-22T10:00:00.000Z',
      },
    ]

    expect(clientsAPrevenir([commande()], notifications, options)).toEqual([])
  })

  it('remet la commande dans la liste si elle a changé depuis la notification', () => {
    const notifications = [
      {
        orderId: commande().id,
        reason: 'pret' as const,
        createdAt: '2026-10-20T10:00:00.000Z',
      },
    ]

    expect(clientsAPrevenir([commande()], notifications, options)).toHaveLength(1)
  })

  it('ignore une notification plus ancienne qu’une autre pour la même commande', () => {
    const id = commande().id
    const notifications = [
      { orderId: id, reason: 'pret' as const, createdAt: '2026-10-20T10:00:00.000Z' },
      { orderId: id, reason: 'relance' as const, createdAt: '2026-10-22T10:00:00.000Z' },
    ]

    expect(clientsAPrevenir([commande()], notifications, options)).toEqual([])
  })

  it('classe les retards avant les commandes prêtes', () => {
    const enRetard = commande({
      id: '11111111-1111-4111-8111-111111111111',
      status: 'washing',
      dueDate: '2026-10-19',
    })
    const prete = commande({
      id: '22222222-2222-4222-8222-222222222222',
      dueDate: '2026-10-25',
    })

    const propositions = clientsAPrevenir([prete, enRetard], [], options)

    expect(propositions.map((proposition) => proposition.motif)).toEqual(['retard', 'pret'])
  })

  it('exclut les commandes livrées et annulées', () => {
    const livree = commande({ status: 'delivered' })
    const annulee = commande({ status: 'cancelled' })

    expect(clientsAPrevenir([livree, annulee], [], options)).toEqual([])
  })

  it('signale un numéro inexploitable par des liens nuls plutôt que par une erreur', () => {
    const propositions = clientsAPrevenir([commande({ customerPhone: 'inconnu' })], [], options)

    expect(propositions[0].whatsapp).toBeNull()
    expect(propositions[0].appel).toBeNull()
  })
})
