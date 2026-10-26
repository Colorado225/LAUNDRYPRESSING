import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * CRUD des modules de gestion (migration 025 et écrans associés).
 *
 * Ce qui est vérifié ici, c'est la **requête construite** et la **règle
 * métier** : validation avant écriture, colonnes envoyées, traduction des
 * refus PostgreSQL, repli quand la fonction serveur n'existe pas encore. Les
 * politiques RLS elles-mêmes sont couvertes par `supabase/tests/crud_complet.sql`.
 */

interface Appel {
  table: string
  action: 'select' | 'insert' | 'update' | 'delete'
  payload: unknown
  filtres: Array<[string, unknown]>
}

const etat = vi.hoisted(() => ({
  appels: [] as Appel[],
  rpc: [] as Array<{ nom: string; args: Record<string, unknown> }>,
  /** Réponse du prochain appel `.from(...)`. */
  reponses: [] as Array<{ data: unknown; error: { message: string; code?: string } | null }>,
  /** Réponse du prochain `rpc(...)`. */
  reponsesRpc: [] as Array<{ data: unknown; error: { message: string } | null }>,
}))

function creerChaine(table: string) {
  let action: Appel['action'] = 'select'
  const filtres: Array<[string, unknown]> = []
  let payload: unknown = null

  const resultat = () => etat.reponses.shift() ?? { data: null, error: null }

  const chaine: Record<string, unknown> = {
    insert: (valeurs: unknown) => {
      action = 'insert'
      payload = valeurs
      return chaine
    },
    update: (valeurs: unknown) => {
      action = 'update'
      payload = valeurs
      return chaine
    },
    delete: () => {
      action = 'delete'
      return chaine
    },
    select: () => chaine,
    eq: (colonne: string, valeur: unknown) => {
      filtres.push([colonne, valeur])
      return chaine
    },
    order: () => chaine,
    limit: () => chaine,
    maybeSingle: () => {
      etat.appels.push({ table, action, payload, filtres: [...filtres] })
      return Promise.resolve(resultat())
    },
    then: (resoudre: (valeur: unknown) => unknown) => {
      etat.appels.push({ table, action, payload, filtres: [...filtres] })
      return Promise.resolve(resultat()).then(resoudre)
    },
  }

  return chaine
}

vi.mock('@/lib/env', () => ({ isSupabaseConfigured: true }))
vi.mock('@/lib/supabaseClient', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => creerChaine(table),
    rpc: (nom: string, args: Record<string, unknown>) => {
      etat.rpc.push({ nom, args })
      return Promise.resolve(etat.reponsesRpc.shift() ?? { data: null, error: null })
    },
  }),
}))

const {
  createCustomer,
  deleteCustomer,
  mergeCustomerCards,
  updateCustomer,
  validateCustomer,
} = await import('@/services/customerService')
const {
  deleteStockItem,
  deleteSupplier,
  setStockItemActive,
  updateSupplier,
  stockErrorMessage,
} = await import('@/services/stockService')
const { updateExpense } = await import('@/services/expenseService')
const {
  addTeamMemberByEmail,
  fetchTeamMembers,
  removeTeamMember,
  updateTeamMember,
} = await import('@/services/tenantMembers')
const { closeSupportRequest, deleteSupportRequest } = await import('@/services/platformService')
const { orderDeletionErrorMessage } = await import('@/services/orderAdminService')

beforeEach(() => {
  etat.appels = []
  etat.rpc = []
  etat.reponses = []
  etat.reponsesRpc = []
})

/* ------------------------------------------------------------------ Clients */

