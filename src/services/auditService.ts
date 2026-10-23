import { getSupabaseClient } from '@/lib/supabaseClient'
import { isSupabaseConfigured } from '@/lib/env'
import { decouperPageCurseur, filtreCurseur, type Curseur } from '@/lib/pagination'
import { formatFcfa } from '@/lib/formatters'
import type { AuditLogRow } from '@/types/database'

/**
 * Journal d'audit (migration 009).
 *
 * La base n'écrit que des **codes** (`tenant_users.update`), jamais des phrases :
 * le libellé français vit ici, où il peut être corrigé sans migration. Ce
 * fichier est donc la seule source des textes affichés — l'écran ne compose pas
 * de phrase lui-même, ce qui garantit qu'un même événement se lit partout pareil.
 *
 * Aucune fonction d'écriture n'est exposée, volontairement : le journal est
 * alimenté par des déclencheurs serveur. Un journal dans lequel l'application
 * pourrait écrire ne prouverait rien.
 */

/** Familles proposées au filtre de l'écran. */
export type FamilleAudit = 'pressing' | 'comptes' | 'tarifs' | 'caisse' | 'depenses' | 'abonnement'

export const FAMILLES_AUDIT: { valeur: FamilleAudit; label: string; tables: string[] }[] = [
  { valeur: 'pressing', label: 'Pressing', tables: ['tenants'] },
  { valeur: 'comptes', label: 'Comptes et rôles', tables: ['tenant_users'] },
  { valeur: 'tarifs', label: 'Prestations', tables: ['catalog_entries'] },
  { valeur: 'caisse', label: 'Caisse', tables: ['cash_sessions', 'payment_refunds'] },
  { valeur: 'depenses', label: 'Dépenses', tables: ['expenses'] },
  { valeur: 'abonnement', label: 'Abonnement', tables: ['subscriptions'] },
]

/** Libellé d'une action, par code `<table>.<opération>`. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'tenants.insert': 'Pressing créé',
  'tenants.update': 'Informations du pressing modifiées',
  'tenant_users.insert': 'Compte rattaché au pressing',
  'tenant_users.update': 'Rôle d’un compte modifié',
  'tenant_users.delete': 'Compte détaché du pressing',
  'catalog_entries.insert': 'Prestation ajoutée',
  'catalog_entries.update': 'Prestation ou tarif modifié',
  'catalog_entries.delete': 'Prestation supprimée',
  'cash_sessions.insert': 'Caisse clôturée',
  'cash_sessions.update': 'Clôture de caisse corrigée',
  'payment_refunds.insert': 'Remboursement enregistré',
  'payment_refunds.update': 'Remboursement modifié',
  'expenses.insert': 'Dépense enregistrée',
  'expenses.update': 'Dépense modifiée',
  'expenses.delete': 'Dépense supprimée',
  'subscriptions.insert': 'Abonnement ouvert',
  'subscriptions.update': 'Abonnement modifié',
}

/** Rôle lisible : les codes serveur ne sont pas des mots français. */
const ROLE_LABELS: Record<string, string> = {
  owner: 'propriétaire',
  receptionist: 'réceptionniste',
  artisan: 'artisan',
}

/**
 * Libellé d'une colonne modifiée.
 *
 * Les colonnes absentes de cette table sont ignorées à l'affichage : mieux vaut
 * une phrase incomplète qu'un `unit_cost` affiché tel quel au gérant.
 */
const CHAMP_LABELS: Record<string, string> = {
  name: 'nom',
  phone: 'téléphone',
  article: 'article',
  service: 'prestation',
  price: 'tarif',
  price_fcfa: 'tarif',
  role: 'rôle',
  display_name: 'nom affiché',
  status: 'statut',
  plan_code: 'formule',
  current_period_end: 'fin de période',
  trial_ends_on: 'fin de l’essai',
  suspended_reason: 'motif de suspension',
  amount: 'montant',
  reason: 'motif',
  channel: 'moyen',
  label: 'libellé',
  category: 'catégorie',
  spent_on: 'date',
  note: 'note',
  business_date: 'journée',
  expected_total: 'montant attendu',
  declared_total: 'montant déclaré',
  difference: 'écart',
  refunded_total: 'remboursements',
}

/** Colonnes qui portent un montant en FCFA. */
const CHAMPS_MONTANT = new Set([
  'price',
  'price_fcfa',
  'amount',
  'expected_total',
  'declared_total',
  'difference',
  'refunded_total',
])

export function libelleAction(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? 'Action enregistrée'
}

export function libelleFamille(famille: FamilleAudit): string {
  return FAMILLES_AUDIT.find((entree) => entree.valeur === famille)?.label ?? 'Toutes'
}

/**
 * Met en forme une valeur de détail.
 *
 * `null` est rendu par un tiret plutôt que par le texte « null », et les
 * montants passent par `formatFcfa` : le journal doit se lire sans connaître la
 * structure de la base.
 */
