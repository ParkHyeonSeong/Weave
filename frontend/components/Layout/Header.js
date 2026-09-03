import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import { Search, Bell, Settings, Shield, AtSign, UserPlus, AlertCircle, MessageSquare, CheckCircle2, CircleDot, Menu, User, LogOut, Reply } from 'lucide-react';
import { formatMessageTime } from '@/library/formatTime';
import { LOGIN_PATH } from '@/library/authRedirect';
import AppSwitcher from './AppSwitcher';
import Avatar from '@/components/common/Avatar';
import NavLink from '@/components/common/NavLink';
import ThemeToggleButton from '@/components/Layout/ThemeToggleButton';

const NOTI_ICONS = {
  mention: AtSign,
  chat_mention: AtSign,
  comment_reply: Reply,
  task_assigned: UserPlus,
  issue_created: AlertCircle,
  issue_comment: MessageSquare,
  issue_closed: CheckCircle2,
  issue_reopened: CircleDot,
  task_status_changed: CheckCircle2,
};

// 알림 타입 → 색 그룹(스캔용) + 짧은 한글 라벨. 그룹 색은 SCSS의
// .Header__NotiChip--{group}가 입힌다(멘션=primary·태스크=success·이슈=warning).
// 매핑에 없는 타입은 칩을 그리지 않는다.
const NOTI_TYPE_META = {
  mention:             { group: 'mention', label: '멘션' },
  chat_mention:        { group: 'mention', label: '멘션' },
  comment_reply:       { group: 'task',    label: '답글' },
  task_assigned:       { group: 'task',    label: '배정' },
  task_status_changed: { group: 'task',    label: '상태' },
  issue_created:       { group: 'issue',   label: '이슈' },
  issue_comment:       { group: 'issue',   label: '댓글' },
  issue_closed:        { group: 'issue',   label: '닫힘' },
  issue_reopened:      { group: 'issue',   label: '재개' },
};

// 알림 title은 항상 "{actor_name}님이 …" 템플릿으로 생성되는데, 같은 이름이
// 바로 윗줄(NotiSender)에 이미 보인다. 본문에서 그 접두를 떼어 좁은 너비를
// 발신자 반복 대신 핵심(엔티티)에 쓰게 한다. 시스템 알림(actor 없음)이거나
// 발신자 개명 등으로 접두가 안 맞으면 원문을 그대로 둔다(graceful).
function stripActorPrefix(title, actorName) {
  if (actorName && title?.startsWith(`${actorName}님이`)) {
    return title.slice(`${actorName}님이`.length).replace(/^\s+/, '');
  }
  return title || '';
}

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
  const [notiFilterUnread, setNotiFilterUnread] = useState(false);
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
    // returnTo 미전달: 로그아웃 후 다시 보호 페이지로 복귀시키지 않는다
    router.replace(LOGIN_PATH);
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

  // 안읽음 필터: 토글 라벨 수는 "지금 로드된 목록"의 미읽음 기준(전역 unreadCount는
  // 30개 한도를 넘는 경우 필터 결과와 어긋날 수 있어, 실제 보일 것과 일치시킨다).
  const unreadNotis = notifications.filter((n) => !n.is_read);
  const notiUnreadInList = unreadNotis.length;
  const visibleNotis = notiFilterUnread ? unreadNotis : notifications;

  // 알림 행 내부(아바타/아이콘 + 본문)는 link 유무와 무관하게 동일 → 한 곳에서 그린다.
  const renderNotiInner = (noti) => {
    const Icon = NOTI_ICONS[noti.type] || Bell;
    const typeMeta = NOTI_TYPE_META[noti.type];
    return (
      <>
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
            <span className="Header__NotiSenderWrap">
              <span className="Header__NotiSender">{noti.actor_name || 'System'}</span>
              {typeMeta && (
                <span className={`Header__NotiChip Header__NotiChip--${typeMeta.group}`}>
                  {typeMeta.label}
                </span>
              )}
            </span>
            <span className="Header__NotiTime">{formatMessageTime(noti.created_at)}</span>
          </div>
          <span className="Header__NotiContent">{stripActorPrefix(noti.title, noti.actor_name)}</span>
        </div>
      </>
    );
  };

  // link가 있으면 네비게이션(NavLink), 없으면 사이드이펙트 전용 버튼. 내부는 공통.
  const renderNotiItem = (noti) => {
    const itemClass = `Header__NotiItem ${!noti.is_read ? 'Header__NotiItem--unread' : ''}`;
    if (noti.link) {
      return (
        <NavLink
          key={noti.notification_id}
          href={noti.link}
          className={itemClass}
          onClick={() => {
            if (!noti.is_read && onReadNotification) {
              onReadNotification(noti.notification_id);
            }
            if (onNotiClick) {
              onNotiClick(noti);
            }
            setShowNotiMenu(false);
          }}
        >
          {renderNotiInner(noti)}
        </NavLink>
      );
    }
    return (
      <button
        key={noti.notification_id}
        className={itemClass}
        onClick={() => handleNotiClick(noti)}
      >
        {renderNotiInner(noti)}
      </button>
    );
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
        <NavLink href="/" className="Header__Logo">
          <img src="/icons/weave_square.svg" alt="Weave" className="Header__LogoIcon" />
          {!isMobile && <span className="Header__LogoText">Weave</span>}
          {!isMobile && workspaceName && (
            <>
              <span className="Header__Separator">/</span>
              <span className="Header__WorkspaceName">{workspaceName}</span>
            </>
          )}
        </NavLink>
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
        <ThemeToggleButton />
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
              {notifications.length > 0 && (
                <div className="Header__NotiFilter">
                  <button
                    className={`Header__NotiFilterBtn ${!notiFilterUnread ? 'Header__NotiFilterBtn--active' : ''}`}
                    onClick={() => setNotiFilterUnread(false)}
                  >
                    All
                  </button>
                  <button
                    className={`Header__NotiFilterBtn ${notiFilterUnread ? 'Header__NotiFilterBtn--active' : ''}`}
                    onClick={() => setNotiFilterUnread(true)}
                  >
                    Unread{notiUnreadInList > 0 ? ` ${notiUnreadInList}` : ''}
                  </button>
                </div>
              )}
              <div className="Header__NotiList">
                {notifications.length === 0 ? (
                  <div className="Header__NotiEmpty">No notifications</div>
                ) : visibleNotis.length === 0 ? (
                  <div className="Header__NotiEmpty">No unread notifications</div>
                ) : (
                  visibleNotis.map(renderNotiItem)
                )}
              </div>
            </div>
          )}
        </div>
        {/* 관리자 설정: 글로벌 admin 권한 보유자에게만 노출 (비관리자에겐 버튼 자체를 숨김) */}
        {role === 'admin' && (
          <div className="Header__SettingsWrap" ref={settingsRef}>
            <button
              className="Header__IconBtn"
              title="Settings"
              onClick={() => setShowSettingsMenu((prev) => !prev)}
            >
              <Settings size={18} />
            </button>
            {showSettingsMenu && (
              <div className="Header__SettingsMenu">
                <NavLink
                  href="/admin"
                  className="Header__SettingsItem"
                  onClick={() => { setShowSettingsMenu(false); }}
                >
                  <Shield size={15} />
                  <span>Admin Settings</span>
                </NavLink>
              </div>
            )}
          </div>
        )}
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
              <NavLink
                href="/profile"
                className="Header__SettingsItem"
                onClick={() => { setShowUserMenu(false); }}
              >
                <User size={15} />
                <span>프로필 설정</span>
              </NavLink>
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
