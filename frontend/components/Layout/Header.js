import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import { Search, Bell, CircleHelp, Settings, Shield, AtSign, UserPlus, AlertCircle, MessageSquare, CheckCircle2 } from 'lucide-react';
import { formatMessageTime } from '@/library/formatTime';
import { getBaseURL } from '@/library/_axios';

const NOTI_ICONS = {
  mention: AtSign,
  chat_mention: AtSign,
  task_assigned: UserPlus,
  issue_created: AlertCircle,
  issue_comment: MessageSquare,
  task_status_changed: CheckCircle2,
};

export default function Header({ onSearchClick, notifications = [], unreadCount = 0, chatUnreadCount = 0, onChatClick, onClearNotifications, onMarkAllRead, onReadNotification, onNotiClick }) {
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showNotiMenu, setShowNotiMenu] = useState(false);
  const settingsRef = useRef(null);
  const notiRef = useRef(null);

  useEffect(() => {
    try {
      const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
      setUsername(profile.username || '');
      setRole(profile.role || '');
      setAvatarUrl(sessionStorage.getItem('avatar_url') || '');
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

  // 프로필 변경 시 헤더 갱신
  useEffect(() => {
    const handleProfileUpdate = () => {
      try {
        const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
        setUsername(profile.username || '');
        setAvatarUrl(sessionStorage.getItem('avatar_url') || '');
      } catch {}
    };
    window.addEventListener('profile:updated', handleProfileUpdate);
    return () => window.removeEventListener('profile:updated', handleProfileUpdate);
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

  // 알림 클릭 시 읽음 처리 + 해당 페이지로 이동
  const handleNotiClick = (noti) => {
    if (!noti.is_read && onReadNotification) {
      onReadNotification(noti.notification_id);
    }
    if (onNotiClick) {
      onNotiClick(noti);
    }
    if (noti.link) {
      router.push(noti.link);
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
        <button
          className="Header__IconBtn"
          title="Messenger"
          onClick={onChatClick}
        >
          <MessageSquare size={18} />
          {chatUnreadCount > 0 && (
            <span className="Header__NotiBadge">
              {chatUnreadCount > 999 ? '999+' : chatUnreadCount}
            </span>
          )}
        </button>
        <div className="Header__NotiWrap" ref={notiRef}>
          <button
            className="Header__IconBtn"
            title="Notifications"
            onClick={() => setShowNotiMenu((prev) => !prev)}
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="Header__NotiBadge">
                {unreadCount > 999 ? '999+' : unreadCount}
              </span>
            )}
          </button>
          {showNotiMenu && (
            <div className="Header__NotiMenu">
              <div className="Header__NotiHeader">
                <span className="Header__NotiTitle">Notifications</span>
                <div className="Header__NotiActions">
                  {unreadCount > 0 && (
                    <button className="Header__NotiMarkAll" onClick={onMarkAllRead}>
                      Mark all read
                    </button>
                  )}
                  {notifications.length > 0 && (
                    <button className="Header__NotiClear" onClick={onClearNotifications}>
                      Clear all
                    </button>
                  )}
                </div>
              </div>
              <div className="Header__NotiList">
                {notifications.length === 0 ? (
                  <div className="Header__NotiEmpty">No notifications</div>
                ) : (
                  notifications.map((noti) => {
                    const Icon = NOTI_ICONS[noti.type] || Bell;
                    return (
                      <button
                        key={noti.notification_id}
                        className={`Header__NotiItem ${!noti.is_read ? 'Header__NotiItem--unread' : ''}`}
                        onClick={() => handleNotiClick(noti)}
                      >
                        <div className="Header__NotiIcon">
                          <Icon size={14} />
                        </div>
                        <div className="Header__NotiBody">
                          <div className="Header__NotiItemTop">
                            <span className="Header__NotiSender">{noti.actor_name || 'System'}</span>
                            <span className="Header__NotiTime">{formatMessageTime(noti.created_at)}</span>
                          </div>
                          <span className="Header__NotiContent">{noti.title}</span>
                        </div>
                      </button>
                    );
                  })
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
        <div className="Header__Avatar" title={username} onClick={() => router.push('/profile')}>
          {avatarUrl ? (
            <img src={`${getBaseURL()}${avatarUrl}`} alt={username} className="Header__AvatarImg" />
          ) : (
            initial
          )}
        </div>
      </div>
    </header>
  );
}
