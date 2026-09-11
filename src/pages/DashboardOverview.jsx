// import { useEffect, useState, useRef, useCallback } from 'react';
// import API from '../api/axios';
// import { 
//   Plus, Search, Eye, CheckCircle2, 
//   Loader2, Printer, Calendar, Wallet, 
//   Clock, CheckSquare, Package, ChevronRight,
//   Receipt as ReceiptIcon
// } from 'lucide-react';
// import { useReactToPrint } from 'react-to-print';

// // Internal Components
// import PaymentModal from '../components/PaymentModal';
// import CreateOrderModal from '../components/CreateOrderModal';
// import { Receipt } from '../components/Receipt';

// const DashboardOverview = () => {
//   const [stats, setStats] = useState({});
//   const [recentOrders, setRecentOrders] = useState([]);
//   const [loading, setLoading] = useState(true);
//   const [search, setSearch] = useState('');
//   const [period, setPeriod] = useState('all'); 
  
//   const [selectedOrder, setSelectedOrder] = useState(null);
//   const [activePrintOrder, setActivePrintOrder] = useState(null);
//   const [showPaymentModal, setShowPaymentModal] = useState(false);
//   const [showOrderModal, setShowOrderModal] = useState(false);
  
//   const receiptRef = useRef(null);

//   // FIXED: Professional Print Logic
//   const handlePrintAction = useReactToPrint({
//     contentRef: receiptRef,
//     onAfterPrint: () => setActivePrintOrder(null),
//   });

//   const triggerPrint = useCallback((order) => {
//     setActivePrintOrder(order);
//     // Ensure the Receipt component is mounted in the DOM before printing
//     setTimeout(() => {
//       handlePrintAction();
//     }, 300); 
//   }, [handlePrintAction]);

//   const fetchDashboardData = async (isSilent = false) => {
//     if (!isSilent) setLoading(true);
//     try {
//       const { data } = await API.get(`/admin/stats?period=${period}`);
//       setStats(data.stats || {});
//       setRecentOrders(data.recentOrders || []);
//     } catch (err) {
//       console.error("Operational Error:", err);
//     } finally {
//       setLoading(false);
//     }
//   };

//   useEffect(() => {
//     fetchDashboardData();

//     // 2. Set up the interval (5 minutes = 300,000 milliseconds)
//     const intervalId = setInterval(() => {
//       console.log("Auto-syncing dashboard data...");
//       fetchDashboardData(true); // Call with isSilent = true to avoid showing loading state
//     }, 300000);

//     // 3. CLEANUP: This is crucial to prevent memory leaks
//     return () => clearInterval(intervalId);

//   }, [period]);

//   const filteredOrders = recentOrders.filter((order) =>
//     order.customerName.toLowerCase().includes(search.toLowerCase()) ||
//     order.trackingCode?.toLowerCase().includes(search.toLowerCase())
//   );

//   const getPaymentStyles = (status) => {
//     switch (status) {
//       case 'PAID': return 'bg-emerald-50 text-emerald-600 border-emerald-100';
//       case 'PARTIAL': return 'bg-sky-50 text-sky-700 border-sky-100';
//       case 'UNPAID': return 'bg-rose-50 text-rose-700 border-rose-100';
//       default: return 'bg-slate-50 text-slate-400 border-slate-100';
//     }
//   };

//   if (loading) {
//     return (
//       <div className="h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
//         <Loader2 className="animate-spin text-slate-900" size={40} strokeWidth={1} />
//         <div className="text-center">
//           <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">System Syncing</p>
//           <p className="text-[8px] font-bold text-slate-300 uppercase tracking-widest mt-1">Mufti Laundry v2.0</p>
//         </div>
//       </div>
//     );
//   }

//   return (
//     <div className="max-w-7xl mx-auto py-6 px-4 md:px-10 space-y-8 bg-slate-50/20 min-h-screen pb-24">
      
//       {/* 1. TOP NAV & GLOBAL ACTIONS */}
//       <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
//         <div className="space-y-1">
//           <h1 className="text-3xl font-black text-slate-900 tracking-tighter">OPERATIONS</h1>
//           <div className="flex items-center gap-2 text-slate-400">
//             <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
//             <p className="text-[10px] font-bold uppercase tracking-[0.2em]">Live Business Intelligence</p>
//           </div>
//         </div>

