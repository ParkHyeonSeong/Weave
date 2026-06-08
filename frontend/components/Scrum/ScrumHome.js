import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/router';
import { CalendarCheck, Users } from 'lucide-react';
import { axios } from '@/library/_axios';
import HomeHero from '@/components/Home/shared/HomeHero';
import StatTiles from '@/components/Home/shared/StatTiles';
import HomeToolbar from '@/components/Home/shared/HomeToolbar';
import HomeSkeleton from '@/components/Home/shared/HomeSkeleton';
import HomeEmptyState from '@/components/Home/shared/HomeEmptyState';
import AppCard from '@/components/Home/shared/AppCard';
import CreateScrumBoard from '@/components/modal/CreateScrumBoard';

const getMyName = () => {
  try { return JSON.parse(sessionStorage.getItem('profile') || '{}').username || ''; } catch { return ''; }
};
const CADENCE_LABEL = { weekly: '매주', biweekly: '격주', every_n_weeks: 'N주', monthly: '매월', manual: '수동' };

export default function ScrumHome() {
  const router = useRouter();
  const [boards, setBoards] = useState([]);
  const [query, setQuery] = useState('');
  const [view, setView] = useState('grid');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [me, setMe] = useState('');

  const fetchBoards = useCallback(async () => {
    try { const res = await axios.get('/scrum'); if (res.data.status) setBoards(res.data.boards); } catch {}
  }, []);

  useEffect(() => {
    setMe(getMyName());
    (async () => { await fetchBoards(); setLoading(false); })();
  }, [fetchBoards]);

  const handleCreated = useCallback((boardId) => {
    setShowCreate(false);
    if (boardId) router.push(`/scrum/${boardId}`);
  }, [router]);

  const filtered = useMemo(() => {
    if (!query.trim()) return boards;
    const q = query.toLowerCase();
    return boards.filter((b) => b.name.toLowerCase().includes(q));
  }, [boards, query]);

  const memberTotal = useMemo(() => boards.reduce((s, b) => s + (b.member_count || 0), 0), [boards]);

  return (
    <div className="HomeMain">
      <HomeHero
        greeting={me ? <>안녕하세요, {me}님 👋</> : <>오늘의 스크럼을 시작해볼까요 👋</>}
        summary={<>스크럼 보드 <b>{boards.length}</b>개</>}
        actions={<button className="HBtn HBtn--pri HBtn--sm" onClick={() => setShowCreate(true)}>＋ 새 보드</button>}
      />
      <StatTiles
        loading={loading}
        tiles={[
          { icon: <CalendarCheck size={16} />, label: '스크럼 보드', value: boards.length, tone: 'track' },
          { icon: <Users size={16} />, label: '총 멤버', value: memberTotal, tone: 'primary' },
        ]}
      />
      <div className="HomeDivider" />
      <HomeToolbar count={`보드 ${boards.length}`} query={query} onQuery={setQuery} placeholder="보드 검색…" sortLabel="최근순" view={view} onView={setView} />
      {loading ? (
        <HomeSkeleton variant="cards" />
      ) : filtered.length === 0 ? (
        <HomeEmptyState
          icon={<CalendarCheck size={26} />}
          title={boards.length === 0 ? '아직 스크럼 보드가 없어요' : '검색 결과 없음'}
          desc={boards.length === 0 ? '첫 보드를 만들고 팀의 데일리스크럼을 시작하세요.' : `"${query}"에 맞는 보드가 없습니다.`}
          ctaLabel={boards.length === 0 ? '＋ 새 보드' : undefined}
          onCta={() => setShowCreate(true)}
        />
      ) : (
        <div className="HGrid">
          {filtered.map((b) => (
            <AppCard key={b.board_id} accent={b.color} onClick={() => router.push(`/scrum/${b.board_id}`)}>
              <div className="HCard__Top">
                <div>
                  <div className="HCard__Title">{b.name}</div>
                  <div className="HCard__Desc">회고 {CADENCE_LABEL[b.retro_cadence] || b.retro_cadence}</div>
                </div>
              </div>
              <div className="HCard__Foot">
                <span className="HChip HChip--muted">멤버 {b.member_count || 0}</span>
              </div>
            </AppCard>
          ))}
        </div>
      )}
      {showCreate && <CreateScrumBoard onClose={() => setShowCreate(false)} onCreated={handleCreated} />}
    </div>
  );
}
