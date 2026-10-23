import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { Camera, CameraOff, Loader2, X } from 'lucide-react'

/**
 * Scanner de QR Code (caméra de tablette Android).
 *
 * Points de robustesse :
 *  - démarrage et arrêt pilotés manuellement (`Html5Qrcode`, pas le scanner
 *    « clé en main » qui injecte sa propre interface) ;
 *  - nettoyage complet au démontage, y compris si la caméra n'a jamais démarré ;
 *  - refus de permission, absence de caméra et navigateur non compatible sont
 *    traités avec un message en français, sans écran blanc ;
 *  - un même code n'est transmis qu'une seule fois (évite le double scan).
 */

const SCANNER_ELEMENT_ID = 'qr-scanner-region'

export interface QrScannerProps {
  onScanSuccess: (decodedText: string) => void
  onClose?: () => void
}

export default function QrScanner({ onScanSuccess, onClose }: QrScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const hasScannedRef = useRef(false)
  const [status, setStatus] = useState<'démarrage' | 'actif' | 'erreur'>('démarrage')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, { verbose: false })
    scannerRef.current = scanner

    const start = async () => {
      try {
        await scanner.start(
          // Caméra arrière : celle qui pointe vers l'étiquette.
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decodedText) => {
            if (hasScannedRef.current) return
            hasScannedRef.current = true
            onScanSuccess(decodedText)
          },
          // Les échecs de décodage image par image sont normaux : on ignore.
          () => undefined,
        )

        if (disposed) {
          // Démontage pendant le démarrage : on arrête tout de suite.
          await safeStop(scanner)
          return
        }
        setStatus('actif')
      } catch (cause) {
        if (disposed) return
        setStatus('erreur')
        setError(describeCameraError(cause))
      }
    }

    void start()

    return () => {
      disposed = true
      void safeStop(scanner)
    }
  }, [onScanSuccess])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
          <Camera size={16} aria-hidden />
          Scanner un vêtement
        </h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le scanner"
            className="inline-flex size-12 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 active:bg-slate-200"
          >
            <X size={20} aria-hidden />
          </button>
        )}
      </div>

      {/* Zone vidéo gérée par html5-qrcode */}
      <div
        id={SCANNER_ELEMENT_ID}
        className="mx-auto w-full max-w-sm overflow-hidden rounded-2xl bg-slate-900 [&_video]:w-full"
      />

      {status === 'démarrage' && (
        <p className="flex items-center justify-center gap-2 text-sm text-slate-500">
          <Loader2 className="animate-spin" size={16} aria-hidden />
          Activation de la caméra…
        </p>
      )}

      {status === 'actif' && (
        <p className="text-center text-sm text-slate-600">
          Placez le QR Code de l’étiquette dans le cadre.
        </p>
      )}

      {status === 'erreur' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="flex items-center gap-2 font-semibold">
            <CameraOff size={16} aria-hidden />
            Caméra indisponible
          </p>
          <p className="mt-1">{error}</p>
          <p className="mt-2 text-xs">
            Vous pouvez saisir le code de l’étiquette manuellement ci-dessous.
          </p>
        </div>
      )}
    </div>
  )
}

/** Arrête puis libère la caméra, sans jamais lever d'exception. */
async function safeStop(scanner: Html5Qrcode): Promise<void> {
  try {
    if (scanner.isScanning) {
      await scanner.stop()
    }
  } catch {
    // La caméra peut avoir été libérée par le système (appel entrant, veille).
  } finally {
    try {
      scanner.clear()
    } catch {
      // `clear()` échoue si aucun rendu n'a eu lieu : sans conséquence.
    }
  }
}

function describeCameraError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause)

  if (/NotAllowedError|Permission denied|permission/i.test(message)) {
    return "L’accès à la caméra a été refusé. Autorisez la caméra dans les réglages du navigateur, puis réessayez."
  }
  if (/NotFoundError|Requested device not found|no camera/i.test(message)) {
    return "Aucune caméra détectée sur cet appareil."
  }
  if (/NotReadableError|Could not start video source/i.test(message)) {
    return "La caméra est déjà utilisée par une autre application."
  }
  if (/secure context|https/i.test(message)) {
    return "Le scan nécessite une connexion sécurisée (HTTPS) ou localhost."
  }
  return "Le scanner n’a pas pu démarrer sur cet appareil."
}
