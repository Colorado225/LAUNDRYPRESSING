// import { useEffect, useState } from 'react';
// import API from '../api/axios';
// import { 
//   Plus, Edit2, Trash2, Search, 
//   Settings, Loader2, Save, X, 
//   FolderPlus, ChevronRight 
// } from 'lucide-react';
// import { motion, AnimatePresence } from 'framer-motion';

// const Services = () => {
//   const [services, setServices] = useState([]);
//   const [categories, setCategories] = useState([]);
//   const [loading, setLoading] = useState(true);
//   const [searchTerm, setSearchTerm] = useState('');
//   const [isEditing, setIsEditing] = useState(null);
//   const [formData, setFormData] = useState({ name: '', price: '', categoryId: '' });

//   // Category Logic States
//   const [showCatInput, setShowCatInput] = useState(false);
//   const [newCatName, setNewCatName] = useState('');
//   const [editingCatId, setEditingCatId] = useState(null);
//   const [editCatName, setEditCatName] = useState('');

//   const fetchData = async () => {
//     try {
//       const [servicesRes, categoriesRes] = await Promise.all([
//         API.get('/services'),
//         API.get('/categories')
//       ]);
//       setServices(servicesRes.data);
//       setCategories(categoriesRes.data);
      
//       if (categoriesRes.data.length > 0 && !formData.categoryId) {
//         setFormData(prev => ({ ...prev, categoryId: categoriesRes.data[0].id }));
//       }
//     } catch (error) {
//       console.error("Fetch error:", error);
//     } finally {
//       setLoading(false);
//     }
//   };

//   useEffect(() => {
//     fetchData();
//   }, []);

//   // --- CATEGORY ACTIONS ---
//   const handleCreateCategory = async (e) => {
//     e.preventDefault();
//     if (!newCatName.trim()) return;
//     try {
//       const { data } = await API.post('/categories', { name: newCatName });
//       setCategories([...categories, data]);
//       setNewCatName('');
//       setShowCatInput(false);
//       setFormData({ ...formData, categoryId: data.id });
//     } catch (error) {
//       alert(error.response?.data?.message || "Failed to create category.");
//     }
//   };

//   const handleUpdateCategory = async (id) => {
//     try {
//       await API.put(`/categories/${id}`, { name: editCatName });
//       setEditingCatId(null);
//       fetchData(); // Refresh to update service list labels
//     } catch (error) {
//       alert("Rename failed.");
//     }
//   };

//   const handleDeleteCategory = async (id, name) => {
//     if (window.confirm(`Delete "${name}" category? This only works if the category is empty.`)) {
//       try {
//         await API.delete(`/categories/${id}`);
//         setCategories(categories.filter(c => c.id !== id));
//       } catch (error) {
//         alert(error.response?.data?.message || "Cannot delete category with services.");
//       }
//     }
//   };

//   // --- SERVICE ACTIONS ---
//   const handleSubmit = async (e) => {
//     e.preventDefault();
//     try {
//       if (isEditing) {
//         await API.put(`/services/${isEditing}`, formData);
//       } else {
//         await API.post('/services', formData);
//       }
//       setFormData({ name: '', price: '', categoryId: categories[0]?.id || '' });
//       setIsEditing(null);
//       fetchData();
//     } catch (error) {
//       alert("Action failed.");
//     }
//   };

//   const handleDelete = async (id) => {
//     if (window.confirm("Remove this item from the price list?")) {
//       try {
//         await API.delete(`/services/${id}`);
//         fetchData();
//       } catch (error) {
//         alert("Delete failed.");
//       }
//     }
//   };

//   const filteredServices = services.filter(s => 
//     s.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
//     s.category?.name.toLowerCase().includes(searchTerm.toLowerCase())
//   );

//   if (loading) return (
//     <div className="h-96 flex flex-col items-center justify-center text-brand-navy gap-4">
//       <Loader2 className="animate-spin text-brand-teal" size={40} />
//       <p className="font-bold tracking-widest uppercase text-xs">Loading Price List...</p>
//     </div>
//   );

//   return (
//     <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8 pb-20">
//       {/* Header */}
//       <div className="flex justify-between items-center">
//         <div>
//           <h1 className="text-2xl font-black text-brand-navy uppercase tracking-tight">Service Management</h1>
//           <p className="text-slate-500 text-xs font-bold uppercase tracking-widest flex items-center gap-2">
//             <Settings size={12} /> Configure your laundry menu
//           </p>
//         </div>
//       </div>

