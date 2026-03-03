import { X } from 'lucide-react';


export default function Alert({ isOpen, onClose, title, contents }) {
  if (!isOpen) return null;

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose?.();
    }
  };

  return (
    <div className="Alert__Backdrop" onClick={handleBackdropClick}>
      <div className="Alert">
        <div className="Alert__Header">
          <h3 className="Alert__Title">{title}</h3>
          <button className="Alert__CloseBtn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="Alert__Body">
          <p className="Alert__Contents">{contents}</p>
        </div>
        <div className="Alert__Footer">
          <button className="Alert__ConfirmBtn" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
}
