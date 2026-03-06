import { useRouter } from 'next/router';
import { LayoutDashboard, CheckSquare, Compass } from 'lucide-react';
import SidebarBranches from './SidebarBranches';
import SidebarCanvases from './SidebarCanvases';

function getAppContext(pathname) {
  if (pathname.startsWith('/canvas')) return 'canvas';
  if (pathname.startsWith('/branch')) return 'branch';
  return 'home';
}

export default function Sidebar({ width, onResizeStart, onCreateBranch, onCreateCanvas }) {
  const router = useRouter();
  const appContext = getAppContext(router.pathname);

  return (
    <aside className="Sidebar" style={{ width }}>
      <div className="Sidebar__Inner">
        {/* 기본 메뉴 (항상 표시) */}
        <nav className="Sidebar__Menu">
          <button
            className={`Sidebar__MenuItem ${router.pathname === '/' ? 'Sidebar__MenuItem--active' : ''}`}
            onClick={() => router.push('/')}
          >
            <LayoutDashboard size={16} className="Sidebar__MenuIcon" />
            Home
          </button>
          <button
            className={`Sidebar__MenuItem ${router.pathname === '/my-tasks' ? 'Sidebar__MenuItem--active' : ''}`}
            onClick={() => router.push('/my-tasks')}
          >
            <CheckSquare size={16} className="Sidebar__MenuIcon" />
            My Tasks
          </button>
          <button
            className={`Sidebar__MenuItem ${router.pathname === '/browse' ? 'Sidebar__MenuItem--active' : ''}`}
            onClick={() => router.push('/browse')}
          >
            <Compass size={16} className="Sidebar__MenuIcon" />
            Browse
          </button>
        </nav>

        {/* 컨텍스트별 하단 섹션 */}
        {appContext !== 'home' && (
          <>
            <div className="Sidebar__Divider" />
            {appContext === 'branch' && (
              <SidebarBranches onCreateBranch={onCreateBranch} />
            )}
            {appContext === 'canvas' && (
              <SidebarCanvases onCreateCanvas={onCreateCanvas} />
            )}
          </>
        )}
      </div>

      {/* 리사이즈 핸들 */}
      <div
        className="Sidebar__ResizeHandle"
        onMouseDown={onResizeStart}
      />
    </aside>
  );
}