//         <div className="flex flex-wrap items-center gap-3">
//           <div className="flex bg-white border border-slate-200 p-1 rounded-xl shadow-sm">
//             {['today', 'month', 'all'].map((p) => (
//               <button
//                 key={p}
//                 onClick={() => setPeriod(p)}
//                 className={`px-5 py-2 text-[10px] font-black uppercase rounded-lg transition-all ${
//                   period === p ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'
//                 }`}
//               >
//                 {p}
//               </button>
//             ))}
//           </div>

//           <button 
//             onClick={() => setShowOrderModal(true)}
//             className="flex-1 lg:flex-none bg-slate-900 text-white px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-95 transition-all shadow-xl shadow-slate-900/20"
//           >
//             <Plus size={18} strokeWidth={3}/> Create Order
//           </button>
//         </div>
//       </header>

//       {/* 2. CORE KPI CARDS */}
//       <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
//         {[
//           { label: 'Revenue', val: stats.totalRevenue, icon: <Wallet size={16}/>, color: 'border-slate-100 text-slate-900' },
//           { label: 'Outstanding', val: stats.unpaidBalance, icon: <Clock size={16}/>, color: 'border-rose-100 text-rose-600' },
//           { label: 'Active Work', val: stats.activeWork, icon: <Package size={16}/>, color: 'border-slate-100 text-slate-900' },
//           { label: 'Ready', val: stats.readyOrders, icon: <CheckSquare size={16}/>, color: 'border-emerald-100 text-emerald-600' }
//         ].map((kpi, i) => (
//           <div key={i} className={`p-6 bg-white border ${kpi.color.split(' ')[0]} rounded-3xl shadow-sm transition-transform hover:-translate-y-1`}>
//             <div className="flex items-center justify-between mb-4">
//               <span className="text-[10px] font-black uppercase tracking-widest opacity-40">{kpi.label}</span>
//               <div className="opacity-20">{kpi.icon}</div>
//             </div>
//             <h2 className={`text-2xl font-black ${kpi.color.split(' ')[1]}`}>
//               {typeof kpi.val === 'number' && kpi.label !== 'Active Work' && kpi.label !== 'Ready' ? `₦${kpi.val.toLocaleString()}` : kpi.val || 0}
//             </h2>
//           </div>
//         ))}
//       </section>

//       {/* 3. WORKFLOW PIPELINE */}
//       <section className="bg-white border border-slate-100 rounded-[2.5rem] p-8 shadow-sm">
//         <div className="flex items-center justify-between mb-8">
//           <div className="flex items-center gap-2">
//             <div className="w-1.5 h-1.5 rounded-full bg-slate-900" />
//             <h3 className="text-xs font-black uppercase tracking-widest text-slate-900">Production Pipeline</h3>
//           </div>
//           <p className="text-[10px] font-bold text-slate-400 uppercase">Live Stage Tracking</p>
//         </div>
        
//         <div className="grid grid-cols-3 lg:grid-cols-6 gap-6 lg:gap-4">
//           {[
//             { label: 'New', val: stats.newOrders || 0, color: 'text-slate-400' },
//             { label: 'Picked', val: stats.pickedOrders || 0, color: 'text-indigo-500' },
//             { label: 'Billed', val: stats.billedOrders || 0, color: 'text-amber-500' },
//             { label: 'Processing', val: stats.activeWork || 0, color: 'text-blue-600' },
//             { label: 'Ready', val: stats.readyOrders || 0, color: 'text-emerald-600' },
//             { label: 'Sent', val: stats.sentOrders || 0, color: 'text-slate-900' }
//           ].map((item, idx) => (
//             <div key={idx} className="relative flex flex-col items-center lg:items-start group">
//               <p className="text-[9px] font-black text-slate-300 uppercase mb-1 tracking-tighter group-hover:text-slate-500 transition-colors">
//                 {item.label}
//               </p>
//               <div className="flex items-end gap-1">
//                 <p className={`text-2xl font-black ${item.color} leading-none`}>
//                   {item.val}
//                 </p>
//                 <span className="text-[8px] font-bold text-slate-300 mb-1">units</span>
//               </div>
//               <div className="w-full h-1 bg-slate-50 rounded-full mt-3 overflow-hidden">
//                 <div 
//                   className={`h-full transition-all duration-700 ${item.color.replace('text-', 'bg-')}`} 
//                   style={{ width: item.val > 0 ? '100%' : '10%' }}
//                 />
//               </div>
//               {idx < 5 && (
//                 <div className="hidden lg:block absolute top-1/2 -right-2 translate-y-[-100%] opacity-10">
//                   <ChevronRight size={16} />
//                 </div>
//               )}
//             </div>
//           ))}
//         </div>
//       </section>

