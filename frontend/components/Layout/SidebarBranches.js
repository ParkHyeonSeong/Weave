import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Plus } from 'lucide-react';
import { axios } from '@/library/_axios';

export default function SidebarBranches({ onCreateBranch }) {
  const router = useRouter();
  const [branches, setBranches] = useState([]);

  const fetchBranches = async () => {
    try {
      const res = await axios.get('/branches');
      if (res.data.status) {
        setBranches(res.data.branches);
      }
    } catch {}
  };

  useEffect(() => {
    fetchBranches();
  }, []);

  // CreateBranch 모달에서 생성 후 목록 갱신
  useEffect(() => {
    const handleRefresh = () => fetchBranches();
    window.addEventListener('branch:created', handleRefresh);
    return () => window.removeEventListener('branch:created', handleRefresh);
  }, []);

  return (
    <>
      <div className="Sidebar__SectionHeader">
        <span className="Sidebar__SectionLabel">Branches</span>
        <button className="Sidebar__SectionAddBtn" onClick={onCreateBranch} title="Create Branch">
          <Plus size={14} />
        </button>
      </div>

      <div className="Sidebar__Branches">
        {branches.length === 0 ? (
          <div className="Sidebar__Empty">
            No branches yet.<br />Create one to get started.
          </div>
        ) : (
          branches.map((branch) => (
            <button
              key={branch.branch_id}
              className={`Sidebar__BranchItem ${
                router.query.id == branch.branch_id ? 'Sidebar__BranchItem--active' : ''
              }`}
              onClick={() => router.push(`/branch/${branch.branch_id}`)}
            >
              <span
                className="Sidebar__BranchDot"
                style={{ backgroundColor: branch.color || '#5E6AD2' }}
              />
              <span className="Sidebar__BranchName">{branch.branch_name}</span>
            </button>
          ))
        )}
      </div>
    </>
  );
}
