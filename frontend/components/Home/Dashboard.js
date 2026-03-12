import { useState, useRef, useCallback } from 'react';
import { LayoutDashboard } from 'lucide-react';
import TaskSummary from './DashboardWidgets/TaskSummary';
import ActiveSprints from './DashboardWidgets/ActiveSprints';
import StarredItems from './DashboardWidgets/StarredItems';
import RecentItems from './DashboardWidgets/RecentItems';
import AIChat from './AIChat/AIChat';

const AI_PANEL_MIN_WIDTH = 320;
const AI_PANEL_DEFAULT_WIDTH = 420;

export default function Dashboard() {
  const [aiPanelWidth, setAiPanelWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dashboard_ai_width');
      return saved ? Number(saved) : AI_PANEL_DEFAULT_WIDTH;
    }
    return AI_PANEL_DEFAULT_WIDTH;
  });
  const isResizingRef = useRef(false);

  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startX = e.clientX;
    const startWidth = aiPanelWidth;
    let latestWidth = startWidth;

    const handleMouseMove = (e) => {
      if (!isResizingRef.current) return;
      const delta = startX - e.clientX;
      const maxWidth = Math.floor(window.innerWidth * 0.5);
      latestWidth = Math.min(maxWidth, Math.max(AI_PANEL_MIN_WIDTH, startWidth + delta));
      setAiPanelWidth(latestWidth);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('dashboard_ai_width', String(latestWidth));
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [aiPanelWidth]);

  return (
    <div className="Dashboard">
      <div className="Dashboard__Panel Dashboard__Panel--left">
        <div className="Dashboard__PanelHeader">
          <LayoutDashboard size={16} />
          <span className="Dashboard__PanelTitle">Dashboard</span>
        </div>
        <div className="Dashboard__PanelBody">
          <div className="Dashboard__WidgetGrid">
            <TaskSummary />
            <ActiveSprints />
            <StarredItems />
            <RecentItems />
          </div>
        </div>
      </div>
      <div className="Dashboard__ResizeHandle" onMouseDown={handleResizeStart} />
      <div className="Dashboard__Panel Dashboard__Panel--right" style={{ width: aiPanelWidth }}>
        <AIChat />
      </div>
    </div>
  );
}
