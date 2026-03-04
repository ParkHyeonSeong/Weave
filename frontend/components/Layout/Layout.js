import { useState, useEffect } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import CreateBranch from '@/components/modal/CreateBranch';
import CommandPalette from '@/components/modal/CommandPalette';

export default function Layout({ children }) {
  const [showCreateBranch, setShowCreateBranch] = useState(false);
  const [showPalette, setShowPalette] = useState(false);

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

  return (
    <div className="Layout">
      <Header onSearchClick={() => setShowPalette(true)} />
      <div className="Layout__Body">
        <Sidebar onCreateBranch={() => setShowCreateBranch(true)} />
        <main className="Layout__Content">
          {children}
        </main>
      </div>

      {showCreateBranch && (
        <CreateBranch onClose={() => setShowCreateBranch(false)} />
      )}
      {showPalette && (
        <CommandPalette onClose={() => setShowPalette(false)} />
      )}
    </div>
  );
}
