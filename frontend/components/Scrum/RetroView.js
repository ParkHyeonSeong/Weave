import { useState, useEffect, useMemo } from 'react';
import { axios } from '@/library/_axios';
import useScrumRetroCollab from '@/library/useScrumRetroCollab';
import ScrumCell from './ScrumCell';

const getProfile = () => { try { return JSON.parse(sessionStorage.getItem('profile') || '{}'); } catch { return {}; } };
const COLS = [['keep', 'Keep · 잘한 것'], ['problem', 'Problem · 문제'], ['try', 'Try · 시도']];

export default function RetroView({ boardId }) {
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
      <div className="RetroView__Period">{fmt(retro.period_start)} – {fmt(retro.period_end)} 회고 · KPT</div>
      <div className="RetroView__Cols">
        {COLS.map(([key, label]) => (
          <div key={key} className={`RetroCol RetroCol--${key}`}>
            <div className="RetroCol__Head">{label}</div>
            <div className="RetroCol__Body">
              <ScrumCell ydoc={ydoc} fragmentKey={key} placeholder="" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
