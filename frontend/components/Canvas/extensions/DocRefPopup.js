import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Search, FileText } from 'lucide-react';
import { axios } from '@/library/_axios';

const DocRefPopup = forwardRef(({ keyword, onSelect, onClose }, ref) => {
  const [docs, setDocs] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  useImperativeHandle(ref, () => ({}));

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await axios.get('/chat/doc-search', {
          params: { q: keyword || '' },
        });
        if (res.data.status) {
          setDocs(res.data.docs);
          setActiveIdx(0);
        }
      } catch {}
      setLoading(false);
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [keyword]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setActiveIdx((prev) => Math.min(prev + 1, docs.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setActiveIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (docs[activeIdx]) onSelect(docs[activeIdx]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [docs, activeIdx, onSelect, onClose]);

  return (
    <div className="DocRefPopup">
      <div className="DocRefPopup__Header">
        <Search size={12} />
        /d - Documents
      </div>
      <ul className="DocRefPopup__List">
        {loading && <li className="DocRefPopup__Empty">Searching...</li>}
        {!loading && docs.length === 0 && (
          <li className="DocRefPopup__Empty">No documents found</li>
        )}
        {!loading && docs.map((doc, idx) => (
          <li
            key={doc.page_id}
            className={`DocRefPopup__Item ${idx === activeIdx ? 'DocRefPopup__Item--active' : ''}`}
            onClick={() => onSelect(doc)}
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
});

DocRefPopup.displayName = 'DocRefPopup';

export default DocRefPopup;
