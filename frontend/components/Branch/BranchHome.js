import { useState, useEffect } from 'react';
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
import useHomeListControls from '@/library/useHomeListControls';
import { byTextAsc, byNumberDesc, byDateDesc, ROLE_GROUP } from '@/library/homeListControls';
import useContextMenu from '@/components/common/useContextMenu';
import ContextMenu from '@/components/common/ContextMenu';
import { buildSpaceMenu } from '@/components/Layout/spaceMenu';
import ConfirmModal from '@/components/modal/ConfirmModal';
import { showToast } from '@/components/Layout/Toast';

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

const BRANCH_CONTROLS = {
  appKey: 'branch',
  hiddenApp: 'branches',
  idField: 'branch_id',
  queryFields: ['branch_name', 'key'],
  defaultView: 'grid',
  sortOptions: [
    { key: 'name', label: '이름순', compare: byTextAsc('branch_name') },
    { key: 'created', label: '최근 생성순', compare: byDateDesc('created_at') },
    { key: 'progress', label: '진행률순', compare: byNumberDesc('progress_percent') },
    { key: 'tasks', label: '활성 태스크순', compare: byNumberDesc('active_task_count') },
  ],
  filterConfig: {
    groups: [
      ROLE_GROUP,
      {
        key: 'sprint', label: '스프린트', options: [
          { value: 'all', label: '전체', test: () => true },
          { value: 'yes', label: '활성 있음', test: (it) => (it.active_sprint_count || 0) > 0 },
          { value: 'no', label: '없음', test: (it) => (it.active_sprint_count || 0) === 0 },
        ],
      },
    ],
    showHidden: true,
  },
};

export default function BranchHome() {
  const router = useRouter();
  const { isHidden, hide, unhide } = useUiPrefs();
  const ctx = useContextMenu();
  const [leaveTarget, setLeaveTarget] = useState(null);
  const [branches, setBranches] = useState([]);
  const { processed, view, query, toolbarProps } = useHomeListControls(BRANCH_CONTROLS, branches);
  const [recentTasks, setRecentTasks] = useState([]);
  const [stats, setStats] = useState(null);
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

  const openCardMenu = (e, b) => {
    const id = b.branch_id;
    const detailPath = `/branch/${id}`;
    const settingsPath = `${detailPath}?tab=settings`;
    ctx.open(e, buildSpaceMenu(
      {
        appType: 'branch',
        id,
        name: b.branch_name,
        role: b.my_role,
        isHidden: isHidden('branches', id),
      },
      {
        open: () => router.push(detailPath),
        openNewTab: () => window.open(detailPath, '_blank'),
        settings: () => router.push(settingsPath),
        rename: () => router.push(settingsPath),
        members: () => router.push(settingsPath),
        toggleHide: () => (isHidden('branches', id) ? unhide('branches', id) : hide('branches', id)),
        archive: async () => {
          try {
            const res = await axios.delete(`/branches/${id}`);
            if (res.data.status) {
              fetchBranches();
              window.dispatchEvent(new Event('branch:created'));
              showToast(`"${b.branch_name}" 아카이브됨`);
            } else {
              showToast('아카이브 실패', 'error');
            }
          } catch {}
        },
        leave: () => setLeaveTarget({ id, name: b.branch_name }),
      },
    ));
  };

  return (
    <>
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
          href: `/branch/${it.branch_id}/task/${it.task_id}`,
        }))}
        emptyText="최근 작업한 태스크가 없습니다"
      />

      <div className="HomeDivider" />

      <HomeToolbar
        count={`브랜치 ${processed.length}`}
        placeholder="브랜치 검색…"
        {...toolbarProps}
      />

      {loading ? (
        <HomeSkeleton variant="cards" />
      ) : processed.length === 0 ? (
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
        <div className={view === 'list' ? 'HList' : 'HGrid'}>
          {processed.map((b) => (
            <AppCard
              key={b.branch_id}
              accent={b.color}
              href={`/branch/${b.branch_id}`}
              onContextMenu={(e) => openCardMenu(e, b)}
            >
              <div className="HCard__Top">
                <div className="HCard__TopText">
                  <div className="HCard__Title">{b.branch_name}</div>
                  <div className="HCard__Desc">{b.description}</div>
                </div>
                {b.progress_percent !== null && (
                  <ProgressRing value={b.progress_percent} color={b.color} />
                )}
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

      <ContextMenu {...ctx.props} />
      <ConfirmModal
        isOpen={!!leaveTarget}
        onClose={() => setLeaveTarget(null)}
        onConfirm={async () => {
          const t = leaveTarget;
          setLeaveTarget(null);
          try {
            const res = await axios.post(`/branches/${t.id}/leave`);
            if (res.data.status) {
              fetchBranches();
              window.dispatchEvent(new Event('branch:created'));
            } else {
              showToast('나가기 실패', 'error');
            }
          } catch {}
        }}
        title="브랜치 나가기"
        message={`"${leaveTarget?.name}"에서 나가시겠습니까?`}
        confirmLabel="나가기"
        variant="danger"
      />
    </>
  );
}
