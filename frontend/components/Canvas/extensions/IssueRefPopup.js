import { useState, useEffect, useRef } from 'react';
import { Search, CircleDot } from 'lucide-react';
import { axios } from '@/library/_axios';

const STATUS_LABELS = { open: 'Open', closed: 'Closed' };

export default function IssueRefPopup({ onSelect, onClose, onDismiss, onBack }) {
  const [keyword, setKeyword] = useState('');
  const [issues, setIssues] = useState([]);
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
        const res = await axios.get('/chat/issue-search', { params: { q: keyword || '' } });
        if (res.data.status) {
          setIssues(res.data.issues);
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
      setActiveIdx((prev) => Math.min(prev + 1, issues.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (issues[activeIdx]) finish(() => onSelect(issues[activeIdx]));
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
    <div className="IssueRefPopup">
      <div className="IssueRefPopup__Header">
        <Search size={12} />
        /i - Issues
      </div>
      <div className="IssueRefPopup__Search">
        <input
          ref={inputRef}
          value={keyword}
          placeholder="이슈 검색…"
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { if (!doneRef.current) onDismiss(); }}
        />
      </div>
      <ul className="IssueRefPopup__List">
        {loading && <li className="IssueRefPopup__Empty">Searching...</li>}
        {!loading && issues.length === 0 && (
          <li className="IssueRefPopup__Empty">No issues found</li>
        )}
        {!loading && issues.map((issue, idx) => (
          <li
            key={issue.issue_id}
            className={`IssueRefPopup__Item ${idx === activeIdx ? 'IssueRefPopup__Item--active' : ''}`}
            onClick={() => finish(() => onSelect(issue))}
            onMouseEnter={() => setActiveIdx(idx)}
          >
            <CircleDot size={12} className="IssueRefPopup__ItemIcon" />
            <span className="IssueRefPopup__ItemId">{issue.display_id}</span>
            <span className="IssueRefPopup__ItemTitle">{issue.title}</span>
            <span className={`IssueRefPopup__ItemStatus IssueRefPopup__ItemStatus--${issue.status}`}>
              {STATUS_LABELS[issue.status] || issue.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
