import Dexie, { type Table } from 'dexie'
import type {
  CatalogApplicationScope,
  CatalogBillingUnit,
  CatalogPricingMode,
  CatalogServiceType,
  LaundryModelAudience,
  LaundryModelServiceMode,
  LaundryModelType,
  FamilyPackageSnapshot,
  OrderItemPriceStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  TenantActivityCode,
} from '@/types/database'

/**
 * Base locale (IndexedDB via Dexie) — socle du mode offline-first.
 *
 * Principes :
 *  - L'application écrit TOUJOURS en local d'abord, puis synchronise.
 *  - `synced` vaut 1 quand la ligne est identique à la version serveur.
 *    Il repasse à 0 à chaque modification locale (création OU changement de
 *    statut) : le moteur de synchronisation ré-envoie alors la ligne entière.
 *    Ce choix évite une file d'opérations séparée, au prix d'un `upsert`
 *    complet — acceptable pour des volumes de quelques dizaines de
 *    commandes par jour.
 *  - `synced` est un NOMBRE (0/1) et non un booléen : IndexedDB n'accepte pas
 *    les booléens comme clé d'index.
 */

export type SyncFlag = 0 | 1

/** Commande stockée localement (camelCase, aligné sur le frontend). */
export interface LocalOrder {
  id: string
  tenantId: string
  customerName: string
  customerPhone: string
  status: OrderStatus
  qrCode: string
  photoUrl: string | null
  totalAmount: number
  paymentStatus: PaymentStatus
  paymentMethod: PaymentMethod | null
  createdAt: string
  updatedAt: string
  synced: SyncFlag
  syncedAt: string | null
  /**
   * Version connue côté serveur (0 tant que la commande n'a jamais été
   * synchronisée). Sert de jeton au verrou optimiste : une mise à jour n'est
   * acceptée que si le serveur est toujours à cette version.
   */
  serverVersion: number
  /** Dernière erreur de synchronisation, affichée dans le bandeau d'état. */
  syncError: string | null
  /**
   * Renseigné quand le serveur a refusé une mise à jour parce que la commande
   * avait été modifiée ailleurs. La commande reste en file et n'est plus
   * renvoyée tant que l'utilisateur n'a pas choisi quelle version garder.
   */
  syncConflict: string | null
  /** Échéance promise au client (AAAA-MM-JJ), `null` si aucune. */
  dueDate: string | null
  /** Employé en charge, `null` tant que la commande n'est attribuée à personne. */
  assignedTo: string | null
  /** Date de la dernière attribution (ISO), `null` si aucune. */
  assignedAt: string | null
  /**
   * Motif d'un changement de statut (annulation, retour en arrière).
   * Transmis avec la commande puis effacé par le déclencheur serveur : il
   * appartient à l'événement, pas à l'état courant.
   */
  statusReason: string | null
}

/** Vêtement d'une commande. */
export interface LocalOrderItem {
  id: string
  orderId: string
  tenantId: string
  label: string
  fabricType: string | null
  specialInstructions: string | null
  /** Total de ligne facturé, figé en FCFA entiers. */
  price: number
  /** Quantité saisie et quantité facturée après minimum/incrément. */
  quantity: number
  billedQuantity: number
  billingUnit: CatalogBillingUnit
  unitPrice: number
  pricingMode: CatalogPricingMode
  priceStatus: OrderItemPriceStatus
  /** Métadonnées locales historiques ; les champs génériques restent disponibles sur la ligne serveur. */
  catalogEntryId: string | null
  articleName: string | null
  serviceName: string | null
  familyNameSnapshot: string | null
  catalogUnitPriceSnapshot: number | null
  minimumQuantitySnapshot: number | null
  billingIncrementSnapshot: number | null
  minimumChargeSnapshot: number | null
  conditionsSnapshot: string | null
  /** Motif d'une dérogation ou d'une ligne saisie librement. */
  priceReason: string | null
  laundryModelId?: string | null
  laundryModelNameSnapshot?: string | null
  laundryModelTypeSnapshot?: LaundryModelType | null
  laundryWeightKg?: number | null
  laundryPriceBreakdownSnapshot?: string | null
  laundryServicesSnapshot?: string | null
  laundryPricePerKgSnapshot?: number | null
  laundryPackagePriceSnapshot?: number | null
  laundryIncludedWeightKgSnapshot?: number | null
  laundryOveragePricePerKgSnapshot?: number | null
  laundryMinimumWeightKgSnapshot?: number | null
  laundryBillingIncrementKgSnapshot?: number | null
  laundryMinimumChargeSnapshot?: number | null
  /** Composition issue des anciennes données locales ; elle n’est plus envoyée au serveur. */
  familyPackageSnapshot?: FamilyPackageSnapshot | null
}

