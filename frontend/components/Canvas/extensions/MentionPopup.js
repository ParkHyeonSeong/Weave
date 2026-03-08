import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Search, User } from 'lucide-react';
import { axios } from '@/library/_axios';

const MentionPopup = forwardRef(({ keyword, branchId, roomId, onSelect, onClose }, ref) => {
  const [users, setUsers] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);

  useImperativeHandle(ref, () => ({}));

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params = { q: keyword || '' };
        if (roomId) params.room_id = roomId;
        else if (branchId) params.branch_id = branchId;
        const res = await axios.get('/chat/mention-search', { params });
        if (res.data.status) {
          setUsers(res.data.users);
          setActiveIdx(0);
        }
      } catch {}
      setLoading(false);
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [keyword, branchId, roomId]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        setActiveIdx((prev) => Math.min(prev + 1, users.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        setActiveIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (users[activeIdx]) onSelect(users[activeIdx]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [users, activeIdx, onSelect, onClose]);

  return (
    <div className="MentionPopup">
      <div className="MentionPopup__Header">
        <Search size={12} />
        Mention a user
      </div>
      <ul className="MentionPopup__List">
        {loading && <li className="MentionPopup__Empty">Searching...</li>}
        {!loading && users.length === 0 && (
          <li className="MentionPopup__Empty">No users found</li>
        )}
        {!loading && users.map((user, idx) => (
          <li
            key={user.user_id}
            className={`MentionPopup__Item ${idx === activeIdx ? 'MentionPopup__Item--active' : ''}`}
            onClick={() => onSelect(user)}
            onMouseEnter={() => setActiveIdx(idx)}
          >
            <User size={12} className="MentionPopup__ItemIcon" />
            <span className="MentionPopup__ItemName">{user.username}</span>
            <span className="MentionPopup__ItemEmail">{user.email}</span>
          </li>
        ))}
      </ul>
    </div>
  );
});

MentionPopup.displayName = 'MentionPopup';

export default MentionPopup;
