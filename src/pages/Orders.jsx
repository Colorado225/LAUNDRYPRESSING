import { useEffect, useState, useCallback, useRef } from 'react';
import API from '../api/axios';
import { 
  Search, Plus, Loader2, Clock, Printer, 
  FileDown, MoreVertical, CreditCard, ChevronRight,
  Receipt as ReceiptIcon 
} from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { useReactToPrint } from 'react-to-print';

// Components
import BillingModal from '../components/BillingModal';
import StatusUpdateModal from '../components/StatusUpdateModal';
import CreateOrderModal from '../components/CreateOrderModal';
import PrintableTag from '../components/PrintableTag';
import PaymentModal from '../components/PaymentModal';
import { Receipt } from '../components/Receipt';

const Orders = () => {
  const [orders, setOrders] = useState([]);
  const [allStaff, setAllStaff] = useState([]); 
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [printingTagOrder, setPrintingTagOrder] = useState(null);
  const [printingReceiptOrder, setPrintingReceiptOrder] = useState(null);
  
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [isEditingBill, setIsEditingBill] = useState(false); 
  
  const tagRef = useRef();
  const receiptRef = useRef();

  const tabs = [
    { label: 'All', value: 'ALL' },
    { label: 'New', value: 'REQUESTED' },
    { label: 'Picked', value: 'PICKED_UP' },
    { label: 'Billed', value: 'BILLED' },
    { label: 'Processing', value: 'PROCESSING' },
    { label: 'Ready', value: 'READY' },
    { label: 'Sent', value: 'DELIVERED' }
  ];

  // Restored: Production Pipeline Logic
  const pipelineStats = {
    New: orders.filter(o => o.status === 'REQUESTED').length,
    Picked: orders.filter(o => o.status === 'PICKED_UP').length,
    Billed: orders.filter(o => o.status === 'BILLED').length,
    Processing: orders.filter(o => o.status === 'PROCESSING').length,
    Ready: orders.filter(o => o.status === 'READY').length,
    Sent: orders.filter(o => o.status === 'DELIVERED').length,
  };

  // --- PRINT ENGINES ---
  const handlePrintTag = useReactToPrint({
    contentRef: tagRef,
    onAfterPrint: () => setPrintingTagOrder(null),
  });

  const handlePrintReceipt = useReactToPrint({
    contentRef: receiptRef,
    onAfterPrint: () => setPrintingReceiptOrder(null),
  });

  const triggerTagPrint = (order) => {
    setPrintingTagOrder(order);
    setTimeout(() => handlePrintTag(), 300);
  };

  const triggerReceiptPrint = (order) => {
    setPrintingReceiptOrder(order);
    setTimeout(() => handlePrintReceipt(), 300);
  };

  // --- DATA FETCHING ---
  const fetchOrders = useCallback(async () => {
    try {
      const { data } = await API.get('/orders/all');
      setOrders(data);
    } catch (error) {
      console.error("Error fetching orders:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStaffList = useCallback(async () => {
    try {
      const { data } = await API.get('/admin/staff');
      setAllStaff(data); 
    } catch (err) {
      console.error("Error loading staff:", err);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
    fetchStaffList();
  }, [fetchOrders, fetchStaffList]);

  // --- UI HELPERS ---
  const handleViewInvoice = (orderId) => {
    window.open(`/invoice/${orderId}`, '_blank');
  };

  const filteredOrders = orders.filter(order => {
    const matchesSearch = 
      order.customerName.toLowerCase().includes(searchTerm.toLowerCase()) || 
      order.trackingCode?.toLowerCase().includes(searchTerm.toLowerCase());
    if (activeTab === 'ALL') return matchesSearch;
    return matchesSearch && order.status === activeTab;
  });

  const getStatusStyles = (status) => {
    switch(status) {
      case 'REQUESTED': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'PICKED_UP': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'BILLED': return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'PROCESSING': return 'bg-indigo-100 text-indigo-700 border-indigo-200';
      case 'READY': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'DELIVERED': return 'bg-slate-100 text-slate-500 border-slate-200';
      default: return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getPaymentStyles = (status) => {
    switch(status) {
      case 'PAID': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      case 'PARTIAL': return 'bg-sky-100 text-sky-700 border-sky-200';
      case 'UNPAID': return 'bg-rose-100 text-rose-700 border-rose-200';
      default: return 'bg-slate-50 text-slate-400 border-slate-100';
    }
  };

  const renderManagementModal = () => {
    if (!selectedOrder || showPaymentModal) return null;
    const showBillingView = isEditingBill || selectedOrder.status === 'REQUESTED' || selectedOrder.status === 'PICKED_UP';

    if (showBillingView) {
      return (
        <BillingModal 
          key={`billing-${selectedOrder.id}`} 
          order={selectedOrder} 
          onClose={() => { setSelectedOrder(null); setIsEditingBill(false); }} 
          onUpdate={() => { fetchOrders(); setSelectedOrder(null); setIsEditingBill(false); }} 
        />
      );
    }

    return (
      <StatusUpdateModal 
        key={`status-${selectedOrder.id}`} 
        order={selectedOrder} 
        allStaff={allStaff} 
        onClose={() => { setSelectedOrder(null); setIsEditingBill(false); }} 
        onUpdate={() => { fetchOrders(); setSelectedOrder(null); setIsEditingBill(false); }} 
        onEditBill={() => setIsEditingBill(true)}
      />
    );
  };

  if (loading) return (
    <div className="h-96 flex flex-col items-center justify-center text-brand-navy gap-4">
      <Loader2 className="animate-spin text-brand-teal" size={40} />
      <p className="font-black tracking-widest uppercase text-[10px]">Syncing Console...</p>
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8 pb-20 md:pb-0">
      
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-black text-brand-navy uppercase tracking-tighter">Inventory Console</h1>
          <p className="text-slate-500 text-[10px] flex items-center gap-2 font-black uppercase tracking-widest">
            <Clock size={12} className="text-brand-teal" /> Real-time Operations
          </p>
        </div>
        <button 
          onClick={() => setShowCreateModal(true)}
          className="w-full md:w-auto flex items-center justify-center gap-2 px-6 py-3 bg-brand-navy text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl shadow-brand-navy/20 hover:bg-brand-teal transition-all"
        >
          <Plus size={16} /> Create New Order
        </button>
      </div>

      {/* RESTORED: WORKFLOW PIPELINE SUMMARY */}
      <section className="bg-white border border-slate-100 rounded-[2.5rem] p-6 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 mb-6">
            <div className="w-1.5 h-1.5 rounded-full bg-brand-teal" />
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Production Pipeline</h3>
        </div>
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-4">
          {Object.entries(pipelineStats).map(([label, count], idx) => (
            <div key={label} className="relative flex flex-col">
              <span className="text-[8px] font-black text-slate-300 uppercase tracking-tighter mb-1">{label}</span>
              <div className="flex items-baseline gap-1">
                <span className={`text-xl font-black ${count > 0 ? 'text-brand-navy' : 'text-slate-200'}`}>{count}</span>
                <span className="text-[7px] font-bold text-slate-300 uppercase">Items</span>
              </div>
              <div className={`h-1 w-8 rounded-full mt-2 ${count > 0 ? 'bg-brand-teal' : 'bg-slate-50'}`} />
              {idx < 5 && <ChevronRight size={12} className="absolute right-0 top-1/2 -translate-y-1/2 text-slate-100 hidden lg:block" />}
            </div>
          ))}
        </div>
      </section>

      {/* SEARCH & FILTERS */}
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search name or ID..." 
            className="w-full pl-12 pr-4 py-3.5 bg-white rounded-2xl border border-slate-200 outline-none focus:ring-4 focus:ring-brand-teal/5 text-sm font-bold shadow-sm"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-tighter transition-all whitespace-nowrap border ${
                activeTab === tab.value 
                ? 'bg-brand-navy border-brand-navy text-white shadow-lg' 
                : 'bg-white border-slate-200 text-slate-500 hover:border-brand-teal'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* MAIN TABLE AREA */}
      <div className="bg-transparent md:bg-white md:rounded-[2.5rem] md:shadow-xl md:shadow-slate-200/40 md:border md:border-slate-100">
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50/50 border-b border-slate-50">
              <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                <th className="px-10 py-5">Order ID</th>
                <th className="px-10 py-5">Client</th>
                <th className="px-10 py-5">Workflow Stage</th>
                <th className="px-10 py-5 text-right">Finance</th>
                <th className="px-10 py-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredOrders.map((order) => {
                const balance = order.totalAmount - (order.amountPaid || 0);
                return (
                  <tr key={order.id} className="hover:bg-slate-50/30 transition-colors group">
                    <td className="px-10 py-6">
                      <span className="text-brand-teal font-black text-xs tracking-widest">
                        #{order.trackingCode || order.id.slice(-4).toUpperCase()}
                      </span>
                    </td>
                    <td className="px-10 py-6">
                      <p className="font-black text-brand-navy text-sm leading-none">{order.customerName}</p>
                      <p className="text-[9px] font-bold text-slate-400 uppercase mt-1">{order.customerPhone}</p>
                    </td>
                    <td className="px-10 py-6">
                      <span className={`px-2.5 py-1 rounded-md text-[8px] font-black uppercase tracking-widest border ${getStatusStyles(order.status)}`}>
                        {order.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-10 py-6 text-right">
                      {/* RESTORED: Detailed Finance Cell */}
                      <div className="flex flex-col items-end">
                        <div className="flex gap-2 items-center">
                           <span className={`px-1.5 py-0.5 rounded-md text-[7px] font-black uppercase border ${getPaymentStyles(order.paymentStatus)}`}>
                            {order.paymentStatus || 'UNPAID'}
                          </span>
                          <span className="text-sm font-black text-brand-navy">₦{order.totalAmount?.toLocaleString()}</span>
                        </div>
                        <span className={`text-[8px] font-bold uppercase mt-1 ${balance > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                           {balance > 0 ? `₦${balance.toLocaleString()} Due` : 'Fully Paid'}
                        </span>
                      </div>
                    </td>
                    <td className="px-10 py-6 text-right">
                      <div className="flex justify-end items-center gap-3">
                        <button 
                          onClick={() => setSelectedOrder(order)} 
                          className="px-4 py-2 bg-slate-900 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-brand-teal transition-all shadow-md active:scale-95"
                        >
                          Manage
                        </button>
                        <ActionMenu 
                          order={order} 
                          onPrintTag={() => triggerTagPrint(order)} 
                          onPrintReceipt={() => triggerReceiptPrint(order)} 
                          handleViewInvoice={handleViewInvoice} 
                          onPay={() => {
                            setSelectedOrder(order);
                            setShowPaymentModal(true);
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* MOBILE CARD VIEW */}
        <div className="md:hidden space-y-4">
          {filteredOrders.map((order) => {
            const balance = order.totalAmount - (order.amountPaid || 0);
            return (
              <div key={order.id} className="bg-white p-5 rounded-[2rem] border border-slate-100 shadow-sm space-y-4">
                <div className="flex justify-between items-start">
                  <span className="text-[10px] font-black text-brand-teal tracking-widest">#{order.trackingCode}</span>
                  <ActionMenu 
                    order={order} 
                    onPrintTag={() => triggerTagPrint(order)} 
                    onPrintReceipt={() => triggerReceiptPrint(order)} 
                    handleViewInvoice={handleViewInvoice} 
                    onPay={() => {
                      setSelectedOrder(order);
                      setShowPaymentModal(true);
                    }}
                  />
                </div>
                <div>
                  <h4 className="font-black text-brand-navy text-base">{order.customerName}</h4>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest border ${getStatusStyles(order.status)}`}>
                        {order.status.replace('_', ' ')}
                    </span>
                    <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase border ${getPaymentStyles(order.paymentStatus)}`}>
                      {order.paymentStatus || 'UNPAID'}
                    </span>
                  </div>
                </div>
                <div className="flex justify-between items-center py-3 border-y border-slate-50 border-dashed">
                  <div>
                    <p className="text-[8px] font-black text-slate-300 uppercase tracking-widest">Balance</p>
                    <p className={`text-sm font-black ${balance > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>₦{balance.toLocaleString()}</p>
                  </div>
                  <button 
                    onClick={() => setSelectedOrder(order)}
                    className="px-6 py-2.5 bg-brand-navy text-white rounded-xl text-[9px] font-black uppercase tracking-widest"
                  >
                    Manage
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* HIDDEN PRINT ENGINES */}
      <div className="hidden">
        <div ref={tagRef}>
          {printingTagOrder && <PrintableTag order={printingTagOrder} />}
        </div>
        <div ref={receiptRef}>
          {printingReceiptOrder && <Receipt order={printingReceiptOrder} />}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {showCreateModal && <CreateOrderModal onClose={() => setShowCreateModal(false)} onUpdate={fetchOrders} />}
        {showPaymentModal && selectedOrder && (
          <PaymentModal 
            order={selectedOrder}
            onClose={() => { setShowPaymentModal(false); setSelectedOrder(null); }}
            onRefresh={fetchOrders}
          />
        )}
        {!showPaymentModal && renderManagementModal()}
      </AnimatePresence>
    </motion.div>
  );
};

/* --- ACTION MENU --- */
const ActionMenu = ({ order, onPrintTag, onPrintReceipt, handleViewInvoice, onPay }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-all active:scale-90"
      >
        <MoreVertical size={20} />
      </button>
      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-[40]" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              className="absolute right-0 mt-2 w-52 bg-white rounded-2xl shadow-2xl border border-slate-100 z-[50] p-2 overflow-hidden"
            >
              <button onClick={() => { onPay(); setIsOpen(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-[10px] font-black uppercase text-brand-navy hover:bg-emerald-50 hover:text-emerald-700 rounded-xl transition-all">
                <CreditCard size={14} /> Record Payment
              </button>
              
              <div className="h-px bg-slate-50 my-1" />

              <button onClick={() => { onPrintTag(); setIsOpen(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-[10px] font-black uppercase text-brand-teal hover:bg-brand-teal/5 rounded-xl transition-all">
                <Printer size={14} /> Print Laundry Tag
              </button>

              <button onClick={() => { onPrintReceipt(); setIsOpen(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-[10px] font-black uppercase text-slate-600 hover:bg-slate-50 rounded-xl transition-all">
                <ReceiptIcon size={14} /> Digital Receipt
              </button>
              
              <button onClick={() => { handleViewInvoice(order.id); setIsOpen(false); }} className="w-full flex items-center gap-3 px-4 py-3 text-[10px] font-black uppercase text-slate-400 hover:bg-rose-50 hover:text-rose-600 rounded-xl transition-all">
                <FileDown size={14} /> PDF Invoice
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Orders;