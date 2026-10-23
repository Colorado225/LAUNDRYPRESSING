import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import Socle from '@/pages/Socle'

/**
 * Racine de l'application.
 *
 * Phase 1 : seule la page de diagnostic du socle est exposée.
 * Les routes métier (/connexion, /commandes, /atelier, /paiement/retour)
 * arrivent aux phases 2 à 5, avec chargement différé (`React.lazy`).
 */
export default function App() {
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

      <Routes>
        <Route path="/" element={<Socle />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
