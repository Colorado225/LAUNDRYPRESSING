import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Building2,
  CheckCircle2,
  Copy,
  CreditCard,
  Database,
  Download,
  HardDrive,
  KeyRound,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { usePendingOrderCount } from '@/db/hooks'
import {
  exporterDonneesLocales,
  purgerCommandesSynchronisees,
  resumerDonneesLocales,
  type ResumeLocal,
} from '@/db/maintenance'
import { TENANT_ROLE_LABELS } from '@/constants/orders'
import { isSupabaseConfigured } from '@/lib/env'
import { formatDateTimeFr } from '@/lib/formatters'
import { tailleLisible } from '@/lib/parametres'
import { can } from '@/lib/permissions'
import { useTenantStore } from '@/lib/tenantContext'
import { getSupabaseClient } from '@/lib/supabaseClient'
import { requestPasswordReset, signOutEverywhere } from '@/services/authService'
import {
  addTeamMemberByEmail,
  fetchTeamMembers,
  memberLabel,
  removeTeamMember,
  ROLE_LABELS,
  teamErrorMessage,
  updateTeamMember,
  type TeamMember,
} from '@/services/tenantMembers'
import { fetchTenantPressing, updateTenant } from '@/services/tenantService'
import type { TenantRole } from '@/types/database'
import { useSyncStore } from '@/stores/syncStore'
import { syncPendingOrders } from '@/sync/syncEngine'

/**
 * Paramètres — écran 12 de la maquette, version enrichie.
 *
 * Quatre responsabilités, et rien d'autre :
 *  1. **identifier** le pressing et le compte (avec les identifiants copiables
 *     que le support demandera) ;
 *  2. **renommer** le pressing — la seule écriture ouverte ici, réservée au
 *     propriétaire par la RLS ;
 *  3. **sécuriser** le compte : lien de réinitialisation, déconnexion de tous
 *     les appareils ;
 *  4. **entretenir les données locales** : voir ce qui est stocké, exporter une
 *     sauvegarde, purger ce qui est déjà au serveur.
 *
 * Ce qui reste ailleurs : la formule (`/abonnement`), l'équipe et les rôles
 * (propriétaire), la console éditeur (`/supervision`). Dupliquer ces écritures
 * ici créerait deux chemins pour la même donnée.
 */
const VERSION_APPLICATION = '0.7.0'

