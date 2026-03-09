import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { axios } from '@/library/_axios';
import { Plus } from 'lucide-react';
import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import EpicBar from './EpicBar';
import EpicModal from '@/components/modal/EpicModal';

const STATUS_LABELS = { future: 'Future', active: 'Active', closed: 'Closed' };

function formatDateRange(start, end) {
  const fmt = (d) => d ? new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '';
  return `${fmt(start)} – ${fmt(end)}`;
}

// 겹치는 스프린트를 별도 lane에 배치
function assignLanes(sprintBars) {
  const sorted = [...sprintBars].sort((a, b) => a.left - b.left);
  const lanes = [];
  for (const bar of sorted) {
    let placed = false;
    for (let i = 0; i < lanes.length; i++) {
      if (bar.left >= lanes[i]) {
        lanes[i] = bar.left + bar.width;
        bar.lane = i;
        placed = true;
        break;
      }
    }
    if (!placed) {
      bar.lane = lanes.length;
      lanes.push(bar.left + bar.width);
    }
  }
  return lanes.length;
}

const VIEW_MODES = [
  { key: 'week', label: 'Week', pxPerDay: 16 },
  { key: 'month', label: 'Month', pxPerDay: 4 },
  { key: 'quarter', label: 'Quarter', pxPerDay: 1.5 },
];

const DEFAULT_nameColWidth = 400;
const MIN_nameColWidth = 200;
const MAX_nameColWidth = 600;

