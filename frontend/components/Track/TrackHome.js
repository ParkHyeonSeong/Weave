import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { Workflow, GitBranch, Clock, AlarmClock } from 'lucide-react';
import { axios } from '@/library/_axios';
import HomeHero from '@/components/Home/shared/HomeHero';
import StatTiles from '@/components/Home/shared/StatTiles';
import HomeToolbar from '@/components/Home/shared/HomeToolbar';
import HomeSkeleton from '@/components/Home/shared/HomeSkeleton';
import HomeEmptyState from '@/components/Home/shared/HomeEmptyState';
import ProgressRing from '@/components/Home/shared/ProgressRing';
import { useUiPrefs } from '@/library/UiPrefsContext';
import useHomeListControls from '@/library/useHomeListControls';
import { byTextAsc, byNumberDesc, byDateDesc, ROLE_GROUP } from '@/library/homeListControls';
import AppCard from '@/components/Home/shared/AppCard';
import CreateTrack from '@/components/modal/CreateTrack';
import useContextMenu from '@/components/common/useContextMenu';
import ContextMenu from '@/components/common/ContextMenu';
import { buildSpaceMenu } from '@/components/Layout/spaceMenu';
import ConfirmModal from '@/components/modal/ConfirmModal';
import { showToast } from '@/components/Layout/Toast';

const getMyName = () => {
  try {
    const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
    return profile.username || '';
  } catch {
    return '';
  }
};

const openCommandPalette = () => window.dispatchEvent(new CustomEvent('layout:open-search'));

const TRACK_CONTROLS = {
  appKey: 'track',
  hiddenApp: 'tracks',
  idField: 'track_id',
  queryFields: ['track_name'],
  defaultView: 'grid',
  sortOptions: [
    { key: 'updated', label: '최근 수정순', compare: byDateDesc('updated_at') },
    { key: 'progress', label: '진행률순', compare: byNumberDesc('progress_percent') },
    { key: 'name', label: '이름순', compare: byTextAsc('track_name') },
    { key: 'branches', label: '브랜치순', compare: byNumberDesc('branch_count') },
  ],
  filterConfig: {
    groups: [
      ROLE_GROUP,
      {
        key: 'status', label: '진행 상태', options: [
          { value: 'all', label: '전체', test: () => true },
          { value: 'active', label: '진행 중', test: (it) => (it.progress_percent ?? 0) < 100 },
          { value: 'done', label: '완료', test: (it) => it.progress_percent === 100 },
        ],
      },
    ],
    showHidden: true,
  },
};

