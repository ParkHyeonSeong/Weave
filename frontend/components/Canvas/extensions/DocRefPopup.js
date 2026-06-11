import { useState, useEffect, useRef } from 'react';
import { Search, FileText } from 'lucide-react';
import { axios } from '@/library/_axios';

export default function DocRefPopup({ onSelect, onClose, onDismiss, onBack }) {
  const [keyword, setKeyword] = useState('');
  const [docs, setDocs] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);
  const inputRef = useRef(null);
  const doneRef = useRef(false); // 선택/닫기 확정 후의 blur는 무시

  // ReactRenderer(flushSync)가 popup DOM 부착 전에 mount effect를 동기 실행하므로
  // 한 프레임 뒤에 포커스해야 실제로 잡힌다 (TaskRefPopup과 동일 패턴)
  useEffect(() => {
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await axios.get('/chat/doc-search', { params: { q: keyword || '' } });
        if (res.data.status) {
          setDocs(res.data.docs);
          setActiveIdx(0);
        }
      } catch {}
      setLoading(false);
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [keyword]);

  const finish = (fn) => { doneRef.current = true; fn(); };

  const handleKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return; // 한글 조합 확정 Enter가 선택으로 새지 않게 (레포 컨벤션)
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((prev) => Math.min(prev + 1, docs.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (docs[activeIdx]) finish(() => onSelect(docs[activeIdx]));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      finish(onClose);
    } else if (e.key === 'Backspace' && keyword === '') {
      // 빈 검색창에서 한 번 더 지우면 커맨드 메뉴로 복귀
      e.preventDefault();
      finish(onBack);
    }
  };

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
          onBlur={() => { if (!doneRef.current) onDismiss(); }}
        />
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
