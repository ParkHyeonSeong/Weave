import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { CalendarCheck, History, X } from 'lucide-react';
import { axios } from '@/library/_axios';

export default function ScrumHomeCards() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [dismissed, setDismissed] = useState(() => new Set());

  useEffect(() => {
    let alive = true;
    axios.get('/scrum/home-cards')
      .then((r) => { if (alive && r.data.status) setData(r.data); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!data) return null;
  const pending = (data.today_pending || []).filter((b) => !dismissed.has(`t${b.board_id}`));
  const retro = (data.retro_due || []).filter((b) => !dismissed.has(`r${b.board_id}`));
  if (pending.length === 0 && retro.length === 0) return null;

  const dismiss = (k) => setDismissed((p) => new Set(p).add(k));

  return (
    <div className="ScrumCards">
      {pending.map((b) => (
        <div key={`t${b.board_id}`} className="ScrumCard ScrumCard--today" style={{ '--accent': b.color }}>
          <div className="ScrumCard__Main" onClick={() => router.push(`/scrum/${b.board_id}`)}>
            <CalendarCheck size={16} />
            <span><b>{b.name}</b> · 오늘 데일리스크럼 아직 안 썼어요</span>
          </div>
          <button className="ScrumCard__Go" onClick={() => router.push(`/scrum/${b.board_id}`)}>지금 쓰기 →</button>
          <button className="ScrumCard__X" onClick={() => dismiss(`t${b.board_id}`)} aria-label="닫기"><X size={14} /></button>
        </div>
      ))}
      {retro.map((b) => (
        <div key={`r${b.board_id}`} className="ScrumCard ScrumCard--retro">
          <div className="ScrumCard__Main" onClick={() => router.push(`/scrum/${b.board_id}?tab=retro`)}>
            <History size={16} />
            <span><b>{b.name}</b> · 회고할 시간이에요 ({b.period_start.slice(5)}~{b.period_end.slice(5)})</span>
          </div>
          <button className="ScrumCard__Go ScrumCard__Go--retro" onClick={() => router.push(`/scrum/${b.board_id}?tab=retro`)}>회고 쓰기 →</button>
          <button className="ScrumCard__X" onClick={() => dismiss(`r${b.board_id}`)} aria-label="닫기"><X size={14} /></button>
        </div>
      ))}
    </div>
  );
}
