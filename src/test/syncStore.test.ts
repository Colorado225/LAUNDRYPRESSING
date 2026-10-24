import { beforeEach, describe, expect, it } from 'vitest'
import { getSavedLastSyncAt, useSyncStore } from '@/stores/syncStore'

const TENANT = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  localStorage.clear()
  useSyncStore.getState().reset()
})

describe('état de synchronisation', () => {
  it('mémorise la dernière réussite par pressing', () => {
    useSyncStore.getState().finishSync({ tenantId: TENANT, pendingCount: 0, lastError: null })

    const saved = getSavedLastSyncAt(TENANT)
    expect(saved).not.toBeNull()
    expect(Number.isNaN(Date.parse(saved!))).toBe(false)
    expect(useSyncStore.getState()).toMatchObject({ state: 'idle', lastSyncedTenantId: TENANT })
  })

  it('conserve l’horodatage réussi après une tentative en échec', () => {
    useSyncStore.getState().finishSync({ tenantId: TENANT, pendingCount: 0, lastError: null })
    const saved = getSavedLastSyncAt(TENANT)

    useSyncStore.getState().finishSync({
      tenantId: TENANT,
      pendingCount: 2,
      lastError: 'Réseau indisponible',
    })

    expect(getSavedLastSyncAt(TENANT)).toBe(saved)
    expect(useSyncStore.getState()).toMatchObject({ state: 'error', lastError: 'Réseau indisponible' })
  })

  it('ne lit pas le dernier passage d’un autre pressing', () => {
    useSyncStore.getState().finishSync({ tenantId: TENANT, pendingCount: 0, lastError: null })
    expect(getSavedLastSyncAt('22222222-2222-4222-8222-222222222222')).toBeNull()
  })
})
