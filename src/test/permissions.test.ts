import { describe, expect, it } from 'vitest'
import { can, canSeeAmounts, type Capability } from '@/lib/permissions'
import type { TenantRole } from '@/types/database'

/**
 * Tests de la matrice d'autorisations (palier 1).
 *
 * Ces règles sont appliquées deux fois : dans l'interface (masquage) et côté
 * serveur (RLS + trigger `guard_order_update`). Les tests ci-dessous verrouillent
 * la partie client ; `supabase/tests/roles.sql` couvre la partie serveur.
 */

const ROLES: TenantRole[] = ['owner', 'receptionist', 'artisan']

const EXPECTED: Record<TenantRole, Capability[]> = {
  owner: [
    'orders.create',
    'orders.updateStatus',
    'orders.editDetails',
    'orders.delete',
    'payments.initiate',
    'amounts.view',
    'tenant.manage',
  ],
  receptionist: [
    'orders.create',
    'orders.updateStatus',
    'orders.editDetails',
    'payments.initiate',
    'amounts.view',
  ],
  artisan: ['orders.updateStatus'],
}

const ALL: Capability[] = [
  'orders.create',
  'orders.updateStatus',
  'orders.editDetails',
  'orders.delete',
  'payments.initiate',
  'amounts.view',
  'tenant.manage',
]

describe('can — matrice complète', () => {
  for (const role of ROLES) {
    it(`applique exactement la matrice pour « ${role} »`, () => {
      const granted = ALL.filter((capability) => can(role, capability))

      expect(granted.sort()).toEqual([...EXPECTED[role]].sort())
    })
  }
})

describe('can — décisions produit explicites', () => {
  it('un artisan ne peut ni créer une commande ni encaisser', () => {
    expect(can('artisan', 'orders.create')).toBe(false)
    expect(can('artisan', 'payments.initiate')).toBe(false)
  })

  it('un artisan fait avancer les commandes', () => {
    expect(can('artisan', 'orders.updateStatus')).toBe(true)
  })

  it('un réceptionniste ne supprime pas et ne gère pas les accès', () => {
    expect(can('receptionist', 'orders.delete')).toBe(false)
    expect(can('receptionist', 'tenant.manage')).toBe(false)
  })

  it('seul le propriétaire gère le pressing', () => {
    expect(can('owner', 'tenant.manage')).toBe(true)
    expect(can('receptionist', 'tenant.manage')).toBe(false)
    expect(can('artisan', 'tenant.manage')).toBe(false)
  })
})

describe('can — rôles absents', () => {
  it('refuse tout quand aucun rôle n’est connu', () => {
    for (const capability of ALL) {
      expect(can(null, capability)).toBe(false)
      expect(can(undefined, capability)).toBe(false)
    }
  })
})

describe('canSeeAmounts', () => {
  it('masque les montants à l’artisan seulement', () => {
    expect(canSeeAmounts('artisan')).toBe(false)
    expect(canSeeAmounts('receptionist')).toBe(true)
    expect(canSeeAmounts('owner')).toBe(true)
    expect(canSeeAmounts(null)).toBe(false)
  })
})
