import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import { getAppContext } from '@/library/appContext';
import { createPortal } from 'react-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import Footer from './Footer';
import Messenger from '@/components/Messenger/Messenger';
import CreateBranch from '@/components/modal/CreateBranch';
import CreateCanvas from '@/components/modal/CreateCanvas';
import CreateTrack from '@/components/modal/CreateTrack';
import CreateScrumBoard from '@/components/modal/CreateScrumBoard';
import CommandPalette from '@/components/modal/CommandPalette';
import { requestNotificationPermission, showNotification, playNotificationSound } from '@/library/notification';
import { subscribeToPush } from '@/library/pushSubscription';
import { getWsBaseURL, refreshAccessToken } from '@/library/_axios';
import { showToast } from './Toast';
import useMobile from '@/hooks/useMobile';
import usePictureInPicture from '@/hooks/usePictureInPicture';

const MESSENGER_MIN_WIDTH = 280;
const MESSENGER_DEFAULT_WIDTH = 320;
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_DEFAULT_WIDTH = 240;

export default function Layout({ children }) {
  const { isMobile } = useMobile();
  const router = useRouter();
  const inApp = !!getAppContext(router.pathname);
  const [showCreateBranch, setShowCreateBranch] = useState(false);
  const [showCreateCanvas, setShowCreateCanvas] = useState(false);
  const [showCreateTrack, setShowCreateTrack] = useState(false);
  const [showCreateScrum, setShowCreateScrum] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    try { return sessionStorage.getItem('sidebar_collapsed') === 'true'; }
    catch { return false; }
  });
  const [isMessengerCollapsed, setIsMessengerCollapsed] = useState(() => {
    try {
      return sessionStorage.getItem('messenger_open') !== 'true';
    } catch { return true; }
  });
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [messengerWidth, setMessengerWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('messenger_width');
      return saved ? Number(saved) : MESSENGER_DEFAULT_WIDTH;
    }
    return MESSENGER_DEFAULT_WIDTH;
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('sidebar_width');
      return saved ? Number(saved) : SIDEBAR_DEFAULT_WIDTH;
    }
    return SIDEBAR_DEFAULT_WIDTH;
  });
  const isResizingRef = useRef(false);
  const wsRef = useRef(null);
  const activeRoomRef = useRef(null);
  const { isSupported: isPipSupported, isPipActive, portalContainer: pipContainer, openPip, closePip } = usePictureInPicture();

  // 모바일 진입 시 사이드바/메신저 자동 닫기
  useEffect(() => {
    if (isMobile) {
      setIsSidebarCollapsed(true);
      setIsMessengerCollapsed(true);
    }
  }, [isMobile]);

  // 사이드바 접힘 상태 저장 (모바일에서는 저장하지 않음)
  useEffect(() => {
    if (isMobile) return;
    try { sessionStorage.setItem('sidebar_collapsed', isSidebarCollapsed ? 'true' : 'false'); }
    catch {}
  }, [isSidebarCollapsed, isMobile]);

  // 메신저 열림 상태 저장 (모바일에서는 저장하지 않음)
  useEffect(() => {
    if (isMobile) return;
    try {
      sessionStorage.setItem('messenger_open', isMessengerCollapsed ? 'false' : 'true');
    } catch {}
  }, [isMessengerCollapsed, isMobile]);

  // 사이드바 리사이즈 드래그 핸들러
  const handleSidebarResizeStart = useCallback((e) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    let latestWidth = startWidth;

    const handleMouseMove = (e) => {
      if (!isResizingRef.current) return;
      const maxWidth = Math.floor(window.innerWidth / 3);
      const delta = e.clientX - startX;
      latestWidth = Math.min(maxWidth, Math.max(SIDEBAR_MIN_WIDTH, startWidth + delta));
      setSidebarWidth(latestWidth);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('sidebar_width', String(latestWidth));
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [sidebarWidth]);

  // 메신저 패널 리사이즈 드래그 핸들러
  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startX = e.clientX;
    const startWidth = messengerWidth;

    let latestMsgWidth = startWidth;

    const handleMouseMove = (e) => {
      if (!isResizingRef.current) return;
      const maxWidth = Math.floor(window.innerWidth * 0.5);
      const delta = startX - e.clientX;
      latestMsgWidth = Math.min(maxWidth, Math.max(MESSENGER_MIN_WIDTH, startWidth + delta));
      setMessengerWidth(latestMsgWidth);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('messenger_width', String(latestMsgWidth));
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [messengerWidth]);

  // 글로벌 단축키
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowPalette((prev) => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'b') {
        e.preventDefault();
        if (inApp) setIsSidebarCollapsed((prev) => !prev);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        setIsMessengerCollapsed((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [inApp]);

  // CommandPalette에서 Branch 생성 요청 수신
  useEffect(() => {
    const handleCreate = () => setShowCreateBranch(true);
    window.addEventListener('palette:create-branch', handleCreate);
    return () => window.removeEventListener('palette:create-branch', handleCreate);
  }, []);

  // BranchHome에서 Branch 생성 요청 수신
  useEffect(() => {
    const handleCreate = () => setShowCreateBranch(true);
    window.addEventListener('layout:create-branch', handleCreate);
    return () => window.removeEventListener('layout:create-branch', handleCreate);
  }, []);

  // CanvasHome에서 Canvas 생성 요청 수신
  useEffect(() => {
    const handleCreate = () => setShowCreateCanvas(true);
    window.addEventListener('layout:create-canvas', handleCreate);
    return () => window.removeEventListener('layout:create-canvas', handleCreate);
  }, []);

  // QuickCreate에서 Track 생성 요청 수신
  useEffect(() => {
    const handleCreate = () => setShowCreateTrack(true);
    window.addEventListener('layout:create-track', handleCreate);
    return () => window.removeEventListener('layout:create-track', handleCreate);
  }, []);

  // ScrumHome에서 Scrum 보드 생성 요청 수신
  useEffect(() => {
    const handleCreate = () => setShowCreateScrum(true);
    window.addEventListener('layout:create-scrum', handleCreate);
    return () => window.removeEventListener('layout:create-scrum', handleCreate);
  }, []);

  // 앱 홈에서 커맨드 팔레트 열기 요청 수신 (⌘K 빠른 이동 버튼)
  useEffect(() => {
    const handleOpen = () => setShowPalette(true);
    window.addEventListener('layout:open-search', handleOpen);
    return () => window.removeEventListener('layout:open-search', handleOpen);
  }, []);

  // 영구 알림 + 채팅 unread 로드
  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const { axios } = await import('@/library/_axios');
        const [listRes, countRes, chatRes] = await Promise.all([
          axios.get('/notifications?limit=30'),
          axios.get('/notifications/unread-count'),
          axios.get('/chat'),
        ]);
        if (listRes.data.status) setNotifications(listRes.data.notifications);
        if (countRes.data.status) setUnreadCount(countRes.data.count);
        if (chatRes.data.status) {
          const total = (chatRes.data.rooms || []).reduce((sum, r) => sum + (r.unread_count || 0), 0);
          setChatUnreadCount(total);
        }
      } catch {}
    };
    fetchNotifications();

    // 채팅 unread count 갱신 이벤트
    const handleChatUnread = () => {
      import('@/library/_axios').then(({ axios }) => {
        axios.get('/chat').then((res) => {
          if (res.data.status) {
            const total = (res.data.rooms || []).reduce((sum, r) => sum + (r.unread_count || 0), 0);
            setChatUnreadCount(total);
          }
        }).catch(() => {});
      });
    };
    window.addEventListener('chat:unread_changed', handleChatUnread);
    return () => window.removeEventListener('chat:unread_changed', handleChatUnread);
  }, []);

  // WebSocket 연결 관리
  useEffect(() => {
    let profile = {};
    try {
      profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
    } catch {}
    if (!profile.user_id) return;

    requestNotificationPermission().then(() => subscribeToPush());

    // WebSocket URL: axios base URL 기반으로 생성
    const wsUrl = `${getWsBaseURL()}/api/ws/chat`;

    let reconnectTimer = null;
    let reconnectAttempts = 0;
    let alive = true;

    const connect = () => {
      if (!alive) return;

      // 기존 연결 정리 (재연결 루프 방지)
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }

      const ws = new WebSocket(wsUrl);

      ws.onopen = () => { reconnectAttempts = 0; };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // 컴포넌트에 전달용 커스텀 이벤트
          window.dispatchEvent(new CustomEvent('chat:ws_message', { detail: data }));

          if (data.type === 'presence') {
            window.dispatchEvent(new CustomEvent('chat:presence', { detail: data }));
          }

          if (data.type === 'notification') {
            // 영구 알림 실시간 수신
            setNotifications((prev) => {
              if (prev.some((n) => n.notification_id === data.notification.notification_id)) return prev;
              return [data.notification, ...prev].slice(0, 50);
            });
            setUnreadCount(data.unread_count);
            showNotification('Weave', data.notification.title);
            showToast(data.notification.title, 'info');
            playNotificationSound();
          }

          if (data.type === 'new_message') {
            // 채팅 목록 갱신용
            window.dispatchEvent(new CustomEvent('chat:new_message', { detail: data }));

            // 내가 보낸 메시지가 아닐 때
            if (data.message.sender_id !== profile.user_id) {
              // 현재 해당 채팅방에 들어와있으면 알림 생략
              const isViewingRoom = activeRoomRef.current === data.room_id;

              if (!isViewingRoom) {
                setChatUnreadCount((prev) => prev + 1);
                // Chrome 알림
                const notiContent = data.message.content
                  || (data.message.task_ref ? 'Shared a task' : null)
                  || (data.message.doc_ref ? 'Shared a document' : null)
                  || (data.message.issue_ref ? 'Shared an issue' : null)
                  || '';
                showNotification(
                  data.message.sender_name || 'New Message',
                  notiContent,
                  data.message
                );
                showToast(`${data.message.sender_name || 'Someone'}: ${notiContent}`, 'info');
                playNotificationSound();
              }
            }
          }
        } catch {}
      };

      ws.onclose = () => {
        if (!alive) return;
        reconnectAttempts += 1;
        // 연속 실패(2회+)는 단기 access 토큰 만료(SEC-29)일 가능성이 크므로 재연결 전에
        // 토큰을 선제 갱신한다(쿨다운 공유). 일시적 끊김은 첫 재시도로 곧 복구된다.
        if (reconnectAttempts >= 2) {
          refreshAccessToken()
            .catch(() => {})
            .finally(() => { if (alive) reconnectTimer = setTimeout(connect, 3000); });
        } else {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };

      wsRef.current = ws;
    };

    connect();

    return () => {
      alive = false;
      clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, []);

  // 모바일에서 사이드바/메신저 열릴 때 backdrop 클릭으로 닫기
  const handleBackdropClick = useCallback(() => {
    setIsSidebarCollapsed(true);
  }, []);
  const handleMessengerBackdropClick = useCallback(() => {
    setIsMessengerCollapsed(true);
  }, []);

  return (
    <div className={`Layout ${isMobile ? 'Layout--mobile' : ''}`}>
      <Header
        isMobile={isMobile}
        hasSidebar={inApp}
        onToggleSidebar={() => setIsSidebarCollapsed((prev) => !prev)}
        onSearchClick={() => setShowPalette(true)}
        notifications={notifications}
        unreadCount={unreadCount}
        chatUnreadCount={chatUnreadCount}
        onChatClick={() => setIsMessengerCollapsed((prev) => !prev)}
        onClearNotifications={async () => {
          try {
            const { axios } = await import('@/library/_axios');
            await axios.delete('/notifications');
            setNotifications([]);
            setUnreadCount(0);
          } catch {}
        }}
        onMarkAllRead={async () => {
          try {
            const { axios } = await import('@/library/_axios');
            await axios.patch('/notifications/read-all');
            setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
            setUnreadCount(0);
          } catch {}
        }}
        onReadNotification={async (notificationId) => {
          try {
            const { axios } = await import('@/library/_axios');
            await axios.patch(`/notifications/${notificationId}/read`);
            setNotifications((prev) =>
              prev.map((n) => n.notification_id === notificationId ? { ...n, is_read: true } : n)
            );
            setUnreadCount((prev) => Math.max(0, prev - 1));
          } catch {}
        }}
        onNotiClick={(noti) => {
          if (noti.link) {
            // link가 있으면 해당 페이지로 이동 (router.push는 Header에서 처리)
          } else if (noti.entity_type === 'chat_room') {
            setIsMessengerCollapsed(false);
            window.dispatchEvent(new CustomEvent('chat:open_room', { detail: noti.entity_id }));
          }
        }}
      />
      <div className="Layout__Body">
        {/* 모바일: 사이드바 backdrop */}
        {isMobile && inApp && !isSidebarCollapsed && (
          <div className="Layout__Backdrop" onClick={handleBackdropClick} />
        )}
        {inApp && !isSidebarCollapsed && (
          <Sidebar
            isMobile={isMobile}
            width={isMobile ? undefined : sidebarWidth}
            onResizeStart={isMobile ? undefined : handleSidebarResizeStart}
            onCreateBranch={() => setShowCreateBranch(true)}
            onCreateCanvas={() => setShowCreateCanvas(true)}
            onCreateTrack={() => setShowCreateTrack(true)}
            onCreateScrum={() => setShowCreateScrum(true)}
            onClose={() => setIsSidebarCollapsed(true)}
          />
        )}
        <main className="Layout__Content">
          {children}
        </main>
        {/* 모바일: 메신저 backdrop */}
        {isMobile && !isMessengerCollapsed && (
          <div className="Layout__Backdrop" onClick={handleMessengerBackdropClick} />
        )}
        {!isMessengerCollapsed && !isPipActive && (
          <>
            {!isMobile && (
              <div
                className="Layout__ResizeHandle"
                onMouseDown={handleResizeStart}
              />
            )}
            <Messenger
              wsRef={wsRef}
              activeRoomRef={activeRoomRef}
              panelWidth={isMobile ? undefined : messengerWidth}
              isMobile={isMobile}
              onPopOut={isPipSupported && !isMobile ? openPip : undefined}
            />
          </>
        )}
        {/* PiP: createPortal로 별도 윈도우에 렌더링 */}
        {isPipActive && pipContainer && createPortal(
          <Messenger
            wsRef={wsRef}
            activeRoomRef={activeRoomRef}
            isMobile={false}
            isPip
          />,
          pipContainer
        )}
      </div>
      <Footer
        isMobile={isMobile}
        hasSidebar={inApp}
        isSidebarCollapsed={isSidebarCollapsed}
        isMessengerCollapsed={isMessengerCollapsed}
        onToggleSidebar={() => setIsSidebarCollapsed((prev) => !prev)}
        onToggleMessenger={() => setIsMessengerCollapsed((prev) => !prev)}
      />

      {showCreateBranch && (
        <CreateBranch onClose={() => setShowCreateBranch(false)} />
      )}
      {showCreateTrack && (
        <CreateTrack
          onClose={() => setShowCreateTrack(false)}
          onCreated={() => setShowCreateTrack(false)}
        />
      )}
      {showCreateCanvas && (
        <CreateCanvas onClose={() => setShowCreateCanvas(false)} />
      )}
      {showCreateScrum && (
        <CreateScrumBoard
          onClose={() => setShowCreateScrum(false)}
          onCreated={() => setShowCreateScrum(false)}
        />
      )}
      {showPalette && (
        <CommandPalette onClose={() => setShowPalette(false)} />
      )}
    </div>
  );
}
