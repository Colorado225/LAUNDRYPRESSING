import { deleteIssueLocal, updateIssueLocal } from '@/db/issueRepository'
import type { LocalOrderIssue } from '@/db/localDb'
import { isSupabaseConfigured } from '@/lib/env'
import { nowIso } from '@/lib/ids'
import { getSupabaseClient } from '@/lib/supabaseClient'

/**
 * Réclamations : clôture et suppression (palier 2, complété par la migration 025
 * côté lecture des politiques existantes).
 *
 * Une réclamation naît hors ligne, dans la file de synchronisation. Tant qu'elle
 * n'a pas été envoyée, elle ne peut pas être clôturée : le serveur ne la connaît
 * pas encore et la décision serait perdue au prochain envoi. Une fois envoyée,
 * la clôture est une écriture **en ligne** (la RLS réserve l'update au comptoir)
 * et la suppression au propriétaire.
 */

export type IssueResolution = NonNullable<LocalOrderIssue['resolution']>

export const ISSUE_RESOLUTIONS: Array<{ value: IssueResolution; label: string }> = [
  { value: 'repaired', label: 'Réparé' },
  { value: 'compensated', label: 'Dédommagé' },
  { value: 'rejected', label: 'Sans suite' },
]

export function issueErrorMessage(message: string): string {
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return 'Réseau indisponible : la clôture d’une réclamation nécessite une connexion.'
  }
  if (message.includes('row-level security') || message.includes('42501')) {
    return 'Votre rôle ne permet pas de modifier cette réclamation.'
  }
  return message
}

function requireClient() {
  if (!isSupabaseConfigured) {
    throw new Error('La gestion des réclamations nécessite une connexion.')
  }
  return getSupabaseClient()
}

/**
 * Clôture (ou rouvre) une réclamation avec une résolution.
 *
 * `resolution = null` rouvre le dossier : la note est alors effacée, comme le
 * fait le déclencheur `stamp_issue_resolution` qui remet `resolved_at` à NULL.
 */
export async function resolveOrderIssue(
  issue: LocalOrderIssue,
  resolution: IssueResolution | null,
  note: string | null,
): Promise<void> {
  const notePropre = note?.trim() ? note.trim() : null

  if (!isSupabaseConfigured) {
    // Mode démonstration : décision locale, aucune donnée distante.
    await updateIssueLocal(issue.id, {
      resolution,
      resolutionNote: resolution ? notePropre : null,
      resolvedAt: resolution ? nowIso() : null,
    })
    return
  }

  if (issue.synced === 0) {
    throw new Error(
      'Cette réclamation est encore en attente d’envoi. Elle pourra être clôturée après la prochaine synchronisation.',
    )
  }

  if (!navigator.onLine) {
    throw new Error('La clôture d’une réclamation nécessite une connexion.')
  }

  const { data, error } = await requireClient()
    .from('order_issues')
    .update({
      resolution,
      resolution_note: resolution ? notePropre : null,
    })
    .eq('tenant_id', issue.tenantId)
    .eq('id', issue.id)
    .select('resolved_at')
    .maybeSingle()

  if (error) throw new Error(issueErrorMessage(error.message))
  if (!data) throw new Error('Réclamation introuvable ou non modifiable.')

  await updateIssueLocal(issue.id, {
    resolution,
    resolutionNote: resolution ? notePropre : null,
    resolvedAt: data.resolved_at ?? (resolution ? nowIso() : null),
  })
}

/**
 * Supprime une réclamation (propriétaire). Non envoyée, elle disparaît de la
 * file locale ; envoyée, elle est effacée côté serveur d'abord.
 */
export async function deleteOrderIssue(issue: LocalOrderIssue): Promise<void> {
  if (isSupabaseConfigured && issue.synced === 1) {
    if (!navigator.onLine) {
      throw new Error('La suppression d’une réclamation envoyée nécessite une connexion.')
    }

    const { error } = await requireClient()
      .from('order_issues')
      .delete()
      .eq('tenant_id', issue.tenantId)
      .eq('id', issue.id)

    if (error) throw new Error(issueErrorMessage(error.message))
  }

  await deleteIssueLocal(issue.id)
}
