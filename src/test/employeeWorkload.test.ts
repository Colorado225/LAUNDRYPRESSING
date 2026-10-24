import { describe, expect, it } from 'vitest'
import type { LocalOrder } from '@/db/localDb'
import { computeEmployeeWorkload } from '@/lib/employeeWorkload'
import { computeRapport, rapportCsv } from '@/lib/reporting'
import type { TeamMember } from '@/services/tenantMembers'

const membres: TeamMember[] = [
  { userId: 'employee-1', role: 'artisan', displayName: 'Aminata' },
  { userId: 'employee-2', role: 'receptionist', displayName: null },
]

function commande(partial: Partial<LocalOrder> & Pick<LocalOrder, 'id'>): LocalOrder {
  return {
    tenantId: 'tenant-a',
    customerName: 'Client test',
    customerPhone: '0700000000',
    status: 'received',
    qrCode: `CMD-${partial.id}`,
    photoUrl: null,
    totalAmount: 5000,
    paymentStatus: 'pending',
    paymentMethod: null,
    createdAt: '2026-05-20T09:00:00.000Z',
    updatedAt: '2026-05-20T09:00:00.000Z',
    synced: 1,
    syncedAt: '2026-05-20T09:00:00.000Z',
    serverVersion: 1,
    syncError: null,
    syncConflict: null,
    dueDate: null,
    assignedTo: null,
    assignedAt: null,
    statusReason: null,
    ...partial,
  }
}

const options = {
  start: '2026-05-01',
  end: '2026-05-31',
  today: '2026-05-30',
  currentUserId: 'employee-1',
}

describe('rapport de charge de l’équipe', () => {
  it('agrège la charge ouverte, les retards et les commandes de la période sans compter les annulations', () => {
    const orders = [
      commande({ id: 'a', assignedTo: 'employee-1', status: 'washing', dueDate: '2026-05-29' }),
      commande({ id: 'b', assignedTo: 'employee-1', status: 'delivered', createdAt: '2026-05-02T10:00:00.000Z' }),
      commande({ id: 'c', assignedTo: 'employee-2', status: 'ready', createdAt: '2026-04-30T10:00:00.000Z', dueDate: '2026-05-30' }),
      commande({ id: 'd', assignedTo: null, status: 'received' }),
      commande({ id: 'e', assignedTo: 'removed-member', status: 'quality_check', dueDate: '2026-05-01' }),
      commande({ id: 'f', assignedTo: 'employee-1', status: 'cancelled' }),
    ]

    const report = computeEmployeeWorkload(orders, membres, options)
    const aminata = report.rows.find((row) => row.member?.userId === 'employee-1')
    const reception = report.rows.find((row) => row.member?.userId === 'employee-2')
    const unknown = report.rows.find((row) => row.label === 'Membre absent de l’équipe')
    const unassigned = report.rows.find((row) => row.label === 'Sans attribution')

    expect(aminata).toMatchObject({
      label: 'Aminata (moi)',
      activeOrders: 1,
      overdueOrders: 1,
      receivedInPeriod: 2,
      deliveredFromPeriod: 1,
    })
    expect(reception).toMatchObject({ activeOrders: 1, overdueOrders: 0, receivedInPeriod: 0 })
    expect(unknown).toMatchObject({ activeOrders: 1, overdueOrders: 1, receivedInPeriod: 1 })
    expect(unknown?.label).not.toContain('removed-member')
    expect(unassigned).toMatchObject({ activeOrders: 1, receivedInPeriod: 1 })
    expect(report).toMatchObject({
      activeOrders: 4,
      overdueOrders: 2,
      unassignedActiveOrders: 1,
      receivedInPeriod: 3,
    })
  })

  it('garde les commandes attribuées visibles quand la liste équipe est indisponible, sans exposer les UUID', () => {
    const report = computeEmployeeWorkload(
      [commande({ id: 'a', assignedTo: 'private-user-id', status: 'ironing' })],
      [],
      options,
    )

    expect(report.rows[0]).toMatchObject({
      label: 'Membre attribué non identifié',
      activeOrders: 1,
    })
    expect(report.rows[0]?.label).not.toContain('private-user-id')
  })

  it('ajoute les indicateurs équipe au CSV et protège les noms traités comme formules', () => {
    const report = computeRapport([], [], [], { jours: 7, aujourdhui: options.today })
    const csv = rapportCsv(report, [{
      employee: '=IMPORTDATA("secret")',
      activeOrders: 3,
      overdueOrders: 1,
      receivedInPeriod: 4,
      deliveredFromPeriod: 2,
    }])

    expect(csv).toContain('Charge et activité de l’équipe')
    expect(csv).toContain("'=IMPORTDATA(")
    expect(csv).toContain('3;1;4;2')
  })
})
