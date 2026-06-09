import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Plus, ChevronRight, ChevronDown } from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { axios } from '@/library/_axios';
import EntityIcon from '@/components/common/EntityIcon';
import SidebarItemActions from './SidebarItemActions';

function SortableTrackItem({ track, isActive, onHide }) {  // isActive는 boolean (caller가 계산)
  const router = useRouter();
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: track.track_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className={`Sidebar__BranchRow ${isActive ? 'Sidebar__BranchRow--active' : ''}`}>
      <button
        className={`Sidebar__BranchItem ${isActive ? 'Sidebar__BranchItem--active' : ''}`}
        onClick={() => router.push(`/tracks/${track.track_id}`)}
        {...attributes}
        {...listeners}
      >
        <EntityIcon
          icon={track.icon}
          color={track.color}
          size={14}
          entityType="track"
        />
        <span className="Sidebar__BranchName">{track.track_name}</span>
      </button>
      <div className="Sidebar__BranchActions">
        <SidebarItemActions onHide={() => onHide(track.track_id)} />
      </div>
    </div>
  );
}

export default function SidebarTracks({ onCreateTrack, savedOrder, onOrderChange, hidden = [], onHide, onUnhide }) {
  const router = useRouter();
  const [tracks, setTracks] = useState([]);
  const [activeItem, setActiveItem] = useState(null);
  const [showHidden, setShowHidden] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const fetchTracks = async () => {
    try {
      const res = await axios.get('/tracks');
      if (res.data.status) setTracks(res.data.tracks);
    } catch {}
  };

  useEffect(() => {
    fetchTracks();
  }, []);

  // CreateTrack 모달 / 다른 곳에서 변경 시 갱신
  useEffect(() => {
    const handler = () => fetchTracks();
    window.addEventListener('track:created', handler);
    window.addEventListener('track:updated', handler);
    return () => {
      window.removeEventListener('track:created', handler);
      window.removeEventListener('track:updated', handler);
    };
  }, []);

  // 저장된 순서에 따라 정렬
  const sortedTracks = useMemo(() => {
    if (!savedOrder || savedOrder.length === 0) return tracks;
    const orderMap = {};
    savedOrder.forEach((id, idx) => { orderMap[id] = idx; });
    return [...tracks].sort((a, b) => {
      const aIdx = orderMap[a.track_id] ?? 9999;
      const bIdx = orderMap[b.track_id] ?? 9999;
      return aIdx - bIdx;
    });
  }, [tracks, savedOrder]);

  const hiddenSet = useMemo(() => new Set(hidden || []), [hidden]);
  const visibleTracks = useMemo(() => sortedTracks.filter((t) => !hiddenSet.has(t.track_id)), [sortedTracks, hiddenSet]);
  const hiddenTracks = useMemo(() => sortedTracks.filter((t) => hiddenSet.has(t.track_id)), [sortedTracks, hiddenSet]);

  const sortableIds = visibleTracks.map((t) => t.track_id);

  const handleDragStart = (event) => {
    const item = visibleTracks.find((t) => t.track_id === event.active.id);
    setActiveItem(item || null);
  };

  const handleDragEnd = (event) => {
    setActiveItem(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = visibleTracks.findIndex((t) => t.track_id === active.id);
    const newIndex = visibleTracks.findIndex((t) => t.track_id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(visibleTracks, oldIndex, newIndex);
    onOrderChange(reordered.map((t) => t.track_id));
  };

  return (
    <>
      <div className="Sidebar__SectionHeader">
        <span className="Sidebar__SectionLabel">Tracks</span>
        {onCreateTrack && (
          <button className="Sidebar__SectionAddBtn" onClick={onCreateTrack} title="Create Track">
            <Plus size={14} />
          </button>
        )}
      </div>

      <div className="Sidebar__Branches">
        {sortedTracks.length === 0 ? (
          <div className="Sidebar__Empty">
            No tracks yet.<br />Create one to get started.
          </div>
        ) : (
          <>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                {visibleTracks.map((track) => (
                  <SortableTrackItem
                    key={track.track_id}
                    track={track}
                    // /tracks/[id] 페이지일 때만 active. router.query.id는 string이라
                    // loose 비교(SidebarBranches와 동일 컨벤션)로 number/string 모두 매치.
                    // eslint-disable-next-line eqeqeq
                    isActive={router.pathname.startsWith('/tracks/') && router.query.id == track.track_id}
                    onHide={onHide}
                  />
                ))}
              </SortableContext>

              <DragOverlay>
                {activeItem && (
                  <div className="Sidebar__BranchItem Sidebar__BranchItem--dragging">
                    <EntityIcon
                      icon={activeItem.icon}
                      color={activeItem.color}
                      size={14}
                      entityType="track"
                    />
                    <span className="Sidebar__BranchName">{activeItem.track_name}</span>
                  </div>
                )}
              </DragOverlay>
            </DndContext>

            {hiddenTracks.length > 0 && (
              <>
                <button className="Sidebar__HiddenToggle" onClick={() => setShowHidden((s) => !s)}>
                  {showHidden ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  숨긴 항목 {hiddenTracks.length}
                </button>
                {showHidden && hiddenTracks.map((track) => (
                  <div key={track.track_id} className="Sidebar__BranchRow Sidebar__BranchRow--hidden">
                    <button className="Sidebar__BranchItem" onClick={() => router.push(`/tracks/${track.track_id}`)}>
                      <EntityIcon icon={track.icon} color={track.color} size={14} entityType="track" />
                      <span className="Sidebar__BranchName">{track.track_name}</span>
                    </button>
                    <button className="Sidebar__UnhideBtn" onClick={() => onUnhide(track.track_id)}>숨김 해제</button>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
