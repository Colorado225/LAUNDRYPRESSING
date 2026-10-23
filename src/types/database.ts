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
  notes: string | null
  closed_by: string | null
  closed_at: string
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
        >
        Update: Partial<Omit<OrderRow, 'id' | 'tenant_id'>>
        Relationships: []
      }
      order_items: {
        Row: OrderItemRow
        Insert: InsertOf<
          OrderItemRow,
          'id' | 'fabric_type' | 'special_instructions' | 'catalog_entry_id' | 'article_name' | 'service_name'
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
    Views: { [_ in never]: never }
    Functions: {
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
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

/** Raccourcis pratiques. */
export type Order = OrderRow
export type OrderItem = OrderItemRow
export type Tenant = TenantRow
export type TenantUser = TenantUserRow
