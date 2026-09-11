import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import API from '../api/axios';
import WorkCard from '../components/workCard'; 
import { AnimatePresence} from 'framer-motion';
import { LogOut, User, RefreshCw, LayoutDashboard, CheckCircle2, Timer, Package } from 'lucide-react';

const StaffDashboard = () => {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('PENDING'); // PENDING vs COMPLETED
  const [isRefreshing, setIsRefreshing] = useState(false);
  const navigate = useNavigate();

  const user = JSON.parse(localStorage.getItem('user')) || { name: 'Staff Member' };

  const fetchTasks = async () => {
    setIsRefreshing(true);
    try {
      const { data } = await API.get('/orders/all');
      setTasks(data);
    } catch (error) {
      console.error("Task Fetch Error:", error);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 60000);
    return () => clearInterval(interval);
  }, []);

  // Professional Filtering Logic
  const pendingTasks = tasks.filter(t => ['BILLED', 'PROCESSING'].includes(t.status));
  const completedTasks = tasks.filter(t => t.status === 'READY');
  
  const displayTasks = activeTab === 'PENDING' ? pendingTasks : completedTasks;

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const handleUpdateStatus = async (id, newStatus) => {
    try {
      await API.put(`/orders/status/${id}`, { status: newStatus });
      fetchTasks(); 
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="min-h-screen bg-[#F1F5F9]">
      {/* NAVIGATION BAR */}
      <nav className="bg-brand-navy border-b border-white/10 sticky top-0 z-50 text-white shadow-xl">
        <div className="max-w-7xl mx-auto px-4 h-16 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-brand-teal p-2 rounded-xl rotate-3">
              <Package size={20} className="text-brand-navy" />
            </div>
            <span className="font-black tracking-tighter text-xl uppercase italic">
              Mufti<span className="text-brand-teal">Ops</span>
            </span>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-xs font-black text-brand-teal uppercase tracking-widest">Active Operator</span>
              <span className="text-sm font-bold">{user.name}</span>
            </div>
            <button onClick={handleLogout} className="p-2 hover:bg-white/10 rounded-full transition-colors">
              <LogOut size={20} className="text-slate-300" />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
        
        {/* STATS SUMMARY SECTION */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <StatCard 
            label="In Queue" 
            count={pendingTasks.filter(t => t.status === 'BILLED').length} 
            icon={<Timer size={18}/>} 
            color="amber" 
          />
          <StatCard 
            label="In Wash" 
            count={pendingTasks.filter(t => t.status === 'PROCESSING').length} 
            icon={<RefreshCw size={18}/>} 
            color="blue" 
          />
          <StatCard 
            label="Finished" 
            count={completedTasks.length} 
            icon={<CheckCircle2 size={18}/>} 
            color="emerald" 
          />
          <button 
            onClick={fetchTasks}
            className="bg-white p-4 rounded-3xl shadow-sm border border-slate-200 flex flex-col items-center justify-center gap-1 hover:border-brand-teal transition-all"
          >
            <RefreshCw size={20} className={`${isRefreshing ? 'animate-spin' : ''} text-brand-teal`} />
            <span className="text-[10px] font-black uppercase text-slate-400">Sync Data</span>
          </button>
        </div>

        {/* TAB NAVIGATION */}
        <div className="flex gap-2 p-1.5 bg-slate-200 w-fit rounded-2xl mb-8">
          <button 
            onClick={() => setActiveTab('PENDING')}
            className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'PENDING' ? 'bg-white text-brand-navy shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Needs Attention ({pendingTasks.length})
          </button>
          <button 
            onClick={() => setActiveTab('COMPLETED')}
            className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'COMPLETED' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Completed ({completedTasks.length})
          </button>
        </div>

        {/* TASK GRID */}
        {loading ? (
          <div className="py-20 text-center animate-pulse font-black text-slate-400 uppercase tracking-tighter">Initializing Hub...</div>
        ) : displayTasks.length === 0 ? (
          <div className="py-20 text-center bg-white rounded-[3rem] border-2 border-dashed border-slate-200">
            <p className="text-slate-400 font-black uppercase">No {activeTab.toLowerCase()} orders</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <AnimatePresence mode="popLayout">
              {displayTasks.map(order => (
                <WorkCard key={order.id} order={order} onStatusUpdate={handleUpdateStatus} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>
    </div>
  );
};

// Internal Stat Card Component
const StatCard = ({ label, count, icon, color }) => {
  const colors = {
    amber: "text-amber-600 bg-amber-50 border-amber-100",
    blue: "text-blue-600 bg-blue-50 border-blue-100",
    emerald: "text-emerald-600 bg-emerald-50 border-emerald-100"
  };
  return (
    <div className={`p-4 rounded-3xl border shadow-sm flex flex-col items-center sm:items-start bg-white`}>
      <div className={`p-2 rounded-xl mb-2 ${colors[color]}`}>
        {icon}
      </div>
      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
      <span className="text-2xl font-black text-slate-800">{count}</span>
    </div>
  );
};

export default StaffDashboard;