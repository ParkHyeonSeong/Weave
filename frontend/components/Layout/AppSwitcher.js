import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { LayoutDashboard, GitBranch, FileEdit, Workflow, CalendarCheck, ChevronDown, Check, FileText } from 'lucide-react';
import { axios } from '@/library/_axios';
import { useUiPrefs } from '@/library/UiPrefsContext';
import { getAppContext, APP_HOME } from '@/library/appContext';
import { DEFAULT_COLORS } from '@/library/entityAppearance';

const APPS = [
  { key: 'home',   label: 'Home',   Icon: LayoutDashboard, color: '#64748b',             path: '/' },
  { key: 'branch', label: 'Branch', Icon: GitBranch,       color: DEFAULT_COLORS.branch, path: APP_HOME.branch },
  { key: 'canvas', label: 'Canvas', Icon: FileEdit,        color: DEFAULT_COLORS.canvas, path: APP_HOME.canvas },
  { key: 'track',  label: 'Track',  Icon: Workflow,        color: DEFAULT_COLORS.track,  path: APP_HOME.track },
  { key: 'scrum',  label: 'Scrum',  Icon: CalendarCheck,   color: DEFAULT_COLORS.scrum,  path: APP_HOME.scrum },
];

export default function AppSwitcher() {
  const router = useRouter();
  const currentKey = getAppContext(router.pathname) || 'home';
  const current = APPS.find((a) => a.key === currentKey) || APPS[0];
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState([]);
  const { isHidden } = useUiPrefs();
  const ref = useRef(null);

  // 드롭다운이 열릴 때만 최근 항목 로드
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    axios.get('/recent-views', { params: { limit: 5 } })
      .then((res) => { if (!cancelled && res.data.status) setRecent(res.data.items || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  // 외부 클릭 시 닫기 (Header의 기존 드롭다운 패턴과 동일)
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const goApp = (path) => { setOpen(false); router.push(path); };

  const goRecent = (item) => {
    setOpen(false);
    if (item.type === 'task') router.push(`/branch/${item.branch_id}/task/${item.task_id}`);
    else if (item.type === 'doc') router.push(`/canvas/${item.canvas_id}/${item.page_id}`);
  };

  const visibleRecent = recent.filter((it) =>
    it.type === 'task'
      ? !isHidden('branches', it.branch_id)
      : !isHidden('canvases', it.canvas_id)
  );

  const CurIcon = current.Icon;

  return (
    <div className="AppSwitcher" ref={ref}>
      <button
        className="AppSwitcher__Trigger"
        onClick={() => setOpen((p) => !p)}
        title="앱 전환"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="AppSwitcher__TrigIcon" style={{ color: current.color }}>
          <CurIcon size={15} strokeWidth={2.2} />
        </span>
        <span className="AppSwitcher__TrigLabel">{current.label}</span>
        <ChevronDown size={14} className="AppSwitcher__Chevron" />
      </button>

      {open && (
        <div className="AppSwitcher__Menu">
          <div className="AppSwitcher__Label">앱 전환</div>
          {APPS.map((app) => {
            const Icon = app.Icon;
            const active = app.key === currentKey;
            return (
              <button
                key={app.key}
                className={`AppSwitcher__Item ${active ? 'AppSwitcher__Item--active' : ''}`}
                onClick={() => goApp(app.path)}
              >
                <span className="AppSwitcher__ItemIcon" style={{ color: app.color }}>
                  <Icon size={16} strokeWidth={2.2} />
                </span>
                <span className="AppSwitcher__ItemLabel">{app.label}</span>
                {active && <Check size={14} className="AppSwitcher__ItemCheck" />}
              </button>
            );
          })}

          {visibleRecent.length > 0 && (
            <>
              <div className="AppSwitcher__Divider" />
              <div className="AppSwitcher__Label">최근</div>
              {visibleRecent.map((item) => (
                <button
                  key={`${item.type}-${item.type === 'task' ? item.task_id : item.page_id}`}
                  className="AppSwitcher__Recent"
                  onClick={() => goRecent(item)}
                >
                  {item.type === 'task' ? (
                    <span
                      className="AppSwitcher__RecentDot"
                      style={item.status_color ? { background: item.status_color } : undefined}
                    />
                  ) : (
                    <FileText size={13} className="AppSwitcher__RecentDocIcon" />
                  )}
                  <span className="AppSwitcher__RecentTitle">{item.title}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
