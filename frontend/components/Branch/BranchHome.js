import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Plus, Clock, Search, FileText, GitBranch } from 'lucide-react';
import { axios } from '@/library/_axios';
import TaskSummary from '@/components/Home/DashboardWidgets/TaskSummary';
import ActiveSprints from '@/components/Home/DashboardWidgets/ActiveSprints';
import EntityIcon from '@/components/common/EntityIcon';

const getRelativeTime = (dateStr) => {
  const now = new Date();
  const date = new Date(dateStr);
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 172800) return 'yesterday';
  return `${Math.floor(diff / 86400)}d ago`;
};

export default function BranchHome() {
  const router = useRouter();
  const [branches, setBranches] = useState([]);
  const [recentTasks, setRecentTasks] = useState([]);
  const [query, setQuery] = useState('');

  const fetchBranches = async () => {
    try {
      const res = await axios.get('/branches');
      if (res.data.status) setBranches(res.data.branches);
    } catch {}
  };

  const fetchRecentTasks = async () => {
    try {
      const res = await axios.get('/recent-views', { params: { type: 'task', limit: 5 } });
      if (res.data.status) setRecentTasks(res.data.items);
    } catch {}
  };

  useEffect(() => {
    fetchBranches();
    fetchRecentTasks();
  }, []);

  useEffect(() => {
    const handleRefresh = () => fetchBranches();
    window.addEventListener('branch:created', handleRefresh);
    return () => window.removeEventListener('branch:created', handleRefresh);
  }, []);

  const filteredBranches = useMemo(() => {
    if (!query.trim()) return branches;
    const q = query.toLowerCase();
    return branches.filter(
      (b) => b.branch_name.toLowerCase().includes(q) || b.key.toLowerCase().includes(q)
    );
  }, [branches, query]);

  return (
    <div className="BranchHome">
      <div className="BranchHome__Panel">
        <div className="BranchHome__PanelHeader">
          <GitBranch size={16} />
          <span className="BranchHome__PanelTitle">Branch</span>
          <button
            className="BranchHome__CreateBtn"
            onClick={() => window.dispatchEvent(new CustomEvent('layout:create-branch'))}
          >
            <Plus size={14} />
            New Branch
          </button>
        </div>
        <div className="BranchHome__PanelBody">

      {/* 위젯 영역 */}
      <div className="BranchHome__WidgetGrid">
        <TaskSummary />
        <ActiveSprints />
      </div>

      {/* 최근 태스크 */}
      {recentTasks.length > 0 && (
        <div className="BranchHome__RecentSection">
          <div className="Widget">
            <div className="Widget__Header">
              <Clock size={16} />
              <span className="Widget__Title">Recent Tasks</span>
            </div>
            <div className="Widget__Body">
              <div className="BranchHome__RecentList">
                {recentTasks.map((item) => (
                  <div
                    key={item.task_id}
                    className="BranchHome__RecentItem"
                    onClick={() => router.push(`/branch/${item.branch_id}/task/${item.task_id}`)}
                  >
                    <div className={`BranchHome__StatusDot BranchHome__StatusDot--${item.status}`} />
                    <span className="BranchHome__RecentId">{item.display_number}</span>
                    <span className="BranchHome__RecentTitle">{item.title}</span>
                    <span className="BranchHome__RecentTime">{getRelativeTime(item.viewed_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 구분선 + 전체 브랜치 목록 */}
      <div className="BranchHome__Divider" />

      <div className="BranchHome__ListSection">
        <div className="BranchHome__SearchWrap">
          <Search size={16} />
          <input
            className="BranchHome__SearchInput"
            type="text"
            placeholder="Search branches..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {filteredBranches.length === 0 ? (
          <div className="BranchHome__Empty">
            {branches.length === 0 ? (
              <>
                <p>No branches yet.</p>
                <p>Create a branch to start managing your project.</p>
              </>
            ) : (
              <p>No branches matching &quot;{query}&quot;</p>
            )}
          </div>
        ) : (
          <div className="BranchHome__Grid">
            {filteredBranches.map((branch) => (
              <button
                key={branch.branch_id}
                className="BranchHome__Card"
                onClick={() => router.push(`/branch/${branch.branch_id}`)}
              >
                <div className="BranchHome__CardHeader">
                  <EntityIcon
                    icon={branch.icon}
                    color={branch.color}
                    size={20}
                    entityType="branch"
                  />
                  <span className="BranchHome__CardName">{branch.branch_name}</span>
                  <span className="BranchHome__CardKey">{branch.key}</span>
                </div>
                {branch.description && (
                  <p className="BranchHome__CardDesc">{branch.description}</p>
                )}
                <div className="BranchHome__CardMeta">
                  <span className="BranchHome__CardRole">{branch.my_role}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
        </div>
      </div>
    </div>
  );
}
