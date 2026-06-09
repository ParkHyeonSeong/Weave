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

function SortableBoardItem({ board, isActive, onHide }) {  // isActive는 boolean (caller가 계산)
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
    <div ref={setNodeRef} style={style} className={`Sidebar__BranchRow ${isActive ? 'Sidebar__BranchRow--active' : ''}`}>
      <button
        className={`Sidebar__BranchItem ${isActive ? 'Sidebar__BranchItem--active' : ''}`}
        onClick={() => router.push(`/scrum/${board.board_id}`)}
        {...attributes}
        {...listeners}
      >
        <EntityIcon
          icon={board.icon}
          color={board.color}
          size={14}
          entityType="track"
        />
        <span className="Sidebar__BranchName">{board.name}</span>
      </button>
      <div className="Sidebar__BranchActions">
        <SidebarItemActions onHide={() => onHide(board.board_id)} />
      </div>
    </div>
  );
}

export default function SidebarScrums({ onCreateScrum, savedOrder, onOrderChange, hidden = [], onHide, onUnhide }) {
  const router = useRouter();
  const [boards, setBoards] = useState([]);
  const [activeItem, setActiveItem] = useState(null);
  const [showHidden, setShowHidden] = useState(false);

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

  const hiddenSet = useMemo(() => new Set(hidden || []), [hidden]);
  const visibleBoards = useMemo(() => sortedBoards.filter((b) => !hiddenSet.has(b.board_id)), [sortedBoards, hiddenSet]);
  const hiddenBoards = useMemo(() => sortedBoards.filter((b) => hiddenSet.has(b.board_id)), [sortedBoards, hiddenSet]);

  const sortableIds = visibleBoards.map((b) => b.board_id);

  const handleDragStart = (event) => {
    const item = visibleBoards.find((b) => b.board_id === event.active.id);
    setActiveItem(item || null);
  };

  const handleDragEnd = (event) => {
    setActiveItem(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = visibleBoards.findIndex((b) => b.board_id === active.id);
    const newIndex = visibleBoards.findIndex((b) => b.board_id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(visibleBoards, oldIndex, newIndex);
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
          <>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                {visibleBoards.map((board) => (
                  <SortableBoardItem
                    key={board.board_id}
                    board={board}
                    // /scrum/[boardId] 페이지일 때만 active. router.query.boardId는 string이라
                    // loose 비교(SidebarBranches와 동일 컨벤션)로 number/string 모두 매치.
                    // eslint-disable-next-line eqeqeq
                    isActive={router.pathname.startsWith('/scrum/') && router.query.boardId == board.board_id}
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
                    <span className="Sidebar__BranchName">{activeItem.name}</span>
                  </div>
                )}
              </DragOverlay>
            </DndContext>

            {hiddenBoards.length > 0 && (
              <>
                <button className="Sidebar__HiddenToggle" onClick={() => setShowHidden((s) => !s)}>
                  {showHidden ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  숨긴 항목 {hiddenBoards.length}
                </button>
                {showHidden && hiddenBoards.map((board) => (
                  <div key={board.board_id} className="Sidebar__BranchRow Sidebar__BranchRow--hidden">
                    <button className="Sidebar__BranchItem" onClick={() => router.push(`/scrum/${board.board_id}`)}>
                      <EntityIcon icon={board.icon} color={board.color} size={14} entityType="track" />
                      <span className="Sidebar__BranchName">{board.name}</span>
                    </button>
                    <button className="Sidebar__UnhideBtn" onClick={() => onUnhide(board.board_id)}>숨김 해제</button>
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
