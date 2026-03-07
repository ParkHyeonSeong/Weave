import { useRouter } from 'next/router';
import { X, FileText } from 'lucide-react';

export default function DocRefCard({ docRef, removable, onRemove }) {
  const router = useRouter();
  if (!docRef) return null;

  const handleClick = () => {
    if (removable) return;
    router.push(`/canvas/${docRef.canvas_id}/${docRef.page_id}`);
  };

  return (
    <div
      className={`DocRefCard ${!removable ? 'DocRefCard--clickable' : ''}`}
      onClick={handleClick}
    >
      <div className="DocRefCard__Header">
        <FileText size={12} className="DocRefCard__Icon" />
        <span className="DocRefCard__Title">{docRef.title}</span>
        {removable && (
          <button className="DocRefCard__Remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
            <X size={12} />
          </button>
        )}
      </div>
      <div className="DocRefCard__Canvas">{docRef.canvas_name}</div>
    </div>
  );
}
