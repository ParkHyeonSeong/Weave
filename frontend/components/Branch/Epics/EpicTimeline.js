import { useState, useEffect, useMemo } from 'react';
import { axios } from '@/library/_axios';
import { Plus } from 'lucide-react';
import EpicBar from './EpicBar';
import EpicModal from '@/components/modal/EpicModal';

const VIEW_MODES = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
];

export default function EpicTimeline({ branchId, onSelectEpic }) {
  const [epics, setEpics] = useState([]);
  const [sprints, setSprints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [epicModal, setEpicModal] = useState({ open: false });
  const [viewMode, setViewMode] = useState('month');

  useEffect(() => {
    fetchData();
  }, [branchId]);

  // epic:updated 이벤트
  useEffect(() => {
    const handleRefresh = () => fetchData();
    window.addEventListener('epic:updated', handleRefresh);
    return () => window.removeEventListener('epic:updated', handleRefresh);
  }, [branchId]);

  const fetchData = async () => {
    try {
      const [epicRes, sprintRes] = await Promise.all([
        axios.get(`/branches/${branchId}/epics`),
        axios.get(`/branches/${branchId}/sprints`),
      ]);
      if (epicRes.data.status) setEpics(epicRes.data.epics);
      if (sprintRes.data.status) setSprints(sprintRes.data.sprints);
    } catch {}
    setLoading(false);
  };

  // 타임라인 범위 계산 (viewMode 기준)
  const { timelineStart, timelineEnd, totalDays, headerLabels } = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    let start, end;

    if (viewMode === 'week') {
      // 이번 주 월요일 ~ 2주 후
      const dayOfWeek = now.getDay() || 7; // 일요일=7
      start = new Date(now);
      start.setDate(now.getDate() - dayOfWeek + 1 - 7); // 1주 전 월요일
      end = new Date(start);
      end.setDate(start.getDate() + 28); // 4주간
    } else if (viewMode === 'month') {
      // 이번 달 기준 앞뒤 1달씩
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    } else {
      // quarter: 이번 분기 기준 앞뒤 1달씩
      const qStart = Math.floor(now.getMonth() / 3) * 3;
      start = new Date(now.getFullYear(), qStart - 1, 1);
      end = new Date(now.getFullYear(), qStart + 4, 0);
    }

    const total = Math.ceil((end - start) / (1000 * 60 * 60 * 24));

    // 헤더 라벨 생성
    const labels = [];
    if (viewMode === 'week') {
      // 주 단위 라벨
      const cursor = new Date(start);
      while (cursor <= end) {
        const dayOffset = Math.ceil((new Date(cursor) - start) / (1000 * 60 * 60 * 24));
        labels.push({
          label: cursor.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }),
          offset: dayOffset,
        });
        cursor.setDate(cursor.getDate() + 7);
      }
    } else {
      // 월 단위 라벨
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cursor <= end) {
        const dayOffset = Math.ceil((new Date(cursor) - start) / (1000 * 60 * 60 * 24));
        labels.push({
          label: cursor.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
          offset: dayOffset,
        });
        cursor.setMonth(cursor.getMonth() + 1);
      }
    }

    return { timelineStart: start, timelineEnd: end, totalDays: total, headerLabels: labels };
  }, [viewMode]);

  const getPosition = (dateStr) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    const days = (date - timelineStart) / (1000 * 60 * 60 * 24);
    return (days / totalDays) * 100;
  };

  const todayPos = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (today < timelineStart || today > timelineEnd) return null;
    const days = (today - timelineStart) / (1000 * 60 * 60 * 24);
    return (days / totalDays) * 100;
  }, [timelineStart, timelineEnd, totalDays]);

  if (loading) return null;

  return (
    <div className="EpicTimeline">
      {/* 상단 액션 */}
      <div className="EpicTimeline__Actions">
        <button
          className="EpicTimeline__CreateBtn"
          onClick={() => setEpicModal({ open: true })}
        >
          <Plus size={14} />
          Create Epic
        </button>

        {/* 뷰 모드 토글 */}
        <div className="EpicTimeline__ViewModes">
          {VIEW_MODES.map((mode) => (
            <button
              key={mode.key}
              className={`EpicTimeline__ViewBtn ${viewMode === mode.key ? 'EpicTimeline__ViewBtn--active' : ''}`}
              onClick={() => setViewMode(mode.key)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {epics.length === 0 ? (
        <div className="EpicTimeline__Empty">
          No epics yet. Create one to start planning.
        </div>
      ) : (
        <div className="EpicTimeline__Container">
          {/* 월 헤더 */}
          <div className="EpicTimeline__Header">
            <div className="EpicTimeline__NameCol" />
            <div className="EpicTimeline__TimelineCol">
              {headerLabels.map((m, i) => (
                <div
                  key={i}
                  className="EpicTimeline__Month"
                  style={{ left: `${(m.offset / totalDays) * 100}%` }}
                >
                  {m.label}
                </div>
              ))}
            </div>
          </div>

          {/* 에픽 행 */}
          <div className="EpicTimeline__Body">
            {/* Sprint 구간 배경 */}
            <div className="EpicTimeline__SprintBg">
              {sprints
                .filter((s) => s.start_date && s.end_date)
                .map((s) => {
                  const left = getPosition(s.start_date);
                  const right = getPosition(s.end_date);
                  if (left == null || right == null) return null;
                  return (
                    <div
                      key={s.sprint_id}
                      className="EpicTimeline__SprintRange"
                      style={{ left: `${left}%`, width: `${right - left}%` }}
                      title={s.sprint_name}
                    />
                  );
                })}
            </div>

            {/* 오늘 마커 */}
            {todayPos != null && (
              <div className="EpicTimeline__Today" style={{ left: `calc(200px + ${todayPos}%)` }}>
                <div className="EpicTimeline__TodayLine" />
              </div>
            )}

            {epics.map((epic) => (
              <EpicBar
                key={epic.epic_id}
                epic={epic}
                getPosition={getPosition}
                onClick={() => onSelectEpic(epic)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Epic 생성 모달 (생성 전용) */}
      {epicModal.open && (
        <EpicModal
          branchId={branchId}
          epic={null}
          onClose={() => setEpicModal({ open: false })}
        />
      )}
    </div>
  );
}
