import { X, FileText } from 'lucide-react';
import NavLink from '@/components/common/NavLink';

export default function DocRefCard({ docRef, removable, onRemove }) {
  if (!docRef) return null;

  // 클릭 가능(전송된 메시지)일 때만 링크. compose 프리뷰(removable)는 이동 안 함.
  const navUrl = !removable ? `/canvas/${docRef.canvas_id}/${docRef.page_id}` : null;

  const content = (
    <>
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
    </>
  );

  if (navUrl) {
    return <NavLink className="DocRefCard DocRefCard--clickable" href={navUrl}>{content}</NavLink>;
  }
  return <div className="DocRefCard">{content}</div>;
}
