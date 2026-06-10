import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import {
  Search, GitBranch, LogOut, Plus, Home, ListTodo, FileText,
  Compass, User, CircleDot, Clock, Settings, PanelLeft,
} from 'lucide-react';
import { axios } from '@/library/_axios';
import { useUiPrefs } from '@/library/UiPrefsContext';
import Avatar from '@/components/common/Avatar';

// --- Command 모드 액션 ---
const ACTIONS = [
  { id: 'nav-dashboard', label: 'Go to Dashboard', icon: Home, group: 'Navigation', route: '/' },
  { id: 'nav-my-tasks', label: 'Go to My Tasks', icon: ListTodo, group: 'Navigation', route: '/my-tasks' },
  { id: 'nav-browse', label: 'Go to Browse', icon: Compass, group: 'Navigation', route: '/browse' },
  { id: 'nav-profile', label: 'Go to Profile', icon: User, group: 'Navigation', route: '/profile' },
  { id: 'nav-admin', label: 'Go to Admin', icon: Settings, group: 'Navigation', route: '/admin' },
  { id: 'create-branch', label: 'Create Branch', icon: Plus, group: 'Actions' },
  { id: 'create-canvas', label: 'Create Canvas', icon: Plus, group: 'Actions' },
  { id: 'logout', label: 'Logout', icon: LogOut, group: 'Account' },
];

const formatStatusKey = (key) => key?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || '';

