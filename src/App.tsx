import { Suspense, lazy, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { Loader2 } from 'lucide-react'
import AppLayout from '@/components/AppLayout'
import TenantGate from '@/components/TenantGate'
import { startSyncEngine, stopSyncEngine } from '@/sync/syncEngine'

/**
 * Racine de l'application.
 *
 * Phase 2 : liste, création et fiche commande — toutes adossées à IndexedDB.
 * Phase 3 : page /atelier (scan QR + changement de statut).
 * Phase 4 : retour de paiement CinetPay (/paiement/retour).
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
const PaymentReturn = lazy(() => import('@/pages/PaymentReturn'))

export default function App() {
  useEffect(() => {
    startSyncEngine()
    return () => stopSyncEngine()
  }, [])

  return (
    <BrowserRouter>
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

      <TenantGate>
        <AppLayout>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Navigate to="/commandes" replace />} />
              <Route path="/commandes" element={<Orders />} />
              <Route path="/commandes/nouvelle" element={<OrderForm />} />
              <Route path="/commandes/:orderId" element={<OrderDetail />} />
              <Route path="/atelier" element={<Atelier />} />
              {/* Retour CinetPay. L'alias anglais évite de casser un lien déjà partagé. */}
              <Route path="/paiement/retour" element={<PaymentReturn />} />
              <Route path="/payment/return" element={<PaymentAliasRedirect />} />
              <Route path="*" element={<Navigate to="/commandes" replace />} />
            </Routes>
          </Suspense>
        </AppLayout>
      </TenantGate>
    </BrowserRouter>
  )
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
