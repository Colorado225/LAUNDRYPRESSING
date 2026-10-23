import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

const STORAGE_KEY = 'laundry_tenant_id'

interface TenantState {
  tenantId: string | null
  setTenantId: (value: string | null) => void
}

export const useTenantStore = create<TenantState>()(
  persist(
    (set) => ({
      tenantId: null,
      setTenantId: (value) => set({ tenantId: value }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
    }
  )
)

export function getTenantId(): string | null {
  return useTenantStore.getState().tenantId
}

export function setTenantId(value: string | null) {
  useTenantStore.getState().setTenantId(value)
}
