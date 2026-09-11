import { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import API from '../api/axios';
import { Loader2, Download, Printer, CheckCircle2 } from 'lucide-react';
import html2pdf from 'html2pdf.js';

const InvoiceView = () => {
  const { orderId } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const invoiceRef = useRef();

  // Define HEX constants here to ensure they never become oklch variables
  const COLORS = {
    NAVY: '#0F172A',
    TEAL: '#0D9488',
    SKY: '#00AEEF',
    SLATE_50: '#F8FAFC',
    SLATE_100: '#F1F5F9',
    SLATE_400: '#94A3B8',
    SLATE_500: '#64748B',
    WHITE: '#FFFFFF',
    SUCCESS_BG: '#D1FAE5',
    SUCCESS_TEXT: '#065F46'
  };

  useEffect(() => {
    const fetchInvoice = async () => {
      try {
        const { data } = await API.get(`/orders/invoice/${orderId}`);
        setOrder(data);
      } catch (err) {
        console.error("Invoice fetch error", err);
      } finally {
        setLoading(false);
      }
    };
    fetchInvoice();
  }, [orderId]);

  const handleDownloadPDF = async () => {
    const element = invoiceRef.current;
    if (!element) return;

    const options = {
      margin: 0.2,
      filename: `Mufti_Invoice_${order?.trackingCode || 'Order'}.pdf`,
      image: { type: 'jpeg', quality: 1 },
      html2canvas: { 
        scale: 2, 
        useCORS: true, 
        logging: false,
        backgroundColor: COLORS.WHITE,
      },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
    };

    try {
      await html2pdf().set(options).from(element).save();
    } catch (error) {
      console.error("PDF Error:", error);
      alert("PDF generation failed. Using browser print instead.");
      window.print();
    }
  };

  if (loading) return (
    <div className="h-screen flex flex-col items-center justify-center bg-slate-50">
      <Loader2 className="animate-spin text-teal-600 mb-4" size={40} />
      <p className="text-xs font-black uppercase tracking-widest text-slate-400">Generating Invoice...</p>
    </div>
  );

  if (!order) return (
    <div className="h-screen flex items-center justify-center text-slate-500 font-bold">
      Invoice Not Found
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100 py-10 px-4">
      {/* Buttons - Keep Tailwind here (they aren't in the PDF) */}
      <div className="max-w-xl mx-auto mb-6 flex justify-end gap-3 no-print">
        <button 
          onClick={handleDownloadPDF}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#0F172A] text-white rounded-xl text-xs font-black uppercase shadow-lg hover:scale-105 transition-all"
        >
          <Download size={14} /> Download PDF
        </button>
        <button 
          onClick={() => window.print()}
          className="flex items-center gap-2 px-5 py-2.5 bg-white rounded-xl text-xs font-black uppercase border border-slate-200 shadow-sm"
        >
          <Printer size={14} /> Print
        </button>
      </div>

      <div ref={invoiceRef} className="print:m-0">
        <motion.div 
          style={{ backgroundColor: COLORS.WHITE, color: COLORS.NAVY }}
          className="max-w-xl mx-auto rounded-[2.5rem] shadow-2xl overflow-hidden border border-white"
        >
          {/* Header */}
          <div style={{ backgroundColor: COLORS.NAVY }} className="p-10 text-white relative">
            <div className="relative z-10">
              <h1 className="text-3xl font-black uppercase leading-none tracking-tighter">Mufti<br/>Laundry Spot</h1>
              <p style={{ color: COLORS.SKY }} className="text-[10px] font-bold uppercase tracking-[0.3em] mt-2">Premium Care Service</p>
            </div>
          </div>

          <div className="p-8 md:p-12">
            {/* Meta Info */}
            <div className="flex justify-between items-start mb-10">
              <div>
                <p style={{ color: COLORS.SLATE_400 }} className="text-[10px] font-black uppercase tracking-widest mb-1">Invoice To</p>
                <h3 style={{ color: COLORS.NAVY }} className="text-xl font-black capitalize">{order.customerName}</h3>
                <p style={{ color: COLORS.SLATE_500 }} className="text-sm font-bold">{order.customerPhone}</p>
              </div>
              <div className="text-right">
                <p style={{ color: COLORS.SLATE_400 }} className="text-[10px] font-black uppercase tracking-widest mb-1">Order ID</p>
                <h3 style={{ color: COLORS.NAVY }} className="text-sm font-black uppercase">#{order.trackingCode}</h3>
              </div>
            </div>

            {/* Items */}
            <div className="space-y-4 mb-8">
              <p style={{ color: COLORS.SLATE_400, borderBottom: `1px solid ${COLORS.SLATE_100}` }} className="text-[10px] font-black uppercase tracking-widest pb-2">Order Summary</p>
              
              {order.items?.map((item, index) => (
                <div key={index} className="flex justify-between items-center py-1">
                  <div>
                    <p style={{ color: COLORS.NAVY }} className="font-black uppercase text-sm">{item.itemName}</p>
                    <p style={{ color: COLORS.SLATE_400 }} className="text-[10px] font-bold">
                      {item.quantity} Unit{item.quantity > 1 ? 's' : ''} × ₦{item.unitPrice.toLocaleString()}
                    </p>
                  </div>
                  <p style={{ color: COLORS.NAVY }} className="font-bold text-base">₦{(item.quantity * item.unitPrice).toLocaleString()}</p>
                </div>
              ))}
            </div>

            {/* Total Section */}
            <div style={{ backgroundColor: COLORS.SLATE_50 }} className="rounded-3xl p-6 flex justify-between items-center">
              <div>
                <p style={{ color: COLORS.SLATE_400 }} className="text-[10px] font-black uppercase tracking-widest">Grand Total</p>
                <div className="flex items-center gap-2 mt-1">
                  {(order.status === 'READY' || order.status === 'DELIVERED') && (
                    <CheckCircle2 style={{ color: COLORS.TEAL }} size={18} />
                  )}
                  <span style={{ color: COLORS.NAVY }} className="text-2xl font-black tracking-tighter">₦{order.totalAmount?.toLocaleString()}</span>
                </div>
              </div>
              <div style={{ 
                backgroundColor: order.status === 'READY' ? COLORS.SUCCESS_BG : COLORS.NAVY,
                color: order.status === 'READY' ? COLORS.SUCCESS_TEXT : COLORS.WHITE
              }} className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest">
                {order.status?.replace('_', ' ')}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
      
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
    </div>
  );
};

export default InvoiceView;