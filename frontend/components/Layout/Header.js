import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import { Search, Bell, CircleHelp, Settings, Shield } from 'lucide-react';

export default function Header({ onSearchClick }) {
  const router = useRouter();
  const [workspaceName, setWorkspaceName] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('');
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const settingsRef = useRef(null);

  useEffect(() => {
    // sessionStorage에서 프로필 정보 가져오기
    try {
      const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
      setUsername(profile.username || '');
      setRole(profile.role || '');
    } catch {}

    // workspace_name은 _app.js에서 setup/status 호출 시 이미 가져옴
    // 여기서는 별도로 가져오기
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
    if (!showSettingsMenu) return;
    const handleClickOutside = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setShowSettingsMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showSettingsMenu]);

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
        <button className="Header__IconBtn" title="Notifications">
          <Bell size={18} />
        </button>
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
