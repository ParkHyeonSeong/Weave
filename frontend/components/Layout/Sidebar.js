import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { LayoutDashboard, CheckSquare, Compass, GitBranch, FileEdit } from 'lucide-react';
import { axios } from '@/library/_axios';
import SidebarBranches from './SidebarBranches';
import SidebarCanvases from './SidebarCanvases';

function getAppContext(pathname) {
  if (pathname.startsWith('/canvas')) return 'canvas';
  if (pathname.startsWith('/branch')) return 'branch';
  return null;
}

export default function Sidebar({ width, onResizeStart, onCreateBranch, onCreateCanvas }) {
  const router = useRouter();
  const urlContext = getAppContext(router.pathname);
  const [activeApp, setActiveApp] = useState(urlContext);
  const [sidebarOrder, setSidebarOrder] = useState(null);

  // URL 변경 시 앱 컨텍스트 동기화
  useEffect(() => {
    if (urlContext) setActiveApp(urlContext);
  }, [urlContext]);

  // 사이드바 순서 로드
  useEffect(() => {
    axios.get('/profile/sidebar-order')
      .then((res) => { if (res.data.status) setSidebarOrder(res.data.sidebar_order); })
      .catch(() => {});
  }, []);

  // 순서 변경 핸들러 (낙관적 업데이트 + 서버 저장)
  const handleOrderChange = useCallback((key, ids) => {
    setSidebarOrder((prev) => {
      const next = { ...prev, [key]: ids };
      axios.patch('/profile/sidebar-order', { [key]: ids }).catch(() => {});
      return next;
    });
  }, []);

  const APP_HOME = { branch: '/branch', canvas: '/canvas' };

  const handleAppClick = (app) => {
    if (activeApp === app) return;
    setActiveApp(app);
    router.push(APP_HOME[app]);
  };

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
          <button
            className={`Sidebar__MenuItem ${activeApp === 'branch' ? 'Sidebar__MenuItem--active' : ''}`}
            onClick={() => handleAppClick('branch')}
          >
            <GitBranch size={16} className="Sidebar__MenuIcon" />
            Branch
          </button>
          <button
            className={`Sidebar__MenuItem ${activeApp === 'canvas' ? 'Sidebar__MenuItem--active' : ''}`}
            onClick={() => handleAppClick('canvas')}
          >
            <FileEdit size={16} className="Sidebar__MenuIcon" />
            Canvas
          </button>
        </nav>

        {/* 앱 컨텍스트별 하단 섹션 */}
        {activeApp && (
          <>
            <div className="Sidebar__Divider" />
            {activeApp === 'branch' && (
              <SidebarBranches
                onCreateBranch={onCreateBranch}
                savedOrder={sidebarOrder?.branches}
                onOrderChange={(ids) => handleOrderChange('branches', ids)}
              />
            )}
            {activeApp === 'canvas' && (
              <SidebarCanvases
                onCreateCanvas={onCreateCanvas}
                savedOrder={sidebarOrder?.canvases}
                onOrderChange={(ids) => handleOrderChange('canvases', ids)}
              />
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
