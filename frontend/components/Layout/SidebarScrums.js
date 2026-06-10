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
import useContextMenu from '@/components/common/useContextMenu';
import ContextMenu from '@/components/common/ContextMenu';
import useInlineRename from '@/components/common/useInlineRename';
import { buildSpaceMenu } from './spaceMenu';
import ConfirmModal from '@/components/modal/ConfirmModal';
import { showToast } from '@/components/Layout/Toast';

function SortableBoardItem({ board, isActive, onMenu, rename }) {  // isActive는 boolean (caller가 계산)
  const router = useRouter();
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: board.board_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const editing = rename.editingId === board.board_id;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`Sidebar__BranchRow ${isActive ? 'Sidebar__BranchRow--active' : ''}`}
      onContextMenu={(e) => onMenu(e, board)}
    >
      <button
        className={`Sidebar__BranchItem ${isActive ? 'Sidebar__BranchItem--active' : ''}`}
        onClick={() => { if (!editing) router.push(`/scrum/${board.board_id}`); }}
        {...attributes}
        {...listeners}
      >
        <EntityIcon
          icon={board.icon}
          color={board.color}
          size={14}
          entityType="track"
        />
        {editing
          ? <input className="Sidebar__RenameInput" {...rename.inputProps} />
          : <span className="Sidebar__BranchName">{board.name}</span>}
      </button>
      <div className="Sidebar__BranchActions">
        <SidebarItemActions onMenu={(e) => onMenu(e, board)} />
      </div>
    </div>
  );
}

export default function SidebarScrums({ onCreateScrum, savedOrder, onOrderChange, hidden = [], onHide, onUnhide }) {
  const router = useRouter();
  const [boards, setBoards] = useState([]);
  const [activeItem, setActiveItem] = useState(null);
  const [showHidden, setShowHidden] = useState(false);

  const ctx = useContextMenu();
  const [leaveTarget, setLeaveTarget] = useState(null); // { id, name } | null
  const rename = useInlineRename(async (id, name) => {
    try {
      await axios.patch(`/scrum/${id}`, { name });
      fetchBoards();
      window.dispatchEvent(new Event('scrum:updated'));
    } catch {}
  });

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

  const openMenu = (e, board) => {
    const detailPath = `/scrum/${board.board_id}`;
    ctx.open(e, buildSpaceMenu(
      {
        appType: 'scrum',
        id: board.board_id,
        name: board.name,
        role: board.my_role,
        isHidden: hiddenSet.has(board.board_id),
      },
      {
        open: () => router.push(detailPath),
        openNewTab: () => window.open(detailPath, '_blank'),
        settings: () => router.push(`${detailPath}/settings`),
        rename: () => rename.start(board.board_id, board.name),
        members: () => router.push(`${detailPath}/settings`),
        toggleHide: () => (hiddenSet.has(board.board_id) ? onUnhide(board.board_id) : onHide(board.board_id)),
        archive: async () => {
          try {
            const res = await axios.delete(`/scrum/${board.board_id}`);
            if (res.data.status) {
              window.dispatchEvent(new Event('scrum:updated'));
              fetchBoards();
              // Toast(showToast)는 액션 버튼을 지원하지 않아 undo 없이 성공 알림만 표시.
              showToast(`"${board.name}" 아카이브됨`);
            } else {
              showToast('아카이브 실패', 'error');
            }
          } catch {}
        },
        leave: () => setLeaveTarget({ id: board.board_id, name: board.name }),
      },
    ));
  };

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
                    onMenu={openMenu}
                    rename={rename}
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
                  <div
                    key={board.board_id}
                    className="Sidebar__BranchRow Sidebar__BranchRow--hidden"
                    onContextMenu={(e) => openMenu(e, board)}
                  >
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

      <ContextMenu {...ctx.props} />
      <ConfirmModal
        isOpen={!!leaveTarget}
        onClose={() => setLeaveTarget(null)}
        onConfirm={async () => {
          const t = leaveTarget;
          setLeaveTarget(null);
          try {
            const res = await axios.post(`/scrum/${t.id}/leave`);
            if (res.data.status) {
              window.dispatchEvent(new Event('scrum:updated'));
              fetchBoards();
            } else {
              showToast('나가기 실패', 'error');
            }
          } catch {}
        }}
        title="스크럼 보드 나가기"
        message={`"${leaveTarget?.name}"에서 나가시겠습니까?`}
        confirmLabel="나가기"
        variant="danger"
      />
    </>
  );
}
