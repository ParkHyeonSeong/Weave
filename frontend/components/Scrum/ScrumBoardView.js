import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/router';
import { ChevronLeft, ChevronRight, Users, Settings } from 'lucide-react';
import { axios } from '@/library/_axios';
import { getErrorCode } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import useScrumWeekCollab from '@/library/useScrumWeekCollab';
import ScrumWeekGrid from './ScrumWeekGrid';
import RetroView from './RetroView';
import ScrumMembersModal from './ScrumMembersModal';
import Avatar from '@/components/common/Avatar';
import DatePicker from '@/components/common/DatePicker';
import RefPanelHost, { useRefPreview } from '@/components/shared/RefPanelHost';
import { currentISOWeek, weekDates, getISOWeek } from '@/library/isoWeek';
import NavLink from '@/components/common/NavLink';

const getProfile = () => {
  try { return JSON.parse(sessionStorage.getItem('profile') || '{}'); } catch { return {}; }
};

// 'YYYY-MM-DD' ↔ 로컬 Date (getISOWeek/jumpWeek과 같은 로컬 기준 — UTC off-by-one 방지)
const ymdToDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const dateToYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayYmd = () => dateToYmd(new Date());
const shiftYmd = (s, days) => { const d = ymdToDate(s); d.setDate(d.getDate() + days); return dateToYmd(d); };

