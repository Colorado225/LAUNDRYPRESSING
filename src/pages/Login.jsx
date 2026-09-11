import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Shirt, Lock, Mail, Loader2, Eye, EyeOff } from 'lucide-react';
import { } from 'framer-motion';
import toast from 'react-hot-toast';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  // Animation variants
  const containerVariants = {
    hidden: { opacity: 0, y: 60, scale: 0.92 },
    show: { 
      opacity: 1, 
      y: 0, 
      scale: 1,
      transition: {
        duration: 0.8,
        ease: [0.16, 1, 0.3, 1],
        staggerChildren: 0.1,
        delayChildren: 0.2,
      }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 15 },
    show: { opacity: 1, y: 0 }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    // 1. Show a loading state in the toast immediately
    const loginLoadingToast = toast.loading("Authenticating...");

    try {
      const result = await login(email, password);
      const userRole = result.user?.role;
      const userName = result.user?.name || "Boss";

      // 2. Update the loading toast to a Success message
      toast.success(`Welcome back, ${userName}!`, {
        id: loginLoadingToast, // This replaces the loading spinner
        icon: '👋',
        duration: 3000
      });

      // 3. DELAY the navigation so the toast is visible on the login page first
      setTimeout(() => {
        if (userRole === 'STAFF') {
          navigate('/staff');
        } else {
          navigate('/dashboard');
        }
      }, 1500); // 1.5 seconds delay gives enough time to read the toast
      
    } catch {
      // Axios Interceptor handles the toast error, so we just clear our loading one
      toast.dismiss(loginLoadingToast);
      console.error("Login attempt failed");
      setLoading(false); // Only stop loading if it failed
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-navy px-4 overflow-hidden">
      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="max-w-md w-full bg-white rounded-[2rem] shadow-2xl p-8"
      >
        <div className="text-center mb-8">
          <motion.div 
            variants={itemVariants}
            className="inline-flex items-center justify-center w-16 h-16 bg-brand-teal/10 text-brand-teal rounded-full mb-4"
          >
            <Shirt size={32} />
          </motion.div>
          <motion.h2 variants={itemVariants} className="text-3xl font-bold text-brand-navy tracking-tight">
            Mufti Admin
          </motion.h2>
          <motion.p variants={itemVariants} className="text-slate-500 text-sm">
            Welcome back. Let's get to work.
          </motion.p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <motion.div variants={itemVariants} className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="email"
              placeholder="Email Address"
              className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-brand-teal focus:bg-white outline-none transition-all font-bold text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </motion.div>

          <motion.div variants={itemVariants} className="relative">
            <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              className="w-full pl-12 pr-12 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-brand-teal focus:bg-white outline-none transition-all font-bold text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-brand-teal transition-colors"
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </motion.div>

          <motion.button
            variants={itemVariants}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            disabled={loading}
            className="w-full bg-brand-navy hover:bg-brand-teal text-white font-black py-4 rounded-2xl transition-all duration-300 flex items-center justify-center gap-2 shadow-xl shadow-brand-navy/10 uppercase text-[10px] tracking-widest"
          >
            {loading ? <Loader2 className="animate-spin" /> : "Sign In to Dashboard"}
          </motion.button>
        </form>
      </motion.div>
    </div>
  );
};

export default Login;