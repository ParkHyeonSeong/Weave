import { useState, useEffect } from 'react';
import { X, CalendarCheck, Globe, Lock, Check } from 'lucide-react';
import { axios } from '@/library/_axios';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';

const COLOR_PRESETS = ['#16A34A', '#5E6AD2', '#10B981', '#F59E0B', '#9333EA', '#EC4899', '#0EA5E9', '#DC2626'];
const CADENCES = [
  { v: 'weekly', label: '매주' }, { v: 'biweekly', label: '격주' },
  { v: 'every_n_weeks', label: 'N주마다' }, { v: 'monthly', label: '매월' },
  { v: 'manual', label: '수동' },
];
const WEEKDAYS = [['0', '월'], ['1', '화'], ['2', '수'], ['3', '목'], ['4', '금']];

export default function CreateScrumBoard({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#16A34A');
  const [visibility, setVisibility] = useState('private');
  const [cadence, setCadence] = useState('weekly');
  const [intervalWeeks, setIntervalWeeks] = useState(3);
  const [anchorWeekday, setAnchorWeekday] = useState(4);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim() || loading) return;
    setError(''); setLoading(true);
    try {
      const res = await axios.post('/scrum', {
        name: name.trim(),
        color,
        visibility,
        retro_cadence: cadence,
        retro_interval_weeks: cadence === 'every_n_weeks' ? Number(intervalWeeks) : null,
        retro_template: 'kpt',
        retro_anchor_weekday: Number(anchorWeekday),
      });
      if (res.data.status) {
        window.dispatchEvent(new Event('scrum:created'));
        onCreated(res.data.board_id);
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? '생성 실패';
        setError(msg);
      }
    } catch (err) {
      setError(err?.response?.data?.detail?.[0]?.msg || '생성 실패');
    } finally { setLoading(false); }
  };

  return (
    <div className="CreateTrack__Backdrop" onClick={onClose}>
      <form className="CreateTrack" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <header className="CreateTrack__Head">
          <div className="CreateTrack__Title"><CalendarCheck size={16} /><span>새 스크럼 보드</span></div>
          <button type="button" className="CreateTrack__Close" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </header>
        <div className="CreateTrack__Body">
          <label className="CreateTrack__Field">
            <span className="CreateTrack__Label">팀 이름</span>
            <input type="text" className="CreateTrack__Input" value={name}
              onChange={(e) => setName(e.target.value)} placeholder="예: 디자인팀" maxLength={300} autoFocus />
          </label>
          <div className="CreateTrack__Field">
            <span className="CreateTrack__Label">색상</span>
            <div className="CreateTrack__Colors">
              {COLOR_PRESETS.map((c) => (
                <button key={c} type="button"
                  className={`CreateTrack__Color ${color === c ? 'CreateTrack__Color--active' : ''}`}
                  style={{ background: c }} onClick={() => setColor(c)} aria-label={`color ${c}`}>
                  {color === c && <Check size={12} />}
                </button>
              ))}
            </div>
          </div>
          <div className="CreateTrack__Field">
            <span className="CreateTrack__Label">회고 주기</span>
            <div className="Scrum__ChipRow">
              {CADENCES.map((c) => (
                <button key={c.v} type="button"
                  className={`Scrum__Chip ${cadence === c.v ? 'Scrum__Chip--on' : ''}`}
                  onClick={() => setCadence(c.v)}>{c.label}</button>
              ))}
            </div>
            {cadence === 'every_n_weeks' && (
              <input type="number" min={2} max={12} className="CreateTrack__Input" style={{ marginTop: 8, maxWidth: 120 }}
                value={intervalWeeks} onChange={(e) => setIntervalWeeks(e.target.value)} />
            )}
          </div>
          <div className="CreateTrack__Field">
            <span className="CreateTrack__Label">기준 요일</span>
            <div className="Scrum__ChipRow">
              {WEEKDAYS.map(([v, label]) => (
                <button key={v} type="button"
                  className={`Scrum__Chip ${String(anchorWeekday) === v ? 'Scrum__Chip--on' : ''}`}
                  onClick={() => setAnchorWeekday(Number(v))}>{label}</button>
              ))}
            </div>
          </div>
          <div className="CreateTrack__Field">
            <span className="CreateTrack__Label">공개 범위</span>
            <div className="CreateTrack__VisGroup">
              <button type="button" className={`CreateTrack__VisOpt ${visibility === 'private' ? 'CreateTrack__VisOpt--active' : ''}`} onClick={() => setVisibility('private')}>
                <Lock size={13} /><div className="CreateTrack__VisText"><span className="CreateTrack__VisName">Private</span><span className="CreateTrack__VisHint">멤버만</span></div>
              </button>
              <button type="button" className={`CreateTrack__VisOpt ${visibility === 'public' ? 'CreateTrack__VisOpt--active' : ''}`} onClick={() => setVisibility('public')}>
                <Globe size={13} /><div className="CreateTrack__VisText"><span className="CreateTrack__VisName">Public</span><span className="CreateTrack__VisHint">조직 전체 조회</span></div>
              </button>
            </div>
          </div>
          {error && <div className="CreateTrack__Error">{error}</div>}
        </div>
        <footer className="CreateTrack__Foot">
          <button type="button" className="CreateTrack__Btn CreateTrack__Btn--ghost" onClick={onClose}>취소</button>
          <button type="submit" className="CreateTrack__Btn CreateTrack__Btn--primary" disabled={!name.trim() || loading}>
            {loading ? '생성 중…' : '보드 만들기'}
          </button>
        </footer>
      </form>
    </div>
  );
}