//       <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
//         {/* Left Column: Form & Category Manager */}
//         <div className="lg:col-span-4 space-y-6">
          
//           {/* Service Form */}
//           <form onSubmit={handleSubmit} className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/50 space-y-5">
//             <h3 className="font-black text-brand-navy uppercase text-sm tracking-widest flex items-center gap-2">
//               <Plus size={16} className="text-brand-teal" />
//               {isEditing ? 'Edit Service' : 'New Service'}
//             </h3>
            
//             <div className="space-y-4">
//               <div>
//                 <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Item Name</label>
//                 <input 
//                   type="text" 
//                   className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none font-bold text-sm focus:ring-2 focus:ring-brand-teal/20"
//                   value={formData.name}
//                   onChange={(e) => setFormData({...formData, name: e.target.value})}
//                   required
//                 />
//               </div>

//               <div className="grid grid-cols-2 gap-4">
//                 <div>
//                   <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Price (₦)</label>
//                   <input 
//                     type="number" 
//                     className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none font-bold text-sm focus:ring-2 focus:ring-brand-teal/20"
//                     value={formData.price}
//                     onChange={(e) => setFormData({...formData, price: e.target.value})}
//                     required
//                   />
//                 </div>
//                 <div>
//                   <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Category</label>
//                   <select 
//                     className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none font-bold text-sm focus:ring-2 focus:ring-brand-teal/20 appearance-none"
//                     value={formData.categoryId}
//                     onChange={(e) => setFormData({...formData, categoryId: e.target.value})}
//                     required
//                   >
//                     {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
//                   </select>
//                 </div>
//               </div>
//             </div>

//             <button type="submit" className="w-full py-4 bg-brand-navy text-white rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-brand-teal transition-all flex items-center justify-center gap-2 shadow-lg shadow-brand-navy/20">
//               {isEditing ? <Save size={16} /> : <Plus size={16} />}
//               {isEditing ? 'Update Service' : 'Create Service'}
//             </button>
//           </form>

//           {/* Category Quick-Manager */}
//           <div className="bg-slate-900 p-6 rounded-[2rem] text-white space-y-4 shadow-xl">
//             <div className="flex justify-between items-center">
//               <h3 className="font-black uppercase text-[10px] tracking-[0.2em] text-slate-400">Manage Categories</h3>
//               <button onClick={() => setShowCatInput(!showCatInput)} className="p-2 bg-white/10 rounded-lg hover:bg-brand-teal transition-colors">
//                 <FolderPlus size={14} />
//               </button>
//             </div>

//             {showCatInput && (
//               <div className="flex gap-2 animate-in slide-in-from-top-2">
//                 <input 
//                   className="flex-1 bg-white/10 rounded-xl px-3 py-2 text-xs font-bold outline-none border border-white/10 focus:border-brand-teal"
//                   placeholder="New Category Name..."
//                   value={newCatName}
//                   onChange={(e) => setNewCatName(e.target.value)}
//                 />
//                 <button onClick={handleCreateCategory} className="bg-brand-teal px-3 rounded-xl"><Save size={14}/></button>
//               </div>
//             )}

//             <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
//               {categories.map(cat => (
//                 <div key={cat.id} className="flex justify-between items-center group bg-white/5 p-2 rounded-xl border border-white/5">
//                   {editingCatId === cat.id ? (
//                     <input 
//                       autoFocus
//                       className="bg-transparent text-xs font-bold outline-none w-24"
//                       value={editCatName}
//                       onChange={(e) => setEditCatName(e.target.value)}
//                       onBlur={() => handleUpdateCategory(cat.id)}
//                       onKeyDown={(e) => e.key === 'Enter' && handleUpdateCategory(cat.id)}
//                     />
//                   ) : (
//                     <span className="text-xs font-bold">{cat.name}</span>
//                   )}
//                   <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
//                     <button onClick={() => {setEditingCatId(cat.id); setEditCatName(cat.name)}} className="p-1 hover:text-brand-teal"><Edit2 size={12}/></button>
//                     <button onClick={() => handleDeleteCategory(cat.id, cat.name)} className="p-1 hover:text-red-400"><Trash2 size={12}/></button>
//                   </div>
//                 </div>
//               ))}
//             </div>
//           </div>
//         </div>

