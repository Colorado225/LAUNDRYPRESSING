import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import AppLayout from '@/components/AppLayout'
import TenantGate from '@/components/TenantGate'
import Orders from '@/pages/Orders'
import OrderForm from '@/pages/OrderForm'
import OrderDetail from '@/pages/OrderDetail'
import { startSyncEngine, stopSyncEngine } from '@/sync/syncEngine'

/**
 * Racine de l'application.
 *
 * Phase 2 : liste, création et fiche commande — toutes adossées à IndexedDB.
 * Le moteur de synchronisation démarre une seule fois pour toute la session.
 */
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
          <Routes>
            <Route path="/" element={<Navigate to="/commandes" replace />} />
            <Route path="/commandes" element={<Orders />} />
            <Route path="/commandes/nouvelle" element={<OrderForm />} />
            <Route path="/commandes/:orderId" element={<OrderDetail />} />
            <Route path="*" element={<Navigate to="/commandes" replace />} />
          </Routes>
        </AppLayout>
      </TenantGate>
    </BrowserRouter>
  )
}
