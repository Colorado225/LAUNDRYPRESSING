import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { getSupabaseClient } from './supabaseClient'
import type { TenantRole } from '@/types/database'

/**
 * Contexte multi-tenant côté client.
 *
 * Principe : le `tenant_id` n'est JAMAIS choisi librement par l'utilisateur.
 * Il est déduit de la ligne `tenant_users` correspondant à son compte Supabase.
 * La sécurité réelle reste assurée par la RLS PostgreSQL : ce store ne sert
 * qu'à filtrer les requêtes et à adapter l'interface.
 *
 * Le store est persisté pour survivre à un rechargement de page hors ligne.
 */

const STORAGE_KEY = 'pressing-pro-tenant'

export interface TenantMembership {
  tenantId: string
  tenantName: string
  role: TenantRole
  /** Compte Supabase connecté, `null` en mode démonstration. */
  userId: string | null
}

/** Une boutique et le rôle du compte dans celle-ci (palier 4). */
export interface ShopMembership {
  tenantId: string
  tenantName: string
  role: TenantRole
}

interface TenantState {
  tenantId: string | null
  tenantName: string | null
  role: TenantRole | null
  userId: string | null
  /** Toutes les boutiques du compte, dans l'ordre de rattachement. */
  shops: ShopMembership[]
  /** Compte de supervision de l'éditeur (console SaaS). */
  isPlatformAdmin: boolean
  setPlatformAdmin: (value: boolean) => void
  setMembership: (membership: TenantMembership) => void
  /** Remplace la liste après une connexion ou un rafraîchissement. */
  setShops: (shops: ShopMembership[], userId: string | null) => void
  /** Bascule vers une autre boutique du compte ; sans effet si inconnue. */
  switchTenant: (tenantId: string) => void
  /** Met à jour le nom affiché après une modification du pressing. */
  renameTenant: (tenantName: string) => void
  clear: () => void
}

export const useTenantStore = create<TenantState>()(
  persist(
    (set) => ({
      tenantId: null,
      tenantName: null,
      role: null,
      userId: null,
      shops: [],
      isPlatformAdmin: false,
      setPlatformAdmin: (value) => set({ isPlatformAdmin: value }),
      setMembership: ({ tenantId, tenantName, role, userId }) =>
        set((state) => ({
          tenantId,
          tenantName,
          role,
          userId,
          // Le mode démonstration n'a qu'une seule boutique : la liste reste
          // cohérente avec la boutique active.
          shops: state.shops.some((shop) => shop.tenantId === tenantId)
            ? state.shops
            : [{ tenantId, tenantName, role }],
        })),
      setShops: (shops, userId) => set({ shops, userId }),
      switchTenant: (tenantId) =>
        set((state) => {
          const shop = state.shops.find((entry) => entry.tenantId === tenantId)
          if (!shop) return state
          return {
            tenantId: shop.tenantId,
            tenantName: shop.tenantName,
            role: shop.role,
          }
        }),
      renameTenant: (tenantName) =>
        set((state) => ({
          tenantName,
          // Le sélecteur de boutique lit `shops` : sans cette mise à jour, il
          // continuerait d'afficher l'ancien nom jusqu'au prochain chargement.
          shops: state.shops.map((shop) =>
            shop.tenantId === state.tenantId ? { ...shop, tenantName } : shop,
          ),
        })),
      clear: () =>
        set({
          tenantId: null,
          tenantName: null,
          role: null,
          userId: null,
          shops: [],
          isPlatformAdmin: false,
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        tenantId: state.tenantId,
        tenantName: state.tenantName,
        role: state.role,
        userId: state.userId,
        shops: state.shops,
        // Un simple drapeau d'interface : la console reste protégée côté
        // serveur par `is_platform_admin()`.
        isPlatformAdmin: state.isPlatformAdmin,
      }),
    },
  ),
)

/** Lecture hors composant React (utile pour le moteur de synchronisation). */
export function getTenantId(): string | null {
  return useTenantStore.getState().tenantId
}

export function setTenantId(tenantId: string | null): void {
  if (tenantId === null) {
    useTenantStore.getState().clear()
    return
  }
  useTenantStore.setState({ tenantId })
}

/**
 * Charge les rattachements d'un utilisateur (palier 4 : multi-boutiques).
 *
 * Un gérant peut tenir plusieurs pressings. La boutique retenue est celle
 * déjà choisie sur l'appareil si elle fait toujours partie de ses droits,
 * sinon la plus ancienne adhésion. Ce choix n'accorde aucun droit : la RLS
 * revérifie l'appartenance à chaque requête.
 */
export async function resolveTenantForUser(userId: string): Promise<TenantMembership | null> {
  const supabase = getSupabaseClient()

  const { data: rows, error: membershipError } = await supabase
    .from('tenant_users')
    .select('tenant_id, role, created_at')
    .eq('user_id', userId)
    .order('created_at')

  if (membershipError) throw membershipError
  if (!rows || rows.length === 0) return null

  const ids = rows.map((row) => row.tenant_id)

  const { data: tenants, error: tenantError } = await supabase
    .from('tenants')
    .select('id, name')
    .in('id', ids)

  if (tenantError) throw tenantError

  const noms = new Map((tenants ?? []).map((tenant) => [tenant.id, tenant.name]))
  const shops: ShopMembership[] = rows.flatMap((row) => {
    const name = noms.get(row.tenant_id)
    return name ? [{ tenantId: row.tenant_id, tenantName: name, role: row.role }] : []
  })

  if (shops.length === 0) return null

  const memorisee = useTenantStore.getState().tenantId
  const choisi = shops.find((shop) => shop.tenantId === memorisee) ?? shops[0]

  useTenantStore.getState().setShops(shops, userId)
  useTenantStore.getState().setMembership({ ...choisi, userId })

  return { ...choisi, userId }
}