/** Prestation configurée pour un pressing (cache hors ligne du référentiel). */
export interface LocalTenantService {
  id: string
  tenantId: string
  activityCode: TenantActivityCode
  serviceName: string
  sortOrder: number
}

/**
 * Structure Dexie historique du catalogue.
 *
 * Conservée pour lire et migrer les données locales des versions précédentes.
 * Le catalogue n'est plus proposé par l'application courante ni synchronisé.
 */
export interface LocalCatalogEntry {
  id: string
  tenantId: string
  article: string
  service: string
  price: number
  pricingMode: CatalogPricingMode
  billingUnit: CatalogBillingUnit
  familyName: string | null
  minimumQuantity: number | null
  billingIncrement: number | null
  minimumCharge: number | null
  conditions: string | null
  requiresReview: boolean
  isActive: boolean
  /** Références article et prestation actives au dernier rafraîchissement. */
  referencesActive?: boolean
  sortOrder: number
}

/**
 * Schéma Dexie historique du catalogue.
 *
 * Gardé pour reconnaître les données créées par les versions précédentes et
 * éviter de supprimer les caches locaux lors d'une mise à jour. Il ne reflète
 * plus le schéma PostgreSQL courant et n'est plus synchronisé.
 */
export interface LocalCatalogStructureRow {
  id: string
  tenantId: string
  /** Discriminateur : une ligne est une catégorie, un article ou une prestation. */
  kind: 'family' | 'article' | 'service'
  name: string
  description: string | null
  /** Catégorie parente pour les articles. */
  familyId: string | null
  careInstructions: string | null
  defaultUnit: CatalogBillingUnit | null
  serviceType: CatalogServiceType | null
  applicationScope: CatalogApplicationScope | null
  isActive: boolean
  sortOrder: number
  updatedAt: string
}

/** Cache Dexie historique des modèles commerciaux, conservé pour compatibilité locale. */
export interface LocalLaundryModel {
  id: string
  tenantId: string
  name: string
  description: string | null
  modelType: LaundryModelType
  audience: LaundryModelAudience
  pricePerKg: number | null
  packagePrice: number | null
  includedWeightKg: number | null
  overagePricePerKg: number | null
  minimumWeightKg: number | null
  billingIncrementKg: number | null
  minimumCharge: number | null
  conditions: string | null
  exclusions: string | null
  pickupDeliveryTerms: string | null
  turnaroundDays: number | null
  isActive: boolean
  sortOrder: number
  familyPackageArticles?: Array<{ articleId: string; articleName: string; familyId: string; familyName: string; careInstructions: string | null }>
  includedPieces?: number | null
  overagePricePerPiece?: number | null
  familyPackageScope?: Array<{ familyId: string | null; articleId: string | null }>
  services: Array<{
    serviceId: string
    serviceName: string
    inclusionMode: LaundryModelServiceMode
    sortOrder: number
    serviceActive: boolean
  }>
}

/**
 * Encaissement au comptoir en attente d'envoi.
 *
 * L'identifiant est généré sur la tablette : c'est lui qui rend l'appel au
 * serveur idempotent. Un paiement encaissé hors ligne est visible
 * immédiatement dans le solde, puis transmis au retour du réseau.
 */
export interface LocalCashPayment {
  id: string
  orderId: string
  tenantId: string
  amount: number
  method: 'cash'
  note: string | null
  receivedAt: string
  synced: SyncFlag
  lastError: string | null
}

/** Réclamation ou vêtement abîmé constaté sur une commande. */
export interface LocalOrderIssue {
  id: string
  orderId: string
  tenantId: string
  /** Ligne concernée, `null` si le dommage porte sur la commande entière. */
  orderItemId: string | null
  kind: 'stained' | 'torn' | 'discoloured' | 'missing' | 'other'
  severity: 'minor' | 'major'
  stage: 'reception' | 'treatment' | 'delivery'
  description: string
  resolution: 'repaired' | 'compensated' | 'rejected' | null
  resolutionNote: string | null
  resolvedAt: string | null
  reportedBy: string | null
  createdAt: string
  synced: SyncFlag
  lastError: string | null
}

/**
 * Remboursement constaté localement.
 *
 * Un remboursement n'est jamais enregistré hors ligne : il sort de l'argent et
 * doit être validé par le serveur (propriétaire uniquement). Cette table est un
 * miroir local du journal distant, pour l'affichage et le reçu.
 */
