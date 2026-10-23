import { newId, nowIso } from '@/lib/ids'
import { db, type LocalOrderIssue, type SyncFlag } from './localDb'

/**
 * Dépôt des réclamations et constats de vêtements abîmés (palier 2).
 *
 * Une réclamation est écrite en local avant tout réseau : elle est constatée
 * devant le client, souvent sans couverture. Elle est ensuite transmise par le
 * moteur de synchronisation. Contrairement à une commande, une réclamation est
 * **immuable** une fois envoyée : on ne l'écrase pas, on la clôture côté
 * serveur.
 */

export interface NewIssueInput {
  orderItemId?: string | null
  kind: LocalOrderIssue['kind']
  severity: LocalOrderIssue['severity']
  stage: LocalOrderIssue['stage']
  description: string
}

export async function queueOrderIssue(
  tenantId: string,
  orderId: string,
  input: NewIssueInput,
): Promise<LocalOrderIssue> {
  const issue: LocalOrderIssue = {
    id: newId(),
    orderId,
    tenantId,
    orderItemId: input.orderItemId ?? null,
    kind: input.kind,
    severity: input.severity,
    stage: input.stage,
    description: input.description.trim(),
    resolution: null,
    resolutionNote: null,
    resolvedAt: null,
    reportedBy: null,
    createdAt: nowIso(),
    synced: 0,
    lastError: null,
  }

  await db.orderIssues.add(issue)
  return issue
}

export async function getPendingOrderIssues(tenantId: string): Promise<LocalOrderIssue[]> {
  return db.orderIssues.where('[tenantId+synced]').equals([tenantId, 0]).sortBy('createdAt')
}

export async function markIssueSynced(issueId: string): Promise<void> {
  await db.orderIssues.update(issueId, { synced: 1 satisfies SyncFlag, lastError: null })
}

/**
 * Mémorise un refus du serveur.
 *
 * `definitive` vaut `true` quand la réclamation ne passera jamais (rôle
 * insuffisant, description refusée) : elle sort de la file mais reste visible
 * avec son motif, sinon elle serait renvoyée toutes les minutes.
 */
export async function markIssueError(
  issueId: string,
  message: string,
  definitive: boolean,
): Promise<void> {
  await db.orderIssues.update(issueId, {
    lastError: message,
    ...(definitive ? { synced: 1 satisfies SyncFlag } : {}),
  })
}

/** Nombre de réclamations en attente (badge du bandeau de synchronisation). */
export async function countPendingIssues(tenantId: string): Promise<number> {
  return db.orderIssues.where('[tenantId+synced]').equals([tenantId, 0]).count()
}
