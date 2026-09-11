import { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { X, Plus, Minus, Receipt, Loader2, Search, ShoppingBag, ClipboardList } from 'lucide-react';
import API from '../api/axios';

const BillingModal = ({ order, onClose, onUpdate }) => {
  const [loading, setLoading] = useState(false);
  const [fetchingServices, setFetchingServices] = useState(true);
  const [availableServices, setAvailableServices] = useState([]);
  const [basket, setBasket] = useState([]);
  const [processingNotes, setProcessingNotes] = useState(order?.processingNotes || "");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  useEffect(() => {
    const fetchServices = async () => {
      try {
        const { data } = await API.get('/services');
        setAvailableServices(data);
      } catch (error) {
        console.error("Failed to fetch services:", error);
      } finally {
        setFetchingServices(false);
      }
    };
    fetchServices();
  }, []);

  useEffect(() => {
    if (order?.items && order.items.length > 0) {
      const savedItems = order.items.map(item => ({
        id: item.serviceId,
        name: item.itemName,
        price: item.unitPrice,
        qty: item.quantity
      }));
      setBasket(savedItems);
    } else {
      setBasket([]);
    }
    setProcessingNotes(order?.processingNotes || "");
  }, [order]);

  const categories = ["All", ...new Set(availableServices.map(s => s.category?.name).filter(Boolean))];

  const filteredServices = availableServices.filter(service => {
    const matchesSearch = service.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "All" || service.category?.name === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const addToBasket = (service) => {
    const existing = basket.find(item => item.id === service.id);
    if (existing) {
      setBasket(basket.map(item => item.id === service.id ? { ...item, qty: item.qty + 1 } : item));
    } else {
      setBasket([...basket, { id: service.id, name: service.name, price: service.price, qty: 1 }]);
    }
  };

  const removeFromBasket = (id) => {
    const existing = basket.find(item => item.id === id);
    if (existing?.qty > 1) {
      setBasket(basket.map(item => item.id === id ? { ...item, qty: item.qty - 1 } : item));
    } else {
      setBasket(basket.filter(item => item.id !== id));
    }
  };

  const totalPrice = basket.reduce((acc, item) => acc + (item.price * item.qty), 0);

  const handleFinalize = async () => {
    setLoading(true);
    try {
      await API.put(`/orders/${order.id}/bill`, {
        applyHandlingFee: true, 
        processingNotes: processingNotes,
        items: basket.map(item => ({
          serviceId: item.id,
          itemName: item.name,
          quantity: item.qty,
          unitPrice: item.price
        }))
      });
      onUpdate();
      onClose();
    } catch {
      alert("Billing failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4 bg-brand-navy/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white w-full max-w-6xl md:rounded-3xl shadow-2xl flex flex-col h-full md:h-[90vh] overflow-hidden"
      >
        {/* Header - Fixed at top */}
        <div className="p-4 md:p-6 border-b border-slate-100 flex justify-between items-center bg-white shrink-0">
          <div>
            <div className="flex items-center gap-2">
               <div className="w-2 h-2 rounded-full bg-brand-teal animate-pulse" />
               <h2 className="text-lg md:text-xl font-black text-brand-navy uppercase tracking-tighter">
                 {order.items?.length > 0 ? "Edit Bill" : "Finalize Bill"}
               </h2>
            </div>
            <p className="text-[10px] md:text-xs font-bold text-slate-400 mt-1">
              #{order.trackingCode} • {order.customerName}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-all text-slate-400">
            <X size={24} />
          </button>
        </div>

        {/* Main Body - Scrollable on mobile, Split on Desktop */}
        <div className="flex-1 overflow-y-auto md:overflow-hidden flex flex-col md:flex-row bg-slate-50/50">
          
          {/* LEFT: Service Selection */}
          <div className="w-full md:flex-1 flex flex-col p-4 md:p-6 md:border-r border-slate-100 bg-white">
            <div className="sticky top-0 z-20 bg-white pb-4 space-y-4">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input 
                  type="text"
                  placeholder="Search services..."
                  className="w-full pl-12 pr-4 py-3 md:py-4 bg-slate-100 rounded-2xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-brand-teal/20"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                {categories.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap border ${
                      selectedCategory === cat ? 'bg-brand-teal border-brand-teal text-white' : 'bg-white border-slate-100 text-slate-500'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Services Grid */}
            <div className="md:flex-1 md:overflow-y-auto custom-scrollbar pt-2">
              {fetchingServices ? (
                <div className="flex flex-col items-center py-10 gap-2">
                  <Loader2 className="animate-spin text-brand-teal" size={24} />
                  <p className="text-[10px] font-black text-slate-400 uppercase">Loading...</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 lg:grid-cols-2 gap-3 pb-6">
                  {filteredServices.map(service => (
                    <button 
                      key={service.id}
                      onClick={() => addToBasket(service)}
                      className="flex flex-col justify-between p-3 rounded-2xl border border-slate-100 bg-white hover:border-brand-teal transition-all text-left"
                    >
                      <p className="text-xs font-black text-slate-700 h-8 overflow-hidden line-clamp-2">{service.name}</p>
                      <div className="flex justify-between items-center mt-2">
                        <span className="text-[11px] text-brand-teal font-black">₦{service.price.toLocaleString()}</span>
                        <div className="p-1 bg-slate-50 rounded-lg"><Plus size={14} /></div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Summary & Finalize */}
          <div className="w-full md:w-[380px] bg-slate-50 p-4 md:p-6 flex flex-col shrink-0 border-t md:border-t-0 md:border-l border-slate-200">
            <div className="flex items-center gap-2 mb-4">
              <ShoppingBag size={18} className="text-brand-navy" />
              <h3 className="text-[10px] font-black text-brand-navy uppercase tracking-widest">Order Summary</h3>
            </div>
            
            {/* Basket items */}
            <div className="max-h-[300px] md:flex-1 md:overflow-y-auto space-y-2 mb-4 custom-scrollbar">
              <AnimatePresence mode='popLayout'>
                {basket.map(item => (
                  <motion.div 
                    layout initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                    key={item.id} className="flex justify-between items-center bg-white p-3 rounded-2xl border border-slate-200"
                  >
                    <div className="flex-1 min-w-0 pr-2">
                      <p className="text-[10px] font-black text-slate-800 uppercase truncate">{item.name}</p>
                      <p className="text-[9px] font-bold text-brand-teal">{item.qty} x ₦{item.price.toLocaleString()}</p>
                    </div>
                    <button onClick={() => removeFromBasket(item.id)} className="p-1.5 bg-red-50 text-red-500 rounded-lg">
                      <Minus size={12} />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {/* Instructions */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <ClipboardList size={14} className="text-slate-400" />
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Instructions</h3>
              </div>
              <textarea 
                className="w-full h-20 p-3 bg-white rounded-2xl border border-slate-200 text-xs font-bold outline-none resize-none"
                placeholder="Specific wash instructions..."
                value={processingNotes}
                onChange={(e) => setProcessingNotes(e.target.value)}
              />
            </div>

            {/* Total & Action */}
            <div className="mt-auto pt-4 border-t border-slate-200">
              <div className="flex justify-between items-end mb-4">
                <span className="text-[10px] font-black text-slate-400 uppercase">Total</span>
                <p className="text-2xl font-black text-brand-navy leading-none">₦{totalPrice.toLocaleString()}</p>
              </div>
              
              <button 
                onClick={handleFinalize}
                disabled={loading || basket.length === 0}
                className="w-full bg-brand-navy text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 shadow-lg hover:bg-brand-teal transition-all disabled:opacity-50"
              >
                {loading ? <Loader2 className="animate-spin" /> : (
                  <>
                    <Receipt size={18} />
                    {order.items?.length > 0 ? "Update Bill" : "Finalize & Bill"}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default BillingModal;