export default function ScrumBoardView() {
  const router = useRouter();
  const boardId = router.isReady ? Number(router.query.boardId) : null;
  const [board, setBoard] = useState(null);
  const [members, setMembers] = useState([]);
  const [weekId, setWeekId] = useState(null);
  const [tab, setTab] = useState(() => (typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('tab') === 'retro') ? 'retro' : 'board');
  const [err, setErr] = useState('');
  const [showMembers, setShowMembers] = useState(false);
  // 주간보드·회고 공용 기준 날짜: null = 현재(오늘 KST). 한 상태로 두 뷰를 동기화한다 —
  // 주간보드는 이 날짜의 ISO 주를, 회고는 이 날짜가 속한 기간을 파생한다.
  // 회고 이동 앵커(prev_date/next_date)는 백엔드가 기간과 함께 내려준다.
  const [anchorDate, setAnchorDate] = useState(null);
  const wk = useMemo(() => (anchorDate ? getISOWeek(ymdToDate(anchorDate)) : currentISOWeek()), [anchorDate]);
  const [retroData, setRetroData] = useState(null);   // { retro, prev_date, next_date, is_current }
  const [retroManual, setRetroManual] = useState(false);
  // 인라인 ref 칩(task/doc) 클릭 → 타입별 패널 오픈 (데일리·회고 탭 공통)
  const [previewRef, setPreviewRef] = useRefPreview();

  // 탭·주·회고기간 전환은 다른 문서로 가는 것 — 열려 있던 참조 패널은 닫는다
  useEffect(() => {
    setPreviewRef(null);
  }, [tab, wk.isoYear, wk.isoWeek, retroData?.retro?.retro_id, setPreviewRef]);

  // 보드를 바꾸면 기준 날짜를 현재로 초기화
  useEffect(() => { setAnchorDate(null); }, [boardId]);
  const user = useMemo(() => { const p = getProfile(); return p.user_id ? { user_id: p.user_id, username: p.username, avatar_url: p.avatar_url, avatar_color: p.avatar_color } : null; }, []);

  // 보드 상세 + 멤버
  const refetchBoard = useCallback(async () => {
    if (!boardId) return;
    try {
      const res = await axios.get(`/scrum/${boardId}`);
      if (res.data.status) {
        setBoard(res.data.board);
        const ms = res.data.board.members || [];
        const myId = user?.user_id;
        // 본인을 항상 맨 위로, 나머지는 원래 순서(가입순) 유지
        const ordered = myId
          ? [...ms].sort((a, b) => (b.user_id === myId) - (a.user_id === myId))
          : ms;
        setMembers(ordered);
      } else setErr(errorText(getErrorCode(res.data)) ?? '접근 불가');
    } catch { setErr('불러오기 실패'); }
  }, [boardId, user?.user_id]);

  useEffect(() => { refetchBoard(); }, [refetchBoard]);

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

  // 회고 탭: 기준 날짜가 속한 기간을 get_or_create + 이전/다음 이동 앵커 조회
  useEffect(() => {
    if (!boardId || tab !== 'retro') return;
    let alive = true;
    setRetroData(null);
    setRetroManual(false);
    (async () => {
      try {
        const q = anchorDate ? `?date=${anchorDate}` : '';
        const res = await axios.get(`/scrum/${boardId}/retros/period${q}`);
        if (!alive) return;
        if (res.data.status) {
          if (res.data.retro) setRetroData(res.data);
          else setRetroManual(true);   // manual 주기 → 자동 회고 없음
        }
      } catch {}
    })();
    return () => { alive = false; };
  }, [boardId, tab, anchorDate]);

  const { ydoc, connectedUsers, status } = useScrumWeekCollab(boardId, weekId, user);

  if (err) return <div className="ScrumBoard__Error">{err}</div>;
  if (!board) return <div className="ScrumBoard__Loading">불러오는 중…</div>;

  const dates = weekDates(wk.isoYear, wk.isoWeek);
  const range = `${dates[0].month}/${dates[0].day} – ${dates[4].month}/${dates[4].day}`;
  const isThisWeek = (() => { const c = currentISOWeek(); return c.isoYear === wk.isoYear && c.isoWeek === wk.isoWeek; })();
  // 'YYYY-MM-DD' → 'M/D' (앞자리 0 제거)
  const fmtPeriod = (s) => (s ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}` : '');
  const retroRange = retroData
    ? `${fmtPeriod(retroData.retro.period_start)} – ${fmtPeriod(retroData.retro.period_end)}`
    : '';
  // 'YYYY-MM-DD' 선택 → 그 날짜를 공용 기준 날짜로 (주간보드·회고 동기화)
  const jumpWeek = (d) => { if (d) setAnchorDate(d); };

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
            <button onClick={() => setAnchorDate((a) => shiftYmd(a ?? todayYmd(), -7))} aria-label="이전 주"><ChevronLeft size={16} /></button>
            <DatePicker
              value={null}
              onChange={jumpWeek}
              trigger={<span className="ScrumBoard__WeekLabel">{range}{isThisWeek ? ' · 이번 주' : ''}</span>}
            />
            <button onClick={() => setAnchorDate((a) => shiftYmd(a ?? todayYmd(), 7))} aria-label="다음 주"><ChevronRight size={16} /></button>
            {!isThisWeek && (
              <button className="ScrumBoard__TodayBtn" onClick={() => setAnchorDate(null)}>오늘로</button>
            )}
          </div>
        )}
        {tab === 'retro' && retroData && (
          <div className="ScrumBoard__WeekNav">
            <button onClick={() => setAnchorDate(retroData.prev_date)} aria-label="이전 회고"><ChevronLeft size={16} /></button>
            <DatePicker
              value={retroData.retro.period_start}
              onChange={(d) => { if (d) setAnchorDate(d); }}
              trigger={<span className="ScrumBoard__WeekLabel">{retroRange}{retroData.is_current ? ' · 이번 회고' : ''}</span>}
            />
            <button onClick={() => setAnchorDate(retroData.next_date)} aria-label="다음 회고"><ChevronRight size={16} /></button>
            {!retroData.is_current && (
              <button className="ScrumBoard__TodayBtn" onClick={() => setAnchorDate(null)}>이번 회고로</button>
            )}
          </div>
        )}
        <div className="ScrumBoard__Presence">
          {tab === 'board' && status === 'connected' && connectedUsers.length > 0 && (
            <span className="ScrumBoard__Live">
              {connectedUsers.slice(0, 5).map((u) => (
                <Avatar
                  key={u.clientId}
                  name={u.name}
                  userId={u.userId}
                  avatarUrl={u.avatar_url}
                  avatarColor={u.avatar_color}
                  size="xs"
                />
              ))}
              <span className="ScrumBoard__LiveText">편집 중 {connectedUsers.length}</span>
            </span>
          )}
          <button
            type="button"
            className="ScrumBoard__MembersBtn"
            onClick={() => setShowMembers(true)}
          >
            <Users size={14} />
            멤버 {members.length}
          </button>
          <NavLink
            href={`/scrum/${boardId}/settings`}
            className="ScrumBoard__SettingsBtn"
            title="보드 설정"
            aria-label="보드 설정"
          >
            <Settings size={15} />
          </NavLink>
        </div>
      </header>
      <div className="ScrumBoard__Body">
        <div className="ScrumBoard__BodyMain">
          {tab === 'board' ? (
            !weekId || !ydoc ? (
              <div className="ScrumBoard__Loading">주간 보드 연결 중…</div>
            ) : members.length === 0 ? (
              <div className="ScrumBoard__Empty">아직 멤버가 없어요. 설정에서 팀원을 초대하세요.</div>
            ) : (
              <ScrumWeekGrid ydoc={ydoc} members={members} isoYear={wk.isoYear} isoWeek={wk.isoWeek} />
            )
          ) : (
            <RetroView boardId={boardId} members={members} retro={retroData?.retro || null} manual={retroManual} />
          )}
        </div>
        <RefPanelHost
          previewRef={previewRef}
          onClose={() => setPreviewRef(null)}
          onChangeRef={setPreviewRef}
        />
      </div>
      {showMembers && (
        <ScrumMembersModal
          boardId={boardId}
          myRole={board.my_role}
          count={members.length}
          onClose={() => setShowMembers(false)}
          onChanged={refetchBoard}
        />
      )}
    </div>
  );
}
