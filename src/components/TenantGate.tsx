import { useState, type FormEvent } from 'react'
import { ArrowRight, Building2, Info } from 'lucide-react'
import { DEMO_TENANT_ID } from '@/lib/env'
import { useTenantStore } from '@/lib/tenantContext'

/**
 * Sélection provisoire du pressing.
 *
 * ⚠️ Écran TEMPORAIRE : la connexion Supabase Auth (email / mot de passe) et la
 * résolution automatique du tenant arrivent en phase 5. D'ici là, cet écran
 * permet de tester la couche offline-first sans coder d'identifiant en dur.
 */
export default function TenantGate({ children }: { children: React.ReactNode }) {
  const tenantId = useTenantStore((state) => state.tenantId)
  const setMembership = useTenantStore((state) => state.setMembership)

  const [value, setValue] = useState(DEMO_TENANT_ID ?? '')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (tenantId) return <>{children}</>

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const id = value.trim()

    if (!id) {
      setError('Renseignez l’identifiant du pressing.')
      return
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      setError('Identifiant invalide : un UUID est attendu (voir supabase/seed.sql).')
      return
    }

    setError(null)
    setMembership({
      tenantId: id,
      tenantName: name.trim() || 'Pressing de démonstration',
      role: 'owner',
    })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-navy px-4 py-10">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
        <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-brand-teal/10 text-brand-teal">
          <Building2 size={24} aria-hidden />
        </span>

        <h1 className="mt-4 text-2xl font-bold text-brand-navy">Choisir le pressing</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Indiquez l’identifiant du pressing à utiliser sur cette tablette. Les commandes créées
          restent enregistrées localement et seront synchronisées dès qu’un projet Supabase sera
          configuré.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="tenant-id" className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Identifiant du pressing (UUID)
            </label>
            <input
              id="tenant-id"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="11111111-1111-4111-8111-111111111111"
              autoComplete="off"
              spellCheck={false}
              className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-300 px-3 font-mono text-sm outline-none focus:border-brand-teal"
            />
          </div>

          <div>
            <label htmlFor="tenant-name" className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Nom affiché (optionnel)
            </label>
            <input
              id="tenant-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Pressing Cocody"
              className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-brand-teal"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-navy px-4 text-sm font-bold text-white transition-colors hover:bg-brand-slate"
          >
            Continuer
            <ArrowRight size={18} aria-hidden />
          </button>
        </form>

        <div className="mt-6 flex gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
          <Info size={16} className="mt-0.5 shrink-0" aria-hidden />
          <p>
            La connexion par e-mail et mot de passe arrive en phase 5. En attendant, utilisez
            l’UUID créé par <code className="font-mono">supabase/seed.sql</code> ou définissez{' '}
            <code className="font-mono">VITE_DEMO_TENANT_ID</code>.
          </p>
        </div>
      </div>
    </div>
  )
}
