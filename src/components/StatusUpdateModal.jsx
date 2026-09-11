import { useState, useEffect } from 'react';
import { X, CheckCircle, Truck, Droplets, Info, Loader2, Edit3, UserCheck, AlertCircle } from 'lucide-react';
import API from '../api/axios';

const StatusUpdateModal = ({ order, allStaff, onClose, onUpdate, onEditBill }) => {
  const [loading, setLoading] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);

  // Debugging log to track if data is arriving
  useEffect(() => {
    console.log("Modal Data Check - Staff Count:", allStaff?.length);
  }, [allStaff]);

  const workflow = [
    { value: 'REQUESTED', label: 'New Request', icon: Info, color: 'text-amber-600', bg: 'bg-amber-100' },
    { value: 'PICKED_UP', label: 'Picked Up', icon: Droplets, color: 'text-blue-600', bg: 'bg-blue-100' },
    { value: 'BILLED', label: 'Order Billed', icon: Droplets, color: 'text-purple-600', bg: 'bg-purple-100' },
    { value: 'PROCESSING', label: 'In-Wash', icon: Droplets, color: 'text-indigo-600', bg: 'bg-indigo-100' },
    { value: 'READY', label: 'Ready for Pickup', icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-100' },
    { value: 'DELIVERED', label: 'Delivered', icon: Truck, color: 'text-slate-600', bg: 'bg-slate-100' },
  ];

  const handleAssign = async (staffId) => {
    if (!staffId) return;
    setIsAssigning(true);
    try {
      // Endpoint matches your backend logic
      await API.patch(`/orders/${order.id}/assign`, { staffId });
      onUpdate(); 
    } catch (error) {
      console.error("Assignment error:", error);
      alert("Failed to assign staff. Check if the backend route exists.");
    } finally {
      setIsAssigning(false);
    }
  };

  const handleStatusUpdate = async (newStatus) => {
    setLoading(true);
    try {
      await API.put(`/orders/status/${order.id}`, { status: newStatus });
      onUpdate(); 
      onClose();  
    } catch (error) {
      console.error("Update error:", error);
      alert("Failed to update status.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-brand-navy/70 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden p-6 max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex justify-between items-start mb-6 border-b border-slate-100 pb-4">
          <div>
            <span className="text-xs font-black uppercase tracking-widest text-brand-teal bg-brand-teal/5 px-3 py-1 rounded-full border border-brand-teal/10">Order Manager</span>
            <h2 className="text-2xl font-black text-brand-navy uppercase tracking-tighter mt-2">Update Workflow</h2>
            <p className="text-sm text-slate-500 font-medium">Customer: <span className='font-bold text-slate-700'>{order.customerName}</span></p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400">
            <X size={20} />
          </button>
        </div>

        {/* --- PERSONNEL ASSIGNMENT SECTION --- */}
        <div className="mb-6 p-5 bg-brand-teal/[0.03] border border-brand-teal/10 rounded-2xl">
          <h3 className="text-[10px] font-black text-brand-teal uppercase tracking-[0.2em] mb-3 flex items-center gap-2">
            <UserCheck size={14} /> Assign Staff & Start Processing
          </h3>
          
          <div className="space-y-3">
            <select 
              disabled={isAssigning || loading}
              value={order.staffId || ""}
              onChange={(e) => handleAssign(e.target.value)}
              className="w-full bg-white border-2 border-slate-100 rounded-xl p-3 text-sm font-bold text-brand-navy outline-none focus:border-brand-teal transition-all appearance-none cursor-pointer disabled:opacity-50"
            >
              {allStaff && allStaff.length > 0 ? (
                <>
                  <option value="">-- Select Personnel --</option>
                  {allStaff.map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.name.toUpperCase()} ({staff.role})
                    </option>
                  ))}
                </>
              ) : (
                <option value="" disabled>No staff members found...</option>
              )}
            </select>
            
            {/* If list is empty, show a small hint */}
            {(!allStaff || allStaff.length === 0) && (
              <p className="text-[10px] text-amber-600 font-bold flex items-center gap-1 mt-1">
                <AlertCircle size={10} /> Check Staff Management to ensure staff are Active.
              </p>
            )}

            {order.staff && (
              <div className="flex items-center gap-2 px-1">
                <div className="w-1.5 h-1.5 bg-brand-teal rounded-full animate-pulse" />
                <p className="text-[10px] font-bold text-slate-500 uppercase">
                  Currently Assigned: <span className="text-brand-navy">{order.staff.name}</span>
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Workflow Visualizer */}
        <div className="bg-slate-50 border border-slate-100 p-5 rounded-2xl mb-6">
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Current Status Lifecycle</h3>
          <div className="flex flex-wrap gap-2">
            {workflow.map((step, index) => {
              const Icon = step.icon;
              const isCurrent = order.status === step.value;
              const isPast = workflow.findIndex(s => s.value === order.status) > index;
              
              return (
                <div key={step.value} className="flex items-center gap-1.5 text-xs">
                  <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-bold ${
                    isCurrent ? `${step.bg} ${step.color} border-current/20` :
                    isPast ? 'bg-emerald-50 text-emerald-700 border-emerald-100 line-through opacity-50' :
                    'bg-white text-slate-400 border-slate-100'
                  }`}>
                    {isCurrent || isPast ? <CheckCircle size={14} /> : <Icon size={14} />}
                    {step.label}
                  </span>
                  {index < workflow.length - 1 && <span className="text-slate-200">→</span>}
                </div>
              );
            })}
          </div>
        </div>

        {/* Status Actions */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Manual Progress Update</h3>
            {!['PROCESSING', 'READY', 'DELIVERED'].includes(order.status) && (
                <button 
                  onClick={onEditBill}
                  className="text-[10px] font-black text-brand-teal uppercase tracking-widest flex items-center gap-1 hover:underline"
                >
                  <Edit3 size={12} /> Edit Bill
                </button>
            )}
          </div>
          
          {loading || isAssigning ? (
             <div className="text-center py-6 text-brand-teal font-black flex items-center justify-center gap-2">
                <Loader2 className="animate-spin" />
                Updating System...
             </div>
          ) : (
             <div className="grid grid-cols-2 gap-4">
               {workflow
                 .filter(step => {
                    const currentStatusRank = workflow.findIndex(s => s.value === order.status);
                    const stepRank = workflow.findIndex(s => s.value === step.value);
                    return stepRank > currentStatusRank;
                 })
                 .map(step => {
                   const Icon = step.icon;
                   return (
                     <button
                       key={step.value}
                       onClick={() => handleStatusUpdate(step.value)}
                       className={`group flex flex-col items-center justify-center text-center p-5 rounded-2xl border transition-all active:scale-95 shadow-lg shadow-slate-100/50 ${
                         step.bg} border-current/10 hover:border-current/30 hover:shadow-xl`}
                     >
                       <Icon size={32} className={`${step.color} mb-3 transition-transform group-hover:scale-110`} />
                       <span className={`text-sm font-black uppercase tracking-tight ${step.color}`}>
                         {step.label}
                       </span>
                     </button>
                   );
               })}
             </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default StatusUpdateModal;