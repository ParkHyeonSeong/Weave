import { useRouter } from 'next/router';
import NavLink from '@/components/common/NavLink';
import { PanelLeft, PanelRight, LayoutDashboard, CheckSquare, Compass, Menu, MessageSquare } from 'lucide-react';

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent);
const mod = isMac ? '\u2318' : 'Ctrl+';

export default function Footer({
  isMobile,
  hasSidebar = false,
  isSidebarCollapsed,
  isMessengerCollapsed,
  onToggleSidebar,
  onToggleMessenger,
}) {
  const router = useRouter();

  // 모바일: 바텀 네비게이션
  if (isMobile) {
    return (
      <footer className="Footer Footer--mobile">
        <NavLink
          href="/"
          className={`Footer__NavItem ${router.pathname === '/' ? 'Footer__NavItem--active' : ''}`}
        >
          <LayoutDashboard size={20} />
          <span className="Footer__NavLabel">Home</span>
        </NavLink>
        <NavLink
          href="/my-tasks"
          className={`Footer__NavItem ${router.pathname === '/my-tasks' ? 'Footer__NavItem--active' : ''}`}
        >
          <CheckSquare size={20} />
          <span className="Footer__NavLabel">Tasks</span>
        </NavLink>
        <NavLink
          href="/browse"
          className={`Footer__NavItem ${router.pathname === '/browse' ? 'Footer__NavItem--active' : ''}`}
        >
          <Compass size={20} />
          <span className="Footer__NavLabel">Browse</span>
        </NavLink>
        {hasSidebar && (
          <button
            className={`Footer__NavItem ${!isSidebarCollapsed ? 'Footer__NavItem--active' : ''}`}
            onClick={onToggleSidebar}
          >
            <Menu size={20} />
            <span className="Footer__NavLabel">Menu</span>
          </button>
        )}
        <button
          className={`Footer__NavItem ${!isMessengerCollapsed ? 'Footer__NavItem--active' : ''}`}
          onClick={onToggleMessenger}
        >
          <MessageSquare size={20} />
          <span className="Footer__NavLabel">Chat</span>
        </button>
      </footer>
    );
  }

  // 데스크톱: 기존 Footer
  return (
    <footer className="Footer">
      <div className="Footer__Left">
        {hasSidebar && (
          <button
            className={`Footer__Toggle ${!isSidebarCollapsed ? 'Footer__Toggle--active' : ''}`}
            onClick={onToggleSidebar}
          >
            <PanelLeft size={14} />
            <span className="Footer__Tooltip">Sidebar <kbd>{mod}B</kbd></span>
          </button>
        )}
      </div>

      <div className="Footer__Center" />

      <div className="Footer__Right">
        <button
          className={`Footer__Toggle ${!isMessengerCollapsed ? 'Footer__Toggle--active' : ''}`}
          onClick={onToggleMessenger}
        >
          <PanelRight size={14} />
          <span className="Footer__Tooltip Footer__Tooltip--right">Messenger <kbd>{mod}.</kbd></span>
        </button>
      </div>
    </footer>
  );
}
