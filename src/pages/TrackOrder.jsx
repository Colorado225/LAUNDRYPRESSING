import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import API from '../api/axios';
import { 
  Search, 
  CheckCircle2, 
  Clock, 
  ShieldCheck, 
  PackageCheck,
  Truck,
  AlertCircle
} from 'lucide-react';
import { AnimatePresence } from 'framer-motion';

const TrackOrder = () => {
  const [code, setCode] = useState('');
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const location = useLocation();

  // 1. AUTO-FETCH LOGIC (For WhatsApp Links)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const codeFromUrl = params.get('code');
    
    if (codeFromUrl) {
      const sanitizedCode = codeFromUrl.toUpperCase();
      setCode(sanitizedCode);
      fetchOrder(sanitizedCode);
    }
  }, [location]);

  const fetchOrder = async (trackingCode) => {
    setLoading(true);
    setError('');
    try {
      // Aligns with router.get('/track/:code', trackOrder)
      const { data } = await API.get(`/orders/track/${trackingCode}`);
      setOrder(data);
    } catch (err) {
      setError(err.response?.data?.message || "Tracking code not found. Please verify the code on your receipt.");
      setOrder(null);
    } finally {
      setLoading(false);
    }
  };

  const handleManualSearch = (e) => {
    e.preventDefault();
    if (code) fetchOrder(code);
  };

  const statusSteps = [
    { label: 'Requested', value: 'REQUESTED', icon: <Clock size={18} /> },
    { label: 'Picked Up', value: 'PICKED_UP', icon: <PackageCheck size={18} /> },
    { label: 'Cleaning', value: 'PROCESSING', icon: <ShieldCheck size={18} /> },
    { label: 'Ready', value: 'READY', icon: <CheckCircle2 size={18} /> },
    { label: 'Delivered', value: 'DELIVERED', icon: <Truck size={18} /> },
  ];

  const currentStatusIndex = statusSteps.findIndex(s => s.value === order?.status);

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        
        {/* Branding Header */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-black text-[#0F172A] tracking-tighter italic">
            MUFTI<span className="text-blue-600">SPOT</span>
          </h1>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mt-2">
            Real-Time Laundry Tracking
          </p>
        </div>

        {/* Search Input Section */}
        <div className="bg-white rounded-[2.5rem] p-4 md:p-6 shadow-xl shadow-blue-900/5 mb-8 border border-white">
          <form onSubmit={handleManualSearch} className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-4 text-slate-400" size={20} />
              <input 
                type="text"
                placeholder="ENTER TRACKING CODE"
                className="w-full pl-12 pr-4 py-4 bg-slate-50 rounded-2xl border-none outline-none font-black text-sm uppercase tracking-widest focus:ring-2 focus:ring-blue-500/20 transition-all"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
            </div>
            <button 
              disabled={loading}
              className="px-8 py-4 bg-[#0F172A] text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:bg-blue-600 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? 'Searching...' : 'Track Now'}
            </button>
          </form>
          
          {error && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 text-red-500 mt-4 px-2">
              <AlertCircle size={14} />
              <p className="text-[10px] font-black uppercase tracking-widest">{error}</p>
            </motion.div>
          )}
        </div>

        <AnimatePresence mode="wait">
          {order && (
            <motion.div 
              key={order.trackingCode}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-6"
            >
              {/* Status Details Card */}
              <div className="bg-white rounded-[2.5rem] p-8 shadow-xl shadow-blue-900/5 border border-white">
                <div className="flex justify-between items-start mb-10">
                  <div>
                    <h2 className="text-2xl font-black text-[#0F172A] uppercase leading-tight">{order.customerName}</h2>
                    <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">
                      Updated: {new Date(order.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Bill</p>
                    <p className="text-xl font-black text-[#0F172A]">₦{order.totalAmount?.toLocaleString()}</p>
                  </div>
                </div>

                {/* Progress Timeline */}
                <div className="relative">
                  {statusSteps.map((step, index) => {
                    const isCompleted = index < currentStatusIndex;
                    const isCurrent = index === currentStatusIndex;
                    const isPending = index > currentStatusIndex;

                    return (
                      <div key={step.value} className="flex items-start gap-6 mb-8 last:mb-0">
                        <div className="flex flex-col items-center">
                          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all duration-500 ${
                            isCompleted || isCurrent 
                              ? 'bg-blue-600 text-white shadow-lg shadow-blue-200' 
                              : 'bg-slate-100 text-slate-300'
                          }`}>
                            {isCompleted ? <CheckCircle2 size={20} /> : step.icon}
                          </div>
                          {index !== statusSteps.length - 1 && (
                            <div className={`w-1 h-10 mt-2 rounded-full ${
                              isCompleted ? 'bg-blue-600' : 'bg-slate-100'
                            }`} />
                          )}
                        </div>
                        <div className="pt-2">
                          <h3 className={`text-xs font-black uppercase tracking-widest ${
                            !isPending ? 'text-[#0F172A]' : 'text-slate-300'
                          }`}>
                            {step.label}
                          </h3>
                          {isCurrent && order.processingNotes && (
                            <div className="mt-2 p-3 bg-blue-50 rounded-xl border-l-4 border-blue-600">
                              <p className="text-[10px] font-bold text-blue-700 italic">
                                Note: {order.processingNotes}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Items Summary Section */}
              <div className="bg-[#0F172A] rounded-[2rem] p-6 text-white">
                <div className="flex justify-between items-center mb-4">
                  <h4 className="text-[10px] font-black uppercase tracking-[0.3em] opacity-50">Clothes in Care</h4>
                  <span className="text-[10px] font-black px-2 py-1 bg-white/10 rounded-md">
                    {order.items?.length || 0} Types
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {order.items?.map((item, i) => (
                    <div key={i} className="flex justify-between items-center bg-white/5 p-4 rounded-2xl border border-white/5">
                      <span className="text-[11px] font-black uppercase tracking-wider">{item.itemName}</span>
                      <div className="flex items-center gap-2">
                         <span className="text-[9px] font-bold opacity-40 uppercase">Qty</span>
                         <span className="text-sm font-black text-blue-400">{item.quantity}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default TrackOrder;