export default function CommandPalette({ onClose }) {
  const router = useRouter();
  const { isHidden } = useUiPrefs();
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const listRef = useRef(null);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  // 최근 항목
  const [recentItems, setRecentItems] = useState([]);

  // 검색 결과
  const [searchResults, setSearchResults] = useState({ tasks: [], docs: [], issues: [], members: [] });
  const [searching, setSearching] = useState(false);

  const isSearchMode = query.trim().length >= 2;

  // 마운트 시 인풋 포커스 + 최근 항목 fetch
  useEffect(() => {
    inputRef.current?.focus();
    fetchRecent();
  }, []);

  const fetchRecent = async () => {
    try {
      const res = await axios.get('/recent-views', { params: { limit: 5 } });
      if (res.data.status) setRecentItems(res.data.items || []);
    } catch {}
  };

  // 검색 모드: 디바운스 API 호출
  useEffect(() => {
    if (!isSearchMode) {
      setSearchResults({ tasks: [], docs: [], issues: [], members: [] });
      setSearching(false);
      return;
    }

    setSearching(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const q = query.trim();
        const [tasksRes, docsRes, issuesRes, membersRes] = await Promise.all([
          axios.get('/chat/task-search', { params: { q, mode: 'all' } }),
          axios.get('/chat/doc-search', { params: { q } }),
          axios.get('/chat/issue-search', { params: { q } }),
          axios.get('/chat/mention-search', { params: { q } }),
        ]);
        setSearchResults({
          tasks: tasksRes.data.status ? tasksRes.data.tasks || [] : [],
          docs: docsRes.data.status ? docsRes.data.docs || [] : [],
          issues: issuesRes.data.status ? issuesRes.data.issues || [] : [],
          members: membersRes.data.status ? membersRes.data.users || [] : [],
        });
        setActiveIndex(0);
      } catch {}
      setSearching(false);
    }, 300);

    return () => clearTimeout(timerRef.current);
  }, [query]);

  // --- flat items 리스트 생성 ---
  const { groups, flatItems } = useMemo(() => {
    const taskVisible = (x) => !isHidden('branches', x.branch_id);
    const docVisible = (x) => !isHidden('canvases', x.canvas_id);
    if (isSearchMode) {
      return buildSearchGroups({
        ...searchResults,
        tasks: searchResults.tasks.filter(taskVisible),
        docs: searchResults.docs.filter(docVisible),
        issues: searchResults.issues.filter(taskVisible),
      });
    }
    const visibleRecent = recentItems.filter((r) =>
      r.type === 'task' ? taskVisible(r) : docVisible(r)
    );
    return buildCommandGroups(visibleRecent, query);
  }, [isSearchMode, searchResults, recentItems, query, isHidden]);

  // 키보드 네비게이션
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, flatItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && flatItems[activeIndex]) {
      e.preventDefault();
      executeItem(flatItems[activeIndex]);
    }
  };

  // 아이템 실행
  const executeItem = (item) => {
    switch (item.type) {
      case 'action':
        executeAction(item);
        break;
      case 'recent-task':
        onClose();
        router.push(`/branch/${item.data.branch_id}/task/${item.data.task_id}`);
        break;
      case 'recent-doc':
        onClose();
        router.push(`/canvas/${item.data.canvas_id}/${item.data.page_id}`);
        break;
      case 'search-task':
        onClose();
        router.push(`/branch/${item.data.branch_id}/task/${item.data.task_id}`);
        break;
      case 'search-doc':
        onClose();
        router.push(`/canvas/${item.data.canvas_id}/${item.data.page_id}`);
        break;
      case 'search-issue':
        onClose();
        router.push(`/branch/${item.data.branch_id}/task/${item.data.task_id}/issue/${item.data.issue_id}`);
        break;
      case 'search-member':
        // v1: 표시만
        break;
    }
  };

  const executeAction = (item) => {
    const action = item.data;
    if (action.route) {
      onClose();
      router.push(action.route);
      return;
    }
    switch (action.id) {
      case 'create-branch':
        onClose();
        window.dispatchEvent(new Event('palette:create-branch'));
        break;
      case 'create-canvas':
        onClose();
        window.dispatchEvent(new Event('layout:create-canvas'));
        break;
      case 'logout':
        axios.post('/auth/logout').catch(() => {});
        sessionStorage.removeItem('profile');
        sessionStorage.removeItem('avatar_url');
        sessionStorage.removeItem('app_initialized');
        router.replace('/auth/login');
        onClose();
        break;
    }
  };

  // 활성 아이템 스크롤
  useEffect(() => {
    const activeEl = listRef.current?.querySelector('.CommandPalette__Item--active');
    activeEl?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <div className="CommandPalette__Backdrop" onClick={onClose}>
      <div className="CommandPalette" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="CommandPalette__InputWrap">
          <Search size={16} className="CommandPalette__SearchIcon" />
          <input
            ref={inputRef}
            className="CommandPalette__Input"
            type="text"
            placeholder="Search or type a command..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
          />
          <kbd className="CommandPalette__Shortcut">ESC</kbd>
        </div>

        <div className="CommandPalette__List" ref={listRef}>
          {searching ? (
            <div className="CommandPalette__Loading">Searching...</div>
          ) : flatItems.length === 0 ? (
            <div className="CommandPalette__Empty">No results found.</div>
          ) : (
            groups.map((group) => (
              <div key={group.label} className="CommandPalette__Group">
                <div className="CommandPalette__GroupLabel">{group.label}</div>
                {group.items.map((item) => (
                  <button
                    key={item.key}
                    className={`CommandPalette__Item ${item.flatIndex === activeIndex ? 'CommandPalette__Item--active' : ''}`}
                    onClick={() => executeItem(item)}
                    onMouseEnter={() => setActiveIndex(item.flatIndex)}
                  >
                    {renderItem(item)}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// --- 아이템 렌더링 ---
function renderItem(item) {
  switch (item.type) {
    case 'action': {
      const Icon = item.data.icon;
      return (
        <>
          <Icon size={16} className="CommandPalette__ItemIcon" />
          <span className="CommandPalette__ItemLabel">{item.data.label}</span>
        </>
      );
    }
    case 'recent-task':
      return (
        <>
          <div className="CommandPalette__StatusDot" style={item.data.status_color ? { background: item.data.status_color } : undefined} />
          <span className="CommandPalette__ItemId">{item.data.display_number}</span>
          <span className="CommandPalette__ItemLabel">{item.data.title}</span>
        </>
      );
    case 'recent-doc':
      return (
        <>
          <FileText size={14} className="CommandPalette__ItemIcon" />
          <span className="CommandPalette__ItemLabel">{item.data.title}</span>
          <span className="CommandPalette__ItemMeta">{item.data.canvas_name}</span>
        </>
      );
    case 'search-task': {
      const main = (item.data.assignees || []).find((a) => a.role === 'main');
      return (
        <>
          <ListTodo size={14} className="CommandPalette__ItemIcon" />
          <span className="CommandPalette__ItemId">{item.data.display_id}</span>
          <span className="CommandPalette__ItemLabel">{item.data.title}</span>
          <span
            className="CommandPalette__ItemMeta"
            style={item.data.status_color ? { color: item.data.status_color } : undefined}
          >
            {item.data.status_label || formatStatusKey(item.data.status)}
          </span>
          {main && (
            <span className="CommandPalette__ItemMeta CommandPalette__ItemAssignee">
              <Avatar user={main} size="xs" />
              {main.username}
            </span>
          )}
        </>
      );
    }
    case 'search-doc':
      return (
        <>
          <FileText size={14} className="CommandPalette__ItemIcon" />
          <span className="CommandPalette__ItemLabel">{item.data.title}</span>
          <span className="CommandPalette__ItemMeta">{item.data.canvas_name}</span>
        </>
      );
    case 'search-issue':
      return (
        <>
          <CircleDot size={14} className="CommandPalette__ItemIcon" />
          <span className="CommandPalette__ItemLabel">{item.data.title}</span>
          <span className={`CommandPalette__StatusBadge CommandPalette__StatusBadge--${item.data.status}`}>
            {item.data.status === 'open' ? 'Open' : 'Closed'}
          </span>
          <span className="CommandPalette__ItemId">{item.data.display_id}</span>
        </>
      );
    case 'search-member':
      return (
        <>
          <Avatar user={item.data} size="sm" />
          <span className="CommandPalette__ItemLabel">{item.data.username}</span>
          <span className="CommandPalette__ItemMeta">{item.data.email}</span>
        </>
      );
    default:
      return null;
  }
}

// --- Command 모드 그룹 빌드 ---
function buildCommandGroups(recentItems, query) {
  const groups = [];
  const flatItems = [];
  let flatIndex = 0;

  // 최근 항목 (쿼리 없을 때만)
  if (!query && recentItems.length > 0) {
    const items = recentItems.map((r) => {
      const type = r.type === 'task' ? 'recent-task' : 'recent-doc';
      const key = `recent-${r.type}-${r.type === 'task' ? r.task_id : r.page_id}`;
      const item = { type, key, data: r, flatIndex: flatIndex++ };
      flatItems.push(item);
      return item;
    });
    groups.push({ label: 'Recent', items });
  }

  // 액션 필터링
  const q = query.toLowerCase();
  const filtered = q
    ? ACTIONS.filter((a) => a.label.toLowerCase().includes(q))
    : ACTIONS;

  // 그룹별 분류
  const actionGroups = {};
  filtered.forEach((action) => {
    if (!actionGroups[action.group]) actionGroups[action.group] = [];
    const item = { type: 'action', key: `action-${action.id}`, data: action, flatIndex: flatIndex++ };
    actionGroups[action.group].push(item);
    flatItems.push(item);
  });

  Object.entries(actionGroups).forEach(([label, items]) => {
    groups.push({ label, items });
  });

  return { groups, flatItems };
}

// --- Search 모드 그룹 빌드 ---
function buildSearchGroups(results) {
  const groups = [];
  const flatItems = [];
  let flatIndex = 0;

  if (results.tasks.length > 0) {
    const items = results.tasks.map((t) => {
      const item = { type: 'search-task', key: `task-${t.task_id}`, data: t, flatIndex: flatIndex++ };
      flatItems.push(item);
      return item;
    });
    groups.push({ label: 'Tasks', items });
  }

  if (results.docs.length > 0) {
    const items = results.docs.map((d) => {
      const item = { type: 'search-doc', key: `doc-${d.page_id}`, data: d, flatIndex: flatIndex++ };
      flatItems.push(item);
      return item;
    });
    groups.push({ label: 'Documents', items });
  }

  if (results.issues.length > 0) {
    const items = results.issues.map((i) => {
      const item = { type: 'search-issue', key: `issue-${i.issue_id}`, data: i, flatIndex: flatIndex++ };
      flatItems.push(item);
      return item;
    });
    groups.push({ label: 'Issues', items });
  }

  if (results.members.length > 0) {
    const items = results.members.map((m) => {
      const item = { type: 'search-member', key: `member-${m.user_id}`, data: m, flatIndex: flatIndex++ };
      flatItems.push(item);
      return item;
    });
    groups.push({ label: 'Members', items });
  }

  return { groups, flatItems };
}
