import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { axios } from '@/library/_axios';
import useScrumWeekCollab from '@/library/useScrumWeekCollab';
import ScrumWeekGrid from './ScrumWeekGrid';
import RetroView from './RetroView';
import { currentISOWeek, addWeeks, weekDates } from '@/library/isoWeek';

const getProfile = () => {
  try { return JSON.parse(sessionStorage.getItem('profile') || '{}'); } catch { return {}; }
};

export default function ScrumBoardView() {
  const router = useRouter();
  const boardId = router.isReady ? Number(router.query.boardId) : null;
  const [board, setBoard] = useState(null);
  const [members, setMembers] = useState([]);
  const [wk, setWk] = useState(() => currentISOWeek());
  const [weekId, setWeekId] = useState(null);
  const [tab, setTab] = useState(() => (typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('tab') === 'retro') ? 'retro' : 'board');
  const [err, setErr] = useState('');
  const user = useMemo(() => { const p = getProfile(); return p.user_id ? { user_id: p.user_id, username: p.username } : null; }, []);

  // 보드 상세 + 멤버
  useEffect(() => {
    if (!boardId) return;
    (async () => {
      try {
        const res = await axios.get(`/scrum/${boardId}`);
        if (res.data.status) { setBoard(res.data.board); setMembers(res.data.board.members || []); }
        else setErr(res.data.message || '접근 불가');
      } catch { setErr('불러오기 실패'); }
    })();
  }, [boardId]);

  // 주 get_or_create → week_id
  useEffect(() => {
    if (!boardId) return;
    setWeekId(null);
    (async () => {
      try {
        const res = await axios.get(`/scrum/${boardId}/weeks/${wk.isoYear}/${wk.isoWeek}`);
        if (res.data.status) setWeekId(res.data.week.week_id);
      } catch {}
    })();
  }, [boardId, wk.isoYear, wk.isoWeek]);

  const { ydoc, connectedUsers, status } = useScrumWeekCollab(boardId, weekId, user);

  if (err) return <div className="ScrumBoard__Error">{err}</div>;
  if (!board) return <div className="ScrumBoard__Loading">불러오는 중…</div>;

  const dates = weekDates(wk.isoYear, wk.isoWeek);
  const range = `${dates[0].month}/${dates[0].day} – ${dates[4].month}/${dates[4].day}`;
  const isThisWeek = (() => { const c = currentISOWeek(); return c.isoYear === wk.isoYear && c.isoWeek === wk.isoWeek; })();

  return (
    <div className="ScrumBoard">
      <header className="ScrumBoard__Head">
        <div className="ScrumBoard__Title" style={{ '--accent': board.color }}>{board.name} 스크럼</div>
        <div className="ScrumBoard__Tabs">
          <button className={tab === 'board' ? 'is-on' : ''} onClick={() => setTab('board')}>주간보드</button>
          <button className={tab === 'retro' ? 'is-on' : ''} onClick={() => setTab('retro')}>회고</button>
        </div>
        {tab === 'board' && (
          <div className="ScrumBoard__WeekNav">
            <button onClick={() => setWk((p) => addWeeks(p.isoYear, p.isoWeek, -1))} aria-label="이전 주"><ChevronLeft size={16} /></button>
            <span className="ScrumBoard__WeekLabel">{range}{isThisWeek ? ' · 이번 주' : ''}</span>
            <button onClick={() => setWk((p) => addWeeks(p.isoYear, p.isoWeek, 1))} aria-label="다음 주"><ChevronRight size={16} /></button>
          </div>
        )}
        {tab === 'board' && (
          <div className="ScrumBoard__Presence">
            {status === 'connected' && connectedUsers.length > 0 && (
              <span className="ScrumBoard__Live">
                {connectedUsers.slice(0, 5).map((u) => (
                  <span key={u.clientId} className="ScrumBoard__Dot" style={{ background: u.color }} title={u.name} />
                ))}
                <span className="ScrumBoard__LiveText">편집 중 {connectedUsers.length}</span>
              </span>
            )}
          </div>
        )}
      </header>
      {tab === 'board' ? (
        !weekId || !ydoc ? (
          <div className="ScrumBoard__Loading">주간 보드 연결 중…</div>
        ) : members.length === 0 ? (
          <div className="ScrumBoard__Empty">아직 멤버가 없어요. 설정에서 팀원을 초대하세요.</div>
        ) : (
          <ScrumWeekGrid ydoc={ydoc} members={members} isoYear={wk.isoYear} isoWeek={wk.isoWeek} />
        )
      ) : (
        <RetroView boardId={boardId} />
      )}
    </div>
  );
}
