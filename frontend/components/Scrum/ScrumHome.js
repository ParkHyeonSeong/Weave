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
import { useUiPrefs } from '@/library/UiPrefsContext';
import useHomeListControls from '@/library/useHomeListControls';
import { byTextAsc, byNumberDesc, byDateDesc, ROLE_GROUP } from '@/library/homeListControls';
import useContextMenu from '@/components/common/useContextMenu';
import ContextMenu from '@/components/common/ContextMenu';
import { buildSpaceMenu } from '@/components/Layout/spaceMenu';
import ConfirmModal from '@/components/modal/ConfirmModal';
import { showToast } from '@/components/Layout/Toast';

const getMyName = () => {
  try { return JSON.parse(sessionStorage.getItem('profile') || '{}').username || ''; } catch { return ''; }
};
const CADENCE_LABEL = { weekly: '매주', biweekly: '격주', every_n_weeks: 'N주', monthly: '매월', manual: '수동' };

const SCRUM_CONTROLS = {
  appKey: 'scrum',
  hiddenApp: 'scrums',
  idField: 'board_id',
  queryFields: ['name'],
  defaultView: 'grid',
  sortOptions: [
    { key: 'updated', label: '최근 수정순', compare: byDateDesc('updated_at') },
    { key: 'name', label: '이름순', compare: byTextAsc('name') },
    { key: 'created', label: '최근 생성순', compare: byDateDesc('created_at') },
    { key: 'members', label: '멤버순', compare: byNumberDesc('member_count') },
  ],
  filterConfig: {
    groups: [
      ROLE_GROUP,
      {
        key: 'cadence', label: '회고 주기', options: [
          { value: 'all', label: '전체', test: () => true },
          { value: 'weekly', label: '매주', test: (it) => it.retro_cadence === 'weekly' },
          { value: 'biweekly', label: '격주', test: (it) => it.retro_cadence === 'biweekly' },
          { value: 'every_n_weeks', label: 'N주', test: (it) => it.retro_cadence === 'every_n_weeks' },
          { value: 'monthly', label: '매월', test: (it) => it.retro_cadence === 'monthly' },
          { value: 'manual', label: '수동', test: (it) => it.retro_cadence === 'manual' },
        ],
      },
    ],
    showHidden: true,
  },
};

export default function ScrumHome() {
  const router = useRouter();
  const { isHidden, hide, unhide } = useUiPrefs();
  const ctx = useContextMenu();
  const [leaveTarget, setLeaveTarget] = useState(null);
  const [boards, setBoards] = useState([]);
  const { processed, view, query, toolbarProps } = useHomeListControls(SCRUM_CONTROLS, boards);
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

  const memberTotal = useMemo(() => boards.reduce((s, b) => s + (b.member_count || 0), 0), [boards]);

  const openCardMenu = (e, b) => {
    const id = b.board_id;
    const detailPath = `/scrum/${id}`;
    const settingsPath = `${detailPath}/settings`;
    ctx.open(e, buildSpaceMenu(
      {
        appType: 'scrum',
        id,
        name: b.name,
        role: b.my_role,
        isHidden: isHidden('scrums', id),
      },
      {
        open: () => router.push(detailPath),
        openNewTab: () => window.open(detailPath, '_blank'),
        settings: () => router.push(settingsPath),
        rename: () => router.push(settingsPath),
        members: () => router.push(settingsPath),
        toggleHide: () => (isHidden('scrums', id) ? unhide('scrums', id) : hide('scrums', id)),
        archive: async () => {
          try {
            const res = await axios.delete(`/scrum/${id}`);
            if (res.data.status) {
              fetchBoards();
              window.dispatchEvent(new Event('scrum:updated'));
              showToast(`"${b.name}" 아카이브됨`);
            } else {
              showToast('아카이브 실패', 'error');
            }
          } catch {}
        },
        leave: () => setLeaveTarget({ id, name: b.name }),
      },
    ));
  };

  return (
    <>
    <div className="HomeMain">
      <HomeHero
        greeting={me ? <>안녕하세요, {me}님 👋</> : <>오늘의 스크럼을 시작해볼까요 👋</>}
        summary={<>스크럼 보드 <b>{boards.length}</b>개</>}
        actions={(
          <>
            <button className="HBtn HBtn--sm" onClick={() => router.push('/scrum/archive')}>🗄 보관함</button>
            <button className="HBtn HBtn--pri HBtn--sm" onClick={() => setShowCreate(true)}>＋ 새 보드</button>
          </>
        )}
      />
      <StatTiles
        loading={loading}
        tiles={[
          { icon: <CalendarCheck size={16} />, label: '스크럼 보드', value: boards.length, tone: 'track' },
          { icon: <Users size={16} />, label: '총 멤버', value: memberTotal, tone: 'primary' },
        ]}
      />
      <div className="HomeDivider" />
      <HomeToolbar count={`보드 ${processed.length}`} placeholder="보드 검색…" {...toolbarProps} />
      {loading ? (
        <HomeSkeleton variant="cards" />
      ) : processed.length === 0 ? (
        <HomeEmptyState
          icon={<CalendarCheck size={26} />}
          title={boards.length === 0 ? '아직 스크럼 보드가 없어요' : (query.trim() ? '검색 결과 없음' : '표시할 보드가 없어요')}
          desc={boards.length === 0 ? '첫 보드를 만들고 팀의 데일리스크럼을 시작하세요.' : (query.trim() ? `"${query}"에 맞는 보드가 없습니다.` : '모든 보드가 숨겨졌어요. 사이드바에서 해제할 수 있어요.')}
          ctaLabel={boards.length === 0 ? '＋ 새 보드' : undefined}
          onCta={() => setShowCreate(true)}
        />
      ) : (
        <div className={view === 'list' ? 'HList' : 'HGrid'}>
          {processed.map((b) => (
            <AppCard key={b.board_id} accent={b.color} href={`/scrum/${b.board_id}`} onContextMenu={(e) => openCardMenu(e, b)}>
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

      <ContextMenu {...ctx.props} />
      <ConfirmModal
        isOpen={!!leaveTarget}
        onClose={() => setLeaveTarget(null)}
        onConfirm={async () => {
          const t = leaveTarget;
          setLeaveTarget(null);
          try {
            const res = await axios.post(`/scrum/${t.id}/leave`);
            if (res.data.status) {
              fetchBoards();
              window.dispatchEvent(new Event('scrum:updated'));
            } else {
              showToast('나가기 실패', 'error');
            }
          } catch {}
        }}
        title="보드 나가기"
        message={`"${leaveTarget?.name}"에서 나가시겠습니까?`}
        confirmLabel="나가기"
        variant="danger"
      />
    </>
  );
}