//         {/* Right Column: Service List */}
//         <div className="lg:col-span-8 space-y-4">
//           <div className="relative group">
//             <Search className="absolute left-5 top-4 text-slate-400 group-focus-within:text-brand-teal transition-colors" size={20} />
//             <input 
//               type="text" 
//               placeholder="Search by garment or wash type..."
//               className="w-full pl-14 pr-6 py-4 bg-white rounded-2xl border border-slate-100 outline-none font-bold text-sm shadow-sm focus:ring-4 focus:ring-brand-teal/5 transition-all"
//               value={searchTerm}
//               onChange={(e) => setSearchTerm(e.target.value)}
//             />
//           </div>

//           <div className="bg-white rounded-[2.5rem] border border-slate-100 overflow-hidden shadow-2xl shadow-slate-200/40">
//             <div className="overflow-x-auto">
//               <table className="w-full text-left border-collapse">
//                 <thead>
//                   <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] bg-slate-50/50">
//                     <th className="px-8 py-5">Item</th>
//                     <th className="px-8 py-5">Category</th>
//                     <th className="px-8 py-5">Rate</th>
//                     <th className="px-8 py-5 text-right">Settings</th>
//                   </tr>
//                 </thead>
//                 <tbody className="divide-y divide-slate-50">
//                   <AnimatePresence mode='popLayout'>
//                     {filteredServices.map((service) => (
//                       <motion.tr 
//                         layout
//                         initial={{ opacity: 0, y: 10 }}
//                         animate={{ opacity: 1, y: 0 }}
//                         exit={{ opacity: 0, scale: 0.95 }}
//                         key={service.id} 
//                         className="hover:bg-brand-teal/[0.02] transition-colors group"
//                       >
//                         <td className="px-8 py-5 font-black text-brand-navy text-sm uppercase tracking-tight">
//                           {service.name}
//                         </td>
//                         <td className="px-8 py-5">
//                           <span className="text-[9px] font-black uppercase tracking-widest bg-brand-teal/10 text-brand-teal px-3 py-1.5 rounded-lg border border-brand-teal/10">
//                             {service.category?.name || 'General'}
//                           </span>
//                         </td>
//                         <td className="px-8 py-5 font-black text-slate-700 text-sm">
//                           ₦{Number(service.price).toLocaleString()}
//                         </td>
//                         <td className="px-8 py-5 text-right">
//                           <div className="flex justify-end gap-1">
//                             <button 
//                               onClick={() => {
//                                 setIsEditing(service.id);
//                                 setFormData({ name: service.name, price: service.price, categoryId: service.categoryId });
//                                 window.scrollTo({top: 0, behavior: 'smooth'});
//                               }} 
//                               className="p-2.5 text-slate-400 hover:text-brand-navy hover:bg-slate-100 rounded-xl transition-all"
//                             >
//                               <Edit2 size={16} />
//                             </button>
//                             <button 
//                               onClick={() => handleDelete(service.id)} 
//                               className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
//                             >
//                               <Trash2 size={16} />
//                             </button>
//                           </div>
//                         </td>
//                       </motion.tr>
//                     ))}
//                   </AnimatePresence>
//                 </tbody>
//               </table>
//             </div>
//           </div>
//         </div>
//       </div>
//     </motion.div>
//   );
// };

// export default Services;

import { useEffect, useState, useCallback } from 'react';
import API from '../api/axios';
import { 
  Plus, Edit2, Trash2, Search, 
  Settings, Loader2, Save, X, 
  FolderPlus, ChevronRight 
} from 'lucide-react';
import { AnimatePresence } from 'framer-motion';

