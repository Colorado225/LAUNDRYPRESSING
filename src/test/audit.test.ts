import { describe, expect, it } from 'vitest'
import {
  AUDIT_ACTION_LABELS,
  FAMILLES_AUDIT,
  decrireDetails,
  formaterValeur,
  libelleAction,
  libelleAuteur,
  libelleFamille,
} from '@/services/auditService'
import type { AuditLogRow } from '@/types/database'

/**
 * Mise en forme du journal d'audit.
 *
 * La base ne stocke que des codes et des valeurs brutes : c'est ici que
 * l'événement devient une phrase lisible. Ces tests verrouillent les décisions
 * qui font la différence entre un journal utile et un mur de JSON.
 */

/** `formatFcfa` utilise l'espace fine insécable (U+202F) : on la ramène à une
 * espace ordinaire pour comparer des chaînes lisibles. */
function normaliser(texte: string): string {
  return texte.replace(/\u202f|\u00a0/g, ' ')
}

function ligne(partiel: Partial<AuditLogRow>): AuditLogRow {
  return {
    id: 'ligne-1',
    tenant_id: 'tenant-1',
    actor_id: 'user-1',
    actor_email: 'patron@pressing.ci',
    actor_role: 'owner',
    action: 'tenants.update',
    entity: 'tenants',
    entity_id: 'tenant-1',
    details: {},
    created_at: '2026-10-23T09:30:00.000Z',
    ...partiel,
  }
}

describe('libellés', () => {
  it('traduit chaque action connue en français', () => {
    expect(libelleAction('tenant_users.update')).toBe('Rôle d’un compte modifié')
    expect(libelleAction('payment_refunds.insert')).toBe('Remboursement enregistré')
    expect(libelleAction('expenses.delete')).toBe('Dépense supprimée')
  })

  it('reste lisible sur une action non prévue', () => {
    // Une action inconnue ne doit jamais afficher un code technique au gérant.
    expect(libelleAction('stock_items.update')).toBe('Action enregistrée')
  })

  it('n’a aucun libellé vide', () => {
    for (const [code, libelle] of Object.entries(AUDIT_ACTION_LABELS)) {
      expect(libelle.length, code).toBeGreaterThan(3)
    }
  })

  it('nomme les familles de filtre', () => {
    expect(libelleFamille('comptes')).toBe('Comptes et rôles')
    expect(FAMILLES_AUDIT.map((famille) => famille.valeur)).toContain('caisse')
  })

  it('fait correspondre chaque famille à au moins une table', () => {
    for (const famille of FAMILLES_AUDIT) {
      expect(famille.tables.length, famille.valeur).toBeGreaterThan(0)
    }
  })
})

describe('formaterValeur', () => {
  it('affiche un montant en FCFA', () => {
    expect(normaliser(formaterValeur('price', 1500))).toBe('1 500 FCFA')
    expect(normaliser(formaterValeur('amount', 10000))).toBe('10 000 FCFA')
  })

  it('affiche un montant arrivé en texte (JSON de la base)', () => {
    expect(normaliser(formaterValeur('declared_total', '25000'))).toBe('25 000 FCFA')
  })

  it('traduit un rôle technique', () => {
    expect(formaterValeur('role', 'receptionist')).toBe('réceptionniste')
    expect(formaterValeur('role', 'owner')).toBe('propriétaire')
  })

  it('écrit une date à la française', () => {
    expect(formaterValeur('current_period_end', '2026-11-06')).toBe('06/11/2026')
  })

  it('rend une valeur absente par un tiret', () => {
    expect(formaterValeur('phone', null)).toBe('—')
    expect(formaterValeur('phone', undefined)).toBe('—')
  })

  it('rend un booléen en français', () => {
    expect(formaterValeur('is_active', true)).toBe('oui')
  })
})

describe('decrireDetails', () => {
  it('lit une modification comme un avant/après', () => {
    const phrases = decrireDetails({
      details: { price: { avant: 1500, apres: 2000 } },
    })
    expect(phrases.map(normaliser)).toEqual(['tarif : 1 500 FCFA → 2 000 FCFA'])
  })

  it('lit une création comme une valeur simple', () => {
    const phrases = decrireDetails({
      details: { role: 'artisan', name: 'Pressing Cocody' },
    })
    expect(phrases).toEqual(['rôle : artisan', 'nom : Pressing Cocody'])
  })

  it('tait les colonnes techniques inconnues', () => {
    // `updated_at` et `unit_cost` ne sont pas dans le vocabulaire du gérant :
    // mieux vaut une phrase plus courte qu'un nom de colonne brut.
    const phrases = decrireDetails({
      details: {
        price: { avant: 1000, apres: 1000 },
        updated_at: { avant: 'a', apres: 'b' },
        unit_cost: { avant: 1, apres: 2 },
      },
    })
    expect(phrases.map(normaliser)).toEqual(['tarif : 1 000 FCFA → 1 000 FCFA'])
  })

  it('accepte un détail vide', () => {
    expect(decrireDetails({ details: {} })).toEqual([])
  })

  it('lit une suspension d’abonnement', () => {
    const phrases = decrireDetails({
      details: {
        status: { avant: 'active', apres: 'suspended' },
        suspended_reason: { avant: null, apres: 'Impayé depuis 30 jours' },
      },
    })
    expect(phrases).toEqual([
      'statut : active → suspended',
      'motif de suspension : — → Impayé depuis 30 jours',
    ])
  })
})

describe('libelleAuteur', () => {
  it('donne le compte et son rôle figé', () => {
    expect(libelleAuteur(ligne({}))).toEqual({
      nom: 'patron@pressing.ci',
      role: 'propriétaire',
    })
  })

  it('distingue une écriture serveur d’une action humaine', () => {
    // Un webhook CinetPay n'a pas de session : le journal doit le dire, sans
    // laisser croire qu'un employé a agi.
    expect(libelleAuteur(ligne({ actor_email: null, actor_role: null }))).toEqual({
      nom: 'Serveur',
      role: null,
    })
  })

  it('garde un rôle inconnu tel quel plutôt que de le masquer', () => {
    expect(libelleAuteur(ligne({ actor_role: 'stagiaire' })).role).toBe('stagiaire')
  })
})
