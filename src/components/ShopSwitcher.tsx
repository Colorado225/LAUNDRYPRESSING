import { Store } from 'lucide-react'
import { useTenantStore } from '@/lib/tenantContext'
import { TENANT_ROLE_LABELS } from '@/constants/orders'

/**
 * Sélecteur de boutique (palier 4).
 *
 * Affiché uniquement quand le compte est rattaché à plusieurs pressings. Le
 * changement recharge l'application : les données hors ligne (Dexie), la caisse
 * et l'abonnement sont propres à chaque boutique, un simple re-rendu laisserait
 * des restes de l'ancienne.
 */
export default function ShopSwitcher() {
  const shops = useTenantStore((state) => state.shops)
  const tenantId = useTenantStore((state) => state.tenantId)
  const switchTenant = useTenantStore((state) => state.switchTenant)

  if (shops.length < 2) return null

  const changer = (valeur: string) => {
    if (valeur === tenantId) return
    switchTenant(valeur)
    window.location.assign('/commandes')
  }

  return (
    <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
      <Store size={16} aria-hidden />
      <span className="sr-only">Boutique active</span>
      <select
        value={tenantId ?? ''}
        onChange={(event) => changer(event.target.value)}
        className="min-h-12 max-w-52 rounded-xl border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 outline-none focus:border-brand-teal"
      >
        {shops.map((shop) => (
          <option key={shop.tenantId} value={shop.tenantId}>
            {shop.tenantName} — {TENANT_ROLE_LABELS[shop.role]}
          </option>
        ))}
      </select>
    </label>
  )
}
