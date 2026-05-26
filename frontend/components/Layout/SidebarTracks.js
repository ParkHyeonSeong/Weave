import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Plus, GripVertical } from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { axios } from '@/library/_axios';

function SortableTrackItem({ track, isActive }) {
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
    <button
      ref={setNodeRef}
      style={style}
      className={`Sidebar__BranchItem ${isActive ? 'Sidebar__BranchItem--active' : ''}`}
      onClick={() => router.push(`/tracks/${track.track_id}`)}
    >
      <span className="Sidebar__DragHandle" {...attributes} {...listeners}>
        <GripVertical size={12} />
      </span>
      <span
        className="Sidebar__BranchDot"
        style={{ backgroundColor: track.color || '#5E6AD2' }}
      />
      <span className="Sidebar__BranchName">{track.track_name}</span>
    </button>
  );
}

export default function SidebarTracks({ onCreateTrack, savedOrder, onOrderChange }) {
  const router = useRouter();
  const [tracks, setTracks] = useState([]);
  const [activeItem, setActiveItem] = useState(null);

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

  const sortableIds = sortedTracks.map((t) => t.track_id);

  const handleDragStart = (event) => {
    const item = sortedTracks.find((t) => t.track_id === event.active.id);
    setActiveItem(item || null);
  };

  const handleDragEnd = (event) => {
    setActiveItem(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sortedTracks.findIndex((t) => t.track_id === active.id);
    const newIndex = sortedTracks.findIndex((t) => t.track_id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(sortedTracks, oldIndex, newIndex);
    onOrderChange(reordered.map((t) => t.track_id));
  };

  // 현재 어떤 Track 상세 페이지에 있는지 — /tracks/[id] 패턴 매치
  const activeTrackId = router.pathname.startsWith('/tracks/')
    ? Number(router.query.id)
    : null;

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
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              {sortedTracks.map((track) => (
                <SortableTrackItem
                  key={track.track_id}
                  track={track}
                  isActive={activeTrackId === track.track_id}
                />
              ))}
            </SortableContext>

            <DragOverlay>
              {activeItem && (
                <div className="Sidebar__BranchItem Sidebar__BranchItem--dragging">
                  <span
                    className="Sidebar__BranchDot"
                    style={{ backgroundColor: activeItem.color || '#5E6AD2' }}
                  />
                  <span className="Sidebar__BranchName">{activeItem.track_name}</span>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </>
  );
}