describe('fiches clients', () => {
  it('valide le nom, le téléphone, l’e-mail et les longueurs avant toute écriture', () => {
    expect(validateCustomer({ name: '', phone: '0700000021' })).toBe(
      'Indiquez le nom du client.',
    )
    expect(validateCustomer({ name: 'Awa', phone: '123' })).toContain('téléphone valide')
    expect(validateCustomer({ name: 'Awa', phone: '0700000021', email: 'invalide' })).toContain(
      'e-mail',
    )
    expect(validateCustomer({ name: 'Awa', phone: '0700000021', email: 'awa@exemple.ci' })).toBeNull()
  })

  it('crée une fiche sans envoyer phone_key : le déclencheur la calcule', () => {
    etat.reponses = [{ data: { id: 'client-1', name: 'Awa', phone: '07 00 00 00 21' }, error: null }]

    return createCustomer('tenant-1', {
      name: ' Awa Koné ',
      phone: ' 07 00 00 00 21 ',
      email: ' ',
      address: 'Cocody',
      notes: null,
    }).then((fiche) => {
      expect(fiche.id).toBe('client-1')
      const appel = etat.appels[0]
      expect(appel.table).toBe('customers')
      expect(appel.action).toBe('insert')
      expect(appel.payload).toEqual({
        tenant_id: 'tenant-1',
        name: 'Awa Koné',
        phone: '07 00 00 00 21',
        email: null,
        address: 'Cocody',
        notes: null,
      })
      expect(appel.payload).not.toHaveProperty('phone_key')
    })
  })

  it('traduit un numéro déjà utilisé en message lisible', async () => {
    etat.reponses = [
      { data: null, error: { message: 'duplicate key value violates constraint "customers_phone_unique"' } },
    ]

    await expect(
      createCustomer('tenant-1', { name: 'Awa', phone: '0700000021' }),
    ).rejects.toThrow('Un client utilise déjà ce numéro de téléphone dans ce pressing.')
  })

  it('accepte un patch partiel (adresse seule) sans exiger nom et téléphone', async () => {
    etat.reponses = [{ data: { id: 'client-1' }, error: null }]

    await updateCustomer('tenant-1', 'client-1', { address: 'Yopougon' })

    const appel = etat.appels[0]
    expect(appel.action).toBe('update')
    expect(appel.payload).toEqual({ address: 'Yopougon' })
    expect(appel.filtres).toEqual([
      ['tenant_id', 'tenant-1'],
      ['id', 'client-1'],
    ])
  })

  it('refuse un téléphone invalide avant d’appeler le serveur', async () => {
    await expect(updateCustomer('tenant-1', 'client-1', { phone: '12' })).rejects.toThrow(
      'Indiquez un numéro de téléphone valide (au moins 6 chiffres).',
    )
    expect(etat.appels).toHaveLength(0)
  })

  it('supprime en filtrant sur le pressing et la fiche', async () => {
    etat.reponses = [{ data: null, error: null }]

    await deleteCustomer('tenant-1', 'client-1')

    expect(etat.appels[0]).toMatchObject({
      table: 'customers',
      action: 'delete',
      filtres: [
        ['tenant_id', 'tenant-1'],
        ['id', 'client-1'],
      ],
    })
  })

  it('fusionne les fiches serveur avec l’historique local, y compris sans commande', () => {
    const clients = mergeCustomerCards(
      [
        {
          id: 'commande-1',
          tenantId: 'tenant-1',
          customerName: 'Awa Koné',
          customerPhone: '0700000021',
          status: 'received',
          qrCode: 'CMD-1',
          photoUrl: null,
          totalAmount: 5_000,
          paymentStatus: 'pending',
          paymentMethod: null,
          createdAt: '2026-10-20T09:00:00.000Z',
          updatedAt: '2026-10-20T09:00:00.000Z',
          synced: 1,
          syncedAt: null,
          serverVersion: 1,
          syncError: null,
          syncConflict: null,
          dueDate: null,
          assignedTo: null,
          assignedAt: null,
          statusReason: null,
        },
      ],
      [
        {
          id: 'client-1',
          tenant_id: 'tenant-1',
          name: 'Awa Koné',
          phone: '07 00 00 00 21',
          phone_key: '0700000021',
          email: 'awa@exemple.ci',
          address: 'Cocody',
          notes: null,
          created_at: '2026-10-01T09:00:00.000Z',
          updated_at: '2026-10-21T09:00:00.000Z',
        },
        {
          id: 'client-2',
          tenant_id: 'tenant-1',
          name: 'Ibrahim Traoré',
          phone: '05 00 00 00 10',
          phone_key: '0500000010',
          email: null,
          address: null,
          notes: null,
          created_at: '2026-10-22T09:00:00.000Z',
          updated_at: '2026-10-22T09:00:00.000Z',
        },
      ],
      '2026-10-23',
    )

    const awa = clients.find((client) => client.key === '0700000021')
    expect(awa?.orderCount).toBe(1)
    expect(awa?.customerId).toBe('client-1')
    expect(awa?.email).toBe('awa@exemple.ci')
    expect(awa?.hasCard).toBe(true)

    // Une fiche créée au comptoir avant toute commande reste visible.
    const ibrahim = clients.find((client) => client.key === '0500000010')
    expect(ibrahim?.orderCount).toBe(0)
    expect(ibrahim?.hasCard).toBe(true)
  })
})

