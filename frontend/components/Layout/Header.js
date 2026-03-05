import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import { Search, Bell, CircleHelp, Settings, Shield } from 'lucide-react';
import { formatMessageTime } from '@/library/formatTime';

export default function Header({ onSearchClick, notifications = [], onClearNotifications, onReadNotification, onNotiClick }) {
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('');
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showNotiMenu, setShowNotiMenu] = useState(false);
  const settingsRef = useRef(null);
  const notiRef = useRef(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    try {
      const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
      setUsername(profile.username || '');
      setRole(profile.role || '');
    } catch {}

    const fetchWorkspace = async () => {
      try {
        const { axios } = await import('@/library/_axios');
        const res = await axios.get('/setup/status');
        if (res.data.initialized) {
          setWorkspaceName(res.data.workspace_name || '');
        }
      } catch {}
    };
    fetchWorkspace();
  }, []);

  // 클릭 외부 감지로 드롭다운 닫기
  useEffect(() => {
    if (!showSettingsMenu && !showNotiMenu) return;
    const handleClickOutside = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setShowSettingsMenu(false);
      }
      if (notiRef.current && !notiRef.current.contains(e.target)) {
        setShowNotiMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSettingsMenu, showNotiMenu]);

  // 알림 클릭 시 읽음 처리 + 해당 채팅방으로 이동
  const handleNotiClick = (noti) => {
    if (!noti.read && onReadNotification) {
      onReadNotification(noti.id);
    }
    if (onNotiClick) {
      onNotiClick(noti.roomId);
    }
    setShowNotiMenu(false);
  };

  const initial = username ? username.charAt(0).toUpperCase() : '?';

  return (
    <header className="Header">
      <div className="Header__Left" onClick={() => router.push('/')} style={{ cursor: 'pointer' }}>
        <img src="/icons/weave_square.svg" alt="Weave" className="Header__LogoIcon" />
        <span className="Header__LogoText">Weave</span>
        {workspaceName && (
          <>
            <span className="Header__Separator">/</span>
            <span className="Header__WorkspaceName">{workspaceName}</span>
          </>
        )}
      </div>

      <div className="Header__Center">
        <button className="Header__SearchBtn" onClick={onSearchClick}>
          <Search size={14} className="Header__SearchIcon" />
          <span className="Header__SearchText">Search...</span>
          <kbd className="Header__SearchShortcut">Cmd+K</kbd>
        </button>
      </div>

      <div className="Header__Right">
        <div className="Header__NotiWrap" ref={notiRef}>
          <button
            className="Header__IconBtn"
            title="Notifications"
            onClick={() => setShowNotiMenu((prev) => !prev)}
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="Header__NotiBadge">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          {showNotiMenu && (
            <div className="Header__NotiMenu">
              <div className="Header__NotiHeader">
                <span className="Header__NotiTitle">Notifications</span>
                {notifications.length > 0 && (
                  <button className="Header__NotiClear" onClick={onClearNotifications}>
                    Clear all
                  </button>
                )}
              </div>
              <div className="Header__NotiList">
                {notifications.length === 0 ? (
                  <div className="Header__NotiEmpty">No notifications</div>
                ) : (
                  notifications.map((noti) => (
                    <button
                      key={noti.id}
                      className={`Header__NotiItem ${!noti.read ? 'Header__NotiItem--unread' : ''}`}
                      onClick={() => handleNotiClick(noti)}
                    >
                      <div className="Header__NotiItemTop">
                        <span className="Header__NotiSender">{noti.senderName}</span>
                        <span className="Header__NotiTime">{formatMessageTime(noti.createdAt)}</span>
                      </div>
                      <span className="Header__NotiContent">{noti.content}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
        <button className="Header__IconBtn" title="Help">
          <CircleHelp size={18} />
        </button>
        <div className="Header__SettingsWrap" ref={settingsRef}>
          <button
            className="Header__IconBtn"
            title="Settings"
            onClick={() => { if (role === 'admin') setShowSettingsMenu((prev) => !prev); }}
          >
            <Settings size={18} />
          </button>
          {showSettingsMenu && (
            <div className="Header__SettingsMenu">
              <button
                className="Header__SettingsItem"
                onClick={() => { setShowSettingsMenu(false); router.push('/admin'); }}
              >
                <Shield size={15} />
                <span>Admin Settings</span>
              </button>
            </div>
          )}
        </div>
        <div className="Header__Avatar" title={username}>
          {initial}
        </div>
      </div>
    </header>
  );
}
