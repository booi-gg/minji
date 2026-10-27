import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from "react";

const TOAST_MS = 5000;

export interface ToastOptions {
  message: string;
  action?: { label: string; onClick: () => void };
}

interface Toast extends ToastOptions {
  id: number;
}

const ToastContext = createContext<((toast: ToastOptions) => void) | null>(null);

/** Shows short messages, optionally with one action such as Undo, in a polite live region. */
export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (options: ToastOptions) => {
      nextId.current += 1;
      const id = nextId.current;
      setToasts((current) => [...current.slice(-2), { ...options, id }]);
      setTimeout(() => dismiss(id), TOAST_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="toast">
            <span>{toast.message}</span>
            {toast.action === undefined ? null : (
              <button
                type="button"
                className="button button-quiet"
                onClick={() => {
                  toast.action?.onClick();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext>
  );
};

export const useToast = (): ((toast: ToastOptions) => void) => {
  const show = use(ToastContext);
  if (show === null) throw new Error("useToast must be used inside ToastProvider");
  return show;
};
