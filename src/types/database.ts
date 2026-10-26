/**
 * Types de la base Supabase (écrits à la main).
 *
 * Ils doivent rester strictement alignés avec `supabase/migrations/001_init.sql`.
 * Lorsque le projet Supabase sera créé, ces types pourront être régénérés avec :
 *   npx supabase gen types typescript --project-id <id> > src/types/database.ts
 */

/** Valeurs JSON acceptées par les colonnes et fonctions PostgreSQL. */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

/** Rôles autorisés dans un pressing (voir contrainte SQL sur `tenant_users.role`). */
export type TenantRole = 'owner' | 'receptionist' | 'artisan'

/** Activités que chaque pressing peut activer et personnaliser. */
export type TenantActivityCode =
  | 'pressing'
  | 'blanchisserie'
  | 'nettoyage_sec'
  | 'repassage'
  | 'retouches'
  | 'collecte_livraison'
  | 'tapis_moquettes'
  | 'cuir'

/**
 * Cycle de vie d'une commande (palier 2).
 *
 * L'ordre ci-dessous est celui du parcours : réception → tri → lavage →
 * séchage → repassage → contrôle qualité → prêt → remis. Le serveur refuse
 * toute marche arrière hors propriétaire (trigger `guard_order_update`),
 * `cancelled` étant une sortie de parcours traitée à part.
 */
export type OrderStatus =
  | 'received'
  | 'sorting'
  | 'washing'
  | 'drying'
  | 'ironing'
  | 'quality_check'
  | 'ready'
  | 'delivered'
  | 'cancelled'

/** État de règlement d'une commande. */
export type PaymentStatus = 'pending' | 'paid' | 'partial'

/** Moyens de paiement acceptés (Mobile Money en priorité). */
export type PaymentMethod = 'wave' | 'orange_money' | 'mtn_momo' | 'moov_money' | 'cash'

export type TenantRow = {
  id: string
  name: string
  phone: string | null
  created_at: string
  onboarding_completed_at: string | null
}

export type TenantServiceBillingUnit = 'PIECE' | 'KG'
export type OrderGarmentType =
  | 'CHEMISE'
  | 'T_SHIRT'
  | 'PANTALON'
  | 'JEAN'
  | 'ROBE'
  | 'JUPE'
  | 'VESTE'
  | 'COSTUME'
  | 'BOUBOU'
  | 'DRAP'
  | 'SERVIETTE'
  | 'AUTRE'

export type OrderGarmentDetail = {
  type: OrderGarmentType
  quantity: number
}

export type TenantActivityRow = {
  id: string
  tenant_id: string
  name: string
  legacy_code: TenantActivityCode | null
  sort_order: number
  created_at: string
  updated_at: string
}

export type TenantServiceRow = {
  id: string
  tenant_id: string
  activity_id: string
  activity_code: TenantActivityCode | null
  service_name: string
  billing_unit: TenantServiceBillingUnit
  unit_price: number | null
  sort_order: number
  created_at: string
  /** Colonnes du catalogue (migration 027), optionnelles pour les anciennes lectures. */
  code?: string | null
  description?: string | null
  estimated_turnaround_hours?: number | null
  is_express?: boolean
  is_active?: boolean
  archived_at?: string | null
  updated_at?: string
}