export default function EpicTimeline({ branchId, onSelectEpic }) {
  const [epics, setEpics] = useState([]);
  const [sprints, setSprints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [epicModal, setEpicModal] = useState({ open: false });
  const [viewMode, setViewMode] = useState('month');
  const [sprintPopover, setSprintPopover] = useState(null);
  const [showDone, setShowDone] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [nameColWidth, setNameColWidth] = useState(DEFAULT_nameColWidth);
  const popoverRef = useRef(null);
  const scrollRef = useRef(null);
  const didScroll = useRef(false);
  const resizeRef = useRef(null);

  // DnD 센서: 5px 이동 후 드래그 시작 (클릭과 구분)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // 컬럼 리사이즈 핸들러
  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = nameColWidth;

    const onMove = (ev) => {
      const newWidth = Math.min(MAX_nameColWidth, Math.max(MIN_nameColWidth, startWidth + ev.clientX - startX));
      setNameColWidth(newWidth);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [nameColWidth]);

  useEffect(() => {
    fetchData();
  }, [branchId]);

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

  const modeConfig = VIEW_MODES.find((m) => m.key === viewMode);
  const pxPerDay = modeConfig?.pxPerDay || 4;

  // 고정 범위: 1년 전 ~ 2년 후
  const { timelineStart, timelineEnd, totalDays, headerLabels } = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const start = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const end = new Date(now.getFullYear() + 2, now.getMonth(), 0);
    const total = Math.ceil((end - start) / (1000 * 60 * 60 * 24));

    // 월 단위 라벨
    const labels = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
      const dayOffset = Math.ceil((new Date(cursor) - start) / (1000 * 60 * 60 * 24));
      const isJan = cursor.getMonth() === 0;
      labels.push({
        label: isJan
          ? cursor.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
          : cursor.toLocaleDateString('en-US', { month: 'short' }),
        offset: dayOffset,
        isYear: isJan,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }

    return { timelineStart: start, timelineEnd: end, totalDays: total, headerLabels: labels };
  }, []);

  const timelineWidth = totalDays * pxPerDay;

  // 날짜 -> px 위치
  const getPosition = useCallback((dateStr) => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    const days = (d - timelineStart) / (1000 * 60 * 60 * 24);
    return days * pxPerDay;
  }, [timelineStart, pxPerDay]);

  // 오늘 위치로 자동 스크롤 (최초 1회)
  useEffect(() => {
    if (loading || didScroll.current || !scrollRef.current) return;
    const todayPx = getPosition(new Date().toISOString());
    if (todayPx != null) {
      const container = scrollRef.current;
      container.scrollLeft = todayPx - container.clientWidth / 3;
      didScroll.current = true;
    }
  }, [loading, getPosition]);

  // viewMode 변경 시 오늘 중심으로 재스크롤
  useEffect(() => {
    if (!scrollRef.current) return;
    const todayPx = getPosition(new Date().toISOString());
    if (todayPx != null) {
      const container = scrollRef.current;
      container.scrollLeft = todayPx - container.clientWidth / 3;
    }
  }, [viewMode, getPosition]);

  // 팝오버 외부 클릭 닫기
  useEffect(() => {
    if (!sprintPopover) return;
    const handleClick = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setSprintPopover(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [sprintPopover]);

  // 스프린트 바 데이터 + lane 계산
  const { sprintBars, laneCount } = useMemo(() => {
    const bars = sprints
      .filter((s) => s.start_date && s.end_date)
      .map((s) => {
        const left = getPosition(s.start_date);
        const right = getPosition(s.end_date);
        if (left == null || right == null) return null;
        return { ...s, left, width: Math.max(right - left, 2), lane: 0 };
      })
      .filter(Boolean);
    const count = assignLanes(bars);
    return { sprintBars: bars, laneCount: count };
  }, [sprints, getPosition]);

  const todayPx = useMemo(() => {
    return getPosition(new Date().toISOString());
  }, [getPosition]);

  // 필터: done 숨기기 (sort_order는 서버에서 이미 적용)
  const filteredEpics = useMemo(() => {
    return showDone ? epics : epics.filter((e) => e.status !== 'done');
  }, [epics, showDone]);

  // 드래그 중인 에픽
  const activeEpic = activeId ? filteredEpics.find((e) => String(e.epic_id) === activeId) : null;

  // 드래그 시작 -> 스크롤 잠금
  const handleDragStart = ({ active }) => {
    setActiveId(active.id);
    if (scrollRef.current) scrollRef.current.style.overflowX = 'hidden';
  };

  // 드래그 완료 -> 스크롤 복원 + 순서 저장
  const handleDragEnd = async (event) => {
    const { active, over } = event;
    setActiveId(null);
    if (scrollRef.current) scrollRef.current.style.overflowX = 'auto';
    if (!over || active.id === over.id) return;

    const oldIndex = filteredEpics.findIndex((e) => String(e.epic_id) === active.id);
    const newIndex = filteredEpics.findIndex((e) => String(e.epic_id) === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // 낙관적 업데이트
    const reordered = arrayMove(filteredEpics, oldIndex, newIndex);
    setEpics(showDone ? reordered : reordered.concat(epics.filter((e) => e.status === 'done')));

    try {
      await axios.post(`/branches/${branchId}/epics/reorder`, {
        epic_ids: reordered.map((e) => e.epic_id),
      });
    } catch {
      fetchData(); // 실패 시 원복
    }
  };

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

        <label className="EpicTimeline__ShowDone">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          Show Done
        </label>

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

      {filteredEpics.length === 0 ? (
        <div className="EpicTimeline__Empty">
          No epics yet. Create one to start planning.
        </div>
      ) : (
        <div className="EpicTimeline__Container">
          {/* 스크롤 가능 영역 */}
          <div className="EpicTimeline__ScrollWrap" ref={scrollRef}>
            <div className="EpicTimeline__Inner" style={{ width: nameColWidth + timelineWidth }}>

              {/* 월 헤더 */}
              <div className="EpicTimeline__Header">
                <div className="EpicTimeline__NameCol" style={{ width: nameColWidth, minWidth: nameColWidth }}>
                  <div className="EpicTimeline__ResizeHandle" onMouseDown={handleResizeStart} />
                </div>
                <div className="EpicTimeline__TimelineCol" style={{ width: timelineWidth }}>
                  {headerLabels.map((m, i) => (
                    <div
                      key={i}
                      className={`EpicTimeline__Month ${m.isYear ? 'EpicTimeline__Month--year' : ''}`}
                      style={{ left: m.offset * pxPerDay }}
                    >
                      {m.label}
                    </div>
                  ))}
                </div>
              </div>

              {/* 스프린트 라벨 행 */}
              {sprintBars.length > 0 && (
                <div className="EpicTimeline__SprintRow">
                  <div className="EpicTimeline__NameCol" style={{ width: nameColWidth, minWidth: nameColWidth }}>
                    <span className="EpicTimeline__SprintRowLabel">Sprints</span>
                  </div>
                  <div
                    className="EpicTimeline__SprintRowTimeline"
                    style={{ width: timelineWidth, height: laneCount * 24 + 8 }}
                  >
                    {sprintBars.map((s) => {
                      const statusClass = s.status === 'active' ? 'EpicTimeline__SprintLabel--active'
                        : s.status === 'closed' ? 'EpicTimeline__SprintLabel--closed' : '';
                      const isOpen = sprintPopover === s.sprint_id;
                      return (
                        <div
                          key={s.sprint_id}
                          className={`EpicTimeline__SprintLabel ${statusClass}`}
                          style={{
                            left: s.left,
                            width: s.width,
                            top: s.lane * 24 + 4,
                          }}
                          onClick={() => setSprintPopover(isOpen ? null : s.sprint_id)}
                        >
                          <span className="EpicTimeline__SprintLabelText">{s.sprint_name}</span>
                          <span className="EpicTimeline__SprintTooltip">
                            {s.sprint_name}
                            <br />
                            {formatDateRange(s.start_date, s.end_date)}
                          </span>
                          {isOpen && (
                            <div className="EpicTimeline__SprintPopover" ref={popoverRef} onClick={(e) => e.stopPropagation()}>
                              <div className="EpicTimeline__SprintPopoverName">{s.sprint_name}</div>
                              <div className="EpicTimeline__SprintPopoverMeta">
                                <span className={`EpicTimeline__SprintPopoverStatus EpicTimeline__SprintPopoverStatus--${s.status}`}>
                                  {STATUS_LABELS[s.status] || s.status}
                                </span>
                                <span className="EpicTimeline__SprintPopoverDate">
                                  {formatDateRange(s.start_date, s.end_date)}
                                </span>
                              </div>
                              {s.goal && (
                                <div className="EpicTimeline__SprintPopoverGoal">{s.goal}</div>
                              )}
                              <div className="EpicTimeline__SprintPopoverTasks">
                                {s.task_count != null ? `${s.task_count} tasks` : ''}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 에픽 행 */}
              <div className="EpicTimeline__Body">
                {/* Sprint 구간 배경 */}
                <div className="EpicTimeline__SprintBg" style={{ left: nameColWidth, width: timelineWidth }}>
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
                          style={{ left, width: right - left }}
                        />
                      );
                    })}
                </div>

                {/* 오늘 마커 */}
                {todayPx != null && (
                  <div className="EpicTimeline__Today" style={{ left: nameColWidth + todayPx }}>
                    <div className="EpicTimeline__TodayLine" />
                  </div>
                )}

                {/* DnD 영역 */}
                <DndContext
                  sensors={sensors}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragCancel={() => {
                    setActiveId(null);
                    if (scrollRef.current) scrollRef.current.style.overflowX = 'auto';
                  }}
                >
                  <SortableContext
                    items={filteredEpics.map((e) => String(e.epic_id))}
                    strategy={verticalListSortingStrategy}
                  >
                    {filteredEpics.map((epic) => (
                      <EpicBar
                        key={epic.epic_id}
                        epic={epic}
                        getPosition={getPosition}
                        timelineWidth={timelineWidth}
                        nameColWidth={nameColWidth}
                        onClick={() => onSelectEpic(epic)}
                      />
                    ))}
                  </SortableContext>
                  <DragOverlay dropAnimation={null}>
                    {activeEpic && (
                      <EpicBar
                        epic={activeEpic}
                        getPosition={getPosition}
                        timelineWidth={timelineWidth}
                        nameColWidth={nameColWidth}
                        isOverlay
                      />
                    )}
                  </DragOverlay>
                </DndContext>
              </div>
            </div>
          </div>
        </div>
      )}

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
