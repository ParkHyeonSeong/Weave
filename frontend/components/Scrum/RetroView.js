import { useState, useEffect, useMemo } from 'react';
import { axios } from '@/library/_axios';
import useScrumRetroCollab from '@/library/useScrumRetroCollab';
import ScrumCell from './ScrumCell';
import Avatar from '@/components/common/Avatar';

const getProfile = () => { try { return JSON.parse(sessionStorage.getItem('profile') || '{}'); } catch { return {}; } };
const COLS = [['keep', 'Keep · 잘한 것'], ['problem', 'Problem · 문제'], ['try', 'Try · 시도']];

// 회고도 멤버별로 각자 KPT를 적는다. 한 회고 문서(period) 안에서 멤버마다
// 별도 fragment(`${userId}:keep|problem|try`)에 바인딩 → 동시 협업·격리.
export default function RetroView({ boardId, members = [] }) {
  const [retro, setRetro] = useState(null);
  const [manual, setManual] = useState(false);
  const user = useMemo(() => { const p = getProfile(); return p.user_id ? { user_id: p.user_id, username: p.username } : null; }, []);

  useEffect(() => {
    if (!boardId) return;
    (async () => {
      try {
        const res = await axios.get(`/scrum/${boardId}/retros/current`);
        if (res.data.status) {
          if (res.data.retro) setRetro(res.data.retro);
          else setManual(true);   // manual 주기 → 자동 회고 없음
        }
      } catch {}
    })();
  }, [boardId]);

  const { ydoc } = useScrumRetroCollab(boardId, retro?.retro_id, user);

  if (manual) return <div className="RetroView__Empty">이 보드는 회고 주기가 ‘수동’입니다. (자동 회고 없음)</div>;
  if (!retro || !ydoc) return <div className="RetroView__Loading">회고 불러오는 중…</div>;

  const fmt = (s) => s?.slice(5).replace('-', '/');
  return (
    <div className="RetroView">
      <div className="RetroView__Period">{fmt(retro.period_start)} – {fmt(retro.period_end)} 회고 · KPT · 멤버별</div>
      {members.map((m) => (
        <div key={m.user_id} className="RetroMember">
          <div className="RetroMember__Head">
            <Avatar user={m} size={20} className="RetroMember__Avatar" />
            <span className="RetroMember__Name">{m.username}</span>
            {m.user_id === user?.user_id && <em className="RetroMember__You">나</em>}
          </div>
          <div className="RetroView__Cols">
            {COLS.map(([key, label]) => (
              <div key={key} className={`RetroCol RetroCol--${key}`}>
                <div className="RetroCol__Head">{label}</div>
                <div className="RetroCol__Body">
                  <ScrumCell ydoc={ydoc} fragmentKey={`${m.user_id}:${key}`} placeholder="" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
