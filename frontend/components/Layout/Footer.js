import { PanelLeft, PanelRight } from 'lucide-react';

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
          title="Toggle Sidebar"
        >
          <PanelLeft size={14} />
        </button>
      </div>

      <div className="Footer__Center" />

      <div className="Footer__Right">
        <button
          className={`Footer__Toggle ${!isMessengerCollapsed ? 'Footer__Toggle--active' : ''}`}
          onClick={onToggleMessenger}
          title="Toggle Messenger"
        >
          <PanelRight size={14} />
        </button>
      </div>
    </footer>
  );
}
