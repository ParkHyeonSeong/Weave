import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import {
  Plus, ChevronRight, ChevronDown,
  FileText, FileCode, Folder, FolderOpen, FolderPlus, MoreHorizontal, Settings,
  Trash2, Pencil, Copy, Link, FolderInput,
} from 'lucide-react';
import ConfirmModal from '@/components/modal/ConfirmModal';
import PageMoveModal from '@/components/modal/PageMoveModal';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { axios } from '@/library/_axios';

export default function SidebarCanvases({ onCreateCanvas, savedOrder, onOrderChange }) {
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
      const res = await axios.get('/canvases');
      if (res.data.status) setCanvases(res.data.canvases);
    } catch {}
  };

  const fetchPages = useCallback(async (canvasId) => {
    try {
      const res = await axios.get(`/canvases/${canvasId}/pages`);
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
    window.addEventListener('canvas:page_updated', handlePageChange);
    return () => {
      window.removeEventListener('canvas:page_created', handlePageChange);
      window.removeEventListener('canvas:page_deleted', handlePageChange);
      window.removeEventListener('canvas:page_updated', handlePageChange);
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
        `/canvases/${expandedId}/pages/${active.id}/move`,
        { parent_page_id: targetParent, position: newPosition },
      );
      fetchPages(expandedId);
    } catch {}
  };

  // Document/Typst 즉시 생성 → 편집 모드로 이동
  const handleQuickCreate = async (canvasId, type, parentPageId = null) => {
    try {
      const body = { title: 'Untitled', type };
      if (parentPageId) body.parent_page_id = parentPageId;
      const res = await axios.post(`/canvases/${canvasId}/pages`, body);
      if (res.data.status) {
        setExpandedId(canvasId);
        if (parentPageId) setExpandedFolders((prev) => ({ ...prev, [parentPageId]: true }));
        fetchPages(canvasId);
        window.dispatchEvent(new CustomEvent('canvas:page_created'));
        router.push(`/canvas/${canvasId}/${res.data.page_id}?edit=1`);
      }
    } catch {}
  };

  // 인라인 생성 핸들러 (폴더용)
  const handleInlineCreate = async () => {
    if (!inlineTitle.trim() || !inlineCreate) return;
    try {
      const body = {
        title: inlineTitle.trim(),
        type: inlineCreate.type,
      };
      if (inlineCreate.parentPageId) body.parent_page_id = inlineCreate.parentPageId;
      const res = await axios.post(`/canvases/${inlineCreate.canvasId}/pages`, body);
      if (res.data.status) {
        setInlineTitle('');
        setInlineCreate(null);
        fetchPages(inlineCreate.canvasId);
        window.dispatchEvent(new CustomEvent('canvas:page_created'));
        if (inlineCreate.type === 'document' || inlineCreate.type === 'typst') {
          router.push(`/canvas/${inlineCreate.canvasId}/${res.data.page_id}`);
        }
      }
    } catch {}
  };

  // 폴더 내 아이템 추가
  const startFolderInlineCreate = (canvasId, parentPageId, type) => {
    setExpandedFolders((prev) => ({ ...prev, [parentPageId]: true }));
    setInlineCreate({ canvasId, type, parentPageId });
    setInlineTitle('');
  };

  const handleInlineKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') handleInlineCreate();
    if (e.key === 'Escape') { setInlineCreate(null); setInlineTitle(''); }
  };

  // 페이지 삭제
  const [deleteTarget, setDeleteTarget] = useState(null);

  const requestDeletePage = (canvasId, page) => {
    setDeleteTarget({ canvasId, pageId: page.page_id, title: page.title, isFolder: page.type === 'folder' });
  };

  const executeDeletePage = async () => {
    if (!deleteTarget) return;
    try {
      const res = await axios.delete(`/canvases/${deleteTarget.canvasId}/pages/${deleteTarget.pageId}`);
      if (res.data.status) {
        window.dispatchEvent(new CustomEvent('canvas:page_deleted'));
        if (String(router.query.pageId) === String(deleteTarget.pageId)) {
          const overview = pages.find((p) => p.type === 'overview');
          if (overview) router.push(`/canvas/${deleteTarget.canvasId}/${overview.page_id}`);
          else router.push(`/canvas/${deleteTarget.canvasId}`);
        }
      }
    } catch {}
    setDeleteTarget(null);
  };

  // 이름변경
  const [renamingPage, setRenamingPage] = useState(null); // { canvasId, pageId, title }

  const requestRenamePage = (canvasId, page) => {
    setRenamingPage({ canvasId, pageId: page.page_id, title: page.title });
  };

  const executeRenamePage = async (newTitle) => {
    if (!renamingPage || !newTitle.trim()) { setRenamingPage(null); return; }
    try {
      await axios.patch(`/canvases/${renamingPage.canvasId}/pages/${renamingPage.pageId}`, { title: newTitle.trim() });
      window.dispatchEvent(new CustomEvent('canvas:page_updated'));
      fetchPages(renamingPage.canvasId);
    } catch {}
    setRenamingPage(null);
  };

  // 복제
  const handleCopyPage = async (canvasId, page) => {
    try {
      const res = await axios.post(`/canvases/${canvasId}/pages/${page.page_id}/copy`, {});
      if (res.data.status) {
        window.dispatchEvent(new CustomEvent('canvas:page_created'));
        fetchPages(canvasId);
      }
    } catch {}
  };

  // 링크 복사
  const handleCopyLink = (canvasId, page) => {
    const url = `${window.location.origin}/canvas/${canvasId}/${page.page_id}`;
    navigator.clipboard.writeText(url).catch(() => {});
  };

  // 이동
  const [moveTarget, setMoveTarget] = useState(null); // { canvasId, page }

  const requestMovePage = (canvasId, page) => {
    setMoveTarget({ canvasId, page });
  };

  const executeMovePage = async (targetParentId) => {
    if (!moveTarget) return;
    const { canvasId, page } = moveTarget;
    try {
      const siblings = pages.filter((p) =>
        targetParentId ? p.parent_page_id === targetParentId : !p.parent_page_id
      );
      await axios.patch(`/canvases/${canvasId}/pages/${page.page_id}/move`, {
        parent_page_id: targetParentId,
        position: siblings.length,
      });
      window.dispatchEvent(new CustomEvent('canvas:page_updated'));
      fetchPages(canvasId);
    } catch {}
    setMoveTarget(null);
  };

  // 우클릭 컨텍스트 메뉴
  const [contextMenu, setContextMenu] = useState(null); // { x, y, canvasId, page }

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [contextMenu]);

  // 캔버스 목록 DnD
  const [activeCanvas, setActiveCanvas] = useState(null);
  const canvasSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // 저장된 순서에 따라 캔버스 정렬
  const sortedCanvases = useMemo(() => {
    if (!savedOrder || savedOrder.length === 0) return canvases;
    const orderMap = {};
    savedOrder.forEach((id, idx) => { orderMap[id] = idx; });
    return [...canvases].sort((a, b) => {
      const aIdx = orderMap[a.canvas_id] ?? 9999;
      const bIdx = orderMap[b.canvas_id] ?? 9999;
      return aIdx - bIdx;
    });
  }, [canvases, savedOrder]);

  const canvasSortableIds = sortedCanvases.map((c) => c.canvas_id);

  const handleCanvasDragStart = (event) => {
    const item = sortedCanvases.find((c) => c.canvas_id === event.active.id);
    setActiveCanvas(item || null);
  };

  const handleCanvasDragEnd = (event) => {
    setActiveCanvas(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sortedCanvases.findIndex((c) => c.canvas_id === active.id);
    const newIndex = sortedCanvases.findIndex((c) => c.canvas_id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(sortedCanvases, oldIndex, newIndex);
    const newOrder = reordered.map((c) => c.canvas_id);
    onOrderChange(newOrder);
  };

  const rootChildren = getChildren(null);
  const sortableIds = pages
    .filter((p) => p.type !== 'overview')
    .map((p) => p.page_id);

  return (
    <>
      <div className="Sidebar__SectionHeader">
        <span className="Sidebar__SectionLabel">Canvases</span>
      </div>

      <div className="Sidebar__Branches">
        {sortedCanvases.length === 0 ? (
          <div className="Sidebar__Empty">
            No canvases yet.<br />Create one to get started.
          </div>
        ) : (
          <DndContext
            sensors={canvasSensors}
            collisionDetection={closestCenter}
            onDragStart={handleCanvasDragStart}
            onDragEnd={handleCanvasDragEnd}
          >
            <SortableContext items={canvasSortableIds} strategy={verticalListSortingStrategy}>
              {sortedCanvases.map((canvas) => (
            <div key={canvas.canvas_id}>
              <CanvasRow
                canvas={canvas}
                isActive={router.query.canvasId == canvas.canvas_id && !router.query.pageId}
                isExpanded={expandedId === canvas.canvas_id}
                onToggle={() => {
                  toggleExpand(canvas.canvas_id);
                  router.push(`/canvas/${canvas.canvas_id}`);
                }}
                onAddDocument={() => handleQuickCreate(canvas.canvas_id, 'document')}
                onAddFolder={() => {
                  setExpandedId(canvas.canvas_id);
                  setInlineCreate({ canvasId: canvas.canvas_id, type: 'folder' });
                  setInlineTitle('');
                }}
                onAddTypst={() => handleQuickCreate(canvas.canvas_id, 'typst')}
              />

              {expandedId === canvas.canvas_id && (
                <div className="Sidebar__PageList">
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
                          onFolderAdd={startFolderInlineCreate}
                          onQuickCreate={handleQuickCreate}
                          onDeletePage={requestDeletePage}
                          onRenamePage={requestRenamePage}
                          onCopyPage={handleCopyPage}
                          onCopyLink={handleCopyLink}
                          onMovePage={requestMovePage}
                          renamingPage={renamingPage}
                          onRenameSubmit={executeRenamePage}
                          onRenameCancel={() => setRenamingPage(null)}
                          onContextMenu={setContextMenu}
                          inlineCreate={inlineCreate}
                          inlineTitle={inlineTitle}
                          setInlineTitle={setInlineTitle}
                          handleInlineKeyDown={handleInlineKeyDown}
                          setInlineCreate={setInlineCreate}
                        />
                      ))}
                    </SortableContext>

                    <DragOverlay>
                      {activeItem && (
                        <div className="Sidebar__PageItem Sidebar__PageItem--dragging">
                          {activeItem.type === 'folder'
                            ? <Folder size={13} className="Sidebar__PageIcon" />
                            : activeItem.type === 'typst'
                              ? <FileCode size={13} className="Sidebar__PageIcon" />
                              : <FileText size={13} className="Sidebar__PageIcon" />}
                          <span className="Sidebar__BranchName">{activeItem.title}</span>
                        </div>
                      )}
                    </DragOverlay>
                  </DndContext>

                  {/* 인라인 생성 입력 (루트 레벨만, 폴더 안 생성은 SidebarPageItem에서 처리) */}
                  {inlineCreate && inlineCreate.canvasId === canvas.canvas_id && !inlineCreate.parentPageId && (
                    <div className="Sidebar__PageItem Sidebar__PageItem--input">
                      {inlineCreate.type === 'folder'
                        ? <Folder size={13} className="Sidebar__PageIcon" />
                        : inlineCreate.type === 'typst'
                          ? <FileCode size={13} className="Sidebar__PageIcon" />
                          : <FileText size={13} className="Sidebar__PageIcon" />}
                      <input
                        autoFocus
                        className="Sidebar__InlineInput"
                        value={inlineTitle}
                        onChange={(e) => setInlineTitle(e.target.value)}
                        onKeyDown={handleInlineKeyDown}
                        onBlur={() => { if (!inlineTitle.trim()) { setInlineCreate(null); setInlineTitle(''); } }}
                        placeholder={inlineCreate.type === 'folder' ? 'Folder name...' : inlineCreate.type === 'typst' ? 'Typst document title...' : 'Document title...'}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
              ))}
            </SortableContext>

            <DragOverlay>
              {activeCanvas && (
                <div className="Sidebar__BranchItem Sidebar__BranchItem--dragging">
                  <span
                    className="Sidebar__BranchDot"
                    style={{ backgroundColor: activeCanvas.color || '#16A34A' }}
                  />
                  <span className="Sidebar__BranchName">{activeCanvas.canvas_name}</span>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={executeDeletePage}
        title={deleteTarget?.isFolder ? 'Delete Folder' : 'Delete Page'}
        message={deleteTarget?.isFolder
          ? `"${deleteTarget?.title}" 폴더와 하위 문서가 모두 영구 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`
          : `"${deleteTarget?.title}" 문서를 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`}
        confirmLabel="Delete"
        variant="danger"
      />

      <PageMoveModal
        isOpen={!!moveTarget}
        onClose={() => setMoveTarget(null)}
        onConfirm={executeMovePage}
        pages={pages}
        currentPageId={moveTarget?.page.page_id}
        canvasName={canvases.find((c) => c.canvas_id === moveTarget?.canvasId)?.canvas_name}
      />

      {/* 우클릭 컨텍스트 메뉴 */}
      {contextMenu && (
        <div
          className="Sidebar__ContextMenu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button className="Sidebar__AddMenuItem" onClick={() => {
            requestRenamePage(contextMenu.canvasId, contextMenu.page);
            setContextMenu(null);
          }}>
            <Pencil size={13} /> Rename
          </button>
          {contextMenu.page.type !== 'folder' && (
            <button className="Sidebar__AddMenuItem" onClick={() => {
              handleCopyPage(contextMenu.canvasId, contextMenu.page);
              setContextMenu(null);
            }}>
              <Copy size={13} /> Duplicate
            </button>
          )}
          <button className="Sidebar__AddMenuItem" onClick={() => {
            handleCopyLink(contextMenu.canvasId, contextMenu.page);
            setContextMenu(null);
          }}>
            <Link size={13} /> Copy link
          </button>
          <button className="Sidebar__AddMenuItem" onClick={() => {
            requestMovePage(contextMenu.canvasId, contextMenu.page);
            setContextMenu(null);
          }}>
            <FolderInput size={13} /> Move
          </button>
          <div className="Sidebar__AddMenuDivider" />
          <button className="Sidebar__AddMenuItem Sidebar__AddMenuItem--danger" onClick={() => {
            requestDeletePage(contextMenu.canvasId, contextMenu.page);
            setContextMenu(null);
          }}>
            <Trash2 size={13} /> Delete
          </button>
        </div>
      )}
    </>
  );
}

// 캔버스 제목 row + 호버 시 더보기/+ 버튼
function CanvasRow({ canvas, isActive, isExpanded, onToggle, onAddDocument, onAddFolder, onAddTypst }) {
  const router = useRouter();
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addMenuPos, setAddMenuPos] = useState(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [moreMenuPos, setMoreMenuPos] = useState(null);
  const addMenuRef = useRef(null);
  const addBtnRef = useRef(null);
  const moreMenuRef = useRef(null);
  const moreBtnRef = useRef(null);

  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: canvas.canvas_id });

  // 외부 클릭 또는 스크롤 시 메뉴 닫기
  useEffect(() => {
    if (!showAddMenu && !showMoreMenu) return;
    const handleClick = (e) => {
      if (showAddMenu && addMenuRef.current && !addMenuRef.current.contains(e.target)) setShowAddMenu(false);
      if (showMoreMenu && moreMenuRef.current && !moreMenuRef.current.contains(e.target)) setShowMoreMenu(false);
    };
    const handleScroll = () => { setShowAddMenu(false); setShowMoreMenu(false); };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [showAddMenu, showMoreMenu]);

  const rowStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={rowStyle}
      className={`Sidebar__BranchRow ${isActive ? 'Sidebar__BranchRow--active' : ''}`}
    >
      <button
        className={`Sidebar__BranchItem ${isActive ? 'Sidebar__BranchItem--active' : ''}`}
        onClick={onToggle}
        {...attributes}
        {...listeners}
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

      <div className="Sidebar__BranchActions">
        {/* 더보기 메뉴 */}
        <div ref={moreMenuRef}>
          <button
            ref={moreBtnRef}
            className="Sidebar__BranchAddBtn"
            onClick={(e) => {
              e.stopPropagation();
              if (!showMoreMenu && moreBtnRef.current) {
                const rect = moreBtnRef.current.getBoundingClientRect();
                const top = Math.min(rect.top, window.innerHeight - 60);
                setMoreMenuPos({ top, left: rect.right + 4 });
              }
              setShowMoreMenu(!showMoreMenu);
            }}
            title="More"
          >
            <MoreHorizontal size={13} />
          </button>
          {showMoreMenu && moreMenuPos && (
            <div className="Sidebar__FixedMenu" style={{ top: moreMenuPos.top, left: moreMenuPos.left }}>
              <button
                className="Sidebar__AddMenuItem"
                onClick={() => { setShowMoreMenu(false); router.push(`/canvas/${canvas.canvas_id}/settings`); }}
              >
                <Settings size={13} />
                Settings
              </button>
            </div>
          )}
        </div>

        {/* 추가 메뉴 */}
        <div ref={addMenuRef}>
          <button
            ref={addBtnRef}
            className="Sidebar__BranchAddBtn"
            onClick={(e) => {
              e.stopPropagation();
              if (!showAddMenu && addBtnRef.current) {
                const rect = addBtnRef.current.getBoundingClientRect();
                const top = Math.min(rect.top, window.innerHeight - 140);
                setAddMenuPos({ top, left: rect.right + 4 });
              }
              setShowAddMenu(!showAddMenu);
            }}
            title="Add"
          >
            <Plus size={13} />
          </button>
          {showAddMenu && addMenuPos && (
            <div className="Sidebar__FixedMenu" style={{ top: addMenuPos.top, left: addMenuPos.left }}>
              <button className="Sidebar__AddMenuItem" onClick={() => { setShowAddMenu(false); onAddDocument(); }}>
                <FileText size={13} />
                Document
              </button>
              <button className="Sidebar__AddMenuItem" onClick={() => { setShowAddMenu(false); onAddTypst(); }}>
                <FileCode size={13} />
                Typst Document
              </button>
              <button className="Sidebar__AddMenuItem" onClick={() => { setShowAddMenu(false); onAddFolder(); }}>
                <FolderPlus size={13} />
                Folder
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SidebarPageItem({
  page, canvasId, depth, expandedFolders, toggleFolder, getChildren, router,
  onFolderAdd, onQuickCreate, onDeletePage,
  onRenamePage, onCopyPage, onCopyLink, onMovePage,
  renamingPage, onRenameSubmit, onRenameCancel,
  onContextMenu,
  inlineCreate, inlineTitle, setInlineTitle, handleInlineKeyDown, setInlineCreate,
}) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: page.page_id });
  const [showMenu, setShowMenu] = useState(false);
  const [menuPos, setMenuPos] = useState(null);
  const [renameTitle, setRenameTitle] = useState('');
  const menuRef = useRef(null);
  const moreBtnRef = useRef(null);

  const isFolder = page.type === 'folder';
  const isExpanded = expandedFolders[page.page_id];
  const children = isFolder ? getChildren(page.page_id) : [];
  const isRenaming = renamingPage?.pageId === page.page_id;

  // 이름변경 모드 진입 시 title 세팅
  useEffect(() => {
    if (isRenaming) setRenameTitle(page.title);
  }, [isRenaming, page.title]);

  // 메뉴 외부 클릭 또는 스크롤 시 닫기
  useEffect(() => {
    if (!showMenu) return;
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false);
    };
    const handleScroll = () => setShowMenu(false);
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [showMenu]);

  // 이름변경 키 핸들러
  const handleRenameKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter') onRenameSubmit(renameTitle);
    if (e.key === 'Escape') onRenameCancel();
  };

  // 우클릭 핸들러
  const handleContextMenu = (e) => {
    if (page.type === 'overview') return;
    e.preventDefault();
    e.stopPropagation();
    const menuW = 170, menuH = 220;
    const x = Math.min(e.clientX, window.innerWidth - menuW);
    const y = Math.min(e.clientY, window.innerHeight - menuH);
    onContextMenu({ x, y, canvasId, page });
  };

  // 이 폴더 안에 인라인 생성 중인지
  const isInlineInThisFolder = inlineCreate
    && inlineCreate.parentPageId === page.page_id
    && inlineCreate.canvasId === canvasId;

  // 더보기 메뉴 내용 (폴더/문서 공용)
  const renderMenuItems = () => (
    <>
      {/* 폴더인 경우 추가 메뉴 */}
      {isFolder && (
        <>
          <button className="Sidebar__AddMenuItem" onClick={() => {
            setShowMenu(false);
            onQuickCreate(canvasId, 'document', page.page_id);
          }}>
            <FileText size={13} /> Document
          </button>
          <button className="Sidebar__AddMenuItem" onClick={() => {
            setShowMenu(false);
            onQuickCreate(canvasId, 'typst', page.page_id);
          }}>
            <FileCode size={13} /> Typst Document
          </button>
          <button className="Sidebar__AddMenuItem" onClick={() => {
            setShowMenu(false);
            onFolderAdd(canvasId, page.page_id, 'folder');
          }}>
            <FolderPlus size={13} /> Folder
          </button>
          <div className="Sidebar__AddMenuDivider" />
        </>
      )}
      <button className="Sidebar__AddMenuItem" onClick={() => {
        setShowMenu(false);
        onRenamePage(canvasId, page);
      }}>
        <Pencil size={13} /> Rename
      </button>
      {!isFolder && (
        <button className="Sidebar__AddMenuItem" onClick={() => {
          setShowMenu(false);
          onCopyPage(canvasId, page);
        }}>
          <Copy size={13} /> Duplicate
        </button>
      )}
      <button className="Sidebar__AddMenuItem" onClick={() => {
        setShowMenu(false);
        onCopyLink(canvasId, page);
      }}>
        <Link size={13} /> Copy link
      </button>
      <button className="Sidebar__AddMenuItem" onClick={() => {
        setShowMenu(false);
        onMovePage(canvasId, page);
      }}>
        <FolderInput size={13} /> Move
      </button>
      <div className="Sidebar__AddMenuDivider" />
      <button className="Sidebar__AddMenuItem Sidebar__AddMenuItem--danger" onClick={() => {
        setShowMenu(false);
        onDeletePage(canvasId, page);
      }}>
        <Trash2 size={13} /> Delete
      </button>
    </>
  );

  return (
    <>
      <div
        className={`Sidebar__PageRow ${router.query.pageId == page.page_id ? 'Sidebar__PageRow--active' : ''}`}
        style={{ paddingLeft: `${40 + depth * 14}px` }}
        onContextMenu={handleContextMenu}
      >
        <button
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
          className="Sidebar__PageItem Sidebar__PageItem--inRow"
          onClick={() => isFolder ? toggleFolder(page.page_id) : router.push(`/canvas/${canvasId}/${page.page_id}`)}
        >
          {isFolder && (
            <span className="Sidebar__ExpandIcon">
              {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </span>
          )}
          {isFolder
            ? (isExpanded ? <FolderOpen size={13} className="Sidebar__PageIcon" /> : <Folder size={13} className="Sidebar__PageIcon" />)
            : page.type === 'typst'
              ? <FileCode size={13} className="Sidebar__PageIcon" />
              : <FileText size={13} className="Sidebar__PageIcon" />}
          {isRenaming ? (
            <input
              autoFocus
              className="Sidebar__InlineInput"
              value={renameTitle}
              onChange={(e) => setRenameTitle(e.target.value)}
              onKeyDown={handleRenameKeyDown}
              onBlur={() => onRenameSubmit(renameTitle)}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="Sidebar__BranchName">{page.title}</span>
          )}
        </button>

        {page.type !== 'overview' && !isRenaming && (
          <div className="Sidebar__PageActions" ref={menuRef}>
            <button
              ref={moreBtnRef}
              className="Sidebar__PageMoreBtn"
              onClick={(e) => {
                e.stopPropagation();
                if (!showMenu && moreBtnRef.current) {
                  const rect = moreBtnRef.current.getBoundingClientRect();
                  const menuH = isFolder ? 280 : 220;
                  const top = Math.min(rect.top, window.innerHeight - menuH);
                  setMenuPos({ top, left: rect.right + 4 });
                }
                setShowMenu(!showMenu);
              }}
              title="More"
            >
              <MoreHorizontal size={12} />
            </button>
            {showMenu && menuPos && (
              <div className="Sidebar__FixedMenu" style={{ top: menuPos.top, left: menuPos.left }}>
                {renderMenuItems()}
              </div>
            )}
          </div>
        )}
      </div>

      {isFolder && isExpanded && (
        <>
          {children.map((child) => (
            <SidebarPageItem
              key={child.page_id}
              page={child}
              canvasId={canvasId}
              depth={depth + 1}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
              getChildren={getChildren}
              router={router}
              onFolderAdd={onFolderAdd}
              onQuickCreate={onQuickCreate}
              onDeletePage={onDeletePage}
              onRenamePage={onRenamePage}
              onCopyPage={onCopyPage}
              onCopyLink={onCopyLink}
              onMovePage={onMovePage}
              renamingPage={renamingPage}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              onContextMenu={onContextMenu}
              inlineCreate={inlineCreate}
              inlineTitle={inlineTitle}
              setInlineTitle={setInlineTitle}
              handleInlineKeyDown={handleInlineKeyDown}
              setInlineCreate={setInlineCreate}
            />
          ))}
          {/* 폴더 내 인라인 생성 입력 */}
          {isInlineInThisFolder && (
            <div className="Sidebar__PageItem Sidebar__PageItem--input" style={{ paddingLeft: `${40 + (depth + 1) * 14}px` }}>
              {inlineCreate.type === 'folder'
                ? <Folder size={13} className="Sidebar__PageIcon" />
                : inlineCreate.type === 'typst'
                  ? <FileCode size={13} className="Sidebar__PageIcon" />
                  : <FileText size={13} className="Sidebar__PageIcon" />}
              <input
                autoFocus
                className="Sidebar__InlineInput"
                value={inlineTitle}
                onChange={(e) => setInlineTitle(e.target.value)}
                onKeyDown={handleInlineKeyDown}
                onBlur={() => { if (!inlineTitle.trim()) { setInlineCreate(null); setInlineTitle(''); } }}
                placeholder={inlineCreate.type === 'folder' ? 'Folder name...' : inlineCreate.type === 'typst' ? 'Typst document title...' : 'Document title...'}
              />
            </div>
          )}
        </>
      )}
    </>
  );
}