/* -------------------------------------------------------------------- Stock */

describe('stock et fournisseurs', () => {
  it('archive un article sans toucher à sa quantité', async () => {
    etat.reponses = [{ data: null, error: null }]

    await setStockItemActive('tenant-1', 'article-1', false)

    expect(etat.appels[0]).toMatchObject({
      table: 'stock_items',
      action: 'update',
      payload: { is_active: false },
    })
  })

  it('supprime un article inutilisé et traduit le refus de suppression', async () => {
    etat.reponses = [{ data: null, error: null }]
    await deleteStockItem('tenant-1', 'article-1')
    expect(etat.appels[0].action).toBe('delete')

    etat.appels = []
    etat.reponses = [
      {
        data: null,
        error: { message: 'Cet article a des mouvements : archivez-le au lieu de le supprimer.' },
      },
    ]
    await expect(deleteStockItem('tenant-1', 'article-1')).rejects.toThrow(
      'Cet article a déjà des mouvements : archivez-le au lieu de le supprimer.',
    )
  })

  it('modifie un fournisseur et le désactive', async () => {
    etat.reponses = [{ data: { id: 'fournisseur-1' }, error: null }]
    await updateSupplier('tenant-1', 'fournisseur-1', {
      name: ' Sotici ',
      phone: '',
      notes: ' Livraison le mardi ',
    })

    expect(etat.appels[0].payload).toEqual({
      name: 'Sotici',
      phone: null,
      notes: 'Livraison le mardi',
    })

    etat.appels = []
    etat.reponses = [{ data: { id: 'fournisseur-1' }, error: null }]
    await updateSupplier('tenant-1', 'fournisseur-1', { is_active: false })
    expect(etat.appels[0].payload).toEqual({ is_active: false })
  })

  it('refuse une suppression de fournisseur utilisé avec un message actionnable', async () => {
    etat.reponses = [
      {
        data: null,
        error: { message: 'Ce fournisseur est utilisé : désactivez-le au lieu de le supprimer.' },
      },
    ]

    await expect(deleteSupplier('tenant-1', 'fournisseur-1')).rejects.toThrow(
      'Ce fournisseur est déjà utilisé : désactivez-le au lieu de le supprimer.',
    )
  })

  it('ne masque pas les autres erreurs de stock', () => {
    expect(stockErrorMessage('Stock insuffisant : 2 restants')).toContain('Stock insuffisant')
    expect(stockErrorMessage('Réseau introuvable')).toBe('Réseau introuvable')
  })
})

/* ----------------------------------------------------------------- Dépenses */

