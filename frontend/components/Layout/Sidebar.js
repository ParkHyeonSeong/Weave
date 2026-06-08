import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { X } from 'lucide-react';
import { axios } from '@/library/_axios';
import { getAppContext } from '@/library/appContext';
import SidebarBranches from './SidebarBranches';
import SidebarCanvases from './SidebarCanvases';
import SidebarTracks from './SidebarTracks';
import SidebarScrums from './SidebarScrums';

export default function Sidebar({ isMobile, width, onResizeStart, onCreateBranch, onCreateCanvas, onCreateTrack, onCreateScrum, onClose }) {
  const router = useRouter();
  const activeApp = getAppContext(router.pathname);
  const [sidebarOrder, setSidebarOrder] = useState(null);

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
          />
        )}
        {activeApp === 'canvas' && (
          <SidebarCanvases
            onCreateCanvas={onCreateCanvas}
            savedOrder={sidebarOrder?.canvases}
            onOrderChange={(ids) => handleOrderChange('canvases', ids)}
          />
        )}
        {activeApp === 'track' && (
          <SidebarTracks
            onCreateTrack={onCreateTrack}
            savedOrder={sidebarOrder?.tracks}
            onOrderChange={(ids) => handleOrderChange('tracks', ids)}
          />
        )}
        {activeApp === 'scrum' && (
          <SidebarScrums
            onCreateScrum={onCreateScrum}
            savedOrder={sidebarOrder?.scrums}
            onOrderChange={(ids) => handleOrderChange('scrums', ids)}
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