export function formaterValeur(champ: string, valeur: unknown): string {
  if (valeur === null || valeur === undefined) return '—'
  if (typeof valeur === 'number' && CHAMPS_MONTANT.has(champ)) return formatFcfa(valeur)
  if (typeof valeur === 'string') {
    if (ROLE_LABELS[valeur]) return ROLE_LABELS[valeur]
    if (CHAMPS_MONTANT.has(champ) && /^-?\d+$/.test(valeur)) return formatFcfa(Number(valeur))
    if (/^\d{4}-\d{2}-\d{2}$/.test(valeur)) {
      const [annee, mois, jour] = valeur.split('-')
      return `${jour}/${mois}/${annee}`
    }
    return valeur
  }
  if (typeof valeur === 'boolean') return valeur ? 'oui' : 'non'
  return JSON.stringify(valeur)
}

/**
 * Détail lisible d'une ligne de journal.
 *
 * Retourne une phrase courte par colonne modifiée :
 *   création  → « tarif : 1 500 FCFA »
 *   modification → « tarif : 1 500 FCFA → 2 000 FCFA »
 *   suppression → « 12 ligne(s) » n'a pas de sens ici, la ligne entière est
 *                 décrite par `details` rempli à la suppression côté serveur.
 */
export function decrireDetails(ligne: Pick<AuditLogRow, 'details'>): string[] {
  const details = ligne.details ?? {}
  const phrases: string[] = []

  for (const [champ, changement] of Object.entries(details)) {
    const libelle = CHAMP_LABELS[champ]
    // Colonne inconnue : on la tait plutôt que d'afficher un nom technique.
    if (!libelle) continue

    // Création : la valeur est brute (`{ role: "artisan" }`). Modification :
    // c'est une paire (`{ avant, apres }`). On distingue les deux par la
    // présence des clés, pas par le type — une valeur jsonb est aussi un objet.
    const estPaire =
      changement !== null &&
      typeof changement === 'object' &&
      ('avant' in changement || 'apres' in changement)

    if (!estPaire) {
      phrases.push(`${libelle} : ${formaterValeur(champ, changement)}`)
      continue
    }

    const { avant, apres } = changement as { avant?: unknown; apres?: unknown }

    // Un changement de tarif se lit mieux avec la flèche qu'avec deux phrases.
    phrases.push(
      `${libelle} : ${formaterValeur(champ, avant)} → ${formaterValeur(champ, apres)}`,
    )
  }

  return phrases
}

/** Auteur affichable : le compte, ou « serveur » quand aucune session n'a agi. */
export function libelleAuteur(
  ligne: Pick<AuditLogRow, 'actor_email' | 'actor_role'>,
): { nom: string; role: string | null } {
  if (!ligne.actor_email) {
    return { nom: 'Serveur', role: null }
  }
  const role = ligne.actor_role ? (ROLE_LABELS[ligne.actor_role] ?? ligne.actor_role) : null
  return { nom: ligne.actor_email, role }
}

/** Taille d'une page du journal : une journée chargée tient en deux écrans. */
export const TAILLE_PAGE_AUDIT = 30

export interface PageAudit {
  lignes: AuditLogRow[]
  curseur: Curseur | null
  aPlus: boolean
}

function requireClient() {
  if (!isSupabaseConfigured) {
    throw new Error('Le journal d’audit nécessite une connexion.')
  }
  return getSupabaseClient()
}

/**
 * Une page du journal, du plus récent au plus ancien.
 *
 * Pagination par curseur, comme les dépenses : le journal ne fait que grossir,
 * et un `offset` ferait réapparaître une ligne déjà lue dès qu'un événement
 * s'ajoute entre deux pages.
 */
export async function listAuditPage(
  tenantId: string,
  options: { curseur?: Curseur | null; limite?: number; famille?: FamilleAudit | null } = {},
): Promise<PageAudit> {
  const limite = Math.max(1, Math.floor(options.limite ?? TAILLE_PAGE_AUDIT))

  let requete = requireClient()
    .from('audit_log')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limite + 1)

  if (options.famille) {
    const tables = FAMILLES_AUDIT.find((entree) => entree.valeur === options.famille)?.tables
    if (tables && tables.length > 0) {
      requete = requete.in('entity', tables)
    }
  }

  if (options.curseur) {
    requete = requete.or(filtreCurseur('created_at', options.curseur))
  }

  const { data, error } = await requete
  if (error) throw new Error(auditErrorMessage(error.message))

  return decouperPageCurseur((data ?? []) as AuditLogRow[], limite, (ligne) => ligne.created_at)
}

export function auditErrorMessage(message: string): string {
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return 'Réseau indisponible : le journal d’audit ne se lit pas hors ligne.'
  }
  if (message.includes('row-level security') || message.includes('permission denied')) {
    return 'Seul le propriétaire peut consulter le journal d’audit.'
  }
  return message
}
