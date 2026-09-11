import React, { useState, useEffect } from 'react';
import { Clock, ClipboardList, AlertCircle, Play, CheckCircle } from 'lucide-react';

const WorkCard = ({ order, onStatusUpdate }) => {
  const [elapsed, setElapsed] = useState("");

  // Live Timer Logic
  useEffect(() => {
    if (order.status === 'PROCESSING' && order.startedAt) {
      const interval = setInterval(() => {
        const start = new Date(order.startedAt).getTime();
        const now = new Date().getTime();
        const diff = Math.floor((now - start) / 1000);
        
        const mins = Math.floor(diff / 60);
        const secs = diff % 60;
        setElapsed(`${mins}m ${secs}s`);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [order.status, order.startedAt]);

  const statusColors = {
    BILLED: "bg-amber-100 text-amber-600 border-amber-200",
    PROCESSING: "bg-blue-100 text-blue-600 border-blue-200",
    READY: "bg-emerald-100 text-emerald-600 border-emerald-200"
  };

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-white rounded-3xl p-5 shadow-sm border border-slate-100 flex flex-col h-full"
    >
      <div className="flex justify-between items-start mb-4">
        <span className={`px-3 py-1 rounded-full text-[10px] font-black border uppercase tracking-widest ${statusColors[order.status]}`}>
          {order.status === 'BILLED' ? 'Waiting' : order.status}
        </span>
        <span className="text-[10px] font-bold text-slate-300">#{order.trackingCode}</span>
      </div>

      <h3 className="text-lg font-black text-brand-navy leading-tight mb-1">{order.customerName}</h3>
      
      <div className="mt-4 space-y-2 flex-1">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
          <ClipboardList size={12} /> Manifest
        </p>
        <div className="bg-slate-50 rounded-2xl p-3">
          {order.items?.map((item, idx) => (
            <div key={idx} className="flex justify-between items-center py-1 border-b border-slate-100 last:border-0">
              <span className="text-xs font-bold text-slate-700">{item.itemName}</span>
              <span className="text-xs font-black text-brand-teal">x{item.quantity}</span>
            </div>
          ))}
        </div>
      </div>

      {order.processingNotes && (
        <div className="mt-4 p-3 bg-red-50 rounded-2xl border border-red-100">
           <p className="text-[10px] font-black text-red-500 uppercase flex items-center gap-1 mb-1">
             <AlertCircle size={12} /> Special Instructions
           </p>
           <p className="text-xs font-bold text-red-700 italic">{order.processingNotes}</p>
        </div>
      )}

      <div className="mt-6 pt-4 border-t border-slate-50 flex items-center justify-between">
        <div className="flex flex-col">
          {order.status === 'PROCESSING' && (
            <>
              <span className="text-[10px] font-black text-slate-400 uppercase">Time Spent</span>
              <span className="text-sm font-black text-brand-navy flex items-center gap-1">
                <Clock size={14} className="text-brand-teal" /> {elapsed}
              </span>
            </>
          )}
        </div>

        {order.status === 'BILLED' && (
          <button 
            onClick={() => onStatusUpdate(order.id, 'PROCESSING')}
            className="bg-brand-navy text-white px-5 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 hover:bg-brand-teal transition-all"
          >
            <Play size={14} fill="currentColor" /> Start Wash
          </button>
        )}

        {order.status === 'PROCESSING' && (
          <button 
            onClick={() => onStatusUpdate(order.id, 'READY')}
            className="bg-brand-teal text-white px-5 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 hover:bg-emerald-600 transition-all shadow-lg shadow-brand-teal/20"
          >
            <CheckCircle size={14} /> Mark Ready
          </button>
        )}
      </div>
    </motion.div>
  );
};

export default WorkCard;