import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Printer, QrCode as QrCodeIcon } from 'lucide-react'
import { generateQrImage, shortOrderReference } from '@/services/qrService'
import { formatDateFr, formatFcfa } from '@/lib/formatters'
import type { LocalOrder, LocalOrderItem } from '@/db/localDb'

/**
 * Étiquette QR imprimable (phase 3).
 *
 * Impression : plutôt que d'imprimer la page entière, on monte une étiquette
 * dédiée dans un portail `#print-root` ajouté au `<body>`. Les règles CSS de
 * `index.css` masquent alors l'application et n'impriment que l'étiquette au
 * format 80 mm — utile avec les imprimantes thermiques de comptoir.
 */

const PRINT_ROOT_ID = 'print-root'
const PRINTING_CLASS = 'impression-etiquette'

export interface QrCodeDisplayProps {
  order: LocalOrder
  items?: LocalOrderItem[]
  tenantName?: string | null
}

export default function QrCodeDisplay({ order, items = [], tenantName }: QrCodeDisplayProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [printRoot, setPrintRoot] = useState<HTMLElement | null>(null)

  // Génération de l'image (asynchrone, sans réseau)
  useEffect(() => {
    let active = true
    setDataUrl(null)
    setError(null)

    generateQrImage(order.qrCode)
      .then((url) => {
        if (active) setDataUrl(url)
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Impossible de générer le QR Code de cette commande.",
          )
        }
      })

    return () => {
      active = false
    }
  }, [order.qrCode])

  // Conteneur d'impression : créé à la demande, retiré au démontage.
  useEffect(() => {
    let container = document.getElementById(PRINT_ROOT_ID)
    let created = false

    if (!container) {
      container = document.createElement('div')
      container.id = PRINT_ROOT_ID
      document.body.appendChild(container)
      created = true
    }

    setPrintRoot(container)

    return () => {
      if (created) container?.remove()
    }
  }, [])

  const handlePrint = () => {
    document.body.classList.add(PRINTING_CLASS)
    const cleanup = () => {
      document.body.classList.remove(PRINTING_CLASS)
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)

    try {
      window.print()
    } finally {
      // Certains navigateurs Android n'émettent pas `afterprint`.
      window.setTimeout(cleanup, 1500)
    }
  }

  if (error) {
    return (
      <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        {error}
      </section>
    )
  }

  return (
    <>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-500">
              <QrCodeIcon size={16} aria-hidden />
              Étiquette QR
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              À coller sur le vêtement ou le sac. Scannez-la à l’atelier pour faire avancer la
              commande.
            </p>
          </div>

          <button
            type="button"
            onClick={handlePrint}
            disabled={!dataUrl}
            className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-navy px-4 text-sm font-bold text-white transition-colors hover:bg-brand-slate disabled:opacity-50"
          >
            <Printer size={18} aria-hidden />
            Imprimer l’étiquette
          </button>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <div className="flex size-32 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white p-2">
            {dataUrl ? (
              <img
                src={dataUrl}
                alt={`QR Code de la commande ${shortOrderReference(order.id)}`}
                className="size-full"
                width={128}
                height={128}
              />
            ) : (
              <Loader2 className="animate-spin text-slate-400" size={20} aria-hidden />
            )}
          </div>

          <dl className="min-w-0 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Référence</dt>
              <dd className="font-mono font-semibold text-brand-navy">
                {shortOrderReference(order.id)}
              </dd>
            </div>
            <div className="mt-2">
              <dt className="text-xs uppercase tracking-wide text-slate-500">Client</dt>
              <dd className="truncate font-medium text-slate-800">{order.customerName}</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* Étiquette destinée à l'impression uniquement */}
      {printRoot &&
        dataUrl &&
        createPortal(
          <LabelSheet
            order={order}
            items={items}
            tenantName={tenantName ?? 'Pressing'}
            dataUrl={dataUrl}
          />,
          printRoot,
        )}
    </>
  )
}

function LabelSheet({
  order,
  items,
  tenantName,
  dataUrl,
}: {
  order: LocalOrder
  items: LocalOrderItem[]
  tenantName: string
  dataUrl: string
}) {
  return (
    <div className="w-[80mm] bg-white px-3 py-2 text-slate-900">
      <header className="border-b border-dashed border-slate-400 pb-2 text-center">
        <p className="text-[13px] font-bold uppercase tracking-wide">{tenantName}</p>
        <p className="text-[9px] uppercase tracking-[0.2em] text-slate-500">Étiquette de commande</p>
      </header>

      <div className="py-2 text-center">
        <img
          src={dataUrl}
          alt=""
          className="mx-auto"
          style={{ width: '52mm', height: '52mm' }}
        />
        <p className="mt-1 font-mono text-[13px] font-bold tracking-wider">
          {shortOrderReference(order.id)}
        </p>
      </div>

      <div className="border-t border-dashed border-slate-400 pt-2 text-[10px] leading-snug">
        <p className="truncate">
          <span className="text-slate-500">Client : </span>
          <span className="font-semibold">{order.customerName}</span>
        </p>
        <p>
          <span className="text-slate-500">Reçu le : </span>
          {formatDateFr(order.createdAt)}
        </p>
        <p>
          <span className="text-slate-500">Vêtements : </span>
          {items.length > 0 ? items.length : '—'}
        </p>
        <p className="font-semibold">
          <span className="font-normal text-slate-500">Total : </span>
          {formatFcfa(order.totalAmount)}
        </p>

        {items.length > 0 && (
          <ul className="mt-1 border-t border-slate-200 pt-1">
            {items.slice(0, 4).map((item) => (
              <li key={item.id} className="truncate">
                • {item.label}
                {item.specialInstructions ? ` — ${item.specialInstructions}` : ''}
              </li>
            ))}
            {items.length > 4 && <li className="text-slate-500">+ {items.length - 4} autre(s)</li>}
          </ul>
        )}
      </div>

      <p className="mt-2 break-all text-center text-[9px] text-slate-600">
        Code : {order.qrCode}
      </p>
    </div>
  )
}
