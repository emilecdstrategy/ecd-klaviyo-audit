import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';
import { Check } from 'lucide-react';

interface Toast {
  id: number;
  message: string;
}

const ToastContext = createContext<(message: string) => void>(() => {});

let savedToastTimer: ReturnType<typeof setTimeout> | null = null;

/** Coalesced "Saved" toast — appears ~500ms after the last successful save in a burst. */
export function scheduleSavedToast(showToast: (message: string) => void, delayMs = 500) {
  if (savedToastTimer) clearTimeout(savedToastTimer);
  savedToastTimer = setTimeout(() => {
    showToast('Saved');
    savedToastTimer = null;
  }, delayMs);
}

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const showToast = useCallback((message: string) => {
    const id = ++counter.current;
    setToasts(prev => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 2200);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="fixed bottom-24 right-5 z-[9999] flex flex-col items-end gap-1.5 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className="flex items-center gap-1.5 rounded-md border border-gray-200/80 bg-white/95 px-2.5 py-1.5 text-xs font-medium text-gray-600 shadow-sm backdrop-blur-sm animate-slide-up pointer-events-auto"
          >
            <Check className="h-3 w-3 shrink-0 text-emerald-500" strokeWidth={2.5} />
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
