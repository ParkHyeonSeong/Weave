import { PanelLeft, PanelRight } from 'lucide-react';

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl+';

export default function Footer({
  isSidebarCollapsed,
  isMessengerCollapsed,
  onToggleSidebar,
  onToggleMessenger,
}) {
  return (
    <footer className="Footer">
      <div className="Footer__Left">
        <button
          className={`Footer__Toggle ${!isSidebarCollapsed ? 'Footer__Toggle--active' : ''}`}
          onClick={onToggleSidebar}
        >
          <PanelLeft size={14} />
          <span className="Footer__Tooltip">Sidebar <kbd>{mod}B</kbd></span>
        </button>
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
