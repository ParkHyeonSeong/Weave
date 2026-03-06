import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import {
  Plus, ChevronRight, ChevronDown,
  FileText, Folder, FolderOpen, BookOpen, FolderPlus,
} from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { axios } from '@/library/_axios';

export default function SidebarCanvases({ onCreateCanvas }) {
  const router = useRouter();
  const [canvases, setCanvases] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [pages, setPages] = useState([]);
  const [expandedFolders, setExpandedFolders] = useState({});
  const [activeItem, setActiveItem] = useState(null);
  // 인라인 생성: { canvasId, type: 'document'|'folder' }
  const [inlineCreate, setInlineCreate] = useState(null);
  const [inlineTitle, setInlineTitle] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const fetchCanvases = async () => {
    try {
      const res = await axios.get('/wiki/canvases');
      if (res.data.status) setCanvases(res.data.canvases);
    } catch {}
  };

  const fetchPages = useCallback(async (canvasId) => {
    try {
      const res = await axios.get(`/wiki/canvases/${canvasId}/pages`);
      if (res.data.status) setPages(res.data.pages);
    } catch {}
  }, []);

  useEffect(() => { fetchCanvases(); }, []);

  useEffect(() => {
    const handleRefresh = () => fetchCanvases();
    window.addEventListener('canvas:created', handleRefresh);
    return () => window.removeEventListener('canvas:created', handleRefresh);
  }, []);

  useEffect(() => {
    const handlePageChange = () => {
      if (expandedId) fetchPages(expandedId);
    };
    window.addEventListener('canvas:page_created', handlePageChange);
    window.addEventListener('canvas:page_deleted', handlePageChange);
    return () => {
      window.removeEventListener('canvas:page_created', handlePageChange);
      window.removeEventListener('canvas:page_deleted', handlePageChange);
    };
  }, [expandedId, fetchPages]);

  useEffect(() => {
    if (!expandedId) { setPages([]); return; }
    fetchPages(expandedId);
  }, [expandedId, fetchPages]);

  useEffect(() => {
    const { canvasId } = router.query;
    if (canvasId) setExpandedId(Number(canvasId));
  }, [router.query.canvasId]);

  const toggleExpand = (canvasId) => {
    setExpandedId((prev) => (prev === canvasId ? null : canvasId));
  };

  const toggleFolder = (pageId) => {
    setExpandedFolders((prev) => ({ ...prev, [pageId]: !prev[pageId] }));
  };

  const getChildren = (parentId) => {
    return pages
      .filter((p) => p.parent_page_id === parentId && p.type !== 'overview')
      .sort((a, b) => a.position - b.position);
  };

  // DnD
  const handleDragStart = (event) => {
    const item = pages.find((p) => p.page_id === event.active.id);
    setActiveItem(item || null);
  };

  const handleDragEnd = async (event) => {
    setActiveItem(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const draggedPage = pages.find((p) => p.page_id === active.id);
    const overPage = pages.find((p) => p.page_id === over.id);
    if (!draggedPage || !overPage) return;
    if (draggedPage.type === 'overview') return;

    const targetParent = overPage.type === 'folder'
      ? overPage.page_id
      : overPage.parent_page_id;
    const siblings = getChildren(targetParent);
    const overIndex = siblings.findIndex((s) => s.page_id === over.id);
    const newPosition = overIndex >= 0 ? overIndex : siblings.length;

    try {
      await axios.patch(
        `/wiki/canvases/${expandedId}/pages/${active.id}/move`,
        { parent_page_id: targetParent, position: newPosition },
      );
      fetchPages(expandedId);
    } catch {}
  };

  // 인라인 생성 핸들러
  const handleInlineCreate = async () => {
    if (!inlineTitle.trim() || !inlineCreate) return;
    try {
      const res = await axios.post(`/wiki/canvases/${inlineCreate.canvasId}/pages`, {
        title: inlineTitle.trim(),
        type: inlineCreate.type,
      });
      if (res.data.status) {
        setInlineTitle('');
        setInlineCreate(null);
        fetchPages(inlineCreate.canvasId);
        window.dispatchEvent(new CustomEvent('canvas:page_created'));
        if (inlineCreate.type === 'document') {
          router.push(`/wiki/${inlineCreate.canvasId}/${res.data.page_id}`);
        }
      }
    } catch {}
  };

  const handleInlineKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') handleInlineCreate();
    if (e.key === 'Escape') { setInlineCreate(null); setInlineTitle(''); }
  };

  const overviewPage = pages.find((p) => p.type === 'overview');
  const rootChildren = getChildren(null);
  const sortableIds = pages
    .filter((p) => p.type !== 'overview')
    .map((p) => p.page_id);

  return (
    <>
      <div className="Sidebar__SectionHeader">
        <span className="Sidebar__SectionLabel">Canvases</span>
        <button className="Sidebar__SectionAddBtn" onClick={onCreateCanvas} title="Create Canvas">
          <Plus size={14} />
        </button>
      </div>

      <div className="Sidebar__Branches">
        {canvases.length === 0 ? (
          <div className="Sidebar__Empty">
            No canvases yet.<br />Create one to get started.
          </div>
        ) : (
          canvases.map((canvas) => (
            <div key={canvas.canvas_id}>
              <CanvasRow
                canvas={canvas}
                isActive={router.query.canvasId == canvas.canvas_id && !router.query.pageId}
                isExpanded={expandedId === canvas.canvas_id}
                onToggle={() => {
                  toggleExpand(canvas.canvas_id);
                  router.push(`/wiki/${canvas.canvas_id}`);
                }}
                onAddDocument={() => {
                  setExpandedId(canvas.canvas_id);
                  setInlineCreate({ canvasId: canvas.canvas_id, type: 'document' });
                  setInlineTitle('');
                }}
                onAddFolder={() => {
                  setExpandedId(canvas.canvas_id);
                  setInlineCreate({ canvasId: canvas.canvas_id, type: 'folder' });
                  setInlineTitle('');
                }}
              />

              {expandedId === canvas.canvas_id && (
                <div className="Sidebar__PageList">
                  {overviewPage && (
                    <button
                      className={`Sidebar__PageItem ${
                        router.query.pageId == overviewPage.page_id ? 'Sidebar__PageItem--active' : ''
                      }`}
                      onClick={() => router.push(`/wiki/${canvas.canvas_id}/${overviewPage.page_id}`)}
                    >
                      <BookOpen size={13} className="Sidebar__PageIcon" />
                      <span className="Sidebar__BranchName">Overview</span>
                    </button>
                  )}

                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                      {rootChildren.map((page) => (
                        <SidebarPageItem
                          key={page.page_id}
                          page={page}
                          canvasId={canvas.canvas_id}
                          depth={0}
                          expandedFolders={expandedFolders}
                          toggleFolder={toggleFolder}
                          getChildren={getChildren}
                          router={router}
                        />
                      ))}
                    </SortableContext>

                    <DragOverlay>
                      {activeItem && (
                        <div className="Sidebar__PageItem Sidebar__PageItem--dragging">
                          {activeItem.type === 'folder'
                            ? <Folder size={13} className="Sidebar__PageIcon" />
                            : <FileText size={13} className="Sidebar__PageIcon" />}
                          <span className="Sidebar__BranchName">{activeItem.title}</span>
                        </div>
                      )}
                    </DragOverlay>
                  </DndContext>

                  {/* 인라인 생성 입력 */}
                  {inlineCreate && inlineCreate.canvasId === canvas.canvas_id && (
                    <div className="Sidebar__PageItem Sidebar__PageItem--input">
                      {inlineCreate.type === 'folder'
                        ? <Folder size={13} className="Sidebar__PageIcon" />
                        : <FileText size={13} className="Sidebar__PageIcon" />}
                      <input
                        autoFocus
                        className="Sidebar__InlineInput"
                        value={inlineTitle}
                        onChange={(e) => setInlineTitle(e.target.value)}
                        onKeyDown={handleInlineKeyDown}
                        onBlur={() => { if (!inlineTitle.trim()) { setInlineCreate(null); setInlineTitle(''); } }}
                        placeholder={inlineCreate.type === 'folder' ? 'Folder name...' : 'Document title...'}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </>
  );
}

// 캔버스 제목 row + 호버 시 + 버튼 (드롭다운)
function CanvasRow({ canvas, isActive, isExpanded, onToggle, onAddDocument, onAddFolder }) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);

  // 외부 클릭 시 메뉴 닫기
  useEffect(() => {
    if (!showMenu) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMenu]);

  return (
    <div className={`Sidebar__BranchRow ${isActive ? 'Sidebar__BranchRow--active' : ''}`}>
      <button
        className={`Sidebar__BranchItem ${isActive ? 'Sidebar__BranchItem--active' : ''}`}
        onClick={onToggle}
      >
        <span className="Sidebar__ExpandIcon">
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span
          className="Sidebar__BranchDot"
          style={{ backgroundColor: canvas.color || '#16A34A' }}
        />
        <span className="Sidebar__BranchName">{canvas.canvas_name}</span>
      </button>

      <div className="Sidebar__BranchActions" ref={menuRef}>
        <button
          className="Sidebar__BranchAddBtn"
          onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
          title="Add page"
        >
          <Plus size={13} />
        </button>

        {showMenu && (
          <div className="Sidebar__AddMenu">
            <button className="Sidebar__AddMenuItem" onClick={() => { setShowMenu(false); onAddDocument(); }}>
              <FileText size={13} />
              Document
            </button>
            <button className="Sidebar__AddMenuItem" onClick={() => { setShowMenu(false); onAddFolder(); }}>
              <FolderPlus size={13} />
              Folder
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SidebarPageItem({ page, canvasId, depth, expandedFolders, toggleFolder, getChildren, router }) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: page.page_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    paddingLeft: `${40 + depth * 14}px`,
  };

  const isFolder = page.type === 'folder';
  const isExpanded = expandedFolders[page.page_id];
  const children = isFolder ? getChildren(page.page_id) : [];

  return (
    <>
      <button
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className={`Sidebar__PageItem ${
          router.query.pageId == page.page_id ? 'Sidebar__PageItem--active' : ''
        }`}
        onClick={() => {
          if (isFolder) {
            toggleFolder(page.page_id);
          } else {
            router.push(`/wiki/${canvasId}/${page.page_id}`);
          }
        }}
      >
        {isFolder ? (
          <>
            <span className="Sidebar__ExpandIcon">
              {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </span>
            {isExpanded
              ? <FolderOpen size={13} className="Sidebar__PageIcon" />
              : <Folder size={13} className="Sidebar__PageIcon" />}
          </>
        ) : (
          <FileText size={13} className="Sidebar__PageIcon" />
        )}
        <span className="Sidebar__BranchName">{page.title}</span>
      </button>

      {isFolder && isExpanded && children.map((child) => (
        <SidebarPageItem
          key={child.page_id}
          page={child}
          canvasId={canvasId}
          depth={depth + 1}
          expandedFolders={expandedFolders}
          toggleFolder={toggleFolder}
          getChildren={getChildren}
          router={router}
        />
      ))}
    </>
  );
}
