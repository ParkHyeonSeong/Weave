import { useState, useEffect, useRef } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import Footer from './Footer';
import Messenger from '@/components/Messenger/Messenger';
import CreateBranch from '@/components/modal/CreateBranch';
import CommandPalette from '@/components/modal/CommandPalette';
import { requestNotificationPermission, showNotification } from '@/library/notification';

export default function Layout({ children }) {
  const [showCreateBranch, setShowCreateBranch] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMessengerCollapsed, setIsMessengerCollapsed] = useState(true);
  const wsRef = useRef(null);

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

    const connect = () => {
      const ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // 컴포넌트에 전달용 커스텀 이벤트
          window.dispatchEvent(new CustomEvent('chat:ws_message', { detail: data }));

          if (data.type === 'new_message') {
            // 채팅 목록 갱신용
            window.dispatchEvent(new CustomEvent('chat:new_message', { detail: data }));

            // Chrome 알림 (내가 보낸 메시지가 아닐 때)
            if (data.message.sender_id !== profile.user_id) {
              showNotification(
                data.message.sender_name || 'New Message',
                data.message.content
              );
            }
          }
        } catch {}
      };

      ws.onclose = () => {
        // 3초 후 재연결 시도
        reconnectTimer = setTimeout(connect, 3000);
      };

      wsRef.current = ws;
    };

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return (
    <div className="Layout">
      <Header onSearchClick={() => setShowPalette(true)} />
      <div className="Layout__Body">
        {!isSidebarCollapsed && (
          <Sidebar onCreateBranch={() => setShowCreateBranch(true)} />
        )}
        <main className="Layout__Content">
          {children}
        </main>
        {!isMessengerCollapsed && (
          <Messenger wsRef={wsRef} />
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
