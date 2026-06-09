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

function SortableBranchItem({ branch, isActive, onHide }) {
  const router = useRouter();
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: branch.branch_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className={`Sidebar__BranchRow ${isActive ? 'Sidebar__BranchRow--active' : ''}`}>
      <button
        className={`Sidebar__BranchItem ${isActive ? 'Sidebar__BranchItem--active' : ''}`}
        onClick={() => router.push(`/branch/${branch.branch_id}`)}
        {...attributes}
        {...listeners}
      >
        <EntityIcon
          icon={branch.icon}
          color={branch.color}
          size={14}
          entityType="branch"
        />
        <span className="Sidebar__BranchName">{branch.branch_name}</span>
      </button>
      <div className="Sidebar__BranchActions">
        <SidebarItemActions onHide={() => onHide(branch.branch_id)} />
      </div>
    </div>
  );
}

export default function SidebarBranches({ onCreateBranch, savedOrder, onOrderChange, hidden = [], onHide, onUnhide }) {
  const router = useRouter();
  const [branches, setBranches] = useState([]);
  const [activeItem, setActiveItem] = useState(null);
  const [showHidden, setShowHidden] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const fetchBranches = async () => {
    try {
      const res = await axios.get('/branches');
      if (res.data.status) {
        setBranches(res.data.branches);
      }
    } catch {}
  };

  useEffect(() => {
    fetchBranches();
  }, []);

  // CreateBranch 모달에서 생성 후 목록 갱신
  useEffect(() => {
    const handleRefresh = () => fetchBranches();
    window.addEventListener('branch:created', handleRefresh);
    return () => window.removeEventListener('branch:created', handleRefresh);
  }, []);

  // 저장된 순서에 따라 정렬
  const sortedBranches = useMemo(() => {
    if (!savedOrder || savedOrder.length === 0) return branches;
    const orderMap = {};
    savedOrder.forEach((id, idx) => { orderMap[id] = idx; });
    return [...branches].sort((a, b) => {
      const aIdx = orderMap[a.branch_id] ?? 9999;
      const bIdx = orderMap[b.branch_id] ?? 9999;
      return aIdx - bIdx;
    });
  }, [branches, savedOrder]);

  // 숨김 분리: 보이는 것만 정렬 대상, 숨긴 것은 토글 섹션으로
  const hiddenSet = useMemo(() => new Set(hidden || []), [hidden]);
  const visibleBranches = useMemo(() => sortedBranches.filter((b) => !hiddenSet.has(b.branch_id)), [sortedBranches, hiddenSet]);
  const hiddenBranches = useMemo(() => sortedBranches.filter((b) => hiddenSet.has(b.branch_id)), [sortedBranches, hiddenSet]);

  const sortableIds = visibleBranches.map((b) => b.branch_id);

  const handleDragStart = (event) => {
    const item = visibleBranches.find((b) => b.branch_id === event.active.id);
    setActiveItem(item || null);
  };

  const handleDragEnd = (event) => {
    setActiveItem(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = visibleBranches.findIndex((b) => b.branch_id === active.id);
    const newIndex = visibleBranches.findIndex((b) => b.branch_id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(visibleBranches, oldIndex, newIndex);
    const newOrder = reordered.map((b) => b.branch_id);
    onOrderChange(newOrder);
  };

  return (
    <>
      <div className="Sidebar__SectionHeader">
        <span className="Sidebar__SectionLabel">Branches</span>
        <button className="Sidebar__SectionAddBtn" onClick={onCreateBranch} title="Create Branch">
          <Plus size={14} />
        </button>
      </div>

      <div className="Sidebar__Branches">
        {sortedBranches.length === 0 ? (
          <div className="Sidebar__Empty">
            No branches yet.<br />Create one to get started.
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
                {visibleBranches.map((branch) => (
                  <SortableBranchItem
                    key={branch.branch_id}
                    branch={branch}
                    isActive={router.query.id == branch.branch_id}
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
                      entityType="branch"
                    />
                    <span className="Sidebar__BranchName">{activeItem.branch_name}</span>
                  </div>
                )}
              </DragOverlay>
            </DndContext>

            {hiddenBranches.length > 0 && (
              <>
                <button className="Sidebar__HiddenToggle" onClick={() => setShowHidden((s) => !s)}>
                  {showHidden ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  숨긴 항목 {hiddenBranches.length}
                </button>
                {showHidden && hiddenBranches.map((branch) => (
                  <div key={branch.branch_id} className="Sidebar__BranchRow Sidebar__BranchRow--hidden">
                    <button className="Sidebar__BranchItem" onClick={() => router.push(`/branch/${branch.branch_id}`)}>
                      <EntityIcon icon={branch.icon} color={branch.color} size={14} entityType="branch" />
                      <span className="Sidebar__BranchName">{branch.branch_name}</span>
                    </button>
                    <button className="Sidebar__UnhideBtn" onClick={() => onUnhide(branch.branch_id)}>숨김 해제</button>
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