//       {/* 4. RECENT ACTIVITY LEDGER */}
//       <section className="bg-white border border-slate-100 rounded-[2.5rem] shadow-sm overflow-hidden">
//         <div className="p-8 border-b border-slate-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
//           <div>
//             <h3 className="font-black text-slate-900 uppercase tracking-widest text-xs">Recent Ledger</h3>
//             <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase">Last {recentOrders.length} interactions</p>
//           </div>
//           <div className="relative w-full md:w-80">
//             <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
//             <input
//               type="text"
//               placeholder="Filter by name or code..."
//               value={search}
//               onChange={(e) => setSearch(e.target.value)}
//               className="w-full bg-slate-50 border-none pl-12 pr-6 py-3.5 rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-slate-100 transition-all"
//             />
//           </div>
//         </div>

//         {/* MOBILE CARDS VIEW */}
//         <div className="block lg:hidden space-y-4 p-4 divide-slate-50">
//           {filteredOrders.map((order, i) => {
//             const balance = order.totalAmount - (order.amountPaid || 0);
//             return (
//               <div key={i} className="p-5 space-y-4 bg-white rounded-3xl border border-slate-100 shadow-sm">
//                 <div className="flex justify-between items-start">
//                   <div className="space-y-0.5">
//                     <h4 className="font-black text-slate-900 text-sm tracking-tight">{order.customerName}</h4>
//                     <div className="flex items-center gap-2">
//                       <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">#{order.trackingCode}</span>
//                       <span className="text-[8px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-black uppercase">
//                         {order.status.replace('_', ' ')}
//                       </span>
//                     </div>
//                   </div>
//                   <span className={`text-[9px] font-black px-2.5 py-1 rounded-lg border tracking-tighter uppercase ${getPaymentStyles(order.paymentStatus)}`}>
//                     {order.paymentStatus}
//                   </span>
//                 </div>

//                 <div className="flex justify-between items-center py-3 border-y border-slate-50 border-dashed">
//                   <div>
//                     <p className="text-[8px] font-black text-slate-300 uppercase tracking-widest">Total Bill</p>
//                     <p className="text-sm font-black text-slate-900 font-mono">₦{order.totalAmount.toLocaleString()}</p>
//                   </div>
//                   <div className="text-right">
//                     <p className="text-[8px] font-black text-slate-300 uppercase tracking-widest">Balance</p>
//                     <p className={`text-sm font-black font-mono ${balance > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
//                       ₦{balance.toLocaleString()}
//                     </p>
//                   </div>
//                 </div>

//                 <div className="flex items-center justify-end gap-3 pt-1">
//                   <button onClick={() => triggerPrint(order)} className="flex items-center gap-2 px-3 py-2 rounded-xl text-slate-500 hover:bg-slate-50 active:bg-slate-100 transition-all">
//                     <Printer size={16} strokeWidth={2.5} />
//                     <span className="text-[10px] font-black uppercase tracking-tight">Receipt</span>
//                   </button>
//                   {balance > 0 && (
//                     <button onClick={() => { setSelectedOrder(order); setShowPaymentModal(true); }} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl shadow-md shadow-slate-900/10 active:scale-95 transition-all">
//                       <CheckCircle2 size={16} strokeWidth={2.5} />
//                       <span className="text-[10px] font-black uppercase tracking-tight">Pay</span>
//                     </button>
//                   )}
//                 </div>
//               </div>
//             );
//           })}
//         </div>

