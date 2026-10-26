import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { Loader2 } from 'lucide-react'
import AppLayout from '@/components/AppLayout'
import AuthGate from '@/components/AuthGate'
import { TenantOnboardingGate, TenantOnboardingProvider } from '@/components/TenantOnboardingGate'
import { useAndroidBackButton } from '@/hooks/useAndroidBackButton'
import { useTenantStore } from '@/lib/tenantContext'
import { startSyncEngine, stopSyncEngine } from '@/sync/syncEngine'

/**
 * Racine de l'application.
 *
 * Phase 2 : liste, création et fiche commande — toutes adossées à IndexedDB.
 * Phase 3 : page /atelier (scan QR + changement de statut).
 * Phase 4 : retour de paiement CinetPay (/paiement/retour).
 * Phase 5 : connexion Supabase (AuthGate), écran /offline, bouton Retour Android.
 * Palier 3 : tableau de bord, clients, stock et dépenses (écrans de gestion).
 * Palier 4 : abonnement, support et console de supervision de l'éditeur.
 * MVP : page Paramètres, réinitialisation du mot de passe, rapports (écran 11)
 * et facture A4 (reçu 80 mm à part).
 *
 * Les écrans sont chargés à la demande (`React.lazy`) : la librairie de scan
 * (`html5-qrcode`) pèse à elle seule plusieurs centaines de kilo-octets et ne
 * doit être téléchargée que lorsqu'un artisan ouvre l'atelier — décisif sur une
 * tablette Android d'entrée de gamme en 3G.
 */

const Orders = lazy(() => import('@/pages/Orders'))
const OrderForm = lazy(() => import('@/pages/OrderForm'))
const OrderDetail = lazy(() => import('@/pages/OrderDetail'))
const Atelier = lazy(() => import('@/pages/Atelier'))
const Caisse = lazy(() => import('@/pages/Caisse'))
const Receipt = lazy(() => import('@/pages/Receipt'))
const Facture = lazy(() => import('@/pages/Facture'))
const PaymentReturn = lazy(() => import('@/pages/PaymentReturn'))
const Offline = lazy(() => import('@/pages/Offline'))
const TableauDeBord = lazy(() => import('@/pages/TableauDeBord'))
const Clients = lazy(() => import('@/pages/Clients'))
const Stock = lazy(() => import('@/pages/Stock'))
const Depenses = lazy(() => import('@/pages/Depenses'))
const Abonnement = lazy(() => import('@/pages/Abonnement'))
const Support = lazy(() => import('@/pages/Support'))
const Supervision = lazy(() => import('@/pages/Supervision'))
const Rapports = lazy(() => import('@/pages/Rapports'))
const Parametres = lazy(() => import('@/pages/Parametres'))
const Audit = lazy(() => import('@/pages/Audit'))
const Reinitialisation = lazy(() => import('@/pages/Reinitialisation'))
const ServicesPressing = lazy(() => import('@/pages/ServicesPressing'))

export default function App() {
  useEffect(() => {
    startSyncEngine()
    return () => stopSyncEngine()
  }, [])

  return (
    <BrowserRouter>
      <BackButtonGuard />
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 4000,
          style: {
            fontSize: '14px',
            borderRadius: '12px',
            background: '#0f172a',
            color: '#ffffff',
          },
        }}
      />

      <RootRoutes />
    </BrowserRouter>
  )
}

/**
 * Aiguillage racine.
 *
 * `/reinitialisation` est traité **avant** `AuthGate` : le lien envoyé par
 * Supabase ouvre une session de récupération, mais le compte peut n'avoir
 * encore aucune appartenance chargée quand la page s'affiche. Toute autre
 * adresse passe par la porte d'authentification habituelle.
 */
function RootRoutes() {
  const { pathname } = useLocation()

  if (pathname === '/reinitialisation') {
    return (
      <Suspense fallback={<PageLoader />}>
        <Reinitialisation />
      </Suspense>
    )
  }

  return (
    <AuthGate>
      <TenantOnboardingProvider>
        <TenantOnboardingGate>
          <AppLayout>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Accueil />} />
                <Route path="/bienvenue" element={<ServicesPressing />} />
                <Route path="/prestations" element={<ServicesPressing />} />
                <Route path="/commandes" element={<Orders />} />
                <Route path="/commandes/nouvelle" element={<OrderForm />} />
                <Route path="/commandes/:orderId" element={<OrderDetail />} />
                <Route path="/atelier" element={<Atelier />} />
                <Route path="/caisse" element={<Caisse />} />
                <Route path="/tableau-de-bord" element={<TableauDeBord />} />
                <Route path="/rapports" element={<Rapports />} />
                <Route path="/clients" element={<Clients />} />
                <Route path="/stock" element={<Stock />} />
                <Route path="/depenses" element={<Depenses />} />
                <Route path="/abonnement" element={<Abonnement />} />
                <Route path="/support" element={<Support />} />
                <Route path="/supervision" element={<Supervision />} />
                <Route path="/parametres" element={<Parametres />} />
                <Route path="/audit" element={<Audit />} />
                <Route path="/commandes/:orderId/recu" element={<Receipt />} />
                <Route path="/commandes/:orderId/facture" element={<Facture />} />
                <Route path="/offline" element={<Offline />} />
                {/* Retour CinetPay. L'alias anglais évite de casser un lien déjà partagé. */}
                <Route path="/paiement/retour" element={<PaymentReturn />} />
                <Route path="/payment/return" element={<PaymentAliasRedirect />} />
                <Route path="*" element={<Accueil />} />
              </Routes>
            </Suspense>
          </AppLayout>
        </TenantOnboardingGate>
      </TenantOnboardingProvider>
    </AuthGate>
  )
}

/** Renvoie un éditeur sans pressing directement vers son back-office. */
function Accueil() {
  const tenantId = useTenantStore((state) => state.tenantId)
  const isPlatformAdmin = useTenantStore((state) => state.isPlatformAdmin)

  return <Navigate to={!tenantId && isPlatformAdmin ? '/supervision' : '/commandes'} replace />
}

/**
 * Monte la gestion du bouton « Retour » Android. Doit être enfant du routeur :
 * le hook s'appuie sur `useNavigate` et `useLocation`.
 */
function BackButtonGuard() {
  useAndroidBackButton()
  return null
}

/** Conserve les paramètres de requête (transaction_id…) lors de l'alias. */
function PaymentAliasRedirect() {
  const location = useLocation()
  return <Navigate to={`/paiement/retour${location.search}`} replace />
}

function PageLoader() {
  return (
    <div
      className="flex items-center justify-center gap-3 py-24 text-slate-500"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="animate-spin" size={20} aria-hidden />
      Chargement de l’écran…
    </div>
  )
}