export interface LocalRefund {
  id: string
  orderId: string
  tenantId: string
  amount: number
  channel: 'cash' | 'mobile_money'
  reason: string
  refundedAt: string
  refundedBy: string | null
}

/**
 * Client prévenu (WhatsApp ou appel), journalisé localement.
 *
 * L'envoi lui-même n'est pas technique : c'est un lien `wa.me` ouvert depuis la
 * tablette du comptoir. Cette ligne garde la trace de **qui** a été prévenu,
 * **quand** et **par quel motif**, ce qui permet de ne pas relancer deux fois
 * le même client et de savoir, en cas de contestation, ce qui lui a été dit.
 *
 * Comme une réclamation, la ligne est immuable : on ne la modifie pas, on en
 * écrit une nouvelle si la situation change.
 */
export interface LocalNotification {
  id: string
  tenantId: string
  /** Commande concernée, `null` pour un message hors commande. */
  orderId: string | null
  channel: 'whatsapp' | 'appel'
  reason: 'pret' | 'retard' | 'relance'
  customerName: string
  customerPhone: string
  /** Texte exact qui a été présenté au comptoir (et envoyé, pour WhatsApp). */
  message: string
  createdAt: string
  synced: SyncFlag
  lastError: string | null
}

/**
 * Paiement Mobile Money en attente d'envoi (utilisé en Phase 4).
 * Le store existe dès la Phase 2 pour éviter une migration de schéma Dexie.
 */
export interface LocalPendingPayment {
  id: string
  orderId: string
  tenantId: string
  amount: number
  /** Opérateur choisi sur le guichet CinetPay : inconnu au moment de l'initiation. */
  method: PaymentMethod | null
  /**
   * `pending` = guichet ouvert, en attente de la confirmation serveur.
   *
   * `simulated` = aucun guichet : CinetPay n'est pas encore installé, et le
   * paiement a été **simulé** pour éprouver le parcours. Cette ligne ne change
   * jamais le statut de la commande : rien n'a été encaissé, et le serveur
   * interdit de toute façon au client de modifier `payment_status`.
   */
  status: 'pending' | 'sending' | 'error' | 'simulated'
  /** Identifiant de transaction CinetPay (`transaction_id`). */
  reference: string | null
  createdAt: string
  lastError: string | null
}

export class PressingDatabase extends Dexie {
  orders!: Table<LocalOrder, string>
  orderItems!: Table<LocalOrderItem, string>
  pendingPayments!: Table<LocalPendingPayment, string>
  catalogEntries!: Table<LocalCatalogEntry, string>
  catalogStructure!: Table<LocalCatalogStructureRow, string>
  laundryModels!: Table<LocalLaundryModel, string>
  cashPayments!: Table<LocalCashPayment, string>
  orderIssues!: Table<LocalOrderIssue, string>
  refunds!: Table<LocalRefund, string>
  notifications!: Table<LocalNotification, string>
  tenantServices!: Table<LocalTenantService, string>

