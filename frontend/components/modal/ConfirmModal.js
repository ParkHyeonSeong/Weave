import { X } from 'lucide-react';

export default function ConfirmModal({ isOpen, onClose, onConfirm, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'primary' }) {
  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose?.();
    }
  };

  return (
    <div className="ConfirmModal__Backdrop" onClick={handleBackdropClick}>
      <div className="ConfirmModal">
        <div className="ConfirmModal__Header">
          <h3 className="ConfirmModal__Title">{title}</h3>
          <button className="ConfirmModal__CloseBtn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="ConfirmModal__Body">
          <p className="ConfirmModal__Message">{message}</p>
        </div>
        <div className="ConfirmModal__Footer">
          <button className="ConfirmModal__CancelBtn" onClick={onClose}>
            {cancelLabel}
          </button>
          <button
            className={`ConfirmModal__ConfirmBtn ConfirmModal__ConfirmBtn--${variant}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
