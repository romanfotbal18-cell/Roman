import { LogIn, Wallet } from 'lucide-react';
import { motion } from 'motion/react';

interface LoginProps {
  onLogin: () => void;
}

export default function Login({ onLogin }: LoginProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-4 text-white">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white/10 backdrop-blur-xl p-8 rounded-3xl border border-white/10 shadow-2xl text-center"
      >
        <div className="mb-6 flex justify-center">
          <div className="w-20 h-20 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Wallet className="w-10 h-10 text-white" />
          </div>
        </div>
        <h1 className="text-4xl font-bold mb-2 tracking-tight uppercase">Týmová Pokladna</h1>
        <p className="text-slate-400 mb-8">Transparentní správa týmových financí, pokut a výdajů na jednom místě.</p>
        
        <button
          onClick={onLogin}
          className="w-full bg-white text-slate-900 font-semibold py-4 px-6 rounded-2xl flex items-center justify-center gap-3 hover:bg-slate-100 transition-all active:scale-95 group"
        >
          <LogIn className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          Přihlásit se přes Google
        </button>
        
        <p className="mt-8 text-xs text-slate-500 uppercase tracking-widest font-medium">
          Powered by Google AI Studio
        </p>
      </motion.div>
    </div>
  );
}
