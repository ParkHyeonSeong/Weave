import { useState, useEffect, useMemo, useCallback } from 'react';
import { axios } from '@/library/_axios';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import ScheduleEventModal from './ScheduleEventModal';

const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// 월의 캘린더 그리드 생성 (6주 x 7일)
function buildCalendarGrid(year, month) {
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay(); // 0=Sun
  const gridStart = new Date(year, month, 1 - startOffset);

  const weeks = [];
  const cursor = new Date(gridStart);
  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

// 날짜를 YYYY-MM-DD 문자열로
function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// 두 날짜가 같은 날인지
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

// 스프린트 바를 주 단위로 분할
function buildSprintSegments(sprints, weeks) {
  const segments = [];

  sprints.forEach((sprint) => {
    if (!sprint.start_date || !sprint.end_date) return;

    const sStart = new Date(sprint.start_date);
    const sEnd = new Date(sprint.end_date);

    weeks.forEach((week, weekIdx) => {
      const weekStart = week[0];
      const weekEnd = week[6];

      // 이 주와 스프린트가 겹치는지
      if (sStart > weekEnd || sEnd < weekStart) return;

      const segStart = sStart < weekStart ? weekStart : sStart;
      const segEnd = sEnd > weekEnd ? weekEnd : sEnd;

      const colStart = segStart.getDay();
      const colEnd = segEnd.getDay();

      segments.push({
        sprint,
        weekIdx,
        colStart,
        colEnd,
        continuedLeft: sStart < weekStart,
        continuedRight: sEnd > weekEnd,
      });
    });
  });

  return segments;
}

// 겹치는 세그먼트를 lane에 배치
function assignLanes(segments) {
  // 주별로 그룹핑
  const byWeek = {};
  segments.forEach((seg) => {
    if (!byWeek[seg.weekIdx]) byWeek[seg.weekIdx] = [];
    byWeek[seg.weekIdx].push(seg);
  });

  const laneCountByWeek = {};

  Object.keys(byWeek).forEach((weekIdx) => {
    const segs = byWeek[weekIdx].sort((a, b) => a.colStart - b.colStart);
    const lanes = []; // lanes[i] = 해당 lane이 차지하는 마지막 colEnd

    segs.forEach((seg) => {
      let placed = false;
      for (let i = 0; i < lanes.length; i++) {
        if (seg.colStart > lanes[i]) {
          lanes[i] = seg.colEnd;
          seg.lane = i;
          placed = true;
          break;
        }
      }
      if (!placed) {
        seg.lane = lanes.length;
        lanes.push(seg.colEnd);
      }
    });

    laneCountByWeek[weekIdx] = lanes.length;
  });

  return laneCountByWeek;
}

// 이벤트를 날짜별로 그룹핑
function groupEventsByDate(events) {
  const map = {};
  events.forEach((evt) => {
    const start = evt.start_date;
    const end = evt.end_date || evt.start_date;
    // 멀티데이 이벤트: 각 날짜에 표시
    const cursor = new Date(start);
    const endDate = new Date(end);
    while (cursor <= endDate) {
      const key = toDateStr(cursor);
      if (!map[key]) map[key] = [];
      map[key].push(evt);
      cursor.setDate(cursor.getDate() + 1);
    }
  });
  return map;
}

const MAX_VISIBLE_EVENTS = 3;

export default function BranchSchedule({ branchId }) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [events, setEvents] = useState([]);
  const [sprints, setSprints] = useState([]);
  const [eventModal, setEventModal] = useState({ open: false, event: null, defaultDate: '' });

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const today = new Date();

  // 캘린더 그리드
  const weeks = useMemo(() => buildCalendarGrid(year, month), [year, month]);

  // 데이터 범위 (그리드 시작~끝)
  const rangeStart = useMemo(() => toDateStr(weeks[0][0]), [weeks]);
  const rangeEnd = useMemo(() => toDateStr(weeks[5][6]), [weeks]);

  // 데이터 페칭
  const fetchData = useCallback(async () => {
    try {
      const [sprintRes, eventRes] = await Promise.all([
        axios.get(`/branches/${branchId}/sprints`),
        axios.get(`/branches/${branchId}/schedule-events?range_start=${rangeStart}&range_end=${rangeEnd}`),
      ]);
      if (sprintRes.data.status) setSprints(sprintRes.data.sprints);
      if (eventRes.data.status) setEvents(eventRes.data.events);
    } catch {}
  }, [branchId, rangeStart, rangeEnd]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // schedule:updated 이벤트 수신
  useEffect(() => {
    const handler = () => fetchData();
    window.addEventListener('schedule:updated', handler);
    return () => window.removeEventListener('schedule:updated', handler);
  }, [fetchData]);

  // 스프린트 세그먼트 계산
  const sprintSegments = useMemo(() => buildSprintSegments(sprints, weeks), [sprints, weeks]);
  const laneCountByWeek = useMemo(() => assignLanes(sprintSegments), [sprintSegments]);

  // 이벤트를 날짜별 그룹핑
  const eventsByDate = useMemo(() => groupEventsByDate(events), [events]);

  // 월 이동
  const goToPrev = () => setCurrentMonth(new Date(year, month - 1, 1));
  const goToNext = () => setCurrentMonth(new Date(year, month + 1, 1));
  const goToToday = () => {
    const now = new Date();
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  // 월 라벨
  const monthLabel = currentMonth.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });

  // 셀 클릭 -> 일정 생성
  const handleCellClick = (date) => {
    setEventModal({ open: true, event: null, defaultDate: toDateStr(date) });
  };

  // 이벤트 pill 클릭 -> 편집
  const handleEventClick = (e, evt) => {
    e.stopPropagation();
    setEventModal({ open: true, event: evt, defaultDate: '' });
  };

  return (
    <div className="BranchSchedule">
      {/* 상단 액션 바 */}
      <div className="BranchSchedule__Actions">
        <div className="BranchSchedule__MonthNav">
          <button className="BranchSchedule__NavBtn" onClick={goToPrev}>
            <ChevronLeft size={16} />
          </button>
          <span className="BranchSchedule__MonthLabel">{monthLabel}</span>
          <button className="BranchSchedule__NavBtn" onClick={goToNext}>
            <ChevronRight size={16} />
          </button>
          <button className="BranchSchedule__TodayBtn" onClick={goToToday}>
            Today
          </button>
        </div>
        <div className="BranchSchedule__ActionsRight">
          <button
            className="BranchSchedule__CreateBtn"
            onClick={() => setEventModal({ open: true, event: null, defaultDate: toDateStr(today) })}
          >
            <Plus size={14} />
            Add Event
          </button>
        </div>
      </div>

      {/* 캘린더 */}
      <div className="BranchSchedule__Calendar">
        {/* 요일 헤더 */}
        <div className="BranchSchedule__WeekHeader">
          {WEEK_DAYS.map((day, i) => (
            <div
              key={day}
              className={`BranchSchedule__WeekDay ${i === 0 || i === 6 ? 'BranchSchedule__WeekDay--weekend' : ''}`}
            >
              {day}
            </div>
          ))}
        </div>

        {/* 그리드 본체 */}
        <div className="BranchSchedule__Grid">
          {weeks.map((week, weekIdx) => {
            const laneCount = laneCountByWeek[weekIdx] || 0;
            // 스프린트 바 높이만큼 이벤트 영역을 아래로 밀기
            const sprintBarOffset = laneCount * 20 + (laneCount > 0 ? 4 : 0);

            return (
              <div className="BranchSchedule__Row" key={weekIdx}>
                {/* 스프린트 바 오버레이 */}
                {laneCount > 0 && (
                  <div className="BranchSchedule__SprintBars">
                    {sprintSegments
                      .filter((seg) => seg.weekIdx === weekIdx)
                      .map((seg, i) => {
                        const leftPct = (seg.colStart / 7) * 100;
                        const widthPct = ((seg.colEnd - seg.colStart + 1) / 7) * 100;
                        const top = (seg.lane || 0) * 20;

                        const statusClass = `BranchSchedule__SprintBar--${seg.sprint.status || 'future'}`;
                        const contLeftClass = seg.continuedLeft ? 'BranchSchedule__SprintBar--continued-left' : '';
                        const contRightClass = seg.continuedRight ? 'BranchSchedule__SprintBar--continued-right' : '';

                        return (
                          <div
                            key={`${seg.sprint.sprint_id}-${weekIdx}-${i}`}
                            className={`BranchSchedule__SprintBar ${statusClass} ${contLeftClass} ${contRightClass}`}
                            style={{ left: `${leftPct}%`, width: `${widthPct}%`, top: `${top}px` }}
                            title={`${seg.sprint.sprint_name} (${seg.sprint.status})`}
                          >
                            {!seg.continuedLeft && seg.sprint.sprint_name}
                          </div>
                        );
                      })}
                  </div>
                )}

                {/* 날짜 셀 */}
                {week.map((date, dayIdx) => {
                  const isOutside = date.getMonth() !== month;
                  const isToday = isSameDay(date, today);
                  const dateStr = toDateStr(date);
                  const dayEvents = eventsByDate[dateStr] || [];

                  const cellClass = [
                    'BranchSchedule__Cell',
                    isOutside ? 'BranchSchedule__Cell--outside' : '',
                    isToday ? 'BranchSchedule__Cell--today' : '',
                  ].filter(Boolean).join(' ');

                  return (
                    <div
                      key={dayIdx}
                      className={cellClass}
                      onClick={() => handleCellClick(date)}
                    >
                      <div className="BranchSchedule__DateNum" style={{ marginTop: sprintBarOffset > 0 ? sprintBarOffset : undefined }}>
                        {date.getDate()}
                      </div>
                      <div className="BranchSchedule__Events">
                        {dayEvents.slice(0, MAX_VISIBLE_EVENTS).map((evt) => (
                          <div
                            key={evt.schedule_event_id}
                            className="BranchSchedule__EventPill"
                            onClick={(e) => handleEventClick(e, evt)}
                          >
                            <span
                              className="BranchSchedule__EventDot"
                              style={{ backgroundColor: evt.color || '#5E6AD2' }}
                            />
                            <span className="BranchSchedule__EventTitle">{evt.title}</span>
                          </div>
                        ))}
                        {dayEvents.length > MAX_VISIBLE_EVENTS && (
                          <div className="BranchSchedule__MoreEvents">
                            +{dayEvents.length - MAX_VISIBLE_EVENTS} more
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* 일정 모달 */}
      {eventModal.open && (
        <ScheduleEventModal
          branchId={branchId}
          event={eventModal.event}
          defaultDate={eventModal.defaultDate}
          onClose={() => setEventModal({ open: false, event: null, defaultDate: '' })}
        />
      )}
    </div>
  );
}
