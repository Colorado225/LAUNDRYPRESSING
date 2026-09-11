import { useEffect, useState } from 'react';
import API from '../api/axios';
import { 
  UserPlus, Mail, Phone, Loader2, Trash2, 
  Briefcase, Truck, X, Lock, Unlock, EyeOff 
} from 'lucide-react';
import {  AnimatePresence } from 'framer-motion';

const StaffManagement = () => {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '', email: '', phone: '', password: '', role: 'STAFF'
  });

  const fetchStaff = async () => {
    try {
      const { data } = await API.get('/admin/staff');
      setStaff(data);
    } catch (err) {
      console.error("Error loading staff:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStaff(); }, []);

  // --- ACTIONS ---

  const handleAddStaff = async (e) => {
    e.preventDefault();
    try {
      await API.post('/admin/staff', formData);
      setIsModalOpen(false);
      setFormData({ name: '', email: '', phone: '', password: '', role: 'STAFF' });
      fetchStaff();
    } catch (err) {
      alert(err.response?.data?.error || "Error adding staff");
    }
  };

  const toggleStatus = async (id) => {
    try {
      // Calls your new PATCH /staff/:id/toggle route
      await API.patch(`/admin/staff/${id}/toggle`);
      fetchStaff(); // Refresh to see UI changes
    } catch {
      alert("Failed to update status");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure? This will permanently remove the staff member.")) return;
    try {
      await API.delete(`/admin/staff/${id}`);
      fetchStaff();
    } catch (err) {
      alert(err.response?.data?.error || "Cannot delete staff with order history. Disable them instead.");
    }
  };

  if (loading) return (
    <div className="h-96 flex items-center justify-center text-brand-teal">
      <Loader2 className="animate-spin" size={40} />
    </div>
  );

  return (
    <div className="relative space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-brand-navy uppercase tracking-tighter">Staff Directory</h1>
          <p className="text-slate-500">Enable, disable, or manage your service team.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="bg-brand-teal text-white px-6 py-3 rounded-2xl font-black uppercase tracking-widest text-xs shadow-lg shadow-brand-teal/20 hover:scale-105 transition-all flex items-center gap-2"
        >
          <UserPlus size={18} /> Add New Staff
        </button>
      </div>

      {/* Staff Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {staff.map((member) => (
          <motion.div 
            key={member.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: member.isActive ? 1 : 0.6, y: 0 }} // Faded if disabled
            className={`bg-white p-6 rounded-[2rem] border ${member.isActive ? 'border-slate-100' : 'border-red-100 bg-red-50/30'} shadow-sm relative group`}
          >
            {/* Status Badge */}
            <div className="absolute top-6 right-6">
               <span className={`text-[8px] font-black px-2 py-1 rounded-full uppercase ${member.isActive ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                 {member.isActive ? 'Active' : 'Disabled'}
               </span>
            </div>

            <div className="flex items-center gap-4 mb-6">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-xl shadow-lg ${member.isActive ? 'bg-brand-navy text-white' : 'bg-slate-300 text-slate-500'}`}>
                {member.name.charAt(0)}
              </div>
              <div>
                <h3 className="font-black text-brand-navy text-lg leading-tight">{member.name}</h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{member.role}</p>
              </div>
            </div>

            <div className="space-y-2 mb-6 text-sm text-slate-500 font-medium">
              <div className="flex items-center gap-2"><Mail size={14}/> {member.email}</div>
              <div className="flex items-center gap-2"><Phone size={14}/> {member.phone || 'N/A'}</div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-50">
              <div className="flex gap-2">
                <button 
                  onClick={() => toggleStatus(member.id)}
                  title={member.isActive ? "Disable Staff" : "Enable Staff"}
                  className={`p-2 rounded-xl transition-all ${member.isActive ? 'bg-amber-50 text-amber-600 hover:bg-amber-100' : 'bg-green-50 text-green-600 hover:bg-green-100'}`}
                >
                  {member.isActive ? <EyeOff size={18} /> : <Unlock size={18} />}
                </button>
                <button 
                  onClick={() => handleDelete(member.id)}
                  className="p-2 bg-red-50 text-red-500 rounded-xl hover:bg-red-100 transition-all"
                >
                  <Trash2 size={18} />
                </button>
              </div>
              
              <div className="text-right">
                <p className="text-[10px] font-black text-slate-400 uppercase">Orders</p>
                <p className="font-black text-brand-navy">{member._count?.managedOrders || 0}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* MODAL CODE (Keep exactly as before) */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-brand-navy/60 backdrop-blur-sm">
             <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl relative"
            >
              {/* Form Content same as before... */}
              <button onClick={() => setIsModalOpen(false)} className="absolute top-6 right-6 p-2 bg-slate-50 rounded-full"><X size={20}/></button>
              <h2 className="text-xl font-black text-brand-navy uppercase mb-6 text-center">Register New Staff</h2>
              <form onSubmit={handleAddStaff} className="space-y-4">
                <input type="text" placeholder="Name" required className="w-full bg-slate-50 rounded-2xl p-4 text-sm" onChange={(e) => setFormData({...formData, name: e.target.value})}/>
                <input type="email" placeholder="Email" required className="w-full bg-slate-50 rounded-2xl p-4 text-sm" onChange={(e) => setFormData({...formData, email: e.target.value})}/>
                <input type="password" placeholder="Password" required className="w-full bg-slate-50 rounded-2xl p-4 text-sm" onChange={(e) => setFormData({...formData, password: e.target.value})}/>
                <select className="w-full bg-slate-50 rounded-2xl p-4 text-sm font-bold" onChange={(e) => setFormData({...formData, role: e.target.value})}>
                  <option value="STAFF">Wash & Iron</option>
                  <option value="DRIVER">Driver</option>
                </select>
                <button type="submit" className="w-full bg-brand-navy text-white py-4 rounded-2xl font-black uppercase">Add to Team</button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default StaffManagement;