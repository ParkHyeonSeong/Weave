import { useState, useEffect, useMemo, useCallback } from 'react';
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
import AppCard from '@/components/Home/shared/AppCard';
import CreateTrack from '@/components/modal/CreateTrack';

const getMyName = () => {
  try {
    const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
    return profile.username || '';
  } catch {
    return '';
  }
};

const openCommandPalette = () => window.dispatchEvent(new CustomEvent('layout:open-search'));

export default function TrackHome() {
  const router = useRouter();
  const { isHidden } = useUiPrefs();
  const [tracks, setTracks] = useState([]);
  const [stats, setStats] = useState(null);
  const [query, setQuery] = useState('');
  const [view, setView] = useState('grid');
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

  const filteredTracks = useMemo(() => {
    const base = tracks.filter((t) => !isHidden('tracks', t.track_id));
    if (!query.trim()) return base;
    const q = query.toLowerCase();
    return base.filter((t) => t.track_name.toLowerCase().includes(q));
  }, [tracks, query, isHidden]);

  return (
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
        count={`트랙 ${filteredTracks.length}`}
        query={query}
        onQuery={setQuery}
        placeholder="트랙 검색…"
        sortLabel="진행률순"
        view={view}
        onView={setView}
      />

      {loading ? (
        <HomeSkeleton variant="cards" />
      ) : filteredTracks.length === 0 ? (
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
        <div className="HGrid">
          {filteredTracks.map((t) => (
            <AppCard
              key={t.track_id}
              accent={t.color}
              onClick={() => router.push(`/tracks/${t.track_id}`)}
            >
              <div className="HCard__Top">
                <ProgressRing value={t.progress_percent} color={t.color} />
                <div>
                  <div className="HCard__Title">{t.track_name}</div>
                  <div className="HCard__Desc">{t.description}</div>
                </div>
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
  );
}
