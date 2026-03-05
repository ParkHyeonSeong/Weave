import { useState, useEffect, useRef, useCallback } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import Footer from './Footer';
import Messenger from '@/components/Messenger/Messenger';
import CreateBranch from '@/components/modal/CreateBranch';
import CommandPalette from '@/components/modal/CommandPalette';
import { requestNotificationPermission, showNotification } from '@/library/notification';

const MESSENGER_MIN_WIDTH = 280;
const MESSENGER_DEFAULT_WIDTH = 320;

export default function Layout({ children }) {
  const [showCreateBranch, setShowCreateBranch] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMessengerCollapsed, setIsMessengerCollapsed] = useState(true);
  const [notifications, setNotifications] = useState([]);
  const [messengerWidth, setMessengerWidth] = useState(MESSENGER_DEFAULT_WIDTH);
  const isResizingRef = useRef(false);
  const wsRef = useRef(null);
  const activeRoomRef = useRef(null);

  // 메신저 패널 리사이즈 드래그 핸들러
  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startX = e.clientX;
    const startWidth = messengerWidth;

    const handleMouseMove = (e) => {
      if (!isResizingRef.current) return;
      const maxWidth = Math.floor(window.innerWidth * 0.5);
      const delta = startX - e.clientX;
      const newWidth = Math.min(maxWidth, Math.max(MESSENGER_MIN_WIDTH, startWidth + delta));
      setMessengerWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [messengerWidth]);

  // 글로벌 Cmd+K 단축키
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowPalette((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // CommandPalette에서 Branch 생성 요청 수신
  useEffect(() => {
    const handleCreate = () => setShowCreateBranch(true);
    window.addEventListener('palette:create-branch', handleCreate);
    return () => window.removeEventListener('palette:create-branch', handleCreate);
  }, []);

  // WebSocket 연결 관리
  useEffect(() => {
    const token = sessionStorage.getItem('x_token');
    if (!token) return;

    requestNotificationPermission();

    let profile = {};
    try {
      profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
    } catch {}

    // API URL에서 포트만 추출, 브라우저 hostname 사용 (LAN IP 대응)
    let backendPort = '10001';
    try {
      const parsed = new URL(process.env.NEXT_PUBLIC_API_URL || '');
      backendPort = parsed.port || '10001';
    } catch {}
    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const wsUrl = `${wsProtocol}://${window.location.hostname}:${backendPort}/ws/chat?token=${token}`;

    let reconnectTimer = null;
    let alive = true;

    const connect = () => {
      if (!alive) return;

      // 기존 연결 정리 (재연결 루프 방지)
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }

      const ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // 컴포넌트에 전달용 커스텀 이벤트
          window.dispatchEvent(new CustomEvent('chat:ws_message', { detail: data }));

          if (data.type === 'new_message') {
            // 채팅 목록 갱신용
            window.dispatchEvent(new CustomEvent('chat:new_message', { detail: data }));

            // 내가 보낸 메시지가 아닐 때
            if (data.message.sender_id !== profile.user_id) {
              // 현재 해당 채팅방에 들어와있으면 알림 생략
              const isViewingRoom = activeRoomRef.current === data.room_id;

              if (!isViewingRoom) {
                // Chrome 알림
                showNotification(
                  data.message.sender_name || 'New Message',
                  data.message.content
                );

                // 헤더 알림 누적
                setNotifications((prev) => {
                  if (prev.some((n) => n.id === data.message.message_id)) return prev;
                  return [{
                    id: data.message.message_id,
                    roomId: data.room_id,
                    senderName: data.message.sender_name,
                    content: data.message.content,
                    createdAt: data.message.created_at,
                    read: false,
                  }, ...prev].slice(0, 50);
                });
              }
            }
          }
        } catch {}
      };

      ws.onclose = () => {
        if (alive) {
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

  return (
    <div className="Layout">
      <Header
        onSearchClick={() => setShowPalette(true)}
        notifications={notifications}
        onClearNotifications={() => setNotifications([])}
        onReadNotification={(id) => setNotifications((prev) =>
          prev.map((n) => n.id === id ? { ...n, read: true } : n)
        )}
        onNotiClick={(roomId) => {
          // 메신저 열기 + 해당 채팅방으로 이동
          setIsMessengerCollapsed(false);
          window.dispatchEvent(new CustomEvent('chat:open_room', { detail: roomId }));
        }}
      />
      <div className="Layout__Body">
        {!isSidebarCollapsed && (
          <Sidebar onCreateBranch={() => setShowCreateBranch(true)} />
        )}
        <main className="Layout__Content">
          {children}
        </main>
        {!isMessengerCollapsed && (
          <>
            <div
              className="Layout__ResizeHandle"
              onMouseDown={handleResizeStart}
            />
            <Messenger
              wsRef={wsRef}
              activeRoomRef={activeRoomRef}
              panelWidth={messengerWidth}
            />
          </>
        )}
      </div>
      <Footer
        isSidebarCollapsed={isSidebarCollapsed}
        isMessengerCollapsed={isMessengerCollapsed}
        onToggleSidebar={() => setIsSidebarCollapsed((prev) => !prev)}
        onToggleMessenger={() => setIsMessengerCollapsed((prev) => !prev)}
      />

      {showCreateBranch && (
        <CreateBranch onClose={() => setShowCreateBranch(false)} />
      )}
      {showPalette && (
        <CommandPalette onClose={() => setShowPalette(false)} />
      )}
    </div>
  );
}
