import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import { Search, Bell, Settings, Shield, AtSign, UserPlus, AlertCircle, MessageSquare, CheckCircle2, Menu, User, LogOut } from 'lucide-react';
import { formatMessageTime } from '@/library/formatTime';
import AppSwitcher from './AppSwitcher';
import Avatar from '@/components/common/Avatar';

const NOTI_ICONS = {
  mention: AtSign,
  chat_mention: AtSign,
  task_assigned: UserPlus,
  issue_created: AlertCircle,
  issue_comment: MessageSquare,
  task_status_changed: CheckCircle2,
};

export default function Header({ isMobile, hasSidebar = false, onToggleSidebar, onSearchClick, notifications = [], unreadCount = 0, chatUnreadCount = 0, onChatClick, onClearNotifications, onMarkAllRead, onReadNotification, onNotiClick }) {
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [userId, setUserId] = useState(null);
  const [avatarColor, setAvatarColor] = useState(null);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showNotiMenu, setShowNotiMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const settingsRef = useRef(null);
  const notiRef = useRef(null);
  const userMenuRef = useRef(null);

  useEffect(() => {
    try {
      const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
      setUsername(profile.username || '');
      setRole(profile.role || '');
      setAvatarUrl(sessionStorage.getItem('avatar_url') || '');
      setUserId(profile.user_id ?? null);
      setAvatarColor(profile.avatar_color ?? null);
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
        setUserId(profile.user_id ?? null);
        setAvatarColor(profile.avatar_color ?? null);
      } catch {}
    };
    window.addEventListener('profile:updated', handleProfileUpdate);
    return () => window.removeEventListener('profile:updated', handleProfileUpdate);
  }, []);

  // 클릭 외부 감지로 드롭다운 닫기
  useEffect(() => {
    if (!showSettingsMenu && !showNotiMenu && !showUserMenu) return;
    const handleClickOutside = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setShowSettingsMenu(false);
      }
      if (notiRef.current && !notiRef.current.contains(e.target)) {
        setShowNotiMenu(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSettingsMenu, showNotiMenu, showUserMenu]);

  // 로그아웃: 서버 세션(쿠키+refresh 토큰) 폐기 후 JS 세션 상태 정리 → 로그인으로
  const handleLogout = async () => {
    setShowUserMenu(false);
    try {
      const { axios } = await import('@/library/_axios');
      await axios.post('/auth/logout');
    } catch {
      // 쿠키 폐기는 서버 책임이라 네트워크 실패해도 클라이언트는 계속 정리한다
    }
    sessionStorage.removeItem('profile');
    sessionStorage.removeItem('avatar_url');
    sessionStorage.removeItem('app_initialized');
    router.replace('/auth/login');
  };

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

  return (
    <header className={`Header ${isMobile ? 'Header--mobile' : ''}`}>
      <div className="Header__Left">
        {/* 모바일: 햄버거 메뉴 */}
        {isMobile && hasSidebar && (
          <button className="Header__IconBtn" onClick={onToggleSidebar} title="Menu">
            <Menu size={20} />
          </button>
        )}
        <div className="Header__Logo" onClick={() => router.push('/')} style={{ cursor: 'pointer' }}>
          <img src="/icons/weave_square.svg" alt="Weave" className="Header__LogoIcon" />
          {!isMobile && <span className="Header__LogoText">Weave</span>}
          {!isMobile && workspaceName && (
            <>
              <span className="Header__Separator">/</span>
              <span className="Header__WorkspaceName">{workspaceName}</span>
            </>
          )}
        </div>
        <span className="Header__Separator">/</span>
        <AppSwitcher />
      </div>

      <div className="Header__Center">
        <button className="Header__SearchBtn" onClick={onSearchClick}>
          <Search size={14} className="Header__SearchIcon" />
          {!isMobile && <span className="Header__SearchText">Search...</span>}
          {!isMobile && <kbd className="Header__SearchShortcut">Cmd+K</kbd>}
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
                        {noti.actor_id ? (
                          <div className="Header__NotiAvatar">
                            <Avatar
                              user={{
                                name: noti.actor_name,
                                id: noti.actor_id,
                                avatar_url: noti.actor_avatar_url,
                                avatar_color: noti.actor_avatar_color,
                              }}
                              size="sm"
                            />
                            <span className="Header__NotiTypeBadge">
                              <Icon size={10} />
                            </span>
                          </div>
                        ) : (
                          // 행위자 없는 시스템 알림은 타입 아이콘을 메인 그래픽으로
                          <div className="Header__NotiIcon">
                            <Icon size={14} />
                          </div>
                        )}
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
        <div className="Header__UserWrap" ref={userMenuRef}>
          <button
            type="button"
            className="Header__Avatar"
            onClick={() => setShowUserMenu((prev) => !prev)}
            title={username || '내 계정'}
          >
            <Avatar
              name={username}
              userId={userId}
              avatarUrl={avatarUrl}
              avatarColor={avatarColor}
              size={28}
            />
          </button>
          {showUserMenu && (
            <div className="Header__SettingsMenu">
              <button
                className="Header__SettingsItem"
                onClick={() => { setShowUserMenu(false); router.push('/profile'); }}
              >
                <User size={15} />
                <span>프로필 설정</span>
              </button>
              <button
                className="Header__SettingsItem Header__SettingsItem--danger"
                onClick={handleLogout}
              >
                <LogOut size={15} />
                <span>로그아웃</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
