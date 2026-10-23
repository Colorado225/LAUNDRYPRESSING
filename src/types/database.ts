/**
 * Types de la base Supabase (écrits à la main).
 *
 * Ils doivent rester strictement alignés avec `supabase/migrations/001_init.sql`.
 * Lorsque le projet Supabase sera créé, ces types pourront être régénérés avec :
 *   npx supabase gen types typescript --project-id <id> > src/types/database.ts
 */

/** Rôles autorisés dans un pressing (voir contrainte SQL sur `tenant_users.role`). */
export type TenantRole = 'owner' | 'receptionist' | 'artisan'

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
  /** Prix facturé, figé au moment de la saisie (prix historisé). */
  price: number
  /** Entrée de catalogue utilisée, si la ligne vient du catalogue. */
  catalog_entry_id: string | null
  /** Libellés recopiés : une modification du catalogue ne réécrit pas l'historique. */
  article_name: string | null
  service_name: string | null
  /** Motif exigé pour un prix différent du tarif du catalogue. */
  price_reason: string | null
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

/** Prestation tarifée du catalogue (table `catalog_entries`, migration 004). */
export type CatalogEntryRow = {
  id: string
  tenant_id: string
  article: string
  service: string
  price: number
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
        Insert: InsertOf<TenantRow, 'id' | 'phone' | 'created_at'>
        Update: Partial<Omit<TenantRow, 'id'>>
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
          | 'catalog_entry_id'
          | 'article_name'
          | 'service_name'
          | 'price_reason'
        >
        Update: Partial<Omit<OrderItemRow, 'id' | 'tenant_id'>>
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
      catalog_entries: {
        Row: CatalogEntryRow
        Insert: InsertOf<
          CatalogEntryRow,
          'id' | 'is_active' | 'sort_order' | 'created_at' | 'updated_at'
        >
        Update: Partial<Omit<CatalogEntryRow, 'id' | 'tenant_id'>>
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
          'id' | 'unit_cost' | 'supplier_id' | 'reason' | 'created_by' | 'created_at'
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
