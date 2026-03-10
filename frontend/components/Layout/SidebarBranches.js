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

function SortableBranchItem({ branch, isActive }) {
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
    <button
      ref={setNodeRef}
      style={style}
      className={`Sidebar__BranchItem ${isActive ? 'Sidebar__BranchItem--active' : ''}`}
      onClick={() => router.push(`/branch/${branch.branch_id}`)}
    >
      <span className="Sidebar__DragHandle" {...attributes} {...listeners}>
        <GripVertical size={12} />
      </span>
      <span
        className="Sidebar__BranchDot"
        style={{ backgroundColor: branch.color || '#5E6AD2' }}
      />
      <span className="Sidebar__BranchName">{branch.branch_name}</span>
    </button>
  );
}

export default function SidebarBranches({ onCreateBranch, savedOrder, onOrderChange }) {
  const router = useRouter();
  const [branches, setBranches] = useState([]);
  const [activeItem, setActiveItem] = useState(null);

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

  const sortableIds = sortedBranches.map((b) => b.branch_id);

  const handleDragStart = (event) => {
    const item = sortedBranches.find((b) => b.branch_id === event.active.id);
    setActiveItem(item || null);
  };

  const handleDragEnd = (event) => {
    setActiveItem(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = sortedBranches.findIndex((b) => b.branch_id === active.id);
    const newIndex = sortedBranches.findIndex((b) => b.branch_id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(sortedBranches, oldIndex, newIndex);
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
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              {sortedBranches.map((branch) => (
                <SortableBranchItem
                  key={branch.branch_id}
                  branch={branch}
                  isActive={router.query.id == branch.branch_id}
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
                  <span className="Sidebar__BranchName">{activeItem.branch_name}</span>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </>
  );
}