const Services = () => {
  const [services, setServices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isEditing, setIsEditing] = useState(null);
  const [formData, setFormData] = useState({ name: '', price: '', categoryId: '' });

  // Category Logic States
  const [showCatInput, setShowCatInput] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [editingCatId, setEditingCatId] = useState(null);
  const [editCatName, setEditCatName] = useState('');

  // Stabilized Fetch Function (Fixes Dependency Warning + reusable in handlers)
  const fetchData = useCallback(async () => {
    try {
      const [servicesRes, categoriesRes] = await Promise.all([
        API.get('/services'),
        API.get('/categories')
      ]);
      
      const fetchedCategories = Array.isArray(categoriesRes.data) ? categoriesRes.data : [];
      const fetchedServices = Array.isArray(servicesRes.data) ? servicesRes.data : [];

      setServices(fetchedServices);
      setCategories(fetchedCategories);
      
      if (fetchedCategories.length > 0) {
        setFormData(prev => ({ 
          ...prev, 
          categoryId: prev.categoryId || fetchedCategories[0].id 
        }));
      }
    } catch (error) {
      console.error("Fetch error:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- CATEGORY ACTIONS ---
  const handleCreateCategory = async (e) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    try {
      const { data } = await API.post('/categories', { name: newCatName });
      setCategories(prev => [...prev, data]);
      setNewCatName('');
      setShowCatInput(false);
      setFormData(prev => ({ ...prev, categoryId: data.id }));
    } catch (error) {
      alert(error.response?.data?.message || "Failed to create category.");
    }
  };

  const handleUpdateCategory = async (id) => {
    try {
      await API.put(`/categories/${id}`, { name: editCatName });
      setEditingCatId(null);
      fetchData(); // Refresh to update service list labels
    } catch {
      alert("Rename failed.");
    }
  };

  const handleDeleteCategory = async (id, name) => {
    if (window.confirm(`Delete "${name}" category? This only works if the category is empty.`)) {
      try {
        await API.delete(`/categories/${id}`);
        setCategories(prev => prev.filter(c => c.id !== id));
      } catch (error) {
        alert(error.response?.data?.message || "Cannot delete category with services.");
      }
    }
  };

  // --- SERVICE ACTIONS ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (isEditing) {
        await API.put(`/services/${isEditing}`, formData);
      } else {
        await API.post('/services', formData);
      }
      setFormData({ name: '', price: '', categoryId: categories[0]?.id || '' });
      setIsEditing(null);
      fetchData();
    } catch {
      alert("Action failed.");
    }
  };

  const handleDelete = async (id) => {
    if (window.confirm("Remove this item from the price list?")) {
      try {
        await API.delete(`/services/${id}`);
        fetchData();
      } catch {
        alert("Delete failed.");
      }
    }
  };

  // Guard against missing properties or null responses
  const filteredServices = services.filter(s => 
    (s.name || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
    (s.category?.name || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return (
    <div className="h-96 flex flex-col items-center justify-center text-brand-navy gap-4">
      <Loader2 className="animate-spin text-brand-teal" size={40} />
      <p className="font-bold tracking-widest uppercase text-xs">Loading Price List...</p>
    </div>
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8 pb-20">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black text-brand-navy uppercase tracking-tight">Service Management</h1>
          <p className="text-slate-500 text-xs font-bold uppercase tracking-widest flex items-center gap-2">
            <Settings size={12} /> Configure your laundry menu
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Form & Category Manager */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Service Form */}
          <form onSubmit={handleSubmit} className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/50 space-y-5">
            <h3 className="font-black text-brand-navy uppercase text-sm tracking-widest flex items-center gap-2">
              <Plus size={16} className="text-brand-teal" />
              {isEditing ? 'Edit Service' : 'New Service'}
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Item Name</label>
                <input 
                  type="text" 
                  className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none font-bold text-sm focus:ring-2 focus:ring-brand-teal/20"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Price (₦)</label>
                  <input 
                    type="number" 
                    className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none font-bold text-sm focus:ring-2 focus:ring-brand-teal/20"
                    value={formData.price}
                    onChange={(e) => setFormData({...formData, price: e.target.value})}
                    required
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Category</label>
                  <select 
                    className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none font-bold text-sm focus:ring-2 focus:ring-brand-teal/20 appearance-none"
                    value={formData.categoryId}
                    onChange={(e) => setFormData({...formData, categoryId: e.target.value})}
                    required
                  >
                    {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <button type="submit" className="w-full py-4 bg-brand-navy text-white rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-brand-teal transition-all flex items-center justify-center gap-2 shadow-lg shadow-brand-navy/20">
              {isEditing ? <Save size={16} /> : <Plus size={16} />}
              {isEditing ? 'Update Service' : 'Create Service'}
            </button>
          </form>

          {/* Category Quick-Manager */}
          <div className="bg-slate-900 p-6 rounded-[2rem] text-white space-y-4 shadow-xl">
            <div className="flex justify-between items-center">
              <h3 className="font-black uppercase text-[10px] tracking-[0.2em] text-slate-400">Manage Categories</h3>
              <button onClick={() => setShowCatInput(!showCatInput)} className="p-2 bg-white/10 rounded-lg hover:bg-brand-teal transition-colors">
                <FolderPlus size={14} />
              </button>
            </div>

            {showCatInput && (
              <div className="flex gap-2 animate-in slide-in-from-top-2">
                <input 
                  className="flex-1 bg-white/10 rounded-xl px-3 py-2 text-xs font-bold outline-none border border-white/10 focus:border-brand-teal"
                  placeholder="New Category Name..."
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                />
                <button onClick={handleCreateCategory} className="bg-brand-teal px-3 rounded-xl"><Save size={14}/></button>
              </div>
            )}

            <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
              {categories.map(cat => (
                <div key={cat.id} className="flex justify-between items-center group bg-white/5 p-2 rounded-xl border border-white/5">
                  {editingCatId === cat.id ? (
                    <input 
                      autoFocus
                      className="bg-transparent text-xs font-bold outline-none w-24"
                      value={editCatName}
                      onChange={(e) => setEditCatName(e.target.value)}
                      onBlur={() => handleUpdateCategory(cat.id)}
                      onKeyDown={(e) => e.key === 'Enter' && handleUpdateCategory(cat.id)}
                    />
                  ) : (
                    <span className="text-xs font-bold">{cat.name}</span>
                  )}
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => {setEditingCatId(cat.id); setEditCatName(cat.name)}} className="p-1 hover:text-brand-teal"><Edit2 size={12}/></button>
                    <button onClick={() => handleDeleteCategory(cat.id, cat.name)} className="p-1 hover:text-red-400"><Trash2 size={12}/></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Service List */}
        <div className="lg:col-span-8 space-y-4">
          <div className="relative group">
            <Search className="absolute left-5 top-4 text-slate-400 group-focus-within:text-brand-teal transition-colors" size={20} />
            <input 
              type="text" 
              placeholder="Search by garment or wash type..."
              className="w-full pl-14 pr-6 py-4 bg-white rounded-2xl border border-slate-100 outline-none font-bold text-sm shadow-sm focus:ring-4 focus:ring-brand-teal/5 transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="bg-white rounded-[2.5rem] border border-slate-100 overflow-hidden shadow-2xl shadow-slate-200/40">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] bg-slate-50/50">
                    <th className="px-8 py-5">Item</th>
                    <th className="px-8 py-5">Category</th>
                    <th className="px-8 py-5">Rate</th>
                    <th className="px-8 py-5 text-right">Settings</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  <AnimatePresence mode='popLayout'>
                    {filteredServices.map((service) => (
                      <motion.tr 
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        key={service.id} 
                        className="hover:bg-brand-teal/[0.02] transition-colors group"
                      >
                        <td className="px-8 py-5 font-black text-brand-navy text-sm uppercase tracking-tight">
                          {service.name}
                        </td>
                        <td className="px-8 py-5">
                          <span className="text-[9px] font-black uppercase tracking-widest bg-brand-teal/10 text-brand-teal px-3 py-1.5 rounded-lg border border-brand-teal/10">
                            {service.category?.name || 'General'}
                          </span>
                        </td>
                        <td className="px-8 py-5 font-black text-slate-700 text-sm">
                          ₦{(Number(service.price) || 0).toLocaleString()}
                        </td>
                        <td className="px-8 py-5 text-right">
                          <div className="flex justify-end gap-1">
                            <button 
                              onClick={() => {
                                setIsEditing(service.id);
                                setFormData({ name: service.name || '', price: service.price || '', categoryId: service.categoryId || '' });
                                window.scrollTo({top: 0, behavior: 'smooth'});
                              }} 
                              className="p-2.5 text-slate-400 hover:text-brand-navy hover:bg-slate-100 rounded-xl transition-all"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button 
                              onClick={() => handleDelete(service.id)} 
                              className="p-2.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default Services;