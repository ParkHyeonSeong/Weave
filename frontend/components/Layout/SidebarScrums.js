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
import EntityIcon from '@/components/common/EntityIcon';

function SortableBoardItem({ board, isActive }) {  // isActive는 boolean (caller가 계산)
  const router = useRouter();
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: board.board_id });

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
      onClick={() => router.push(`/scrum/${board.board_id}`)}
    >
      <span className="Sidebar__DragHandle" {...attributes} {...listeners}>
        <GripVertical size={12} />
      </span>
      <EntityIcon
        icon={board.icon}
        color={board.color}
        size={14}
        entityType="track"
      />
      <span className="Sidebar__BranchName">{board.name}</span>
    </button>
  );
}

export default function SidebarScrums({ onCreateScrum, savedOrder, onOrderChange }) {
  const router = useRouter();
  const [boards, setBoards] = useState([]);
  const [activeItem, setActiveItem] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const fetchBoards = async () => {
    try {
      const res = await axios.get('/scrum');
      if (res.data.status) setBoards(res.data.boards);
    } catch {}
  };

  useEffect(() => {
    fetchBoards();
  }, []);

  // CreateScrumBoard 모달 / 다른 곳에서 변경 시 갱신
  useEffect(() => {
    const handler = () => fetchBoards();
    window.addEventListener('scrum:created', handler);
    window.addEventListener('scrum:updated', handler);
    return () => {
      window.removeEventListener('scrum:created', handler);
      window.removeEventListener('scrum:updated', handler);
    };
  }, []);

  // 저장된 순서에 따라 정렬
  const sortedBoards = useMemo(() => {
    if (!savedOrder || savedOrder.length === 0) return boards;
    const orderMap = {};
    savedOrder.forEach((id, idx) => { orderMap[id] = idx; });
    return [...boards].sort((a, b) => {
      const aIdx = orderMap[a.board_id] ?? 9999;
      const bIdx = orderMap[b.board_id] ?? 9999;
      return aIdx - bIdx;
    });
  }, [boards, savedOrder]);

  const sortableIds = sortedBoards.map((b) => b.board_id);

  const handleDragStart = (event) => {
    const item = sortedBoards.find((b) => b.board_id === event.active.id);
    setActiveItem(item || null);
  };

  const handleDragEnd = (event) => {
    setActiveItem(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sortedBoards.findIndex((b) => b.board_id === active.id);
    const newIndex = sortedBoards.findIndex((b) => b.board_id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(sortedBoards, oldIndex, newIndex);
    onOrderChange(reordered.map((b) => b.board_id));
  };

  return (
    <>
      <div className="Sidebar__SectionHeader">
        <span className="Sidebar__SectionLabel">Scrum</span>
        {onCreateScrum && (
          <button className="Sidebar__SectionAddBtn" onClick={onCreateScrum} title="Create Scrum">
            <Plus size={14} />
          </button>
        )}
      </div>

      <div className="Sidebar__Branches">
        {sortedBoards.length === 0 ? (
          <div className="Sidebar__Empty">
            No boards yet.<br />Create one to get started.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              {sortedBoards.map((board) => (
                <SortableBoardItem
                  key={board.board_id}
                  board={board}
                  // /scrum/[boardId] 페이지일 때만 active. router.query.boardId는 string이라
                  // loose 비교(SidebarBranches와 동일 컨벤션)로 number/string 모두 매치.
                  // eslint-disable-next-line eqeqeq
                  isActive={router.pathname.startsWith('/scrum/') && router.query.boardId == board.board_id}
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
                  <span className="Sidebar__BranchName">{activeItem.name}</span>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </>
  );
}
