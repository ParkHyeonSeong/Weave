import { useState, useEffect, useMemo } from 'react';
import { axios } from '@/library/_axios';
import { Plus } from 'lucide-react';
import EpicBar from './EpicBar';
import EpicModal from '@/components/modal/EpicModal';

export default function EpicTimeline({ branchId }) {
  const [epics, setEpics] = useState([]);
  const [sprints, setSprints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [epicModal, setEpicModal] = useState({ open: false, epic: null });

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

  // 타임라인 범위 계산 (전체 에픽 + 스프린트 기간을 기준으로)
  const { timelineStart, timelineEnd, totalDays, months } = useMemo(() => {
    const allDates = [];

    epics.forEach((e) => {
      if (e.start_date) allDates.push(new Date(e.start_date));
      if (e.due_date) allDates.push(new Date(e.due_date));
    });
    sprints.forEach((s) => {
      if (s.start_date) allDates.push(new Date(s.start_date));
      if (s.end_date) allDates.push(new Date(s.end_date));
    });

    if (allDates.length === 0) {
      // 날짜가 없으면 현재 달 기준 3개월
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 3, 0);
      allDates.push(start, end);
    }

    const minDate = new Date(Math.min(...allDates));
    const maxDate = new Date(Math.max(...allDates));

    // 한달 여유 추가
    const start = new Date(minDate.getFullYear(), minDate.getMonth() - 1, 1);
    const end = new Date(maxDate.getFullYear(), maxDate.getMonth() + 2, 0);

    const total = Math.ceil((end - start) / (1000 * 60 * 60 * 24));

    // 월 레이블 생성
    const monthLabels = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
      const monthStart = new Date(cursor);
      const dayOffset = Math.ceil((monthStart - start) / (1000 * 60 * 60 * 24));
      monthLabels.push({
        label: cursor.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        offset: dayOffset,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return {
      timelineStart: start,
      timelineEnd: end,
      totalDays: total,
      months: monthLabels,
    };
  }, [epics, sprints]);

  // 날짜 -> left% 계산
  const getPosition = (dateStr) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    const days = (date - timelineStart) / (1000 * 60 * 60 * 24);
    return (days / totalDays) * 100;
  };

  // 오늘 마커
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
          onClick={() => setEpicModal({ open: true, epic: null })}
        >
          <Plus size={14} />
          Create Epic
        </button>
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
              {months.map((m, i) => (
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
                onClick={() => setEpicModal({ open: true, epic })}
              />
            ))}
          </div>
        </div>
      )}

      {/* Epic 모달 */}
      {epicModal.open && (
        <EpicModal
          branchId={branchId}
          epic={epicModal.epic}
          onClose={() => setEpicModal({ open: false, epic: null })}
        />
      )}
    </div>
  );
}
