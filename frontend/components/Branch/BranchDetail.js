import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { axios } from '@/library/_axios';
import { Zap, ListTodo, Columns3 } from 'lucide-react';
import TaskList from './Tasks/TaskList';

const TABS = [
  { key: 'epics', label: 'Epics', icon: Zap },
  { key: 'tasks', label: 'Tasks', icon: ListTodo },
  { key: 'board', label: 'Board', icon: Columns3 },
];

export default function BranchDetail() {
  const router = useRouter();
  const { id } = router.query;
  const [branch, setBranch] = useState(null);
  const [activeTab, setActiveTab] = useState('tasks');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetchBranch();
  }, [id]);

  const fetchBranch = async () => {
    try {
      const res = await axios.get(`/branches/${id}`);
      if (res.data.status) {
        setBranch(res.data.branch);
      } else {
        router.replace('/');
      }
    } catch {
      router.replace('/');
    } finally {
      setLoading(false);
    }
  };

  if (loading || !branch) return null;

  return (
    <div className="BranchDetail">
      {/* 헤더 */}
      <div className="BranchDetail__Header">
        <span
          className="BranchDetail__Icon"
          style={{ backgroundColor: branch.color || '#5E6AD2' }}
        />
        <h1 className="BranchDetail__Name">{branch.branch_name}</h1>
        <span className="BranchDetail__Key">{branch.key}</span>
      </div>

      {/* 탭 */}
      <div className="BranchDetail__Tabs">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`BranchDetail__Tab ${activeTab === key ? 'BranchDetail__Tab--active' : ''}`}
            onClick={() => setActiveTab(key)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      <div className="BranchDetail__Content">
        {activeTab === 'tasks' && (
          <TaskList branchId={branch.branch_id} branchKey={branch.key} />
        )}
        {activeTab === 'epics' && (
          <div className="BranchDetail__Placeholder">
            Epics 타임라인 뷰 (준비 중)
          </div>
        )}
        {activeTab === 'board' && (
          <div className="BranchDetail__Placeholder">
            Board 칸반 뷰 (준비 중)
          </div>
        )}
      </div>
    </div>
  );
}
