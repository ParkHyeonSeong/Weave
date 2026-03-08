import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';

const ICONS = {
  success: <CheckCircle2 size={16} />,
  error: <XCircle size={16} />,
  warning: <AlertTriangle size={16} />,
  info: <Info size={16} />,
};

let toastId = 0;

export function showToast(message, type = 'success') {
  window.dispatchEvent(new CustomEvent('toast', { detail: { message, type, id: ++toastId } }));
}

export default function Toast() {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const { message, type, id } = e.detail;
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => removeToast(id), 5000);
    };
    window.addEventListener('toast', handler);
    return () => window.removeEventListener('toast', handler);
  }, [removeToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="Toast__Container">
      {toasts.map((t) => (
        <div key={t.id} className={`Toast Toast--${t.type}`}>
          <span className="Toast__Icon">{ICONS[t.type] || ICONS.info}</span>
          <span className="Toast__Message">{t.message}</span>
          <button className="Toast__Close" onClick={() => removeToast(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
