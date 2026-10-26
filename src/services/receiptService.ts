import type { LocalOrder, LocalOrderItem } from "@/db/localDb";

/**
 * Échappe une valeur saisie (nom du client, libellé d'article, nom du
 * pressing) avant interpolation dans le HTML d'impression.
 *
 * Le reçu est écrit par `document.write` dans une fenêtre de même origine :
 * sans échappement, un libellé contenant du HTML serait interprété comme du
 * balisage (au mieux un reçu cassé, au pire du script exécuté avec accès à la
 * fenêtre parente). Les autres documents (reçu, facture, étiquette) passent
 * par React, qui échappe par défaut ; ce générateur-ci doit le faire à la main.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Génère le texte du reçu formaté pour WhatsApp (avec emojis et markdown)
 */
export function generateReceiptText(
  order: LocalOrder,
  items: LocalOrderItem[],
  tenantName: string,
): string {
  const dateCreation = new Date(order.createdAt).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const dateRetrait = order.dueDate
    ? new Date(order.dueDate + "T12:00:00").toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "Non définie";

  const lignesArticles = items
    .map(
      (item) =>
        `  • ${item.label} (${item.quantity}x) : ${item.packageLineId ? "inclus dans le forfait" : `${item.price.toLocaleString("fr-FR")} FCFA`}`,
    )
    .join("\n");

  return `📋 *REÇU DE COMMANDE*
━━━━━━━━━━━━━━━━━━━━━━
🏪 ${tenantName}
📅 Date de dépôt : ${dateCreation}
📆 Date de retrait : ${dateRetrait}
🔢 Numéro : ${order.qrCode}

👤 Client : ${order.customerName}
📞 Téléphone : ${order.customerPhone}

🧺 VOS VÊTEMENTS :
${lignesArticles || "  Aucun article"}

💰 TOTAL : ${order.totalAmount.toLocaleString("fr-FR")} FCFA
💳 Statut paiement : ${order.paymentStatus === "paid" ? "✅ Payé" : order.paymentStatus === "partial" ? "⚠️ Acompte" : "❌ En attente"}

━━━━━━━━━━━━━━━━━━━━━━
Merci pour votre confiance !`;
}

/**
 * Génère l'URL WhatsApp pour partager le reçu
 * Normalise les numéros ivoiriens (07XX... devient 2257XX...)
 */
export function generateWhatsAppUrl(
  phone: string,
  receiptText: string,
): string {
  let cleanPhone = phone.replace(/\D/g, "");

  // Normalisation des numéros ivoiriens
  if (cleanPhone.startsWith("0")) {
    cleanPhone = "225" + cleanPhone.substring(1);
  } else if (!cleanPhone.startsWith("225")) {
    cleanPhone = "225" + cleanPhone;
  }

  const encodedText = encodeURIComponent(receiptText);
  return `https://wa.me/${cleanPhone}?text=${encodedText}`;
}

/**
 * Génère le HTML du reçu imprimable (optimisé pour imprimantes 80mm)
 */
export function generatePrintableReceipt(
  order: LocalOrder,
  items: LocalOrderItem[],
  tenantName: string,
): string {
  const dateCreation = new Date(order.createdAt).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const dateRetrait = order.dueDate
    ? new Date(order.dueDate + "T12:00:00").toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "Non définie";

  const lignesArticles = items
    .map(
      (item) => `
      <tr>
        <td style="text-align: left; padding: 2px 0; font-size: 11px;">${escapeHtml(item.label)} (${item.quantity}x)</td>
        <td style="text-align: right; padding: 2px 0; font-size: 11px;">${item.packageLineId ? "Inclus" : item.price.toLocaleString("fr-FR")}</td>
      </tr>`,
    )
    .join("");

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Reçu - ${escapeHtml(order.qrCode)}</title>
  <style>
    @media print {
      body { margin: 0; padding: 0; width: 300px; font-family: monospace; }
      .receipt { width: 300px; padding: 10px; }
    }
    body { font-family: 'Courier New', monospace; max-width: 300px; margin: 0 auto; }
    .receipt { padding: 10px; }
    .header { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 10px; margin-bottom: 10px; }
    .info-row { display: flex; justify-content: space-between; margin: 3px 0; font-size: 11px; }
    .divider { border-bottom: 1px dashed #000; margin: 8px 0; }
    .total { font-weight: bold; font-size: 13px; border-top: 1px solid #000; padding-top: 8px; margin-top: 8px; }
    .footer { text-align: center; margin-top: 15px; font-size: 10px; color: #666; }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <h2 style="margin: 0; font-size: 14px;">${escapeHtml(tenantName)}</h2>
      <p style="margin: 5px 0 0; font-size: 10px;">REÇU DE COMMANDE</p>
    </div>

    <div class="info-row">
      <span>N° commande:</span>
      <span>${escapeHtml(order.qrCode)}</span>
    </div>
    <div class="info-row">
      <span>Dépôt:</span>
      <span>${dateCreation}</span>
    </div>
    <div class="info-row">
      <span>Retrait:</span>
      <span>${dateRetrait}</span>
    </div>

    <div class="divider"></div>

    <div class="info-row">
      <span>Client:</span>
      <span>${escapeHtml(order.customerName)}</span>
    </div>
    <div class="info-row">
      <span>Tél:</span>
      <span>${escapeHtml(order.customerPhone)}</span>
    </div>

    <div class="divider"></div>

    <table style="width: 100%; border-collapse: collapse;">
      ${lignesArticles}
    </table>

    <div class="info-row total">
      <span>TOTAL:</span>
      <span>${order.totalAmount.toLocaleString("fr-FR")} FCFA</span>
    </div>

    <div class="info-row">
      <span>Paiement:</span>
      <span>${order.paymentStatus === "paid" ? "Payé" : order.paymentStatus === "partial" ? "Acompte" : "En attente"}</span>
    </div>

    <div class="footer">
      Merci pour votre confiance !
    </div>
  </div>
</body>
</html>`;
}

/**
 * Déclenche l'impression du reçu
 */
export function printReceipt(htmlContent: string): void {
  const printWindow = window.open("", "_blank", "width=320,height=600");
  if (!printWindow) {
    throw new Error(
      "Impossible d'ouvrir la fenêtre d'impression. Vérifiez les popups.",
    );
  }
  printWindow.document.write(htmlContent);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}
