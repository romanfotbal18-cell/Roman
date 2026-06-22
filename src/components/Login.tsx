import { useState } from 'react';
import { LogIn, Wallet, AlertCircle, HelpCircle, Loader2, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { signInWithGoogle, signInWithGoogleRedirect } from '../firebase';

export default function Login() {
  const [loading, setLoading] = useState<'popup' | 'redirect' | null>(null);
  const [error, setError] = useState<{ code: string; message: string; hostname?: string } | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const handleLoginPopup = async () => {
    try {
      setLoading('popup');
      setError(null);
      await signInWithGoogle();
    } catch (err: any) {
      console.error("Firebase Login Error:", err);
      const errorCode = err?.code || 'unknown';
      const errorMessage = err?.message || String(err);
      setError({
        code: errorCode,
        message: errorMessage,
        hostname: window.location.hostname
      });
      setLoading(null);
    }
  };

  const handleLoginRedirect = async () => {
    try {
      setLoading('redirect');
      setError(null);
      await signInWithGoogleRedirect();
    } catch (err: any) {
      console.error("Firebase Login Error:", err);
      const errorCode = err?.code || 'unknown';
      const errorMessage = err?.message || String(err);
      setError({
        code: errorCode,
        message: errorMessage,
        hostname: window.location.hostname
      });
      setLoading(null);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 dark:bg-[#0B0F19] p-4 text-slate-800 dark:text-slate-100 transition-colors duration-200">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 p-8 rounded-[2.5rem] shadow-xl text-center relative overflow-hidden"
      >
        <div className="absolute top-4 right-4">
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Nápověda k přihlášení"
          >
            <HelpCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-6 flex justify-center">
          <div className="w-20 h-20 bg-blue-600 dark:bg-blue-500 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Wallet className="w-10 h-10 text-white animate-pulse" />
          </div>
        </div>
        
        <h1 className="text-3xl font-black mb-2 tracking-tight uppercase text-slate-900 dark:text-white">
          Týmová Pokladna
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mb-8">
          Transparentní správa týmových financí, pokut a výdajů na jednom místě.
        </p>

        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-6 p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900/60 rounded-2xl text-left text-sm text-rose-700 dark:text-rose-300"
            >
              <div className="flex gap-3 items-start">
                <AlertCircle className="w-5 h-5 shrink-0 text-rose-500 mt-0.5" />
                <div className="space-y-2">
                  <p className="font-bold">Chyba při přihlášení</p>
                  
                  {error.code === 'auth/unauthorized-domain' ? (
                    <div className="space-y-1.5 text-xs leading-relaxed">
                      <p>
                        Tato doména <code className="px-1.5 py-0.5 bg-rose-100 dark:bg-rose-900 rounded font-mono text-[11px] font-bold">{error.hostname}</code> není autorizovaná ve vašem Firebase projektu!
                      </p>
                      <p className="font-semibold text-slate-700 dark:text-slate-300">
                        Jak to opravit:
                      </p>
                      <ol className="list-decimal list-inside pl-1 space-y-1 text-[11px]">
                        <li>Otevřete <strong>Firebase Console</strong></li>
                        <li>Přejděte do sekce <strong>Authentication</strong></li>
                        <li>Klikněte na záložku <strong>Nastavení (Settings)</strong></li>
                        <li>Vyberte <strong>Autorizované domény (Authorized domains)</strong></li>
                        <li>Přidejte doménu <code className="px-1 py-0.2 bg-rose-100 dark:bg-rose-900/60 rounded font-mono font-bold text-[10px]">{error.hostname}</code></li>
                      </ol>
                    </div>
                  ) : error.code === 'auth/popup-blocked' ? (
                    <p className="text-xs">
                      Prohlížeč zablokoval vyskakovací okno pro přihlášení. Povolte prosím vyskakovací okna nebo použijte <strong>metodu přesměrování (Redirect)</strong> níže.
                    </p>
                  ) : error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request' ? (
                    <p className="text-xs">
                      Přihlašovací okno bylo zavřeno před dokončením přihlášení. Zkuste to prosím znovu.
                    </p>
                  ) : (
                    <p className="text-xs break-words">
                      {error.message} (kód: {error.code})
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {showHelp && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-6 p-4 bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/60 rounded-2xl text-left text-sm text-blue-700 dark:text-blue-300"
            >
              <div className="flex gap-3 items-start">
                <Info className="w-5 h-5 shrink-0 text-blue-500 mt-0.5" />
                <div className="space-y-1.5 text-xs leading-relaxed">
                  <p className="font-bold text-sm">Průvodce řešením přihlášení:</p>
                  <p>
                    <strong>Popup (Vyskakovací okno):</strong> Standardní rychlá metoda. Může selhat na mobilech nebo při přísném nastavení prohlížeče.
                  </p>
                  <p>
                    <strong>Redirect (Přesměrování):</strong> Nejspolehlivější metoda pro mobilní prohlížeče, Vercel a integrované prohlížeče (Facebook/Instagram), protože neotevírá samostatné okno.
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-3">
          <button
            onClick={handleLoginPopup}
            disabled={loading !== null}
            className="w-full bg-blue-600 dark:bg-blue-500 text-white font-bold py-4 px-6 rounded-2xl flex items-center justify-center gap-3 hover:bg-blue-700 dark:hover:bg-blue-600 transition-all active:scale-95 group disabled:opacity-50 disabled:pointer-events-none shadow-lg shadow-blue-500/10"
          >
            {loading === 'popup' ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <LogIn className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            )}
            {loading === 'popup' ? 'Otevírání okna...' : 'Přihlásit se přes Google'}
          </button>

          <button
            onClick={handleLoginRedirect}
            disabled={loading !== null}
            className="w-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold py-3.5 px-6 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none border border-slate-200/50 dark:border-slate-700/50 text-xs uppercase tracking-widest"
          >
            {loading === 'redirect' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : null}
            {loading === 'redirect' ? 'Přesměrovávání...' : 'Záložní metoda (Přesměrování)'}
          </button>
        </div>

        <p className="mt-8 text-xs text-slate-400 dark:text-slate-500 uppercase tracking-widest font-bold">
          Powered by Google AI Studio
        </p>
      </motion.div>
    </div>
  );
}
