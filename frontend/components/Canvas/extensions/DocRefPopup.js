import { Search, FileText } from 'lucide-react';
import { useRefSearchPopup } from './useRefSearchPopup';

export default function DocRefPopup({ onSelect, onClose, onDismiss, onBack }) {
  const {
    keyword, setKeyword, items: docs, activeIdx, setActiveIdx, loading,
    inputRef, listRef, finish, handleKeyDown, handleBlur,
  } = useRefSearchPopup({
    url: '/chat/doc-search',
    pickItems: (data) => data.docs,
    onSelect, onClose, onDismiss, onBack,
  });

  return (
    <div className="DocRefPopup">
      <div className="DocRefPopup__Header">
        <Search size={12} />
        /d - Documents
      </div>
      <div className="DocRefPopup__Search">
        <input
          ref={inputRef}
          value={keyword}
          placeholder="문서 검색…"
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
        />
      </div>
      <ul className="DocRefPopup__List" ref={listRef}>
        {loading && <li className="DocRefPopup__Empty">Searching...</li>}
        {!loading && docs.length === 0 && (
          <li className="DocRefPopup__Empty">No documents found</li>
        )}
        {!loading && docs.map((doc, idx) => (
          <li
            key={doc.page_id}
            className={`DocRefPopup__Item ${idx === activeIdx ? 'DocRefPopup__Item--active' : ''}`}
            onClick={() => finish(() => onSelect(doc))}
            onMouseEnter={() => setActiveIdx(idx)}
          >
            <FileText size={12} className="DocRefPopup__ItemIcon" />
            <span className="DocRefPopup__ItemTitle">{doc.title}</span>
            <span className="DocRefPopup__ItemCanvas">{doc.canvas_name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