//         {/* DESKTOP TABLE VIEW */}
//         <div className="hidden lg:block overflow-x-auto">
//           <table className="w-full">
//             <thead>
//               <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50/50">
//                 <th className="text-left px-10 py-5">Client Profile</th>
//                 <th className="text-left px-10 py-5">Order Flow</th>
//                 <th className="text-left px-10 py-5">Accounting</th>
//                 <th className="text-right px-10 py-5">Amount</th>
//                 <th className="text-right px-10 py-5">Actions</th>
//               </tr>
//             </thead>
//             <tbody className="divide-y divide-slate-50">
//               {filteredOrders.map((order, i) => {
//                 const balance = order.totalAmount - (order.amountPaid || 0);
//                 return (
//                   <tr key={i} className="hover:bg-slate-50/40 transition-colors group">
//                     <td className="px-10 py-6 text-sm font-black text-slate-800 tracking-tight">
//                       {order.customerName}
//                       <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">#{order.trackingCode}</span>
//                     </td>
//                     <td className="px-10 py-6">
//                       <div className="flex items-center gap-2">
//                         <span className={`w-2 h-2 rounded-full ${order.status === 'READY' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-blue-500'}`} />
//                         <span className="text-[10px] font-black text-slate-600 uppercase tracking-tighter">{order.status.replace('_', ' ')}</span>
//                       </div>
//                     </td>
//                     <td className="px-10 py-6">
//                       <span className={`text-[9px] font-black px-3 py-1.5 rounded-lg border tracking-wider uppercase ${getPaymentStyles(order.paymentStatus)}`}>
//                         {order.paymentStatus || 'UNPAID'}
//                       </span>
//                     </td>
//                     <td className="px-10 py-6 text-right">
//                       <p className="text-sm font-black text-slate-900 font-mono">₦{order.totalAmount.toLocaleString()}</p>
//                       {balance > 0 && <p className="text-[9px] font-bold text-rose-500 uppercase tracking-tighter">₦{balance.toLocaleString()} Bal</p>}
//                     </td>
//                     <td className="px-10 py-6 text-right">
//                       <div className="flex justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
//                         <button onClick={() => triggerPrint(order)} className="p-2.5 border border-slate-200 rounded-xl hover:border-slate-900 transition-all text-slate-400 hover:text-slate-900 bg-white" title="Print Receipt">
//                           <Printer size={16} />
//                         </button>
//                         {balance > 0 && (
//                           <button onClick={() => { setSelectedOrder(order); setShowPaymentModal(true); }} className="p-2.5 bg-slate-900 text-white rounded-xl hover:shadow-xl transition-all active:scale-90" title="Record Payment">
//                             <CheckCircle2 size={16} />
//                           </button>
//                         )}
//                         <button className="p-2.5 border border-slate-200 rounded-xl hover:bg-slate-50 transition-all text-slate-400">
//                           <Eye size={16} />
//                         </button>
//                       </div>
//                     </td>
//                   </tr>
//                 );
//               })}
//             </tbody>
//           </table>
//         </div>
//       </section>

//       {/* 5. HIDDEN STAGING AREA FOR PRINTING */}
//       <div className="hidden">
//         <div ref={receiptRef}>
//           {activePrintOrder && (
//             <Receipt 
//               key={activePrintOrder.id} 
//               order={activePrintOrder} 
//             />
//           )}
//         </div>
//       </div>

//       {/* 6. MODALS */}
//       {showOrderModal && (
//         <CreateOrderModal 
//           onClose={() => setShowOrderModal(false)} 
//           onUpdate={() => { fetchDashboardData(); setShowOrderModal(false); }}
//         />
//       )}

//       {showPaymentModal && (
//         <PaymentModal 
//           order={selectedOrder} 
//           onClose={() => { setShowPaymentModal(false); setSelectedOrder(null); }} 
//           onRefresh={fetchDashboardData} 
//         />
//       )}
//     </div>
//   );
// };

// export default DashboardOverview;


import { useEffect, useState, useRef, useCallback } from 'react';
import API from '../api/axios';
import { 
  Plus, Search, Eye, CheckCircle2, 
  Loader2, Printer, Calendar, Wallet, 
  Clock, CheckSquare, Package, ChevronRight,
  Receipt as ReceiptIcon
} from 'lucide-react';
import { useReactToPrint } from 'react-to-print';

// Internal Components
import PaymentModal from '../components/PaymentModal';
import CreateOrderModal from '../components/CreateOrderModal';
import { Receipt } from '../components/Receipt';

