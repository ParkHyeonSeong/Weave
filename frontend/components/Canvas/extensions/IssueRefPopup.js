import { Search, CircleDot } from 'lucide-react';
import { useRefSearchPopup } from './useRefSearchPopup';

const STATUS_LABELS = { open: 'Open', closed: 'Closed' };

export default function IssueRefPopup({ onSelect, onClose, onDismiss, onBack }) {
  const {
    keyword, setKeyword, items: issues, activeIdx, setActiveIdx, loading,
    inputRef, listRef, finish, handleKeyDown, handleBlur,
  } = useRefSearchPopup({
    url: '/chat/issue-search',
    pickItems: (data) => data.issues,
    onSelect, onClose, onDismiss, onBack,
  });

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
          onBlur={handleBlur}
        />
      </div>
      <ul className="IssueRefPopup__List" ref={listRef}>
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
