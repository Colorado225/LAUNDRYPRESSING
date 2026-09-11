import { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { X, Plus, Minus, ShoppingBag, User, Loader2, Trash2, ClipboardList, Search } from 'lucide-react';
import API from '../api/axios';
import toast from 'react-hot-toast'; // Import toast

const CreateOrderModal = ({ onClose, onUpdate }) => {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  
  // Form State
  const [customer, setCustomer] = useState({ name: '', phone: '', address: '' });
  const [cart, setCart] = useState([]);
  const [applyFee, setApplyFee] = useState(true);
  const [processingNotes, setProcessingNotes] = useState(''); 

  // --- SEARCH & FILTER STATE ---
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  useEffect(() => {
    const fetchServices = async () => {
      try {
        const { data } = await API.get('/services');
        setServices(data);
      } catch {
        console.error("Could not load services");
        toast.error("Failed to sync service list"); // Added toast
      } finally {
        setLoading(false);
      }
    };
    fetchServices();
  }, []);

  // --- FILTERING LOGIC ---
  const categories = ["All", ...new Set(services.map(s => s.category?.name).filter(Boolean))];

  const filteredServices = services.filter(service => {
    const matchesSearch = service.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "All" || service.category?.name === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const addToCart = (service) => {
    const exists = cart.find(item => item.id === service.id);
    if (exists) {
      setCart(cart.map(item => item.id === service.id ? { ...item, qty: item.qty + 1 } : item));
    } else {
      setCart([...cart, { ...service, qty: 1 }]);
      toast.success(`${service.name} added`, { icon: '🛒', duration: 1500 }); // Added toast
    }
  };

  const updateQty = (id, delta) => {
    setCart(cart.map(item => {
      if (item.id === id) {
        const newQty = item.qty + delta;
        return newQty > 0 ? { ...item, qty: newQty } : item;
      }
      return item;
    }));
  };

  const removeFromCart = (id) => {
    setCart(cart.filter(item => item.id !== id));
    toast.error("Item removed", { duration: 1500 }); // Added toast
  };

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
  const handlingFee = applyFee ? 200 : 0;
  const total = subtotal + handlingFee;

  const handleCreateOrder = async () => {
    if (!customer.name) return toast.error("Customer name is required"); // Replaced alert
    if (cart.length === 0) return toast.error("Your basket is empty"); // Replaced alert
    
    setSubmitting(true);
    const loadingToast = toast.loading("Processing order..."); // Added loading toast

    try {
      await API.post('/orders/book', {
        customerName: customer.name,
        customerPhone: customer.phone,
        address: customer.address,
        items: cart,
        applyHandlingFee: applyFee,
        processingNotes: processingNotes 
      });
      
      toast.success("Order created successfully!", { id: loadingToast }); // Update loading toast
      onUpdate();
      onClose();
    } catch {
      toast.error("Failed to create order. Try again.", { id: loadingToast }); // Update loading toast
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-brand-navy/60 backdrop-blur-sm flex justify-center md:justify-end">
      <motion.div 
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        className="bg-white w-full max-w-4xl h-full shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="p-4 md:p-6 border-b border-slate-100 flex justify-between items-center bg-white shrink-0">
          <div>
            <h2 className="text-xl md:text-2xl font-black text-brand-navy uppercase tracking-tighter">New Order</h2>
            <p className="text-[10px] font-black text-brand-teal uppercase tracking-widest">Mufti Laundry Spot</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-full transition-all">
            <X size={24} />
          </button>
        </div>

        {/* Responsive Body */}
        <div className="flex-1 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden bg-slate-50/30">
          
          {/* LEFT COLUMN: Customer & Services */}
          <div className="flex-1 p-4 md:p-6 space-y-6 md:overflow-y-auto custom-scrollbar bg-white">
            
            {/* Customer Section */}
            <section className="space-y-3">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                <User size={14} /> Customer Details
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input 
                  className="md:col-span-2 p-3 bg-slate-100 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-brand-teal/20"
                  placeholder="Full Name"
                  value={customer.name}
                  onChange={(e) => setCustomer({...customer, name: e.target.value})}
                />
                <input 
                  className="p-3 bg-slate-100 rounded-xl font-bold text-sm outline-none"
                  placeholder="Phone"
                  value={customer.phone}
                  onChange={(e) => setCustomer({...customer, phone: e.target.value})}
                />
                <input 
                  className="p-3 bg-slate-100 rounded-xl font-bold text-sm outline-none"
                  placeholder="Address"
                  value={customer.address}
                  onChange={(e) => setCustomer({...customer, address: e.target.value})}
                />
              </div>
            </section>

            {/* Service Search & Selection */}
            <section className="space-y-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 pt-2">
                <Plus size={14} /> Add Services
              </h3>
              
              {/* Search Bar */}
              <div className="sticky top-0 z-10 bg-white space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input 
                    type="text"
                    placeholder="Search e.g. Suit, Duvet..."
                    className="w-full pl-10 pr-4 py-3 bg-slate-100 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-brand-teal/20"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                
                {/* Categories */}
                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                  {categories.map(cat => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-tighter border transition-all whitespace-nowrap ${
                        selectedCategory === cat ? 'bg-brand-teal border-brand-teal text-white' : 'bg-white border-slate-200 text-slate-500'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {loading ? <Loader2 className="animate-spin text-brand-teal mx-auto py-10" /> : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {filteredServices.map(s => (
                    <button 
                      key={s.id}
                      onClick={() => addToCart(s)}
                      className="p-3 border border-slate-100 rounded-xl text-left hover:border-brand-teal hover:bg-brand-teal/5 transition-all group"
                    >
                      <p className="font-black text-brand-navy uppercase text-[9px] leading-tight mb-1 truncate">{s.name}</p>
                      <p className="text-brand-teal font-bold text-[10px]">₦{s.price.toLocaleString()}</p>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* RIGHT COLUMN: Basket & Instructions */}
          <div className="w-full md:w-[350px] bg-slate-50 p-4 md:p-6 flex flex-col border-t md:border-t-0 md:border-l border-slate-200">
            <h3 className="text-[10px] font-black text-brand-navy uppercase tracking-widest flex items-center gap-2 mb-4">
              <ShoppingBag size={14} /> Basket
            </h3>

            {/* Cart Items */}
            <div className="flex-1 overflow-y-auto space-y-2 mb-4 max-h-[250px] md:max-h-none">
              <AnimatePresence>
                {cart.map(item => (
                  <motion.div 
                    layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }}
                    key={item.id} className="bg-white p-3 rounded-xl border border-slate-200 flex justify-between items-center"
                  >
                    <div className="min-w-0 pr-2">
                      <p className="font-black text-[10px] uppercase text-brand-navy truncate">{item.name}</p>
                      <p className="text-[9px] font-bold text-brand-teal">₦{(item.price * item.qty).toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => updateQty(item.id, -1)} className="p-1 bg-slate-100 rounded-lg"><Minus size={10}/></button>
                      <span className="text-xs font-black">{item.qty}</span>
                      <button onClick={() => updateQty(item.id, 1)} className="p-1 bg-slate-100 rounded-lg"><Plus size={10}/></button>
                      <button onClick={() => removeFromCart(item.id)} className="ml-1 text-red-400"><Trash2 size={14}/></button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {/* Instructions */}
            <div className="space-y-2 mb-4">
              <h3 className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-2">
                <ClipboardList size={12} /> Instructions
              </h3>
              <textarea 
                className="w-full p-3 bg-white rounded-xl border border-slate-200 text-xs font-bold outline-none resize-none h-20"
                placeholder="Special handling notes..."
                value={processingNotes}
                onChange={(e) => setProcessingNotes(e.target.value)}
              />
            </div>

            {/* Final Totals */}
            <div className="mt-auto pt-4 border-t border-slate-200">
              <div className="flex items-center gap-2 mb-3">
                <input type="checkbox" checked={applyFee} onChange={(e) => setApplyFee(e.target.checked)} className="accent-brand-teal" />
                <span className="text-[10px] font-bold text-slate-500">Logistics Fee (₦200)</span>
              </div>
              <div className="flex justify-between items-end mb-4">
                <span className="text-[10px] font-black text-slate-400 uppercase">Grand Total</span>
                <h4 className="text-2xl font-black text-brand-navy">₦{total.toLocaleString()}</h4>
              </div>
              <button 
                disabled={submitting || cart.length === 0}
                onClick={handleCreateOrder}
                className="w-full py-4 bg-brand-navy text-white rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-brand-teal transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="animate-spin" /> : "Confirm Order"}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default CreateOrderModal;