const DashboardOverview = () => {
  const [stats, setStats] = useState({});
  const [recentOrders, setRecentOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState('all'); 
  
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [activePrintOrder, setActivePrintOrder] = useState(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showOrderModal, setShowOrderModal] = useState(false);
  
  const receiptRef = useRef(null);

  // Professional Print Handler
  const handlePrintAction = useReactToPrint({
    contentRef: receiptRef,
    onAfterPrint: () => setActivePrintOrder(null),
  });

  // Trigger print cleanly once component mounts in DOM
  useEffect(() => {
    if (activePrintOrder) {
      handlePrintAction();
    }
  }, [activePrintOrder, handlePrintAction]);

  const triggerPrint = useCallback((order) => {
    setActivePrintOrder(order);
  }, []);

  // Stabilized Fetch Function (Fixes Dependency Warning + keeps Modal reuse)
  const fetchDashboardData = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const { data } = await API.get(`/admin/stats?period=${period}`);
      setStats(data.stats || {});
      setRecentOrders(data.recentOrders || []);
    } catch (err) {
      console.error("Operational Error:", err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchDashboardData();

    const intervalId = setInterval(() => {
      fetchDashboardData(true);
    }, 300000);

    return () => clearInterval(intervalId);
  }, [fetchDashboardData]);

  const filteredOrders = recentOrders.filter((order) =>
    (order.customerName || '').toLowerCase().includes(search.toLowerCase()) ||
    (order.trackingCode || '').toLowerCase().includes(search.toLowerCase())
  );

  const getPaymentStyles = (status) => {
    switch (status) {
      case 'PAID': return 'bg-emerald-50 text-emerald-600 border-emerald-100';
      case 'PARTIAL': return 'bg-sky-50 text-sky-700 border-sky-100';
      case 'UNPAID': return 'bg-rose-50 text-rose-700 border-rose-100';
      default: return 'bg-slate-50 text-slate-400 border-slate-100';
    }
  };

  if (loading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
        <Loader2 className="animate-spin text-slate-900" size={40} strokeWidth={1} />
        <div className="text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">System Syncing</p>
          <p className="text-[8px] font-bold text-slate-300 uppercase tracking-widest mt-1">Mufti Laundry v2.0</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto py-6 px-4 md:px-10 space-y-8 bg-slate-50/20 min-h-screen pb-24">
      
      {/* 1. TOP NAV & GLOBAL ACTIONS */}
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-black text-slate-900 tracking-tighter">OPERATIONS</h1>
          <div className="flex items-center gap-2 text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <p className="text-[10px] font-bold uppercase tracking-[0.2em]">Live Business Intelligence</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-white border border-slate-200 p-1 rounded-xl shadow-sm">
            {['today', 'month', 'all'].map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-5 py-2 text-[10px] font-black uppercase rounded-lg transition-all ${
                  period === p ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          <button 
            onClick={() => setShowOrderModal(true)}
            className="flex-1 lg:flex-none bg-slate-900 text-white px-8 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-95 transition-all shadow-xl shadow-slate-900/20"
          >
            <Plus size={18} strokeWidth={3}/> Create Order
          </button>
        </div>
      </header>

      {/* 2. CORE KPI CARDS */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {[
          { label: 'Revenue', val: stats.totalRevenue, icon: <Wallet size={16}/>, color: 'border-slate-100 text-slate-900' },
          { label: 'Outstanding', val: stats.unpaidBalance, icon: <Clock size={16}/>, color: 'border-rose-100 text-rose-600' },
          { label: 'Active Work', val: stats.activeWork, icon: <Package size={16}/>, color: 'border-slate-100 text-slate-900' },
          { label: 'Ready', val: stats.readyOrders, icon: <CheckSquare size={16}/>, color: 'border-emerald-100 text-emerald-600' }
        ].map((kpi, i) => (
          <div key={i} className={`p-6 bg-white border ${kpi.color.split(' ')[0]} rounded-3xl shadow-sm transition-transform hover:-translate-y-1`}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-black uppercase tracking-widest opacity-40">{kpi.label}</span>
              <div className="opacity-20">{kpi.icon}</div>
            </div>
            <h2 className={`text-2xl font-black ${kpi.color.split(' ')[1]}`}>
              {typeof kpi.val === 'number' && kpi.label !== 'Active Work' && kpi.label !== 'Ready' ? `₦${kpi.val.toLocaleString()}` : kpi.val || 0}
            </h2>
          </div>
        ))}
      </section>

      {/* 3. WORKFLOW PIPELINE */}
      <section className="bg-white border border-slate-100 rounded-[2.5rem] p-8 shadow-sm">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-slate-900" />
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-900">Production Pipeline</h3>
          </div>
          <p className="text-[10px] font-bold text-slate-400 uppercase">Live Stage Tracking</p>
        </div>
        
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-6 lg:gap-4">
          {[
            { label: 'New', val: stats.newOrders || 0, color: 'text-slate-400' },
            { label: 'Picked', val: stats.pickedOrders || 0, color: 'text-indigo-500' },
            { label: 'Billed', val: stats.billedOrders || 0, color: 'text-amber-500' },
            { label: 'Processing', val: stats.activeWork || 0, color: 'text-blue-600' },
            { label: 'Ready', val: stats.readyOrders || 0, color: 'text-emerald-600' },
            { label: 'Sent', val: stats.sentOrders || 0, color: 'text-slate-900' }
          ].map((item, idx) => (
            <div key={idx} className="relative flex flex-col items-center lg:items-start group">
              <p className="text-[9px] font-black text-slate-300 uppercase mb-1 tracking-tighter group-hover:text-slate-500 transition-colors">
                {item.label}
              </p>
              <div className="flex items-end gap-1">
                <p className={`text-2xl font-black ${item.color} leading-none`}>
                  {item.val}
                </p>
                <span className="text-[8px] font-bold text-slate-300 mb-1">units</span>
              </div>
              <div className="w-full h-1 bg-slate-50 rounded-full mt-3 overflow-hidden">
                <div 
                  className={`h-full transition-all duration-700 ${item.color.replace('text-', 'bg-')}`} 
                  style={{ width: item.val > 0 ? '100%' : '10%' }}
                />
              </div>
              {idx < 5 && (
                <div className="hidden lg:block absolute top-1/2 -right-2 translate-y-[-100%] opacity-10">
                  <ChevronRight size={16} />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 4. RECENT ACTIVITY LEDGER */}
      <section className="bg-white border border-slate-100 rounded-[2.5rem] shadow-sm overflow-hidden">
        <div className="p-8 border-b border-slate-50 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div>
            <h3 className="font-black text-slate-900 uppercase tracking-widest text-xs">Recent Ledger</h3>
            <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase">Last {recentOrders.length} interactions</p>
          </div>
          <div className="relative w-full md:w-80">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
            <input
              type="text"
              placeholder="Filter by name or code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-50 border-none pl-12 pr-6 py-3.5 rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-slate-100 transition-all"
            />
          </div>
        </div>

        {/* MOBILE CARDS VIEW */}
        <div className="block lg:hidden space-y-4 p-4 divide-slate-50">
          {filteredOrders.map((order, i) => {
            const balance = order.totalAmount - (order.amountPaid || 0);
            return (
              <div key={i} className="p-5 space-y-4 bg-white rounded-3xl border border-slate-100 shadow-sm">
                <div className="flex justify-between items-start">
                  <div className="space-y-0.5">
                    <h4 className="font-black text-slate-900 text-sm tracking-tight">{order.customerName}</h4>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">#{order.trackingCode}</span>
                      <span className="text-[8px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-black uppercase">
                        {order.status?.replace('_', ' ') || 'PENDING'}
                      </span>
                    </div>
                  </div>
                  <span className={`text-[9px] font-black px-2.5 py-1 rounded-lg border tracking-tighter uppercase ${getPaymentStyles(order.paymentStatus)}`}>
                    {order.paymentStatus || 'UNPAID'}
                  </span>
                </div>

                <div className="flex justify-between items-center py-3 border-y border-slate-50 border-dashed">
                  <div>
                    <p className="text-[8px] font-black text-slate-300 uppercase tracking-widest">Total Bill</p>
                    <p className="text-sm font-black text-slate-900 font-mono">₦{(order.totalAmount || 0).toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[8px] font-black text-slate-300 uppercase tracking-widest">Balance</p>
                    <p className={`text-sm font-black font-mono ${balance > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                      ₦{balance.toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-1">
                  <button onClick={() => triggerPrint(order)} className="flex items-center gap-2 px-3 py-2 rounded-xl text-slate-500 hover:bg-slate-50 active:bg-slate-100 transition-all">
                    <Printer size={16} strokeWidth={2.5} />
                    <span className="text-[10px] font-black uppercase tracking-tight">Receipt</span>
                  </button>
                  {balance > 0 && (
                    <button onClick={() => { setSelectedOrder(order); setShowPaymentModal(true); }} className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl shadow-md shadow-slate-900/10 active:scale-95 transition-all">
                      <CheckCircle2 size={16} strokeWidth={2.5} />
                      <span className="text-[10px] font-black uppercase tracking-tight">Pay</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* DESKTOP TABLE VIEW */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-50/50">
                <th className="text-left px-10 py-5">Client Profile</th>
                <th className="text-left px-10 py-5">Order Flow</th>
                <th className="text-left px-10 py-5">Accounting</th>
                <th className="text-right px-10 py-5">Amount</th>
                <th className="text-right px-10 py-5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredOrders.map((order, i) => {
                const balance = order.totalAmount - (order.amountPaid || 0);
                return (
                  <tr key={i} className="hover:bg-slate-50/40 transition-colors group">
                    <td className="px-10 py-6 text-sm font-black text-slate-800 tracking-tight">
                      {order.customerName}
                      <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">#{order.trackingCode}</span>
                    </td>
                    <td className="px-10 py-6">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${order.status === 'READY' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'bg-blue-500'}`} />
                        <span className="text-[10px] font-black text-slate-600 uppercase tracking-tighter">{order.status?.replace('_', ' ') || 'PENDING'}</span>
                      </div>
                    </td>
                    <td className="px-10 py-6">
                      <span className={`text-[9px] font-black px-3 py-1.5 rounded-lg border tracking-wider uppercase ${getPaymentStyles(order.paymentStatus)}`}>
                        {order.paymentStatus || 'UNPAID'}
                      </span>
                    </td>
                    <td className="px-10 py-6 text-right">
                      <p className="text-sm font-black text-slate-900 font-mono">₦{(order.totalAmount || 0).toLocaleString()}</p>
                      {balance > 0 && <p className="text-[9px] font-bold text-rose-500 uppercase tracking-tighter">₦{balance.toLocaleString()} Bal</p>}
                    </td>
                    <td className="px-10 py-6 text-right">
                      <div className="flex justify-end gap-3 opacity-60 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                        <button onClick={() => triggerPrint(order)} className="p-2.5 border border-slate-200 rounded-xl hover:border-slate-900 transition-all text-slate-400 hover:text-slate-900 bg-white" title="Print Receipt">
                          <Printer size={16} />
                        </button>
                        {balance > 0 && (
                          <button onClick={() => { setSelectedOrder(order); setShowPaymentModal(true); }} className="p-2.5 bg-slate-900 text-white rounded-xl hover:shadow-xl transition-all active:scale-90" title="Record Payment">
                            <CheckCircle2 size={16} />
                          </button>
                        )}
                        <button className="p-2.5 border border-slate-200 rounded-xl hover:bg-slate-50 transition-all text-slate-400">
                          <Eye size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* 5. HIDDEN STAGING AREA FOR PRINTING */}
      <div className="absolute -left-[9999px] top-0" aria-hidden="true">
        <div ref={receiptRef}>
          {activePrintOrder && (
            <Receipt 
              key={activePrintOrder.id} 
              order={activePrintOrder} 
            />
          )}
        </div>
      </div>

      {/* 6. MODALS */}
      {showOrderModal && (
        <CreateOrderModal 
          onClose={() => setShowOrderModal(false)} 
          onUpdate={() => { fetchDashboardData(); setShowOrderModal(false); }}
        />
      )}

      {showPaymentModal && (
        <PaymentModal 
          order={selectedOrder} 
          onClose={() => { setShowPaymentModal(false); setSelectedOrder(null); }} 
          onRefresh={fetchDashboardData} 
        />
      )}
    </div>
  );
};

export default DashboardOverview;