/** Catégorie d'articles du catalogue (migration 027) ; `tenant_id` nul = bibliothèque système. */
export type GarmentCategoryRow = {
  id: string
  tenant_id: string | null
  code: string
  name: string
  sort_order: number
  is_system: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

/** Article / type de vêtement du catalogue (migration 027). */
export type GarmentTypeRow = {
  id: string
  tenant_id: string | null
  category_id: string
  code: string
  name: string
  icon_key: string
  default_unit: CatalogBillingUnit
  is_delicate: boolean
  is_system: boolean
  is_active: boolean
  archived_at: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

/** Prix courant d'une prestation pour un article (migration 027) ; absence = non configuré. */
export type ServiceGarmentPriceRow = {
  id: string
  tenant_id: string
  tenant_service_id: string
  garment_type_id: string
  price_xof: number
  is_active: boolean
  created_at: string
  updated_at: string
}

/** Règle de tarification au kilo d'une prestation (migration 028). */
export type PricingRuleRow = {
  id: string
  tenant_id: string
  tenant_service_id: string
  rule_name: string
  rule_mode: 'flat_rate' | 'progressive_tiers'
  min_billable_kg: number
  step_kg: number
  rounding_mode: 'ceil' | 'nearest' | 'exact'
  is_active: boolean
  created_at: string
  updated_at: string
}

export type PricingRuleTierRow = {
  id: string
  tenant_id: string
  pricing_rule_id: string
  min_kg: number
  max_kg: number | null
  price_per_kg_xof: number
}

/** Modèle de blanchisserie (migration 029) ; `tenant_id` nul = gabarit système. */
export type LaundryProfileRow = {
  id: string
  tenant_id: string | null
  code: string
  name: string
  description: string | null
  profile_kind: 'system_template' | 'custom'
  is_default: boolean
  is_active: boolean
  archived_at: string | null
  created_at: string
  updated_at: string
}

export type LaundryProfileItemRow = {
  id: string
  profile_id: string
  garment_type_id: string | null
  garment_code: string | null
  service_code: string | null
  sort_order: number
}

export type CommercialPackageRow = {
  id: string
  tenant_id: string
  code: string
  name: string
  description: string | null
  price_xof: number
  is_active: boolean
  archived_at: string | null
  created_at: string
  updated_at: string
}

export type CommercialPackageItemRow = {
  id: string
  tenant_id: string
  package_id: string
  garment_type_id: string | null
  tenant_service_id: string | null
  label: string | null
  quantity: number
  sort_order: number
}

export type TenantUserRow = {
  user_id: string
  tenant_id: string
  role: TenantRole
  /** Nom affiché dans l'interface (« Propriétaire », « Awa », …). */
  display_name: string | null
  created_at: string
}

export type OrderRow = {
  id: string
  tenant_id: string
  customer_name: string
  customer_phone: string
  status: OrderStatus
  qr_code: string
  photo_url: string | null
  total_amount: number
  payment_status: PaymentStatus
  payment_method: PaymentMethod | null
  created_at: string
  updated_at: string
  synced_from_local: boolean
  /** Verrou optimiste : incrémenté par trigger à chaque changement métier. */
  version: number
  /** Date de livraison promise au client (jour calendaire, sans heure). */
  due_date: string | null
  /** Employé en charge de la commande. */
  assigned_to: string | null
  /** Horodatage de la dernière attribution. */
  assigned_at: string | null
  /**
   * Colonne de transport : le motif d'un changement de statut y transite le
   * temps d'une mise à jour, puis le déclencheur l'efface en le recopiant dans
   * `order_status_history.reason`.
   */
  status_reason?: string | null
}

export type OrderItemRow = {
  id: string
  order_id: string
  tenant_id: string
  label: string
  fabric_type: string | null
  special_instructions: string | null
  /** Montant total facturé pour la ligne, calculé en FCFA entiers. */
  price: number
  /** Quantité mesurée puis quantité facturée après minimum et incrément. */
  quantity: number
  billed_quantity: number
  billing_unit: CatalogBillingUnit
  /** Prix par unité de facturation, figé au moment de la saisie. */
  unit_price: number
  pricing_mode: CatalogPricingMode
  price_status: OrderItemPriceStatus
  /** Références et paramètres tarifaires figés avec la ligne. */
  article_name: string | null
  service_name: string | null
  tenant_service_id: string | null
  activity_name_snapshot: string | null
  /** Article du catalogue vendu (migration 027) ; les libellés figés restent la référence d'affichage. */
  garment_type_id?: string | null
  family_name_snapshot: string | null
  catalog_unit_price_snapshot: number | null
  minimum_quantity_snapshot: number | null
  billing_increment_snapshot: number | null
  minimum_charge_snapshot: number | null
  conditions_snapshot: string | null
  /** Motif d'un écart de tarif ou d'une ligne libre. */
  price_reason: string | null
  /** Composition des vêtements d'une ligne au kilo, figée à la réception. */
  garment_details: OrderGarmentDetail[]
  /** Modèle commercial et conditions tarifaires figés à la réception. */
}

/** Réclamation ou vêtement abîmé (table `order_issues`, migration 005). */
export type OrderIssueKind = 'stained' | 'torn' | 'discoloured' | 'missing' | 'other'
export type OrderIssueStage = 'reception' | 'treatment' | 'delivery'
export type OrderIssueResolution = 'repaired' | 'compensated' | 'rejected'

export type OrderIssueRow = {
  id: string
  tenant_id: string
  order_id: string
  order_item_id: string | null
  kind: OrderIssueKind
  severity: 'minor' | 'major'
  stage: OrderIssueStage
  description: string
  reported_by: string | null
  resolution: OrderIssueResolution | null
  resolution_note: string | null
  resolved_at: string | null
  created_at: string
}

/**
 * Client prévenu (table `notifications`, migration 010).
 *
 * Ligne immuable : elle atteste qu'un message a été présenté au comptoir et
 * envoyé, elle ne se réécrit pas. Une nouvelle situation crée une nouvelle
 * ligne, ce qui garde l'historique des sollicitations.
 */
export type NotificationRow = {
  id: string
  tenant_id: string
  order_id: string | null
  channel: 'whatsapp' | 'appel' | 'sms'
  reason: 'pret' | 'retard' | 'relance'
  customer_name: string
  customer_phone: string
  message: string
  sent_by: string | null
  created_at: string
}

/** Remboursement (table `payment_refunds`, migration 005). */
export type PaymentRefundRow = {
  id: string
  tenant_id: string
  order_id: string
  payment_id: string | null
  amount: number
  channel: 'cash' | 'mobile_money'
  reason: string
  refunded_by: string | null
  refunded_at: string
}

export type OrderStatusHistoryRow = {
  id: string
  order_id: string
  tenant_id: string
  status: OrderStatus
  /** Statut précédent, renseigné par le trigger depuis la migration 003. */
  previous_status: OrderStatus | null
  /** Motif éventuel d'une dérogation (annulation, correction). */
  reason: string | null
  changed_by: string | null
  changed_at: string
}

/** Transaction Mobile Money (table `payment_transactions`, migration 002). */
export type PaymentTransactionStatus =
  | 'pending'
  | 'initiated'
  | 'paid'
  | 'refused'
  | 'cancelled'
  | 'error'

export type PaymentTransactionRow = {
  id: string
  tenant_id: string
  order_id: string
  transaction_id: string
  amount: number
  order_amount: number
  currency: 'XOF' | 'XAF'
  status: PaymentTransactionStatus
  provider: string
  payment_method: PaymentMethod | null
  operator_label: string | null
  payment_url: string | null
  signature_verified: boolean
  provider_payload: unknown
  created_at: string
  updated_at: string
  paid_at: string | null
  /** Encaissement au comptoir : utilisateur ayant reçu l'argent. */
  received_by: string | null
  note: string | null
  /** Clôture de caisse à laquelle l'encaissement est rattaché. */
  cash_session_id: string | null
}

/** Unités de facturation prises en charge par le catalogue. */
export type CatalogBillingUnit =
  | 'PIECE'
  | 'PAIR'
  | 'SET'
  | 'KG'
  | 'M2'
  | 'METER'
  | 'PACKAGE'
  | 'FLAT'

/** Modes d'évaluation d'un tarif. */
export type CatalogPricingMode = 'FIXED' | 'FROM' | 'QUOTE' | 'UNCONFIGURED'
export type CatalogServiceType = 'treatment' | 'option' | 'logistics' | 'other'
export type CatalogApplicationScope = 'article' | 'order'
export type OrderItemPriceStatus = 'CONFIRMED' | 'ESTIMATED'

/** Modèles commerciaux de blanchisserie, distincts des tarifs à la pièce. */
export type LaundryModelType = 'PER_KG' | 'WEIGHT_PACKAGE' | 'FAMILY_PACKAGE'
export type LaundryModelAudience = 'ALL' | 'INDIVIDUAL' | 'PROFESSIONAL'
export type LaundryModelServiceMode = 'INCLUDED' | 'EXTRA'

/** Composition et paramètres tarifaires figés pour un forfait famille saisi hors ligne. */
export type FamilyPackageContentSnapshot = {
  articleId: string
  articleName: string
  familyName: string | null
  quantity: number
  careInstructions: string | null
}

export type FamilyPackageSnapshot = {
  modelId: string
  modelName: string
  packagePrice: number
  includedPieces: number
  overagePricePerPiece: number | null
  minimumCharge: number | null
  pieceCount: number
  manualTotalPrice: number | null
  contents: FamilyPackageContentSnapshot[]
}

export type LaundryModelRow = {
  id: string
  tenant_id: string
  name: string
  description: string | null
  model_type: LaundryModelType
  audience: LaundryModelAudience
  pricing_basis: 'KG' | 'PIECE'
  price_per_kg: number | null
  package_price: number | null
  included_weight_kg: number | null
  overage_price_per_kg: number | null
  included_pieces: number | null
  overage_price_per_piece: number | null
  minimum_weight_kg: number | null
  billing_increment_kg: number | null
  minimum_charge: number | null
  conditions: string | null
  exclusions: string | null
  pickup_delivery_terms: string | null
  turnaround_days: number | null
  is_active: boolean
  sort_order: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export type LaundryModelServiceRow = {
  id: string
  tenant_id: string
  model_id: string
  service_id: string
  inclusion_mode: LaundryModelServiceMode
  sort_order: number
  created_at: string
}

export type OrderPriceHistoryRow = {
  id: string
  tenant_id: string
  order_id: string
  order_item_id: string
  previous_price: number
  new_price: number
  reason: string | null
  changed_by: string | null
  changed_at: string
  previous_snapshot: Json
  new_snapshot: Json
}

export type CatalogFamilyRow = {
  id: string
  tenant_id: string
  name: string
  template_code: string | null
  description: string | null
  is_active: boolean
  sort_order: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export type CatalogArticleRow = {
  id: string
  tenant_id: string
  family_id: string
  name: string
  template_code: string | null
  description: string | null
  care_instructions: string | null
  default_unit: CatalogBillingUnit
  is_active: boolean
  sort_order: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export type CatalogServiceRow = {
  id: string
  tenant_id: string
  name: string
  template_code: string | null
  service_type: CatalogServiceType
  application_scope: CatalogApplicationScope
  description: string | null
  is_active: boolean
  sort_order: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export type CatalogOperationDefinitionRow = { code: string; name: string; sort_order: number }
export type CatalogModelTemplateRow = {
  code: string
  template_kind: 'FAMILY' | 'ARTICLE' | 'SERVICE'
  name: string
  parent_code: string | null
  description: string | null
  default_unit: CatalogBillingUnit | null
  service_type: CatalogServiceType | null
  application_scope: CatalogApplicationScope | null
  operation_codes: string[]
  sort_order: number
  is_active: boolean
  created_at: string
}
export type LaundryModelTemplateRow = {
  code: string
  name: string
  description: string | null
  model_type: LaundryModelType
  pricing_basis: 'KG' | 'PIECE'
  included_weight_kg: number | null
  included_pieces: number | null
  conditions: string | null
  exclusions: string | null
  turnaround_days: number | null
  is_active: boolean
  sort_order: number
  created_at: string
}
export type LaundryModelTemplateServiceRow = {
  template_code: string
  service_template_code: string
  inclusion_mode: LaundryModelServiceMode
  sort_order: number
}
export type LaundryModelTemplateFamilyRow = {
  template_code: string
  family_template_code: string
}
export type CatalogArticleAliasRow = {
  id: string
  tenant_id: string
  article_id: string
  alias: string
  alias_key: string
  created_at: string
}
export type CatalogServiceOperationRow = {
  tenant_id: string
  service_id: string
  operation_code: string
  sort_order: number
  created_at: string
}
export type LaundryModelCatalogScopeRow = {
  id: string
  tenant_id: string
  model_id: string
  family_id: string | null
  article_id: string | null
  created_at: string
}
export type OrderItemFamilyPackageRow = {
  id: string
  tenant_id: string
  order_id: string
  order_item_id: string
  laundry_model_id: string
  model_name_snapshot: string
  package_price_snapshot: number
  included_pieces_snapshot: number
  overage_price_per_piece_snapshot: number | null
  minimum_charge_snapshot: number | null
  piece_count: number
  scope_snapshot: Json
  price_breakdown_snapshot: Json
  created_at: string
}
export type OrderItemFamilyPackageContentRow = {
  id: string
  tenant_id: string
  order_id: string
  order_item_id: string
  article_id: string
  article_name_snapshot: string
  family_name_snapshot: string
  quantity: number
  care_instructions_snapshot: string | null
  service_operations_snapshot: Json
  created_at: string
}

/** Tarif tenant-scoped (table `catalog_entries`, migrations 004 et 013). */
export type CatalogEntryRow = {
  id: string
  tenant_id: string
  /** Libellés de compatibilité, synchronisés avec les références ci-dessous. */
  article: string
  service: string
  article_id: string | null
  service_id: string
  price: number
  pricing_mode: CatalogPricingMode
  billing_unit: CatalogBillingUnit
  minimum_quantity: number | null
  billing_increment: number | null
  minimum_charge: number | null
  conditions: string | null
  requires_review: boolean
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

/** Clôture journalière de caisse (table `cash_sessions`, migration 004). */
export type CashSessionRow = {
  id: string
  tenant_id: string
  business_date: string
  expected_total: number
  declared_total: number
  difference: number
  /** Somme des remboursements en espèces de la journée. */
  refunded_total: number
  notes: string | null
  closed_by: string | null
  closed_at: string
}

/** Fiche client (table `customers`, migration 006). */
export type CustomerRow = {
  id: string
  tenant_id: string
  name: string
  phone: string
  phone_key: string
  email: string | null
  address: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

/** Fournisseur (table `suppliers`, migration 006). */
export type SupplierRow = {
  id: string
  tenant_id: string
  name: string
  phone: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/** Article de stock (table `stock_items`, migration 006). */
export type StockCategory = 'produit' | 'emballage' | 'consommable' | 'autre'
export type StockUnit = 'pièce' | 'litre' | 'kg' | 'flacon' | 'rouleau'

export type StockItemRow = {
  id: string
  tenant_id: string
  name: string
  category: StockCategory
  unit: StockUnit
  quantity: number
  min_quantity: number
  unit_cost: number | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/** Mouvement de stock (table `stock_movements`, migration 006). */
export type StockMovementRow = {
  id: string
  tenant_id: string
  item_id: string
  kind: 'in' | 'out'
  quantity: number
  unit_cost: number | null
  order_item_id: string | null
  supplier_id: string | null
  reason: string | null
  created_by: string | null
  created_at: string
}

/** Dépense (table `expenses`, migration 006). */
export type ExpenseCategory =
  | 'fournitures'
  | 'loyer'
  | 'salaire'
  | 'eau_electricite'
  | 'transport'
  | 'autre'

/**
 * Abonnement SaaS (palier 4).
 *
 * L'éditeur vend une formule mensuelle ; le règlement se fait hors application
 * et l'éditeur enregistre la période réglée. Aucune ligne n'est écrite par le
 * pressing : `platform_set_subscription` est réservée aux administrateurs.
 */
export type SubscriptionState = 'trial' | 'active' | 'grace' | 'expired' | 'suspended'

export type PlanRow = {
  code: string
  name: string
  description: string
  price_fcfa: number
  duration_days: number
  max_users: number | null
  max_shops: number
  is_active: boolean
  sort_order: number
}

export type SubscriptionRow = {
  tenant_id: string
  plan_code: string
  status: SubscriptionState
  started_on: string
  current_period_end: string
  trial_ends_on: string | null
  grace_days: number
  suspended_reason: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

/** Vue renvoyée par la fonction `my_subscription()`. */
export type SubscriptionSnapshot = {
  tenant_id: string
  state: SubscriptionState
  writable: boolean
  plan_code?: string
  plan_name?: string
  price_fcfa?: number
  duration_days?: number
  max_users?: number | null
  max_shops?: number
  status?: SubscriptionState
  started_on?: string
  current_period_end?: string
  trial_ends_on?: string | null
  grace_days?: number
  suspended_reason?: string | null
}

/** Ligne de la console de supervision (`platform_tenants_overview`). */
export type TenantOverviewRow = {
  tenant_id: string
  tenant_name: string
  created_at: string
  users_count: number
  orders_count: number
  last_order_at: string | null
  plan_code: string | null
  plan_name: string | null
  price_fcfa: number | null
  status: SubscriptionState | null
  state: SubscriptionState
  current_period_end: string | null
  trial_ends_on: string | null
}

export type SupportRequestStatus = 'open' | 'in_progress' | 'closed'

export type SupportRequestRow = {
  id: string
  tenant_id: string
  author_id: string | null
  author_name: string | null
  subject: string
  message: string
  status: SupportRequestStatus
  response: string | null
  created_at: string
  updated_at: string
}

/** Demande de support telle que la voit l'éditeur (nom du pressing joint). */
export type PlatformSupportRequest = {
  id: string
  tenant_id: string
  tenant_name: string
  author_name: string | null
  subject: string
  message: string
  status: SupportRequestStatus
  response: string | null
  created_at: string
}

/** Ligne du journal d'audit (migration 009) : action sensible, figée à l'écriture. */
export type AuditLogRow = {
  id: string
  tenant_id: string
  /** Compte auteur, `null` quand l'écriture vient du serveur (webhook, script). */
  actor_id: string | null
  /** Adresse e-mail figée au moment de l'action : elle ne suit pas les changements. */
  actor_email: string | null
  /** Rôle figé au moment de l'action, `null` hors du pressing concerné. */
  actor_role: string | null
  /** Code stable `<table>.<insert|update|delete>`. */
  action: string
  /** Table d'origine de l'événement. */
  entity: string
  entity_id: string | null
  /**
   * Détail de l'événement. Création : `{ colonne: valeur }`. Modification :
   * `{ colonne: { avant, apres } }`. Le type reste ouvert, car la base stocke
   * du jsonb et une valeur peut elle-même être un objet.
   */
  details: Record<string, unknown>
  created_at: string
}

export type ExpenseRow = {
  id: string
  tenant_id: string
  label: string
  category: ExpenseCategory
  amount: number
  spent_on: string
  supplier_id: string | null
  note: string | null
  created_by: string | null
  created_at: string
}

/** Type `Insert` générique : les colonnes avec valeur par défaut deviennent optionnelles. */
type InsertOf<Row, OptionalKeys extends keyof Row> = Omit<Row, OptionalKeys> &
  Partial<Pick<Row, OptionalKeys>>

export interface Database {
  public: {
    Tables: {
      tenants: {
        Row: TenantRow
        Insert: InsertOf<TenantRow, 'id' | 'phone' | 'created_at' | 'onboarding_completed_at'>
        Update: Partial<Omit<TenantRow, 'id'>>
        Relationships: []
      }
      tenant_activities: {
        Row: TenantActivityRow
        Insert: InsertOf<TenantActivityRow, 'id' | 'legacy_code' | 'sort_order' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<TenantActivityRow, 'id' | 'tenant_id' | 'created_at'>>
        Relationships: []
      }
      tenant_services: {
        Row: TenantServiceRow
        Insert: InsertOf<TenantServiceRow, 'id' | 'activity_code' | 'billing_unit' | 'unit_price' | 'sort_order' | 'created_at'>
        Update: Partial<Omit<TenantServiceRow, 'id' | 'tenant_id' | 'created_at'>>
        Relationships: []
      }
      garment_categories: {
        Row: GarmentCategoryRow
        Insert: InsertOf<GarmentCategoryRow, 'id' | 'tenant_id' | 'sort_order' | 'is_system' | 'is_active' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<GarmentCategoryRow, 'id' | 'created_at'>>
        Relationships: []
      }
      garment_types: {
        Row: GarmentTypeRow
        Insert: InsertOf<GarmentTypeRow, 'id' | 'tenant_id' | 'icon_key' | 'default_unit' | 'is_delicate' | 'is_system' | 'is_active' | 'archived_at' | 'sort_order' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<GarmentTypeRow, 'id' | 'created_at'>>
        Relationships: []
      }
      service_garment_prices: {
        Row: ServiceGarmentPriceRow
        Insert: InsertOf<ServiceGarmentPriceRow, 'id' | 'is_active' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<ServiceGarmentPriceRow, 'id' | 'tenant_id' | 'created_at'>>
        Relationships: []
      }
      pricing_rules: {
        Row: PricingRuleRow
        Insert: InsertOf<PricingRuleRow, 'id' | 'min_billable_kg' | 'step_kg' | 'rounding_mode' | 'is_active' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<PricingRuleRow, 'id' | 'tenant_id' | 'created_at'>>
        Relationships: []
      }
      pricing_rule_tiers: {
        Row: PricingRuleTierRow
        Insert: InsertOf<PricingRuleTierRow, 'id' | 'tenant_id' | 'max_kg'>
        Update: Partial<Omit<PricingRuleTierRow, 'id'>>
        Relationships: []
      }
      laundry_profiles: {
        Row: LaundryProfileRow
        Insert: InsertOf<LaundryProfileRow, 'id' | 'tenant_id' | 'description' | 'is_default' | 'is_active' | 'archived_at' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<LaundryProfileRow, 'id' | 'created_at'>>
        Relationships: []
      }
      laundry_profile_items: {
        Row: LaundryProfileItemRow
        Insert: InsertOf<LaundryProfileItemRow, 'id' | 'garment_type_id' | 'garment_code' | 'service_code' | 'sort_order'>
        Update: Partial<Omit<LaundryProfileItemRow, 'id'>>
        Relationships: []
      }
      commercial_packages: {
        Row: CommercialPackageRow
        Insert: InsertOf<CommercialPackageRow, 'id' | 'description' | 'is_active' | 'archived_at' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<CommercialPackageRow, 'id' | 'tenant_id' | 'created_at'>>
        Relationships: []
      }
      commercial_package_items: {
        Row: CommercialPackageItemRow
        Insert: InsertOf<CommercialPackageItemRow, 'id' | 'garment_type_id' | 'tenant_service_id' | 'label' | 'quantity' | 'sort_order'>
        Update: Partial<Omit<CommercialPackageItemRow, 'id' | 'tenant_id'>>
        Relationships: []
      }
      tenant_users: {
        Row: TenantUserRow
        Insert: TenantUserRow
        Update: Partial<TenantUserRow>
        Relationships: []
      }
      orders: {
        Row: OrderRow
        Insert: InsertOf<
          OrderRow,
          | 'id'
          | 'status'
          | 'photo_url'
          | 'payment_status'
          | 'payment_method'
          | 'created_at'
          | 'updated_at'
          | 'synced_from_local'
          | 'version'
          | 'due_date'
          | 'assigned_to'
          | 'assigned_at'
          | 'status_reason'
        >
        Update: Partial<Omit<OrderRow, 'id' | 'tenant_id'>>
        Relationships: []
      }
      order_items: {
        Row: OrderItemRow
        Insert: InsertOf<
          OrderItemRow,
          | 'id'
          | 'fabric_type'
          | 'special_instructions'
          | 'article_name'
          | 'service_name'
          | 'tenant_service_id'
          | 'activity_name_snapshot'
          | 'garment_type_id'
          | 'price_reason'
          | 'quantity'
          | 'billed_quantity'
          | 'billing_unit'
          | 'unit_price'
          | 'pricing_mode'
          | 'price_status'
          | 'family_name_snapshot'
          | 'catalog_unit_price_snapshot'
          | 'minimum_quantity_snapshot'
          | 'billing_increment_snapshot'
          | 'minimum_charge_snapshot'
          | 'conditions_snapshot'
          | 'garment_details'
        >
        Update: Partial<Omit<OrderItemRow, 'id' | 'tenant_id'>>
        Relationships: []
      }
      order_price_history: {
        Row: OrderPriceHistoryRow
        Insert: InsertOf<
          OrderPriceHistoryRow,
          | 'id'
          | 'reason'
          | 'changed_by'
          | 'changed_at'
          | 'previous_snapshot'
          | 'new_snapshot'
        >
        Update: Partial<Omit<OrderPriceHistoryRow, 'id' | 'tenant_id'>>
        Relationships: []
      }
      order_status_history: {
        Row: OrderStatusHistoryRow
        Insert: InsertOf<
          OrderStatusHistoryRow,
          'id' | 'previous_status' | 'reason' | 'changed_by' | 'changed_at'
        >
        Update: Partial<Omit<OrderStatusHistoryRow, 'id' | 'tenant_id'>>
        Relationships: []
      }
      cash_sessions: {
        Row: CashSessionRow
        Insert: InsertOf<
          CashSessionRow,
          'id' | 'notes' | 'closed_by' | 'closed_at'
        >
        Update: Partial<Omit<CashSessionRow, 'id' | 'tenant_id'>>
        Relationships: []
      }
      order_issues: {
        Row: OrderIssueRow
        Insert: InsertOf<
          OrderIssueRow,
          | 'id'
          | 'order_item_id'
          | 'severity'
          | 'stage'
          | 'reported_by'
          | 'resolution'
          | 'resolution_note'
          | 'resolved_at'
          | 'created_at'
        >
        Update: Partial<Omit<OrderIssueRow, 'id' | 'tenant_id'>>
        Relationships: []
      }
      payment_refunds: {
        Row: PaymentRefundRow
        Insert: InsertOf<
          PaymentRefundRow,
          'id' | 'payment_id' | 'channel' | 'refunded_by' | 'refunded_at'
        >
        Update: Partial<Omit<PaymentRefundRow, 'id' | 'tenant_id'>>
        Relationships: []
      }
      customers: {
        Row: CustomerRow
        Insert: InsertOf<
          CustomerRow,
          'id' | 'phone_key' | 'email' | 'address' | 'notes' | 'created_at' | 'updated_at'
        >
        Update: Partial<Omit<CustomerRow, 'id' | 'tenant_id'>>
        Relationships: []
      }
      suppliers: {
        Row: SupplierRow
        Insert: InsertOf<
          SupplierRow,
          'id' | 'phone' | 'notes' | 'is_active' | 'created_at' | 'updated_at'
        >
        Update: Partial<Omit<SupplierRow, 'id' | 'tenant_id'>>
        Relationships: []
      }
      stock_items: {
        Row: StockItemRow
        Insert: InsertOf<
          StockItemRow,
          | 'id'
          | 'category'
          | 'unit'
          | 'quantity'
          | 'min_quantity'
          | 'unit_cost'
          | 'is_active'
          | 'created_at'
          | 'updated_at'
        >
        Update: Partial<Omit<StockItemRow, 'id' | 'tenant_id'>>
        Relationships: []
      }
      stock_movements: {
        Row: StockMovementRow
        Insert: InsertOf<
          StockMovementRow,
          'id' | 'unit_cost' | 'order_item_id' | 'supplier_id' | 'reason' | 'created_by' | 'created_at'
        >
        Update: Partial<Omit<StockMovementRow, 'id' | 'tenant_id'>>
        Relationships: []
      }
      audit_log: {
        Row: AuditLogRow
        // Le journal est en écriture seule côté serveur : aucun `Insert` client
        // n'est exposé, et le type le dit pour décourager toute tentative.
        Insert: never
        Update: never
        Relationships: []
      }
      expenses: {
        Row: ExpenseRow
        Insert: InsertOf<
          ExpenseRow,
          'id' | 'category' | 'spent_on' | 'supplier_id' | 'note' | 'created_by' | 'created_at'
        >
        Update: Partial<Omit<ExpenseRow, 'id' | 'tenant_id'>>
        Relationships: []
      }
      notifications: {
        Row: NotificationRow
        Insert: InsertOf<
          NotificationRow,
          'id' | 'order_id' | 'sent_by' | 'created_at'
        >
        // Aucune mise à jour : le journal des sollicitations est immuable.
        Update: never
        Relationships: []
      }
      plans: {
        Row: PlanRow
        Insert: InsertOf<PlanRow, 'description' | 'duration_days' | 'max_users' | 'max_shops' | 'is_active' | 'sort_order'>
        Update: Partial<PlanRow>
        Relationships: []
      }
      subscriptions: {
        Row: SubscriptionRow
        Insert: InsertOf<
          SubscriptionRow,
          'status' | 'started_on' | 'trial_ends_on' | 'grace_days' | 'suspended_reason' | 'notes' | 'created_at' | 'updated_at'
        >
        Update: Partial<Omit<SubscriptionRow, 'tenant_id'>>
        Relationships: []
      }
      support_requests: {
        Row: SupportRequestRow
        Insert: InsertOf<SupportRequestRow, 'id' | 'author_id' | 'author_name' | 'status' | 'response' | 'created_at' | 'updated_at'>
        Update: Partial<Omit<SupportRequestRow, 'id' | 'tenant_id' | 'author_id'>>
        Relationships: []
      }
      payment_transactions: {
        Row: PaymentTransactionRow
        Insert: InsertOf<
          PaymentTransactionRow,
          | 'id'
          | 'currency'
          | 'status'
          | 'provider'
          | 'payment_method'
          | 'operator_label'
          | 'payment_url'
          | 'signature_verified'
          | 'provider_payload'
          | 'created_at'
          | 'updated_at'
          | 'paid_at'
          | 'received_by'
          | 'note'
          | 'cash_session_id'
        >
        Update: Partial<Omit<PaymentTransactionRow, 'id' | 'tenant_id'>>
        Relationships: []
      }
    }
    Views: {
      expense_totals: {
        Row: {
          tenant_id: string
          month: string
          category: ExpenseCategory
          total_amount: number
          entries: number
        }
        Relationships: []
      }
    }
    Functions: {
      complete_tenant_onboarding: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      save_tenant_services: {
        Args: { p_services: Json }
        Returns: string
      }
      install_catalog_reference: {
        Args: Record<PropertyKey, never>
        Returns: Json
      }
      quote_weight_price: {
        Args: { p_service: string; p_weight: number }
        Returns: Json
      }
      duplicate_laundry_profile: {
        Args: { p_profile: string; p_name?: string }
        Returns: string
      }
      report_stock_consumption_costs: {
        Args: { p_order_item_ids: string[] }
        Returns: { order_item_id: string; cost_amount: number; missing_cost_movements: number }[]
      }
      my_subscription: {
        Args: Record<PropertyKey, never>
        Returns: SubscriptionSnapshot | null
      }
      is_platform_admin: {
        Args: Record<PropertyKey, never>
        Returns: boolean
      }
      platform_tenants_overview: {
        Args: Record<PropertyKey, never>
        Returns: TenantOverviewRow[]
      }
      platform_set_subscription: {
        Args: {
          p_tenant: string
          p_plan: string
          p_days?: number
          p_status?: SubscriptionState
          p_reason?: string | null
        }
        Returns: { tenant_id: string; state: SubscriptionState; writable: boolean }
      }
      platform_create_shop: {
        Args: {
          p_name: string
          p_phone?: string | null
          p_owner?: string | null
          p_plan?: string
          p_days?: number
        }
        Returns: { tenant_id: string; plan_code: string }
      }
      platform_members: {
        Args: Record<PropertyKey, never>
        Returns: {
          tenant_id: string
          tenant_name: string
          user_id: string
          email: string | null
          role: TenantRole
          display_name: string | null
          created_at: string
        }[]
      }
      platform_set_member: {
        Args: {
          p_tenant: string
          p_user: string
          p_role: TenantRole | null
          p_display_name?: string | null
        }
        Returns: undefined
      }
      platform_support_requests: {
        Args: Record<PropertyKey, never>
        Returns: PlatformSupportRequest[]
      }
      platform_answer_support: {
        Args: { p_id: string; p_response: string; p_status?: SupportRequestStatus }
        Returns: undefined
      }
      current_tenant_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      current_tenant_role: {
        Args: Record<PropertyKey, never>
        Returns: string | null
      }
      // Journal de diagnostic (migration 026) : le poste consigne lui-même le
      // refus d'un envoi, pour qu'une commande bloquée laisse une trace lisible.
      log_client_sync: {
        Args: {
          p_kind: 'push_error' | 'push_ok' | 'push_conflict' | 'probe'
          p_message?: string | null
          p_order_id?: string | null
          p_details?: Json
        }
        Returns: undefined
      }
      record_cash_payment: {
        Args: {
          p_order_id: string
          p_amount: number
          p_payment_id?: string | null
          p_note?: string | null
        }
        Returns: {
          payment_id: string
          paid: number
          remaining: number
          duplicate: boolean
        }
      }
      finalize_cinetpay_payment: {
        Args: {
          p_transaction_id: string
          p_amount: number
          p_payment_method?: string | null
          p_operator_label?: string | null
          p_signature_verified?: boolean
          p_provider_payload?: Json
        }
        Returns: Json
      }
      close_cash_session: {
        Args: {
          p_business_date: string
          p_declared_total: number
          p_notes?: string | null
        }
        Returns: CashSessionRow
      }
      record_refund: {
        Args: {
          p_order_id: string
          p_amount: number
          p_reason: string
          p_channel?: 'cash' | 'mobile_money'
        }
        Returns: {
          refund_id: string
          refunded_total: number
          refundable_amount: number
        }
      }
      create_tenant_for_user: {
        Args: {
          p_name: string
          p_phone?: string | null
        }
        Returns: string
      }
      /* Migration 025 — CRUD complet des modules de gestion */
      tenant_team: {
        Args: Record<PropertyKey, never>
        Returns: {
          user_id: string
          email: string | null
          role: TenantRole
          display_name: string | null
          created_at: string
        }[]
      }
      tenant_set_member: {
        Args: {
          p_user: string
          p_role: TenantRole | null
          p_display_name?: string | null
        }
        Returns: undefined
      }
      tenant_attach_member_by_email: {
        Args: {
          p_email: string
          p_role: TenantRole
          p_display_name?: string | null
        }
        Returns: string
      }
      tenant_remove_member: {
        Args: { p_user: string }
        Returns: undefined
      }
      tenant_close_support_request: {
        Args: { p_id: string }
        Returns: undefined
      }
      tenant_delete_support_request: {
        Args: { p_id: string }
        Returns: undefined
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

/** Raccourcis pratiques. */
export type Customer = CustomerRow
export type Supplier = SupplierRow
export type StockItem = StockItemRow
export type StockMovement = StockMovementRow
export type Expense = ExpenseRow
export type Order = OrderRow
export type OrderItem = OrderItemRow
export type OrderIssue = OrderIssueRow
export type PaymentRefund = PaymentRefundRow
export type Tenant = TenantRow
export type TenantUser = TenantUserRow
