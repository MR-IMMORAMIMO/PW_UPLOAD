import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';

export type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: string;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  showToast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const remove = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  const showToast = useCallback(
    (message: string, tone: ToastTone = 'success') => {
      const id = crypto.randomUUID();
      setToasts((current) => [...current, { id, message, tone }]);
      window.setTimeout(() => remove(id), 4_500);
    },
    [remove],
  );
  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" aria-live="polite" aria-label="Notifications">
        <AnimatePresence>
          {toasts.map((toast) => {
            const Icon =
              toast.tone === 'success' ? CheckCircle2 : toast.tone === 'error' ? CircleAlert : Info;
            return (
              <motion.div
                className={`toast toast-${toast.tone}`}
                key={toast.id}
                initial={{ opacity: 0, y: -18, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 30 }}
              >
                <Icon size={19} aria-hidden="true" />
                <span>{toast.message}</span>
                <button
                  type="button"
                  onClick={() => remove(toast.id)}
                  aria-label="Dismiss notification"
                >
                  <X size={16} />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider.');
  return value;
}