describe('dépenses', () => {
  it('met à jour une dépense en envoyant seulement les champs modifiés', async () => {
    etat.reponses = [{ data: { id: 'depense-1' }, error: null }]

    await updateExpense('tenant-1', 'depense-1', { amount: 12_500, note: '  ' })

    expect(etat.appels[0]).toMatchObject({
      table: 'expenses',
      action: 'update',
      payload: { amount: 12_500, note: null },
      filtres: [
        ['tenant_id', 'tenant-1'],
        ['id', 'depense-1'],
      ],
    })
  })

  it('refuse un montant nul ou décimal avant l’écriture', async () => {
    await expect(updateExpense('tenant-1', 'depense-1', { amount: 0 })).rejects.toThrow(
      'Indiquez un montant entier positif, en FCFA.',
    )
    await expect(updateExpense('tenant-1', 'depense-1', { amount: 1.5 })).rejects.toThrow(
      'Indiquez un montant entier positif, en FCFA.',
    )
    expect(etat.appels).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------- Équipe */

describe('équipe du pressing', () => {
  it('lit l’annuaire par la fonction serveur, e-mails compris', async () => {
    etat.reponsesRpc = [
      {
        data: [
          { user_id: 'u-2', email: 'atelier@exemple.ci', role: 'artisan', display_name: null, created_at: '' },
          { user_id: 'u-1', email: 'owner@exemple.ci', role: 'owner', display_name: 'Patron', created_at: '' },
        ],
        error: null,
      },
    ]

    const membres = await fetchTeamMembers('tenant-1')

    expect(etat.rpc[0].nom).toBe('tenant_team')
    expect(membres.map((membre) => membre.role)).toEqual(['owner', 'artisan'])
    expect(membres[1].email).toBe('atelier@exemple.ci')
  })

  it('retombe sur tenant_users quand la migration n’est pas encore appliquée', async () => {
    etat.reponsesRpc = [{ data: null, error: { message: 'function tenant_team() does not exist' } }]
    etat.reponses = [
      { data: [{ user_id: 'u-1', role: 'owner', display_name: null }], error: null },
    ]

    const membres = await fetchTeamMembers('tenant-1')

    expect(membres).toHaveLength(1)
    expect(membres[0].email).toBeNull()
    expect(etat.appels[0].table).toBe('tenant_users')
  })

  it('délègue le rattachement, la modification et le retrait aux fonctions serveur', async () => {
    await addTeamMemberByEmail({
      email: ' collegue@exemple.ci ',
      role: 'receptionist',
      displayName: 'Awa',
    })
    await updateTeamMember({ userId: 'u-2', role: 'artisan', displayName: 'Atelier' })
    await removeTeamMember('u-2')

    expect(etat.rpc).toEqual([
      {
        nom: 'tenant_attach_member_by_email',
        args: { p_email: 'collegue@exemple.ci', p_role: 'receptionist', p_display_name: 'Awa' },
      },
      {
        nom: 'tenant_set_member',
        args: { p_user: 'u-2', p_role: 'artisan', p_display_name: 'Atelier' },
      },
      { nom: 'tenant_remove_member', args: { p_user: 'u-2' } },
    ])
  })

  it('refuse un e-mail vide ou mal formé avant l’appel', async () => {
    await expect(
      addTeamMemberByEmail({ email: 'pas-un-email', role: 'artisan' }),
    ).rejects.toThrow('Indiquez l’adresse e-mail du collègue.')
    expect(etat.rpc).toHaveLength(0)
  })

  it('traduit la protection du dernier propriétaire', async () => {
    etat.reponsesRpc = [
      {
        data: null,
        error: { message: 'Impossible de détacher le dernier propriétaire du pressing.' },
      },
    ]

    await expect(removeTeamMember('u-1')).rejects.toThrow(
      'Impossible de retirer le dernier propriétaire du pressing.',
    )
  })
})

/* ------------------------------------------------------------------ Support */

describe('support côté pressing', () => {
  it('appelle les fonctions de clôture et de retrait', async () => {
    await closeSupportRequest('demande-1')
    await deleteSupportRequest('demande-2')

    expect(etat.rpc).toEqual([
      { nom: 'tenant_close_support_request', args: { p_id: 'demande-1' } },
      { nom: 'tenant_delete_support_request', args: { p_id: 'demande-2' } },
    ])
  })

  it('remonte le refus serveur d’une demande déjà traitée', async () => {
    etat.reponsesRpc = [
      {
        data: null,
        error: { message: 'Une demande déjà traitée ne peut pas être retirée.' },
      },
    ]

    await expect(deleteSupportRequest('demande-1')).rejects.toThrow(
      'Une demande déjà traitée ne peut pas être retirée.',
    )
  })
})

/* ------------------------------------------------- Suppression de commande */

describe('suppression de commande', () => {
  it('isole le refus métier renvoyé par le déclencheur', () => {
    expect(
      orderDeletionErrorMessage(
        'Cette commande a des encaissements : annulez-la au lieu de la supprimer.',
      ),
    ).toBe('Cette commande a des encaissements : annulez-la au lieu de la supprimer.')
  })

  it('traduit une cascade financière accompagnée de son détail PostgREST', () => {
    expect(
      orderDeletionErrorMessage(
        'update or delete on table "orders" violates foreign key constraint\n' +
          'DETAIL: Cette commande a des remboursements : annulez-la au lieu de la supprimer.',
      ),
    ).toBe('Cette commande a des remboursements : annulez-la au lieu de la supprimer.')
  })

  it('explique un refus de rôle et conserve les autres erreurs techniques', () => {
    expect(
      orderDeletionErrorMessage('new row violates row-level security policy for table "orders"'),
    ).toBe('Votre rôle ne permet pas de supprimer cette commande.')
    expect(orderDeletionErrorMessage('JWT expired')).toBe(
      'Suppression serveur impossible : JWT expired',
    )
  })
})
