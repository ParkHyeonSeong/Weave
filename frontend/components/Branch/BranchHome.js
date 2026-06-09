import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Inbox, Clock, AlarmClock, Activity, GitBranch } from 'lucide-react';
import { axios } from '@/library/_axios';
import HomeHero from '@/components/Home/shared/HomeHero';
import StatTiles from '@/components/Home/shared/StatTiles';
import ContinueStrip from '@/components/Home/shared/ContinueStrip';
import HomeToolbar from '@/components/Home/shared/HomeToolbar';
import HomeSkeleton from '@/components/Home/shared/HomeSkeleton';
import HomeEmptyState from '@/components/Home/shared/HomeEmptyState';
import ProgressRing from '@/components/Home/shared/ProgressRing';
import AppCard, { AvatarSet } from '@/components/Home/shared/AppCard';
import { useUiPrefs } from '@/library/UiPrefsContext';

const getRelativeTime = (dateStr) => {
  const now = new Date();
  const date = new Date(dateStr);
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return '방금 전';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 172800) return '어제';
  return `${Math.floor(diff / 86400)}일 전`;
};

const getMyName = () => {
  try {
    const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
    return profile.username || '';
  } catch {
    return '';
  }
};

const createBranch = () => window.dispatchEvent(new CustomEvent('layout:create-branch'));
const openCommandPalette = () => window.dispatchEvent(new CustomEvent('layout:open-search'));

export default function BranchHome() {
  const router = useRouter();
  const { isHidden } = useUiPrefs();
  const [branches, setBranches] = useState([]);
  const [recentTasks, setRecentTasks] = useState([]);
  const [stats, setStats] = useState(null);
  const [query, setQuery] = useState('');
  const [view, setView] = useState('grid');
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState('');

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

  const fetchStats = async () => {
    try {
      const res = await axios.get('/branches/home-stats');
      if (res.data.status) setStats(res.data);
    } catch {}
  };

  useEffect(() => {
    setMe(getMyName());
    (async () => {
      await Promise.all([fetchBranches(), fetchRecentTasks(), fetchStats()]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const handleRefresh = () => fetchBranches();
    window.addEventListener('branch:created', handleRefresh);
    return () => window.removeEventListener('branch:created', handleRefresh);
  }, []);

  const filteredBranches = useMemo(() => {
    const base = branches.filter((b) => !isHidden('branches', b.branch_id));
    if (!query.trim()) return base;
    const q = query.toLowerCase();
    return base.filter(
      (b) => b.branch_name.toLowerCase().includes(q) || b.key.toLowerCase().includes(q)
    );
  }, [branches, query, isHidden]);

  return (
    <div className="HomeMain">
      <HomeHero
        greeting={me ? <>안녕하세요, {me}님 👋</> : <>안녕하세요 👋</>}
        summary={stats && (
          <>
            이번 주 마감 <b>{stats.due_this_week_count}</b> · 진행 중{' '}
            <b>{stats.in_progress_count}</b> · 활성 스프린트{' '}
            <b>{stats.active_sprint_count}</b>
          </>
        )}
        actions={
          <>
            <button className="HBtn HBtn--sm" onClick={openCommandPalette}>
              ⌘K 빠른 이동
            </button>
            <button className="HBtn HBtn--sm" onClick={() => router.push('/branch/archive')}>
              🗄 보관함
            </button>
            <button className="HBtn HBtn--pri HBtn--sm" onClick={createBranch}>
              ＋ 새 브랜치
            </button>
          </>
        }
      />

      <StatTiles
        loading={!stats}
        tiles={stats ? [
          { icon: <Inbox size={16} />, label: '열린 태스크', value: stats.open_count, tone: 'primary' },
          { icon: <Clock size={16} />, label: '진행 중', value: stats.in_progress_count, tone: 'inprog' },
          { icon: <AlarmClock size={16} />, label: '이번 주 마감', value: stats.due_this_week_count, tone: 'error' },
          { icon: <Activity size={16} />, label: '활성 스프린트', value: stats.active_sprint_count, tone: 'success' },
        ] : []}
      />

      <ContinueStrip
        title="이어서 작업하기"
        onMore={() => router.push('/my-tasks')}
        loading={loading}
        items={recentTasks.map((it) => ({
          title: it.title,
          dotColor: it.status_color,
          meta: `${it.display_number} · ${getRelativeTime(it.viewed_at)}`,
          onClick: () => router.push(`/branch/${it.branch_id}/task/${it.task_id}`),
        }))}
        emptyText="최근 작업한 태스크가 없습니다"
      />

      <div className="HomeDivider" />

      <HomeToolbar
        count={`브랜치 ${filteredBranches.length}`}
        query={query}
        onQuery={setQuery}
        placeholder="브랜치 검색…"
        sortLabel="최근 활동순"
        view={view}
        onView={setView}
      />

      {loading ? (
        <HomeSkeleton variant="cards" />
      ) : filteredBranches.length === 0 ? (
        <HomeEmptyState
          icon={<GitBranch size={26} />}
          title={branches.length === 0 ? '아직 브랜치가 없어요' : (query.trim() ? '검색 결과 없음' : '표시할 브랜치가 없어요')}
          desc={
            branches.length === 0
              ? '브랜치를 만들어 프로젝트 관리를 시작하세요.'
              : `"${query}"에 맞는 브랜치가 없습니다.`
          }
          ctaLabel={branches.length === 0 ? '＋ 새 브랜치' : undefined}
          onCta={createBranch}
        />
      ) : (
        <div className="HGrid">
          {filteredBranches.map((b) => (
            <AppCard
              key={b.branch_id}
              accent={b.color}
              onClick={() => router.push(`/branch/${b.branch_id}`)}
            >
              <div className="HCard__Top">
                {b.progress_percent !== null && (
                  <ProgressRing value={b.progress_percent} color={b.color} />
                )}
                <div>
                  <div className="HCard__Title">{b.branch_name}</div>
                  <div className="HCard__Desc">{b.description}</div>
                </div>
              </div>
              <div className="HCard__Foot">
                <span className={`HChip ${b.progress_percent !== null ? 'HChip--sprint' : 'HChip--muted'}`}>
                  {b.progress_percent !== null
                    ? `${b.active_sprint_count === 1 ? b.active_sprint_name : `스프린트 ${b.active_sprint_count}개`} · ${b.sprint_task_total} 태스크`
                    : `스프린트 없음 · ${b.active_task_count} 활성`}
                </span>
                <AvatarSet members={b.members || []} />
              </div>
            </AppCard>
          ))}
        </div>
      )}
    </div>
  );
}
