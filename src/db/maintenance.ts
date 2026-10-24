import { db } from '@/db/localDb'
import { estPurgeable } from '@/lib/parametres'

/**
 * Entretien des données locales (écran Paramètres).
 *
 * Une tablette de comptoir accumule des mois de commandes dans IndexedDB. Cet
 * écran permet de **voir** ce qui est stocké, d'**exporter** une sauvegarde
 * lisible, et de **purger** ce qui est déjà au serveur.
 *
 * Règle non négociable : rien n'est effacé qui n'existe pas déjà côté serveur.
 * Une commande en attente de synchronisation, ou en conflit, est conservée.
 */

export interface ResumeLocal {
  commandes: number
  /** Commandes jamais envoyées au serveur. */
  enAttente: number
  /** Commandes dont le serveur a refusé la version locale. */
  enConflit: number
  /** Commandes effaçables sans perte. */
  purgeables: number
  lignes: number
  encaissements: number
  /** Espace occupé par l'origine entière, `null` si le navigateur ne le donne pas. */
  octets: number | null
}

/** Photographie du cache local, pour la page Paramètres. */
export async function resumerDonneesLocales(tenantId: string | null): Promise<ResumeLocal> {
  const toutes = await db.orders.toArray()
  const commandes = tenantId ? toutes.filter((commande) => commande.tenantId === tenantId) : toutes
  const ids = new Set(commandes.map((commande) => commande.id))

  const [lignesToutes, encaissementsTous] = await Promise.all([
    db.orderItems.toArray(),
    db.cashPayments.toArray(),
  ])

  let octets: number | null = null
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const estimation = await navigator.storage.estimate()
      octets = estimation.usage ?? null
    }
  } catch {
    octets = null
  }

  return {
    commandes: commandes.length,
    enAttente: commandes.filter((commande) => commande.synced === 0).length,
    enConflit: commandes.filter((commande) => commande.syncConflict !== null).length,
    purgeables: commandes.filter(estPurgeable).length,
    lignes: lignesToutes.filter((ligne) => ids.has(ligne.orderId)).length,
    encaissements: encaissementsTous.filter((paiement) => ids.has(paiement.orderId)).length,
    octets,
  }
}

export interface ExportLocal {
  version: 1
  genereLe: string
  tenantId: string | null
  commandes: unknown[]
  lignes: unknown[]
  encaissements: unknown[]
  anomalies: unknown[]
  remboursements: unknown[]
}

/**
 * Sauvegarde complète du cache local, prête à être téléchargée.
 *
 * Format volontairement **lisible** (JSON indenté) plutôt que binaire : en cas
 * de panne, un pressing doit pouvoir ouvrir le fichier avec un tableur ou le
 * transmettre au support. Aucune donnée n'est transformée ni anonymisée.
 */
export async function exporterDonneesLocales(tenantId: string | null): Promise<ExportLocal> {
  const commandes = (await db.orders.toArray()).filter(
    (commande) => !tenantId || commande.tenantId === tenantId,
  )
  const ids = new Set(commandes.map((commande) => commande.id))

  const [lignes, encaissements, anomalies, remboursements] = await Promise.all([
    db.orderItems.toArray(),
    db.cashPayments.toArray(),
    db.orderIssues.toArray(),
    db.refunds.toArray(),
  ])

  return {
    version: 1,
    genereLe: new Date().toISOString(),
    tenantId,
    commandes,
    lignes: lignes.filter((ligne) => ids.has(ligne.orderId)),
    encaissements: encaissements.filter((paiement) => ids.has(paiement.orderId)),
    anomalies: anomalies.filter((anomalie) => ids.has(anomalie.orderId)),
    remboursements: remboursements.filter((remboursement) => ids.has(remboursement.orderId)),
  }
}

/**
 * Efface les commandes synchronisées et leurs dépendances locales.
 *
 * Les commandes en attente et en conflit sont épargnées : elles ne sont
 * récupérables nulle part ailleurs.
 */
export async function purgerCommandesSynchronisees(tenantId: string | null): Promise<number> {
  const commandes = (await db.orders.toArray()).filter(
    (commande) => (!tenantId || commande.tenantId === tenantId) && estPurgeable(commande),
  )
  if (commandes.length === 0) return 0

  const ids = new Set(commandes.map((commande) => commande.id))

  await db.transaction(
    'rw',
    [db.orders, db.orderItems, db.cashPayments, db.orderIssues, db.refunds],
    async () => {
      await db.orderItems.where('orderId').anyOf([...ids]).delete()
      await db.cashPayments.where('orderId').anyOf([...ids]).delete()
      await db.orderIssues.where('orderId').anyOf([...ids]).delete()
      await db.refunds.where('orderId').anyOf([...ids]).delete()
      await db.orders.bulkDelete([...ids])
    },
  )

  return commandes.length
}