export default function Parametres() {
  const tenantId = useTenantStore((state) => state.tenantId)
  const tenantName = useTenantStore((state) => state.tenantName)
  const role = useTenantStore((state) => state.role)
  const userId = useTenantStore((state) => state.userId)
  const shops = useTenantStore((state) => state.shops)
  const renameTenant = useTenantStore((state) => state.renameTenant)

  const syncState = useSyncStore((state) => state.state)
  const lastSyncedAt = useSyncStore((state) => state.lastSyncedAt)
  const lastError = useSyncStore((state) => state.lastError)
  const pendingCount = usePendingOrderCount()

  const estProprietaire = can(role, 'tenant.manage')

  const [email, setEmail] = useState<string | null>(null)
  const [enLigne, setEnLigne] = useState(() => navigator.onLine)
  const [synchronisation, setSynchronisation] = useState(false)
  const [equipe, setEquipe] = useState<TeamMember[]>([])

  // Gestion de l'équipe : le propriétaire seul écrit (fonctions `tenant_*`,
  // migration 025). L'ajout se fait par e-mail : aucun mot de passe ne circule.
  const [membreEnEdition, setMembreEnEdition] = useState<TeamMember | null>(null)
  const [editMembreRole, setEditMembreRole] = useState<TenantRole>('receptionist')
  const [editMembreNom, setEditMembreNom] = useState('')
  const [ajoutMembreOuvert, setAjoutMembreOuvert] = useState(false)
  const [nouvelEmail, setNouvelEmail] = useState('')
  const [nouveauNom, setNouveauNom] = useState('')
  const [nouveauRole, setNouveauRole] = useState<TenantRole>('receptionist')
  const [equipeEnvoi, setEquipeEnvoi] = useState(false)

  const [edition, setEdition] = useState(false)
  const [nom, setNom] = useState(tenantName ?? '')
  const [telephone, setTelephone] = useState('')
  const [enregistrement, setEnregistrement] = useState(false)

  const [resume, setResume] = useState<ResumeLocal | null>(null)
  const [traitementLocal, setTraitementLocal] = useState(false)
  const [envoiLien, setEnvoiLien] = useState(false)

  useEffect(() => {
    const goOnline = () => setEnLigne(true)
    const goOffline = () => setEnLigne(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) return

    let actif = true
    void getSupabaseClient()
      .auth.getUser()
      .then(({ data }) => {
        if (actif) setEmail(data.user?.email ?? null)
      })
      .catch(() => undefined)

    return () => {
      actif = false
    }
  }, [])

  const rafraichirLocal = useCallback(async () => {
    const donnees = await resumerDonneesLocales(tenantId).catch(() => null)
    setResume(donnees)
  }, [tenantId])

  useEffect(() => {
    void rafraichirLocal()
  }, [rafraichirLocal])

  const rafraichirEquipe = useCallback(async () => {
    if (!tenantId || !isSupabaseConfigured) return
    try {
      setEquipe(await fetchTeamMembers(tenantId))
    } catch {
      // Hors ligne : la liste précédente reste affichée, les écritures seront
      // refusées par le service avec un message explicite.
    }
  }, [tenantId])

  useEffect(() => {
    void rafraichirEquipe()
  }, [rafraichirEquipe])

  const ouvrirEditionMembre = (membre: TeamMember) => {
    setMembreEnEdition(membre)
    setEditMembreRole(membre.role)
    setEditMembreNom(membre.displayName ?? '')
    setAjoutMembreOuvert(false)
  }

  const enregistrerMembre = async () => {
    if (!membreEnEdition) return
    setEquipeEnvoi(true)
    try {
      await updateTeamMember({
        userId: membreEnEdition.userId,
        role: editMembreRole,
        displayName: editMembreNom,
      })
      toast.success('Membre mis à jour', { icon: '👥' })
      setMembreEnEdition(null)
      await rafraichirEquipe()
    } catch (error) {
      toast.error(error instanceof Error ? teamErrorMessage(error.message) : 'Modification impossible')
    } finally {
      setEquipeEnvoi(false)
    }
  }

  const ajouterMembre = async () => {
    setEquipeEnvoi(true)
    try {
      await addTeamMemberByEmail({
        email: nouvelEmail,
        role: nouveauRole,
        displayName: nouveauNom,
      })
      toast.success('Collègue rattaché au pressing', { icon: '👥' })
      setNouvelEmail('')
      setNouveauNom('')
      setNouveauRole('receptionist')
      setAjoutMembreOuvert(false)
      await rafraichirEquipe()
    } catch (error) {
      toast.error(error instanceof Error ? teamErrorMessage(error.message) : 'Rattachement impossible')
    } finally {
      setEquipeEnvoi(false)
    }
  }

  const retirerMembre = async (membre: TeamMember) => {
    const confirme = window.confirm(
      `Détacher ${memberLabel(membre, userId)} du pressing ? Le compte reste actif, mais perd l’accès à ce pressing.`,
    )
    if (!confirme) return

    setEquipeEnvoi(true)
    try {
      await removeTeamMember(membre.userId)
      toast.success('Membre détaché du pressing')
      if (membreEnEdition?.userId === membre.userId) setMembreEnEdition(null)
      await rafraichirEquipe()
    } catch (error) {
      toast.error(error instanceof Error ? teamErrorMessage(error.message) : 'Retrait impossible')
    } finally {
      setEquipeEnvoi(false)
    }
  }

  const copier = async (valeur: string, libelle: string) => {
    try {
      await navigator.clipboard.writeText(valeur)
      toast.success(`${libelle} copié`, { icon: '📋' })
    } catch {
      toast.error('Copie impossible sur cet appareil.')
    }
  }

  const synchroniser = async () => {
    setSynchronisation(true)
    try {
      await syncPendingOrders()
      toast.success('Synchronisation terminée', { icon: '🔄' })
      await rafraichirLocal()
    } catch {
      toast.error('Synchronisation impossible : vérifiez votre connexion.')
    } finally {
      setSynchronisation(false)
    }
  }

  /**
   * Ouvre le formulaire en lisant d'abord la fiche réelle.
   *
   * Sans cette lecture, le champ téléphone partirait vide et l'enregistrement
   * effacerait le numéro existant — une perte silencieuse de donnée pour une
   * simple correction de nom.
   */
  const commencerEdition = async () => {
    if (!tenantId) {
      toast.error('Aucun pressing sélectionné.')
      return
    }
    setNom(tenantName ?? '')
    setTelephone('')
    setEdition(true)

    try {
      const fiche = await fetchTenantPressing(tenantId)
      setNom(fiche.name)
      setTelephone(fiche.phone ?? '')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Lecture du pressing impossible hors ligne.',
      )
    }
  }

  const enregistrerPressing = async () => {
    if (!tenantId) {
      toast.error('Aucun pressing sélectionné.')
      return
    }
    setEnregistrement(true)
    try {
      const maj = await updateTenant(tenantId, { name: nom, phone: telephone })
      renameTenant(maj.name)
      setEdition(false)
      toast.success('Informations du pressing mises à jour', { icon: '🏪' })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Enregistrement impossible')
    } finally {
      setEnregistrement(false)
    }
  }

  const envoyerLien = async () => {
    if (!email) {
      toast.error('Aucune adresse e-mail associée à ce compte.')
      return
    }
    setEnvoiLien(true)
    try {
      await requestPasswordReset(email)
      toast.success('Lien envoyé : consultez la boîte e-mail du compte.', { icon: '✉️' })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Envoi impossible')
    } finally {
      setEnvoiLien(false)
    }
  }

  const deconnecterPartout = async () => {
    const confirme = window.confirm(
      'Déconnecter ce compte de tous les appareils ?\n\n' +
        'Vous devrez vous reconnecter ici. Les commandes non synchronisées resteront sur cette tablette.',
    )
    if (!confirme) return

    try {
      await signOutEverywhere()
      toast.success('Compte déconnecté de tous les appareils')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Déconnexion impossible')
    }
  }

  const exporter = async () => {
    setTraitementLocal(true)
    try {
      const donnees = await exporterDonneesLocales(tenantId)
      const blob = new Blob([JSON.stringify(donnees, null, 2)], {
        type: 'application/json;charset=utf-8',
      })
      const url = URL.createObjectURL(blob)
      const lien = document.createElement('a')
      lien.href = url
      lien.download = `sauvegarde-pressing-${new Date().toISOString().slice(0, 10)}.json`
      lien.click()
      URL.revokeObjectURL(url)
      toast.success('Sauvegarde téléchargée', { icon: '💾' })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export impossible')
    } finally {
      setTraitementLocal(false)
    }
  }

  const purger = async () => {
    if (!resume || resume.purgeables === 0) return

    const confirme = window.confirm(
      `Effacer de cette tablette ${resume.purgeables} commande(s) déjà enregistrée(s) sur le serveur ?\n\n` +
        `Les ${resume.enAttente + resume.enConflit} commande(s) en attente ou en conflit seront conservées. ` +
        'Une copie reste consultable depuis le serveur, mais plus hors ligne.',
    )
    if (!confirme) return

    setTraitementLocal(true)
    try {
      const effacees = await purgerCommandesSynchronisees(tenantId)
      await rafraichirLocal()
      toast.success(`${effacees} commande(s) effacée(s) de la tablette`, { icon: '🧹' })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Suppression impossible')
    } finally {
      setTraitementLocal(false)
    }
  }

  const libelleSync =
    syncState === 'syncing'
      ? 'Envoi en cours'
      : syncState === 'error'
        ? 'Échec de synchronisation'
        : !enLigne
          ? 'Hors ligne'
          : pendingCount > 0
            ? `${pendingCount} commande${pendingCount > 1 ? 's' : ''} en attente`
            : 'Tout est synchronisé'

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-brand-navy sm:text-2xl">
          <ShieldCheck size={22} aria-hidden /> Paramètres
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Pressing, compte, équipe, synchronisation et données locales.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---------------------------------------------------------- Pressing */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex items-start justify-between gap-2">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
              <Building2 size={16} aria-hidden /> Pressing
            </h2>
            {estProprietaire && !edition && (
              <button
                type="button"
                onClick={() => void commencerEdition()}
                className="inline-flex min-h-12 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                <Pencil size={13} aria-hidden /> Modifier
              </button>
            )}
          </div>

          {edition ? (
            <div className="mt-3 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">Nom du pressing</span>
                <input
                  value={nom}
                  onChange={(event) => setNom(event.target.value)}
                  maxLength={80}
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">
                  Téléphone (facultatif)
                </span>
                <input
                  value={telephone}
                  onChange={(event) => setTelephone(event.target.value)}
                  inputMode="tel"
                  placeholder="07 07 07 07 07"
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
                />
                <span className="mt-1 block text-xs text-slate-500">
                  Facultatif. Laisser vide efface le numéro enregistré.
                </span>
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void enregistrerPressing()}
                  disabled={enregistrement}
                  className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white hover:bg-brand-teal-dark disabled:opacity-60"
                >
                  {enregistrement ? (
                    <Loader2 className="animate-spin" size={16} aria-hidden />
                  ) : (
                    <Save size={16} aria-hidden />
                  )}
                  Enregistrer
                </button>
                <button
                  type="button"
                  onClick={() => setEdition(false)}
                  className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-600"
                >
                  <X size={16} aria-hidden /> Annuler
                </button>
              </div>
            </div>
          ) : (
            <dl className="mt-3 space-y-3 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Nom</dt>
                <dd className="font-semibold text-slate-800">{tenantName ?? 'Non sélectionné'}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Identifiant (à communiquer au support)</dt>
                <dd className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-700">
                    {tenantId ?? '—'}
                  </code>
                  {tenantId && (
                    <button
                      type="button"
                      onClick={() => void copier(tenantId, 'Identifiant')}
                      className="inline-flex min-h-12 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 text-xs font-semibold text-slate-600"
                    >
                      <Copy size={14} aria-hidden /> Copier
                    </button>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Boutiques rattachées à ce compte</dt>
                <dd className="font-semibold text-slate-800">{shops.length || 1}</dd>
              </div>
            </dl>
          )}

          {!estProprietaire && (
            <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
              Seul le propriétaire peut renommer le pressing.
            </p>
          )}
        </section>

        {/* ----------------------------------------------------------- Compte */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            <UserRound size={16} aria-hidden /> Compte
          </h2>

          <dl className="mt-3 space-y-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Rôle sur ce pressing</dt>
              <dd className="font-semibold text-slate-800">
                {role ? TENANT_ROLE_LABELS[role] : 'Inconnu'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Adresse e-mail</dt>
              <dd className="font-semibold text-slate-800">{email ?? 'Non communiquée'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Identifiant du compte</dt>
              <dd className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-50 px-2 py-1.5 font-mono text-xs text-slate-700">
                  {userId ?? 'Mode démonstration'}
                </code>
                {userId && (
                  <button
                    type="button"
                    onClick={() => void copier(userId, 'Identifiant du compte')}
                    className="inline-flex min-h-12 items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 text-xs font-semibold text-slate-600"
                  >
                    <Copy size={14} aria-hidden /> Copier
                  </button>
                )}
              </dd>
            </div>
          </dl>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void envoyerLien()}
              disabled={envoiLien || !isSupabaseConfigured || !enLigne}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
            >
              {envoiLien ? (
                <Loader2 className="animate-spin" size={16} aria-hidden />
              ) : (
                <KeyRound size={16} aria-hidden />
              )}
              Changer le mot de passe
            </button>

            <button
              type="button"
              onClick={() => void deconnecterPartout()}
              disabled={!isSupabaseConfigured}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
            >
              <LogOut size={16} aria-hidden /> Déconnecter tous les appareils
            </button>
          </div>

          <p className="mt-2 text-xs text-slate-500">
            Le changement de mot de passe passe par un lien reçu par e-mail : aucun mot de passe ne
            transite par cette tablette.
          </p>
        </section>

        {/* ----------------------------------------------------------- Équipe */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
              <Users size={16} aria-hidden /> Équipe
            </h2>
            {estProprietaire && isSupabaseConfigured && enLigne && (
              <button
                type="button"
                onClick={() => {
                  setAjoutMembreOuvert((ouvert) => !ouvert)
                  setMembreEnEdition(null)
                }}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:border-brand-teal"
              >
                {ajoutMembreOuvert ? <X size={14} aria-hidden /> : <Plus size={14} aria-hidden />}
                {ajoutMembreOuvert ? 'Fermer' : 'Ajouter'}
              </button>
            )}
          </div>

          {equipe.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              {enLigne ? 'Aucun membre lisible pour ce compte.' : 'Équipe indisponible hors ligne.'}
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {equipe.map((membre) => (
                <li key={membre.userId} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-800">
                      {memberLabel(membre, userId)}
                    </span>
                    {membre.email && (
                      <span className="block truncate text-xs text-slate-400">{membre.email}</span>
                    )}
                  </span>

                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                      {ROLE_LABELS[membre.role]}
                    </span>

                    {estProprietaire && isSupabaseConfigured && enLigne && (
                      <>
                        <button
                          type="button"
                          onClick={() => ouvrirEditionMembre(membre)}
                          aria-label={`Modifier le membre ${memberLabel(membre, userId)}`}
                          className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
                        >
                          <Pencil size={14} aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => void retirerMembre(membre)}
                          aria-label={`Détacher le membre ${memberLabel(membre, userId)}`}
                          className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:border-rose-300 hover:text-rose-600"
                        >
                          <Trash2 size={14} aria-hidden />
                        </button>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {membreEnEdition && estProprietaire && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Modifier {memberLabel(membreEnEdition, userId)}
              </p>

              <label className="mt-2 block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">
                  Nom affiché (facultatif)
                </span>
                <input
                  value={editMembreNom}
                  onChange={(event) => setEditMembreNom(event.target.value)}
                  maxLength={80}
                  placeholder="Awa — comptoir"
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
                />
              </label>

              <label className="mt-2 block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">Rôle</span>
                <select
                  value={editMembreRole}
                  onChange={(event) => setEditMembreRole(event.target.value as TenantRole)}
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
                >
                  {(['owner', 'receptionist', 'artisan'] as TenantRole[]).map((valeur) => (
                    <option key={valeur} value={valeur}>
                      {ROLE_LABELS[valeur]}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void enregistrerMembre()}
                  disabled={equipeEnvoi}
                  className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white hover:bg-brand-teal-dark disabled:opacity-60"
                >
                  {equipeEnvoi ? (
                    <Loader2 className="animate-spin" size={16} aria-hidden />
                  ) : (
                    <Save size={16} aria-hidden />
                  )}
                  Enregistrer
                </button>
                <button
                  type="button"
                  onClick={() => setMembreEnEdition(null)}
                  className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-semibold text-slate-700"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}

          {ajoutMembreOuvert && estProprietaire && (
            <div className="mt-3 rounded-xl border border-brand-teal/40 bg-slate-50 p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Rattacher un collègue
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Le compte doit déjà exister (créé depuis l’écran de connexion). Aucun mot de passe
                ne circule ici.
              </p>

              <label className="mt-2 block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">E-mail</span>
                <input
                  type="email"
                  value={nouvelEmail}
                  onChange={(event) => setNouvelEmail(event.target.value)}
                  placeholder="collegue@exemple.ci"
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
                />
              </label>

              <label className="mt-2 block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">
                  Nom affiché (facultatif)
                </span>
                <input
                  value={nouveauNom}
                  onChange={(event) => setNouveauNom(event.target.value)}
                  maxLength={80}
                  placeholder="Awa — comptoir"
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
                />
              </label>

              <label className="mt-2 block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">Rôle</span>
                <select
                  value={nouveauRole}
                  onChange={(event) => setNouveauRole(event.target.value as TenantRole)}
                  className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-teal"
                >
                  {(['receptionist', 'artisan', 'owner'] as TenantRole[]).map((valeur) => (
                    <option key={valeur} value={valeur}>
                      {ROLE_LABELS[valeur]}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={() => void ajouterMembre()}
                disabled={equipeEnvoi}
                className="mt-2 inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-4 text-sm font-bold text-white hover:bg-brand-teal-dark disabled:opacity-60"
              >
                {equipeEnvoi ? (
                  <Loader2 className="animate-spin" size={16} aria-hidden />
                ) : (
                  <Plus size={16} aria-hidden />
                )}
                Rattacher au pressing
              </button>
            </div>
          )}

          <p className="mt-2 text-xs text-slate-500">
            {estProprietaire
              ? 'Seul le propriétaire gère l’équipe. Le dernier propriétaire ne peut pas être retiré.'
              : 'Seul le propriétaire peut ajouter ou modifier un membre de l’équipe.'}
          </p>
        </section>

        {/* -------------------------------------------------- Synchronisation */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            <Database size={16} aria-hidden /> Synchronisation
          </h2>

          <div className="mt-3 flex items-start gap-3">
            <span
              className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ${
                enLigne ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
              }`}
            >
              {enLigne ? <Wifi size={18} aria-hidden /> : <WifiOff size={18} aria-hidden />}
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-slate-800">{libelleSync}</p>
              <p className="mt-0.5 text-xs text-slate-500">
                {enLigne ? 'Connexion active' : 'Aucune connexion : tout reste sur la tablette'}
              </p>
              {lastSyncedAt && (
                <p className="mt-1 text-xs text-slate-500">
                  Dernière synchronisation : {formatDateTimeFr(lastSyncedAt)}
                </p>
              )}
              {lastError && (
                <p className="mt-1 text-xs text-rose-700">Dernière erreur : {lastError}</p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void synchroniser()}
            disabled={synchronisation || !enLigne}
            className="mt-3 inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
          >
            {synchronisation ? (
              <Loader2 className="animate-spin" size={16} aria-hidden />
            ) : (
              <RefreshCw size={16} aria-hidden />
            )}
            Synchroniser maintenant
          </button>
        </section>

        {/* ----------------------------------------------- Données locales */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 lg:col-span-2">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            <HardDrive size={16} aria-hidden /> Données sur cet appareil
          </h2>

          {resume === null ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="animate-spin" size={14} aria-hidden /> Lecture du stockage…
            </p>
          ) : (
            <>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-slate-500">Commandes</dt>
                  <dd className="font-bold text-brand-navy">{resume.commandes}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">En attente d’envoi</dt>
                  <dd
                    className={`font-bold ${resume.enAttente > 0 ? 'text-amber-700' : 'text-brand-navy'}`}
                  >
                    {resume.enAttente}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">En conflit</dt>
                  <dd className={`font-bold ${resume.enConflit > 0 ? 'text-rose-700' : 'text-brand-navy'}`}>
                    {resume.enConflit}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Espace occupé</dt>
                  <dd className="font-bold text-brand-navy">{tailleLisible(resume.octets)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Lignes de commande</dt>
                  <dd className="font-bold text-brand-navy">{resume.lignes}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Encaissements</dt>
                  <dd className="font-bold text-brand-navy">{resume.encaissements}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Effaçables sans perte</dt>
                  <dd className="font-bold text-brand-navy">{resume.purgeables}</dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void exporter()}
                  disabled={traitementLocal || resume.commandes === 0}
                  className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
                >
                  {traitementLocal ? (
                    <Loader2 className="animate-spin" size={16} aria-hidden />
                  ) : (
                    <Download size={16} aria-hidden />
                  )}
                  Exporter une sauvegarde
                </button>

                <button
                  type="button"
                  onClick={() => void purger()}
                  disabled={traitementLocal || resume.purgeables === 0}
                  className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-rose-200 px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                >
                  <Trash2 size={16} aria-hidden /> Effacer les commandes synchronisées
                </button>
              </div>

              <p className="mt-2 text-xs text-slate-500">
                La sauvegarde contient les commandes de ce pressing présentes sur la tablette, leurs
                lignes, les encaissements, les anomalies et les remboursements. Aucune commande en
                attente ou en conflit n’est jamais effacée par le nettoyage.
              </p>
            </>
          )}
        </section>

        {/* ------------------------------------------------------- Application */}
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 lg:col-span-2">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
            <CheckCircle2 size={16} aria-hidden /> Application
          </h2>

          <ul className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
            <li className="flex items-start gap-2">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
              Les commandes restent consultables hors ligne sur cet appareil.
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
              Mode {isSupabaseConfigured ? 'connecté à Supabase' : 'démonstration (Supabase non configuré)'}.
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
              Version {VERSION_APPLICATION} — application installable (PWA), utilisable hors ligne.
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden />
              Schéma de base : migrations 001 à 008.
            </li>
          </ul>

          {can(role, 'subscription.view') && (
            <Link
              to="/abonnement"
              className="mt-3 inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-teal px-3 text-sm font-bold text-white"
            >
              <CreditCard size={16} aria-hidden /> Voir l’abonnement
            </Link>
          )}
        </section>
      </div>
    </div>
  )
}
