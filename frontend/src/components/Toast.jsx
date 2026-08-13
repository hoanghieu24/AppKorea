import { createContext, useCallback, useContext, useRef, useState } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState({ show: false, msg: '', type: 'info' });
  const timerRef = useRef(null);

  const showToast = useCallback((msg, type = 'info', duration = 2500) => {
    clearTimeout(timerRef.current);
    setToast({ show: true, msg, type });
    timerRef.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), duration);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className={`toast ${toast.show ? 'show' : ''} ${toast.type}`}>{toast.msg}</div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast phải dùng bên trong ToastProvider');
  return ctx;
}