  constructor() {
    super('pressing-pro')

    this.version(1).stores({
      // Index composites : les requêtes de l'application filtrent toujours
      // par tenant AVANT de filtrer par statut ou par état de synchro.
      orders: 'id, tenantId, status, synced, createdAt, [tenantId+status], [tenantId+synced]',
      orderItems: 'id, orderId, tenantId, [orderId+tenantId]',
      pendingPayments: 'id, orderId, tenantId, status, createdAt',
    })

    // v2 (phase 3) : ajout de l'index `qrCode`, indispensable au scan de
    // l'atelier — rechercher une commande sans index parcourrait toute la table.
    // Dexie réindexe automatiquement les enregistrements existants.
    this.version(2).stores({
      orders: 'id, tenantId, status, synced, createdAt, qrCode, [tenantId+status], [tenantId+synced]',
    })

    // v3 (palier 1) : verrou optimiste et marqueur de conflit. Aucun index
    // nouveau — ces champs ne servent pas de critère de requête — mais les
    // enregistrements existants doivent recevoir une valeur par défaut, sinon
    // `serverVersion` resterait `undefined` et la première mise à jour
    // partirait avec un jeton invalide.
    this.version(3)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table('orders')
          .toCollection()
          .modify((order: LocalOrder & Record<string, unknown>) => {
            // Une commande déjà synchronisée existait forcément côté serveur
            // en version ≥ 1 ; on suppose 1, et un éventuel décalage sera
            // détecté comme un conflit à la première mise à jour.
            if (order.serverVersion === undefined) {
              order.serverVersion = order.synced === 1 ? 1 : 0
            }
            if (order.syncConflict === undefined) order.syncConflict = null
          })
      })

    // v4 (palier 2) : échéance, catalogue et caisse espèces.
    //  - `orders.dueDate` sert aux alertes de retard ;
    //  - les lignes de commande gagnent la traçabilité du catalogue (prix
    //    historisé) ;
    //  - deux nouvelles tables : cache du catalogue et file des encaissements.
    this.version(4)
      .stores({
        orders:
          'id, tenantId, status, synced, createdAt, qrCode, dueDate, [tenantId+status], [tenantId+synced]',
        orderItems: 'id, orderId, tenantId, [orderId+tenantId]',
        catalogEntries: 'id, tenantId, [tenantId+isActive]',
        cashPayments:
          'id, orderId, tenantId, synced, receivedAt, [tenantId+synced], [orderId+synced]',
      })
      .upgrade(async (tx) => {
        await tx
          .table('orders')
          .toCollection()
          .modify((order: LocalOrder & Record<string, unknown>) => {
            if (order.dueDate === undefined) order.dueDate = null
          })

        await tx
          .table('orderItems')
          .toCollection()
          .modify((item: LocalOrderItem & Record<string, unknown>) => {
            if (item.catalogEntryId === undefined) item.catalogEntryId = null
            if (item.articleName === undefined) item.articleName = null
            if (item.serviceName === undefined) item.serviceName = null
          })
      })

    // v5 (palier 2, finitions) : attribution à un employé, motif de dérogation,
    // réclamations et miroir des remboursements.
    this.version(5)
      .stores({
        orders:
          'id, tenantId, status, synced, createdAt, qrCode, dueDate, assignedTo, [tenantId+status], [tenantId+synced]',
        orderItems: 'id, orderId, tenantId, [orderId+tenantId]',
        orderIssues: 'id, orderId, tenantId, synced, createdAt, [tenantId+synced]',
        refunds: 'id, orderId, tenantId, refundedAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table('orders')
          .toCollection()
          .modify((order: LocalOrder & Record<string, unknown>) => {
            if (order.assignedTo === undefined) order.assignedTo = null
            if (order.assignedAt === undefined) order.assignedAt = null
            if (order.statusReason === undefined) order.statusReason = null
          })

        await tx
          .table('orderItems')
          .toCollection()
          .modify((item: LocalOrderItem & Record<string, unknown>) => {
            if (item.priceReason === undefined) item.priceReason = null
          })
      })

    // v6 (prévenir le client) : journal des clients prévenus. Aucun champ
    // ajouté aux commandes — le statut et l'échéance suffisent à décider qui
    // reste à prévenir ; c'est la date de la dernière notification qui tranche.
    this.version(6).stores({
      notifications: 'id, tenantId, orderId, createdAt, synced, [tenantId+synced], [orderId+createdAt]',
    })

    // v7 : unités, quantités et instantanés de prix des lignes de commande.
    // Les anciennes lignes restent exactement au même montant : elles sont
    // reprises comme une pièce, quantité 1, prix unitaire égal au total ancien.
    this.version(7)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table('orderItems')
          .toCollection()
          .modify((item: LocalOrderItem & Record<string, unknown>) => {
            if (item.quantity === undefined) item.quantity = 1
            if (item.billedQuantity === undefined) item.billedQuantity = item.quantity
            if (item.billingUnit === undefined) item.billingUnit = 'PIECE'
            if (item.unitPrice === undefined) item.unitPrice = item.price
            if (item.pricingMode === undefined) item.pricingMode = 'FIXED'
            if (item.priceStatus === undefined) item.priceStatus = 'CONFIRMED'
            if (item.familyNameSnapshot === undefined) item.familyNameSnapshot = null
            if (item.catalogUnitPriceSnapshot === undefined) item.catalogUnitPriceSnapshot = null
            if (item.minimumQuantitySnapshot === undefined) item.minimumQuantitySnapshot = null
            if (item.billingIncrementSnapshot === undefined) item.billingIncrementSnapshot = null
            if (item.minimumChargeSnapshot === undefined) item.minimumChargeSnapshot = null
            if (item.conditionsSnapshot === undefined) item.conditionsSnapshot = null
          })

        await tx
          .table('catalogEntries')
          .toCollection()
          .modify((entry: LocalCatalogEntry & Record<string, unknown>) => {
            if (entry.familyName === undefined) entry.familyName = null
            if (entry.minimumQuantity === undefined) entry.minimumQuantity = null
            if (entry.billingIncrement === undefined) entry.billingIncrement = null
            if (entry.minimumCharge === undefined) entry.minimumCharge = null
            if (entry.conditions === undefined) entry.conditions = null
          })
      })

    // v8 : paramètres des modèles au kilo et au forfait, consultables hors ligne.
    this.version(8).stores({
      laundryModels: 'id, tenantId, [tenantId+isActive]',
    })

    // v9 : instantanés de modèle commercial sur les lignes de commande.
    this.version(9)
      .stores({})
      .upgrade(async (tx) => {
        await tx.table('orderItems').toCollection().modify((item: LocalOrderItem & Record<string, unknown>) => {
          if (item.laundryModelId === undefined) item.laundryModelId = null
          if (item.laundryModelNameSnapshot === undefined) item.laundryModelNameSnapshot = null
          if (item.laundryModelTypeSnapshot === undefined) item.laundryModelTypeSnapshot = null
          if (item.laundryWeightKg === undefined) item.laundryWeightKg = null
          if (item.laundryPriceBreakdownSnapshot === undefined) item.laundryPriceBreakdownSnapshot = null
          if (item.laundryServicesSnapshot === undefined) item.laundryServicesSnapshot = null
          if (item.laundryPricePerKgSnapshot === undefined) item.laundryPricePerKgSnapshot = null
          if (item.laundryPackagePriceSnapshot === undefined) item.laundryPackagePriceSnapshot = null
          if (item.laundryIncludedWeightKgSnapshot === undefined) item.laundryIncludedWeightKgSnapshot = null
          if (item.laundryOveragePricePerKgSnapshot === undefined) item.laundryOveragePricePerKgSnapshot = null
          if (item.laundryMinimumWeightKgSnapshot === undefined) item.laundryMinimumWeightKgSnapshot = null
          if (item.laundryBillingIncrementKgSnapshot === undefined) item.laundryBillingIncrementKgSnapshot = null
          if (item.laundryMinimumChargeSnapshot === undefined) item.laundryMinimumChargeSnapshot = null
        })
      })

    // v10 : composition et tarif snapshot des forfaits famille conservés hors ligne.
    this.version(10)
      .stores({})
      .upgrade(async (tx) => {
        await tx.table('orderItems').toCollection().modify((item: LocalOrderItem & Record<string, unknown>) => {
          if (item.familyPackageSnapshot === undefined) item.familyPackageSnapshot = null
        })
        await tx.table('laundryModels').toCollection().modify((model: LocalLaundryModel & Record<string, unknown>) => {
          if (model.familyPackageArticles === undefined) model.familyPackageArticles = []
          if (model.includedPieces === undefined) model.includedPieces = null
          if (model.overagePricePerPiece === undefined) model.overagePricePerPiece = null
          if (model.familyPackageScope === undefined) model.familyPackageScope = []
        })
      })

    // v11 : table unique pour la structure locale du catalogue (mode démonstration
    // sans Supabase). Discriminante par `kind`, indexée par tenant + type pour
    // recharger chaque référentiel séparément comme les trois tables serveur.
    this.version(11).stores({
      catalogStructure: 'id, tenantId, kind, isActive, [tenantId+kind], [tenantId+isActive]',
    })

    // v12 : prestations choisies par chaque pressing, utilisables hors ligne.
    this.version(12).stores({
      tenantServices: 'id, tenantId, activityCode, [tenantId+activityCode]',
    })
  }
}

export const db = new PressingDatabase()

/** Supprime toutes les données locales (déconnexion, changement de pressing). */
export async function clearLocalData(): Promise<void> {
  // Forme « tableau » : au-delà de cinq tables, la signature variadique de
  // Dexie n'est plus typée.
  await db.transaction(
    'rw',
    [
      db.orders,
      db.orderItems,
      db.pendingPayments,
      db.catalogEntries,
      db.catalogStructure,
      db.laundryModels,
      db.cashPayments,
      db.orderIssues,
      db.refunds,
      db.notifications,
      db.tenantServices,
    ],
    async () => {
      await Promise.all([
        db.orders.clear(),
        db.orderItems.clear(),
        db.pendingPayments.clear(),
        db.catalogEntries.clear(),
        db.catalogStructure.clear(),
        db.laundryModels.clear(),
        db.cashPayments.clear(),
        db.orderIssues.clear(),
        db.refunds.clear(),
        db.notifications.clear(),
        db.tenantServices.clear(),
      ])
    },
  )
}
