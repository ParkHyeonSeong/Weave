import { useCallback } from 'react';
import { useRouter } from 'next/router';
import { X } from 'lucide-react';
import { getAppContext } from '@/library/appContext';
import { useUiPrefs } from '@/library/UiPrefsContext';
import SidebarBranches from './SidebarBranches';
import SidebarCanvases from './SidebarCanvases';
import SidebarTracks from './SidebarTracks';
import SidebarScrums from './SidebarScrums';

export default function Sidebar({ isMobile, width, onResizeStart, onCreateBranch, onCreateCanvas, onCreateTrack, onCreateScrum, onClose }) {
  const router = useRouter();
  const activeApp = getAppContext(router.pathname);
  const { prefs, setNamespace, hide, unhide } = useUiPrefs();
  const sidebarOrder = prefs.sidebar_order;
  const hidden = prefs.hidden || {};

  // 순서 변경 핸들러 (네임스페이스 통째 교체 → 낙관적 업데이트 + 서버 저장)
  const handleOrderChange = useCallback((key, ids) => {
    setNamespace('sidebar_order', { ...(prefs.sidebar_order || {}), [key]: ids });
  }, [prefs.sidebar_order, setNamespace]);

  return (
    <aside
      className={`Sidebar ${isMobile ? 'Sidebar--mobile' : ''}`}
      style={isMobile ? undefined : { width }}
    >
      <div className="Sidebar__Inner">
        {/* 모바일: 닫기 버튼 */}
        {isMobile && (
          <div className="Sidebar__MobileHeader">
            <span className="Sidebar__MobileTitle">Menu</span>
            <button className="Sidebar__CloseBtn" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        )}

        {/* 현재 앱의 콘텐츠 섹션만 렌더 (Layout이 앱 컨텍스트에서만 Sidebar를 렌더함) */}
        {activeApp === 'branch' && (
          <SidebarBranches
            onCreateBranch={onCreateBranch}
            savedOrder={sidebarOrder?.branches}
            onOrderChange={(ids) => handleOrderChange('branches', ids)}
            hidden={hidden.branches}
            onHide={(id) => hide('branches', id)}
            onUnhide={(id) => unhide('branches', id)}
          />
        )}
        {activeApp === 'canvas' && (
          <SidebarCanvases
            onCreateCanvas={onCreateCanvas}
            savedOrder={sidebarOrder?.canvases}
            onOrderChange={(ids) => handleOrderChange('canvases', ids)}
            hidden={hidden.canvases}
            onHide={(id) => hide('canvases', id)}
            onUnhide={(id) => unhide('canvases', id)}
          />
        )}
        {activeApp === 'track' && (
          <SidebarTracks
            onCreateTrack={onCreateTrack}
            savedOrder={sidebarOrder?.tracks}
            onOrderChange={(ids) => handleOrderChange('tracks', ids)}
            hidden={hidden.tracks}
            onHide={(id) => hide('tracks', id)}
            onUnhide={(id) => unhide('tracks', id)}
          />
        )}
        {activeApp === 'scrum' && (
          <SidebarScrums
            onCreateScrum={onCreateScrum}
            savedOrder={sidebarOrder?.scrums}
            onOrderChange={(ids) => handleOrderChange('scrums', ids)}
            hidden={hidden.scrums}
            onHide={(id) => hide('scrums', id)}
            onUnhide={(id) => unhide('scrums', id)}
          />
        )}
      </div>

      {/* 리사이즈 핸들 (모바일에서 숨김) */}
      {!isMobile && (
        <div
          className="Sidebar__ResizeHandle"
          onMouseDown={onResizeStart}
        />
      )}
    </aside>
  );
}
