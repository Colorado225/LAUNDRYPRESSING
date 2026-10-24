import { ACTIVE_ORDER_STATUSES, isOrderLate } from '@/constants/orders'
import type { LocalOrder } from '@/db/localDb'
import { memberLabel, type TeamMember } from '@/services/tenantMembers'

export interface EmployeeWorkloadRow {
  /** Null identifie le groupe de commandes non attribuées. */
  member: TeamMember | null
  label: string
  activeOrders: number
  overdueOrders: number
  receivedInPeriod: number
  deliveredFromPeriod: number
}

export interface EmployeeWorkloadReport {
  rows: EmployeeWorkloadRow[]
  activeOrders: number
  overdueOrders: number
  unassignedActiveOrders: number
  receivedInPeriod: number
}

/**
 * Agrège les commandes connues localement par attribution actuelle.
 *
 * Les données historiques d'attribution ne sont pas conservées par le modèle
 * actuel : les indicateurs de période décrivent donc le statut et l'employé
 * auxquels la commande est rattachée aujourd'hui, et non son historique complet.
 */
export function computeEmployeeWorkload(
  orders: LocalOrder[],
  members: TeamMember[],
  options: {
    start: string
    end: string
    today: string
    currentUserId: string | null
  },
): EmployeeWorkloadReport {
  const membreParId = new Map(members.map((member) => [member.userId, member]))
  const commandesValides = orders.filter((order) => order.status !== 'cancelled')
  const dansLaPeriode = (order: LocalOrder) => {
    const date = order.createdAt.slice(0, 10)
    return date >= options.start && date <= options.end
  }

  const agreger = (
    member: TeamMember | null,
    label: string,
    appartient: (order: LocalOrder) => boolean,
  ): EmployeeWorkloadRow => {
    const attribuees = commandesValides.filter(appartient)
    const actives = attribuees.filter((order) => ACTIVE_ORDER_STATUSES.includes(order.status))
    const creeesPendantLaPeriode = attribuees.filter(dansLaPeriode)
    return {
      member,
      label,
      activeOrders: actives.length,
      overdueOrders: actives.filter((order) => isOrderLate(order, options.today)).length,
      receivedInPeriod: creeesPendantLaPeriode.length,
      deliveredFromPeriod: creeesPendantLaPeriode.filter((order) => order.status === 'delivered').length,
    }
  }

  const rows = members.map((member) =>
    agreger(
      member,
      memberLabel(member, options.currentUserId),
      (order) => order.assignedTo === member.userId,
    ),
  )

  // Une adhésion révoquée ou une liste d'équipe indisponible ne doit pas faire
  // disparaître silencieusement des commandes attribuées ni révéler un UUID.
  const hasUnknownAssignment = commandesValides.some(
    (order) => order.assignedTo !== null && !membreParId.has(order.assignedTo),
  )
  if (hasUnknownAssignment) {
    rows.push(agreger(
      null,
      members.length === 0 ? 'Membre attribué non identifié' : 'Membre absent de l’équipe',
      (order) => order.assignedTo !== null && !membreParId.has(order.assignedTo),
    ))
  }

  rows.push(agreger(null, 'Sans attribution', (order) => order.assignedTo === null))

  const activeOrders = commandesValides.filter((order) =>
    order.assignedTo !== null && ACTIVE_ORDER_STATUSES.includes(order.status),
  )
  const unassignedActiveOrders = commandesValides.filter((order) =>
    order.assignedTo === null && ACTIVE_ORDER_STATUSES.includes(order.status),
  ).length
  const receivedInPeriod = commandesValides.filter((order) =>
    order.assignedTo !== null && dansLaPeriode(order),
  ).length

  return {
    rows,
    activeOrders: activeOrders.length + unassignedActiveOrders,
    overdueOrders: commandesValides.filter((order) =>
      ACTIVE_ORDER_STATUSES.includes(order.status) && isOrderLate(order, options.today),
    ).length,
    unassignedActiveOrders,
    receivedInPeriod,
  }
}
