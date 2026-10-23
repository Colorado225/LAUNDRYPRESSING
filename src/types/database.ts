/**
 * Types de la base Supabase (écrits à la main).
 *
 * Ils doivent rester strictement alignés avec `supabase/migrations/001_init.sql`.
 * Lorsque le projet Supabase sera créé, ces types pourront être régénérés avec :
 *   npx supabase gen types typescript --project-id <id> > src/types/database.ts
 */

/** Rôles autorisés dans un pressing (voir contrainte SQL sur `tenant_users.role`). */
export type TenantRole = 'owner' | 'receptionist' | 'artisan'

/** Cycle de vie d'une commande. */
export type OrderStatus =
  | 'received'
  | 'washing'
  | 'ironing'
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
}

export type OrderItemRow = {
  id: string
  order_id: string
  tenant_id: string
  label: string
  fabric_type: string | null
  special_instructions: string | null
  price: number
}

export type OrderStatusHistoryRow = {
  id: string
  order_id: string
  tenant_id: string
  status: OrderStatus
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
        >
        Update: Partial<Omit<OrderRow, 'id' | 'tenant_id'>>
        Relationships: []
      }
      order_items: {
        Row: OrderItemRow
        Insert: InsertOf<OrderItemRow, 'id' | 'fabric_type' | 'special_instructions'>
        Update: Partial<Omit<OrderItemRow, 'id' | 'tenant_id'>>
        Relationships: []
      }
      order_status_history: {
        Row: OrderStatusHistoryRow
        Insert: InsertOf<OrderStatusHistoryRow, 'id' | 'changed_by' | 'changed_at'>
        Update: Partial<Omit<OrderStatusHistoryRow, 'id' | 'tenant_id'>>
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
