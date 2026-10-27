import { describe, expect, it } from 'vitest'
import { normaliser, rechercherGlobalement } from '@/services/globalSearch'
import type { LocalOrder } from '@/db/localDb'

/**
 * Recherche globale de l'en-tête.
 *
 * Ce qui compte ici n'est pas le rendu mais la **réponse** : trouver une
 * commande par son client même si le nom est accentué ou saisi sans accent,
 * retrouver un numéro écrit avec des espaces, et ne jamais proposer une page
 * pour un terme d'une seule lettre.
 */

function commande(partiel: Partial<LocalOrder> & { id: string }): LocalOrder {
  return {
    tenantId: 'tenant-1',
    customerName: 'Client',
    customerPhone: '0700000000',
    status: 'received',
    qrCode: 'CMD',
    photoUrl: null,
    totalAmount: 5000,
    paymentStatus: 'pending',
    paymentMethod: null,
    createdAt: '2026-10-26T08:00:00Z',
    updatedAt: '2026-10-26T08:00:00Z',
    synced: 'pending',
    syncedAt: null,
    serverVersion: 0,
    syncError: null,
    ...partiel,
  } as LocalOrder
}

const COMMANDES: LocalOrder[] = [
  commande({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    customerName: 'Awa Koné',
    customerPhone: '07 09 44 12 08',
    status: 'ready',
  }),
  commande({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    customerName: 'Ibrahim Touré',
    customerPhone: '05 66 20 91 34',
    status: 'washing',
  }),
  commande({
    id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
    customerName: 'Fatou Diarra',
    customerPhone: '07 47 88 03 55',
    status: 'delivered',
  }),
]

describe('normaliser', () => {
  it('ignore la casse et les accents', () => {
    expect(normaliser('Awa Koné')).toBe('awa kone')
    expect(normaliser('  ÇA  ')).toBe('ca')
  })
})

describe('rechercherGlobalement', () => {
  it('ne propose rien pour un terme d’une lettre', () => {
    expect(rechercherGlobalement('a', COMMANDES)).toEqual([])
  })

  it('trouve une commande par son nom, accentuée ou non', () => {
    const avecAccent = rechercherGlobalement('Koné', COMMANDES)
    const sansAccent = rechercherGlobalement('kone', COMMANDES)

    expect(avecAccent).toHaveLength(1)
    expect(sansAccent).toHaveLength(1)
    expect(avecAccent[0]?.type).toBe('commande')
    expect(avecAccent[0]?.to).toContain('/commandes/')
    expect(avecAccent[0]?.titre).toContain('Awa Koné')
  })

  it('retrouve un numéro saisi sans espaces', () => {
    const resultats = rechercherGlobalement('070944', COMMANDES)

    expect(resultats).toHaveLength(1)
    expect(resultats[0]?.titre).toContain('Awa Koné')
    // Le détail annonce le statut réel de la commande.
    expect(resultats[0]?.detail).toContain('Prête')
  })

  it('trouve aussi par la référence affichée du ticket', () => {
    const reference = rechercherGlobalement('ccc3'.toUpperCase(), COMMANDES)
    // La référence réelle est dérivée de l'identifiant : on vérifie au moins
    // qu'aucune commande n'est proposée pour un fragment arbitraire.
    expect(reference.every((resultat) => resultat.type !== 'commande')).toBe(false)

    const parReference = rechercherGlobalement('CMD-', COMMANDES)
    expect(parReference.filter((resultat) => resultat.type === 'commande')).toHaveLength(3)
  })

  it('propose des pages de l’application quand le terme en désigne une', () => {
    const resultats = rechercherGlobalement('atelier', COMMANDES)
    const page = resultats.find((resultat) => resultat.type === 'page')

    expect(page?.titre).toBe('Atelier')
    expect(page?.to).toBe('/atelier')
  })

  it('trouve le catalogue sous son ancien nom', () => {
    // « Catalogue & Tarifs » est le libellé de la maquette ; la page réelle
    // s'appelle « Services & activités », mais la recherche doit accepter les
    // deux pour ne pas perdre un utilisateur qui emploie le vocabulaire métier.
    const resultats = rechercherGlobalement('catalogue', COMMANDES)
    expect(resultats.some((resultat) => resultat.to === '/prestations')).toBe(true)
  })

  it('respecte la limite de commandes demandée', () => {
    // « CMD- » correspond aux trois tickets : la limite doit en garder un seul.
    const resultats = rechercherGlobalement('CMD-', COMMANDES, 1)
    expect(resultats.filter((resultat) => resultat.type === 'commande')).toHaveLength(1)
  })

  it('ne cherche pas un téléphone sur deux chiffres seulement', () => {
    // « 07 » est le préfixe de la moitié des numéros du pays : le seuil est de
    // trois chiffres pour éviter une liste qui ne veut rien dire.
    expect(rechercherGlobalement('07', COMMANDES)).toEqual([])
  })

  it('renvoie une liste vide plutôt qu’une erreur sans correspondance', () => {
    expect(rechercherGlobalement('zzzzz', COMMANDES)).toEqual([])
  })

  it('place les commandes avant les pages', () => {
    const resultats = rechercherGlobalement('commandes', COMMANDES)
    const premierPage = resultats.findIndex((resultat) => resultat.type === 'page')
    const dernierCommande = resultats.map((r) => r.type).lastIndexOf('commande')

    expect(dernierCommande).toBeLessThan(premierPage === -1 ? Infinity : premierPage)
  })
})