export default function TrackHome() {
  const router = useRouter();
  const { isHidden, hide, unhide } = useUiPrefs();
  const ctx = useContextMenu();
  const [leaveTarget, setLeaveTarget] = useState(null);
  const [tracks, setTracks] = useState([]);
  const { processed, view, query, toolbarProps } = useHomeListControls(TRACK_CONTROLS, tracks);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [me, setMe] = useState('');

  const fetchTracks = useCallback(async () => {
    try {
      const res = await axios.get('/tracks');
      if (res.data.status) setTracks(res.data.tracks);
    } catch {}
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await axios.get('/tracks/home-stats');
      if (res.data.status) setStats(res.data);
    } catch {}
  }, []);

  useEffect(() => {
    setMe(getMyName());
    (async () => {
      await Promise.all([fetchTracks(), fetchStats()]);
      setLoading(false);
    })();
  }, [fetchTracks, fetchStats]);

  const handleCreated = useCallback((trackId) => {
    setShowCreate(false);
    if (trackId) router.push(`/tracks/${trackId}`);
  }, [router]);

  const openCardMenu = (e, t) => {
    const id = t.track_id;
    const detailPath = `/tracks/${id}`;
    const settingsPath = `${detailPath}/settings`;
    ctx.open(e, buildSpaceMenu(
      {
        appType: 'track',
        id,
        name: t.track_name,
        role: t.my_role,
        isHidden: isHidden('tracks', id),
      },
      {
        open: () => router.push(detailPath),
        openNewTab: () => window.open(detailPath, '_blank'),
        settings: () => router.push(settingsPath),
        rename: () => router.push(settingsPath),
        members: () => router.push(settingsPath),
        toggleHide: () => (isHidden('tracks', id) ? unhide('tracks', id) : hide('tracks', id)),
        archive: async () => {
          try {
            const res = await axios.delete(`/tracks/${id}`);
            if (res.data.status) {
              fetchTracks();
              window.dispatchEvent(new Event('track:updated'));
              showToast(`"${t.track_name}" 아카이브됨`);
            } else {
              showToast('아카이브 실패', 'error');
            }
          } catch {}
        },
        leave: () => setLeaveTarget({ id, name: t.track_name }),
      },
    ));
  };

  return (
    <>
    <div className="HomeMain">
      <HomeHero
        greeting={me ? <>안녕하세요, {me}님 👋</> : <>워크플로우 현황을 살펴볼까요 👋</>}
        summary={stats && (
          <>
            진행 중 <b>{stats.in_progress_task_count}</b> · 이번 주 마감{' '}
            <b>{stats.due_this_week_count}</b>
          </>
        )}
        actions={
          <>
            <button className="HBtn HBtn--sm" onClick={openCommandPalette}>
              ⌘K 빠른 이동
            </button>
            <button className="HBtn HBtn--sm" onClick={() => router.push('/tracks/archive')}>
              🗄 보관함
            </button>
            <button className="HBtn HBtn--pri HBtn--sm" onClick={() => setShowCreate(true)}>
              ＋ 새 트랙
            </button>
          </>
        }
      />

      <StatTiles
        loading={!stats}
        tiles={stats ? [
          { icon: <Workflow size={16} />, label: '활성 트랙', value: stats.active_track_count, tone: 'track' },
          { icon: <GitBranch size={16} />, label: '연결된 브랜치', value: stats.connected_branch_count, tone: 'primary' },
          { icon: <Clock size={16} />, label: '진행 중 태스크', value: stats.in_progress_task_count, tone: 'inprog' },
          { icon: <AlarmClock size={16} />, label: '이번 주 마감', value: stats.due_this_week_count, tone: 'error' },
        ] : []}
      />

      <div className="HomeDivider" />

      <HomeToolbar
        count={`트랙 ${processed.length}`}
        placeholder="트랙 검색…"
        {...toolbarProps}
      />

      {loading ? (
        <HomeSkeleton variant="cards" />
      ) : processed.length === 0 ? (
        <HomeEmptyState
          icon={<Workflow size={26} />}
          title={tracks.length === 0 ? '아직 트랙이 없어요' : (query.trim() ? '검색 결과 없음' : '표시할 트랙이 없어요')}
          desc={
            tracks.length === 0
              ? '첫 Track을 만들고 여러 branch의 task를 모아 흐름을 그려보세요.'
              : `"${query}"에 맞는 트랙이 없습니다.`
          }
          ctaLabel={tracks.length === 0 ? '＋ 새 트랙' : undefined}
          onCta={() => setShowCreate(true)}
        />
      ) : (
        <div className={view === 'list' ? 'HList' : 'HGrid'}>
          {processed.map((t) => (
            <AppCard
              key={t.track_id}
              accent={t.color}
              onClick={() => router.push(`/tracks/${t.track_id}`)}
              onContextMenu={(e) => openCardMenu(e, t)}
            >
              <div className="HCard__Top">
                <div className="HCard__TopText">
                  <div className="HCard__Title">{t.track_name}</div>
                  <div className="HCard__Desc">{t.description}</div>
                </div>
                <ProgressRing value={t.progress_percent} color={t.color} />
              </div>
              <div className="HCard__Linked">
                {(t.branches || []).map((br, i) => (
                  <span key={i} className="HCard__LChip">
                    <span className="HDot" style={{ background: br.color }} />
                    {br.name}
                  </span>
                ))}
                {t.branch_count > (t.branches?.length || 0) && (
                  <span className="HCard__LChip">
                    +{t.branch_count - (t.branches?.length || 0)}
                  </span>
                )}
              </div>
              <div className="HCard__Foot">
                <span className="HChip HChip--muted">{t.item_count || 0} 태스크</span>
              </div>
            </AppCard>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateTrack
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
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
            const res = await axios.post(`/tracks/${t.id}/leave`);
            if (res.data.status) {
              fetchTracks();
              window.dispatchEvent(new Event('track:updated'));
            } else {
              showToast('나가기 실패', 'error');
            }
          } catch {}
        }}
        title="트랙 나가기"
        message={`"${leaveTarget?.name}"에서 나가시겠습니까?`}
        confirmLabel="나가기"
        variant="danger"
      />
    </>
  );
}
