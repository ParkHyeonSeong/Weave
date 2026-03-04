import { useEffect, useState } from 'react';
import { Search, Bell, CircleHelp, Settings } from 'lucide-react';

export default function Header({ onSearchClick }) {
  const [workspaceName, setWorkspaceName] = useState('');
  const [username, setUsername] = useState('');

  useEffect(() => {
    // sessionStorage에서 프로필 정보 가져오기
    try {
      const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
      setUsername(profile.username || '');
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

  const initial = username ? username.charAt(0).toUpperCase() : '?';

  return (
    <header className="Header">
      <div className="Header__Left">
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
        <button className="Header__IconBtn" title="Settings">
          <Settings size={18} />
        </button>
        <div className="Header__Avatar" title={username}>
          {initial}
        </div>
      </div>
    </header>
  );
}
