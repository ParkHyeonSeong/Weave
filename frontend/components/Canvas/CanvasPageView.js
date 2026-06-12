import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { Pencil, X, Wifi, WifiOff, Loader, RefreshCw, Maximize2, Minimize2, Trash2, Download, AlertTriangle, Star, MessageSquare, MoreHorizontal, Copy, Link, FolderInput, Clock } from 'lucide-react';
import useStar from '@/hooks/useStar';
import useAnnotations from '@/hooks/useAnnotations';
import { axios } from '@/library/_axios';
import ConfirmModal from '@/components/modal/ConfirmModal';
import PageMoveModal from '@/components/modal/PageMoveModal';
import useCollabProvider from '@/library/useCollabProvider';
import { sanitizeHtml, sanitizeSvg } from '@/library/sanitize';
import { applyFallbackBadges, useRefHydration } from '@/library/refHydration';
import PresenceBar from './PresenceBar';
import AnnotationLayer from './AnnotationLayer';
import AnnotationSidebar from './AnnotationSidebar';
import ActivityTimeline from '@/components/common/ActivityTimeline';
import katex from 'katex';
import { common, createLowlight } from 'lowlight';
import { toHtml } from 'hast-util-to-html';
import { compileToSvg, downloadPdf } from '@/library/typstCompiler';

const lowlight = createLowlight(common);

// SSR 비활성화
const CanvasCollabEditor = dynamic(() => import('./CanvasCollabEditor'), { ssr: false });
const TypstEditor = dynamic(() => import('./TypstEditor'), { ssr: false });

export default function CanvasPageView({ onRefClick }) {
  const router = useRouter();
  const { canvasId, pageId } = router.query;
  const [page, setPage] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [user, setUser] = useState(null);
  const [saveStatus, setSaveStatus] = useState('saved');
  const titleTimerRef = useRef(null);
  const htmlRef = useRef('');
  const contentRef = useRef(null);
  const contentTimerRef = useRef(null);
  const stickyRef = useRef(null);
  const [isScrolled, setIsScrolled] = useState(false);

  const { starred, toggle: toggleStar } = useStar('doc', pageId ? Number(pageId) : null);

  // Annotation (인라인 코멘트) 상태
  const {
    annotations, fetchAnnotations,
    createAnnotation, resolveAnnotation, reopenAnnotation, deleteAnnotation,
    createReply, updateReply, deleteReply,
  } = useAnnotations(canvasId, pageId);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeAnnotationId, setActiveAnnotationId] = useState(null);
  const [newAnnotationData, setNewAnnotationData] = useState(null);

  // Typst 읽기 모드용 상태
  const [typstSvg, setTypstSvg] = useState(null);
  const [typstExporting, setTypstExporting] = useState(false);

  // 스크롤 감지 → 헤더 border 표시
  useEffect(() => {
    const scrollParent = stickyRef.current?.closest('.Layout__Content');
    if (!scrollParent) return;
    const handleScroll = () => setIsScrolled(scrollParent.scrollTop > 10);
    scrollParent.addEventListener('scroll', handleScroll, { passive: true });
    return () => scrollParent.removeEventListener('scroll', handleScroll);
  }, [page]);

  // StickyHeader 높이를 CSS 변수로 전달 (에디터 툴바 sticky 위치용)
  useEffect(() => {
    const el = stickyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.borderBoxSize?.[0]?.blockSize ?? entry.target.offsetHeight;
      el.closest('.CanvasPageView')?.style.setProperty('--sticky-header-h', `${h}px`);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [page]);

  // 편집 모드에서 ref 클릭 이벤트 수신
  useEffect(() => {
    if (!onRefClick) return;
    const handler = (e) => onRefClick(e.detail);
    window.addEventListener('canvas:ref_click', handler);
    return () => window.removeEventListener('canvas:ref_click', handler);
  }, [onRefClick]);

  // sessionStorage에서 유저 정보 로드 (아바타 변경 시 awareness 갱신 위해 profile:updated도 수신)
  useEffect(() => {
    const loadUser = () => {
      try {
        const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
        if (profile.user_id) setUser(profile);
      } catch {}
    };
    loadUser();
    window.addEventListener('profile:updated', loadUser);
    return () => window.removeEventListener('profile:updated', loadUser);
  }, []);

  // Edit 모드일 때만 WebSocket 연결
  const { ydoc, provider, status, connectedUsers } = useCollabProvider(
    isEditing && canvasId ? Number(canvasId) : null,
    isEditing && pageId ? Number(pageId) : null,
    isEditing ? user : null
  );

  // 페이지 데이터 fetch
  const fetchPage = useCallback(async () => {
    if (!canvasId || !pageId) return;
    try {
      const res = await axios.get(`/canvases/${canvasId}/pages/${pageId}`);
      if (res.data.status) {
        setPage(res.data.page);
        setEditTitle(res.data.page.title);
      }
    } catch {}
  }, [canvasId, pageId]);

  // pageId 변경 시 상태 초기화
  useEffect(() => {
    setPage(null);
    setTypstSvg(null);
    setSaveStatus('saved');
  }, [pageId]);

  useEffect(() => {
    fetchPage();
    if (router.query.edit) {
      setIsEditing(true);
      router.replace(`/canvas/${canvasId}/${pageId}`, undefined, { shallow: true });
    } else {
      setIsEditing(false);
    }
  }, [fetchPage]);

  // 외부(사이드바 등)에서 페이지가 변경되면 데이터 갱신
  useEffect(() => {
    const handlePageUpdate = () => {
      if (!isEditing) fetchPage();
    };
    window.addEventListener('canvas:page_updated', handlePageUpdate);
    return () => window.removeEventListener('canvas:page_updated', handlePageUpdate);
  }, [fetchPage, isEditing]);

  // 연결 상태에 따른 saveStatus 업데이트
  useEffect(() => {
    if (!isEditing) return;
    if (status === 'disconnected') setSaveStatus('offline');
    else if (status === 'connected') setSaveStatus('saved');
  }, [status, isEditing]);

  // 읽기 모드에서 KaTeX 수식 렌더링
  useEffect(() => {
    if (isEditing || !contentRef.current || page?.type === 'typst') return;
    const mathNodes = contentRef.current.querySelectorAll('[data-type="block-math"], [data-type="inline-math"]');
    mathNodes.forEach((el) => {
      const latex = el.getAttribute('data-latex');
      if (latex && !el.querySelector('.katex')) {
        const isBlock = el.getAttribute('data-type') === 'block-math';
        try {
          katex.render(latex, el, { throwOnError: false, displayMode: isBlock });
        } catch {}
      }
    });
  }, [isEditing, page?.content]);

  // 읽기 모드에서 코드 블록 구문 강조
  useEffect(() => {
    if (isEditing || !contentRef.current || page?.type === 'typst') return;
    const codeBlocks = contentRef.current.querySelectorAll('pre code');
    codeBlocks.forEach((el) => {
      if (el.dataset.highlighted) return;
      const lang = (el.className.match(/language-(\w+)/) || [])[1];
      const code = el.textContent || '';
      try {
        const tree = lang && lowlight.registered(lang)
          ? lowlight.highlight(lang, code)
          : lowlight.highlightAuto(code);
        el.innerHTML = toHtml(tree);
        el.dataset.highlighted = 'true';
      } catch {}
    });
  }, [isEditing, page?.content]);

  // 읽기 모드에서 레퍼런스 클릭 핸들러 (task, doc, issue)
  useEffect(() => {
    if (isEditing || !contentRef.current || page?.type === 'typst') return;
    const handlers = [];

    contentRef.current.querySelectorAll('[data-task-ref]').forEach((el) => {
      el.classList.add('task-ref');
      el.style.cursor = 'pointer';
      const handler = () => {
        const branchId = el.getAttribute('data-branch-id');
        const taskId = el.getAttribute('data-task-id');
        if (!branchId || !taskId) return;
        if (onRefClick) {
          onRefClick({ type: 'task', data: { branchId, taskId } });
        } else {
          router.push(`/branch/${branchId}/task/${taskId}`);
        }
      };
      el.addEventListener('click', handler);
      handlers.push({ el, handler });
    });

    contentRef.current.querySelectorAll('[data-doc-ref]').forEach((el) => {
      el.classList.add('doc-ref');
      el.style.cursor = 'pointer';
      const handler = () => {
        const canvasId = el.getAttribute('data-canvas-id');
        const pageId = el.getAttribute('data-page-id');
        if (!canvasId || !pageId) return;
        if (onRefClick) {
          onRefClick({ type: 'doc', data: { canvasId, pageId } });
        } else {
          router.push(`/canvas/${canvasId}/${pageId}`);
        }
      };
      el.addEventListener('click', handler);
      handlers.push({ el, handler });
    });

    contentRef.current.querySelectorAll('[data-issue-ref]').forEach((el) => {
      el.classList.add('issue-ref');
      el.style.cursor = 'pointer';
      const handler = () => {
        const branchId = el.getAttribute('data-branch-id');
        const taskId = el.getAttribute('data-task-id');
        const issueId = el.getAttribute('data-issue-id');
        if (!branchId || !taskId || !issueId) return;
        if (onRefClick) {
          onRefClick({ type: 'issue', data: { branchId, taskId, issueId } });
        } else {
          router.push(`/branch/${branchId}/task/${taskId}/issue/${issueId}`);
        }
      };
      el.addEventListener('click', handler);
      handlers.push({ el, handler });
    });

    // Bookmark 카드 클릭 → 새 탭에서 열기
    contentRef.current.querySelectorAll('[data-bookmark]').forEach((el) => {
      el.style.cursor = 'pointer';
      const handler = () => {
        const url = el.getAttribute('data-url');
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
      };
      el.addEventListener('click', handler);
      handlers.push({ el, handler });
    });

    return () => handlers.forEach(({ el, handler }) => el.removeEventListener('click', handler));
  }, [isEditing, page?.content, router, onRefClick]);

  // 읽기 모드에서 ref 칩 폴백 뱃지 주입 (data-* 스냅샷으로 fetch 전 즉시 표시)
  useEffect(() => {
    if (isEditing || !contentRef.current || page?.type === 'typst') return;
    applyFallbackBadges(contentRef.current);
  }, [isEditing, page?.content]);

  // 배치 API로 최신 제목·상태 하이드레이션 + 탭 내 태스크/이슈 변경 이벤트 갱신
  useRefHydration(contentRef, [isEditing, page?.content], !isEditing && page?.type !== 'typst');

  // 제목 변경 (debounced)
  const handleTitleChange = (e) => {
    const newTitle = e.target.value;
    setEditTitle(newTitle);
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
    titleTimerRef.current = setTimeout(async () => {
      if (newTitle && newTitle !== page?.title) {
        try {
          await axios.patch(`/canvases/${canvasId}/pages/${pageId}`, { title: newTitle });
          setPage((prev) => prev ? { ...prev, title: newTitle } : prev);
          window.dispatchEvent(new CustomEvent('canvas:page_updated'));
        } catch {}
      }
    }, 1000);
  };

  // HTML content 변경 시 debounced REST PATCH
  const handleHtmlChange = (html) => {
    htmlRef.current = html;
    if (contentTimerRef.current) clearTimeout(contentTimerRef.current);
    contentTimerRef.current = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        await axios.patch(`/canvases/${canvasId}/pages/${pageId}`, { content: htmlRef.current });
        setSaveStatus('saved');
      } catch {
        setSaveStatus('offline');
      }
    }, 5000);
  };

  // Edit 모드 종료
  const handleCloseEdit = useCallback(async () => {
    // 남은 content 즉시 저장
    if (htmlRef.current) {
      try {
        await axios.patch(`/canvases/${canvasId}/pages/${pageId}`, { content: htmlRef.current });
      } catch {}
    }
    if (contentTimerRef.current) clearTimeout(contentTimerRef.current);

    // 남은 title 즉시 저장
    if (titleTimerRef.current) {
      clearTimeout(titleTimerRef.current);
      if (editTitle && editTitle !== page?.title) {
        try {
          await axios.patch(`/canvases/${canvasId}/pages/${pageId}`, { title: editTitle });
          window.dispatchEvent(new CustomEvent('canvas:page_updated'));
        } catch {}
      }
    }

    htmlRef.current = '';
    setIsEditing(false);
    fetchPage();
  }, [canvasId, pageId, editTitle, page?.title, fetchPage]);

  // 너비 모드 토글
  const toggleWideMode = async () => {
    const newMode = !page.wide_mode;
    setPage((prev) => ({ ...prev, wide_mode: newMode }));
    try {
      await axios.patch(`/canvases/${canvasId}/pages/${pageId}`, { wide_mode: newMode });
    } catch {
      setPage((prev) => ({ ...prev, wide_mode: !newMode }));
    }
  };

  // 더보기 메뉴
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef(null);

  useEffect(() => {
    if (!showMoreMenu) return;
    const handleClick = (e) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) setShowMoreMenu(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMoreMenu]);

  // 복제
  const handleDuplicate = async () => {
    setShowMoreMenu(false);
    try {
      const res = await axios.post(`/canvases/${canvasId}/pages/${pageId}/copy`, {});
      if (res.data.status) {
        window.dispatchEvent(new CustomEvent('canvas:page_created'));
        router.push(`/canvas/${canvasId}/${res.data.page_id}`);
      }
    } catch {}
  };

  // 링크 복사
  const handleCopyLink = () => {
    setShowMoreMenu(false);
    const url = `${window.location.origin}/canvas/${canvasId}/${pageId}`;
    navigator.clipboard.writeText(url).catch(() => {});
  };

  // 이동
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [movePages, setMovePages] = useState([]);
  const [moveCanvasName, setMoveCanvasName] = useState('');

  const handleOpenMove = async () => {
    setShowMoreMenu(false);
    try {
      const [treeRes, canvasRes] = await Promise.all([
        axios.get(`/canvases/${canvasId}/pages`),
        axios.get(`/canvases/${canvasId}`),
      ]);
      if (treeRes.data.status) {
        setMovePages(treeRes.data.pages);
        setMoveCanvasName(canvasRes.data?.canvas?.canvas_name || 'Canvas');
        setShowMoveModal(true);
      }
    } catch {}
  };

  const handleMove = async (targetParentId) => {
    const siblings = movePages.filter((p) =>
      targetParentId ? p.parent_page_id === targetParentId : !p.parent_page_id
    );
    try {
      await axios.patch(`/canvases/${canvasId}/pages/${pageId}/move`, {
        parent_page_id: targetParentId,
        position: siblings.length,
      });
      window.dispatchEvent(new CustomEvent('canvas:page_updated'));
    } catch {}
    setShowMoveModal(false);
  };

  // 삭제
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDelete = async () => {
    setShowDeleteConfirm(false);
    try {
      const res = await axios.delete(`/canvases/${canvasId}/pages/${pageId}`);
      if (res.data.status) {
        window.dispatchEvent(new CustomEvent('canvas:page_deleted'));
        // overview 페이지로 이동
        const treeRes = await axios.get(`/canvases/${canvasId}/pages`);
        if (treeRes.data.status) {
          const overview = treeRes.data.pages.find((p) => p.type === 'overview');
          if (overview) {
            router.push(`/canvas/${canvasId}/${overview.page_id}`);
            return;
          }
        }
        router.push(`/canvas/${canvasId}`);
      }
    } catch {}
  };

  // 탭 포커스 복귀 시 업데이트 감지
  const [updateToast, setUpdateToast] = useState(null);

  useEffect(() => {
    if (!canvasId || !pageId || !page) return;
    const checkForUpdates = async () => {
      if (isEditing) return;
      try {
        const res = await axios.get(`/canvases/${canvasId}/pages/${pageId}`);
        if (res.data.status) {
          const remote = res.data.page;
          const remoteTime = new Date(remote.updated_at).getTime();
          const localTime = new Date(page.updated_at).getTime();
          if (remoteTime > localTime && remote.updated_by !== user?.user_id) {
            setUpdateToast({
              name: remote.updated_by_name || remote.created_by_name || 'Someone',
              reload: () => {
                setPage(remote);
                setEditTitle(remote.title);
                setUpdateToast(null);
              },
            });
          }
        }
      } catch {}
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') checkForUpdates();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', checkForUpdates);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', checkForUpdates);
    };
  }, [canvasId, pageId, page?.updated_at, isEditing]);

  // Typst 읽기 모드: content를 SVG로 컴파일
  const [typstError, setTypstError] = useState(null);

  useEffect(() => {
    if (isEditing || page?.type !== 'typst' || !page?.content) {
      setTypstSvg(null);
      setTypstError(null);
      return;
    }
    let cancelled = false;
    compileToSvg(page.content).then(({ svg, errors }) => {
      if (cancelled) return;
      if (svg) {
        setTypstSvg(svg);
        setTypstError(null);
      } else {
        setTypstSvg(null);
        // SourceDiagnostic 문자열에서 message 추출
        const raw = errors?.[0] || 'Compile error';
        const match = raw.match(/message:\s*"([^"]+)"/);
        setTypstError(match ? match[1] : raw);
      }
    });
    return () => { cancelled = true; };
  }, [isEditing, page?.type, page?.content]);

  // Typst PDF 내보내기 (읽기 모드)
  const handleTypstExportPdf = async () => {
    if (!page?.content?.trim()) return;
    setTypstExporting(true);
    try {
      const filename = (page.title || 'document').replace(/[^a-zA-Z0-9가-힣\s_-]/g, '') + '.pdf';
      await downloadPdf(page.content, filename);
    } catch {}
    setTypstExporting(false);
  };

  // 키보드 단축키: e → Edit, Cmd+S → Save & Close
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (isEditing) {
        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
          e.preventDefault();
          handleCloseEdit();
        }
      } else {
        // input/textarea/contenteditable 에서는 무시
        const tag = e.target.tagName;
        const editable = e.target.isContentEditable;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return;
        if (e.key === 'e' && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          setIsEditing(true);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isEditing, handleCloseEdit]);

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
      if (contentTimerRef.current) clearTimeout(contentTimerRef.current);
    };
  }, []);

  if (!page) return null;

  return (
    <div className={`CanvasPageView${page?.wide_mode ? ' CanvasPageView--wide' : ''}${page?.type === 'typst' && isEditing ? ' CanvasPageView--typst-editing' : ''}`}>
      <div ref={stickyRef} className={`CanvasPageView__StickyHeader ${isScrolled ? 'CanvasPageView__StickyHeader--scrolled' : ''}`}>
      <div className="CanvasPageView__TopBar">
        {isEditing ? (
          <>
            <div className="CanvasPageView__StatusGroup">
              <span className={`CanvasPageView__Status CanvasPageView__Status--${status}`}>
                {status === 'connected' ? <Wifi size={14} /> :
                 status === 'connecting' ? <Loader size={14} className="CanvasPageView__StatusSpin" /> :
                 <WifiOff size={14} />}
              </span>
              <span className="CanvasPageView__SaveStatus">
                {saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving...' : 'Offline'}
              </span>
            </div>
            <div className="CanvasPageView__Actions">
              <PresenceBar users={connectedUsers} currentUserId={user?.user_id} />
              <button
                className={`CanvasPageView__ActionBtn ${starred ? 'CanvasPageView__ActionBtn--starred' : ''}`}
                onClick={toggleStar}
                title={starred ? 'Remove star' : 'Add star'}
              >
                <Star size={15} fill={starred ? 'currentColor' : 'none'} />
              </button>
              <button
                className="CanvasPageView__ActionBtn"
                onClick={toggleWideMode}
                title={page.wide_mode ? '기본 너비' : '넓게 보기'}
              >
                {page.wide_mode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
              <button
                className="CanvasPageView__ActionBtn CanvasPageView__ActionBtn--secondary"
                onClick={handleCloseEdit}
              >
                <X size={15} />
                Close
                <kbd className="CanvasPageView__Kbd">⌘S</kbd>
              </button>
            </div>
          </>
        ) : (
          <>
            <div />
            <div className="CanvasPageView__Actions">
              <button
                className={`CanvasPageView__ActionBtn ${starred ? 'CanvasPageView__ActionBtn--starred' : ''}`}
                onClick={toggleStar}
                title={starred ? 'Remove star' : 'Add star'}
              >
                <Star size={15} fill={starred ? 'currentColor' : 'none'} />
              </button>
              {page.type !== 'overview' && (
                <div ref={moreMenuRef} className="CanvasPageView__MoreWrap">
                  <button
                    className="CanvasPageView__ActionBtn"
                    onClick={() => setShowMoreMenu(!showMoreMenu)}
                    title="More actions"
                  >
                    <MoreHorizontal size={15} />
                  </button>
                  {showMoreMenu && (
                    <div className="CanvasPageView__MoreMenu">
                      <button className="CanvasPageView__MoreMenuItem" onClick={() => { setShowMoreMenu(false); setIsEditing(true); }}>
                        <Pencil size={13} /> Rename
                      </button>
                      {page.type !== 'folder' && (
                        <button className="CanvasPageView__MoreMenuItem" onClick={handleDuplicate}>
                          <Copy size={13} /> Duplicate
                        </button>
                      )}
                      <button className="CanvasPageView__MoreMenuItem" onClick={handleCopyLink}>
                        <Link size={13} /> Copy link
                      </button>
                      <button className="CanvasPageView__MoreMenuItem" onClick={handleOpenMove}>
                        <FolderInput size={13} /> Move
                      </button>
                      <div className="CanvasPageView__MoreMenuDivider" />
                      <button className="CanvasPageView__MoreMenuItem CanvasPageView__MoreMenuItem--danger" onClick={() => { setShowMoreMenu(false); setShowDeleteConfirm(true); }}>
                        <Trash2 size={13} /> Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button
                className="CanvasPageView__ActionBtn"
                onClick={toggleWideMode}
                title={page.wide_mode ? '기본 너비' : '넓게 보기'}
              >
                {page.wide_mode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
              {page.type === 'typst' && (
                <button
                  className="CanvasPageView__ActionBtn"
                  onClick={handleTypstExportPdf}
                  disabled={typstExporting}
                  title="Download PDF"
                >
                  {typstExporting ? <Loader size={15} className="CanvasPageView__StatusSpin" /> : <Download size={15} />}
                  PDF
                </button>
              )}
              {page.type !== 'typst' && (
                <button
                  className={`CanvasPageView__ActionBtn${sidebarOpen ? ' CanvasPageView__ActionBtn--active' : ''}`}
                  onClick={() => setSidebarOpen((v) => !v)}
                  title="Comments"
                >
                  <MessageSquare size={15} />
                  {annotations.filter((a) => a.status === 'open').length > 0 && (
                    <span className="CanvasPageView__Badge">
                      {annotations.filter((a) => a.status === 'open').length}
                    </span>
                  )}
                </button>
              )}
              <button
                className={`CanvasPageView__ActionBtn${historyOpen ? ' CanvasPageView__ActionBtn--active' : ''}`}
                onClick={() => { setHistoryOpen((v) => !v); if (!historyOpen) setSidebarOpen(false); }}
                title="History"
              >
                <Clock size={15} />
              </button>
              <button
                className="CanvasPageView__ActionBtn"
                onClick={() => setIsEditing(true)}
              >
                <Pencil size={15} />
                Edit
                <kbd className="CanvasPageView__Kbd">E</kbd>
              </button>
            </div>
          </>
        )}
      </div>

      {/* 제목 */}
      <div className="CanvasPageView__TitleArea">
        {isEditing ? (
          <input
            className="CanvasPageView__TitleInput"
            value={editTitle}
            onChange={handleTitleChange}
            placeholder="Page title..."
          />
        ) : (
          <h1 className="CanvasPageView__Title">{page.title}</h1>
        )}
        {!isEditing && page.updated_at && (
          <span className="CanvasPageView__Meta">
            Last updated {new Date(page.updated_at).toLocaleDateString()}
            {(page.updated_by_name || page.created_by_name) && ` by ${page.updated_by_name || page.created_by_name}`}
          </span>
        )}
      </div>
      </div>

      {/* 내용 */}
      <div className={`CanvasPageView__Body${page.type === 'typst' ? ' CanvasPageView__Body--typst' : ''}`}>
        {isEditing ? (
          ydoc && provider ? (
            page.type === 'typst' ? (
              <TypstEditor
                ydoc={ydoc}
                provider={provider}
                initialContent={page.content || ''}
                hasExistingYjsState={!!page.yjs_state}
                onContentChange={handleHtmlChange}
                pageTitle={page.title}
              />
            ) : (
              <CanvasCollabEditor
                ydoc={ydoc}
                provider={provider}
                canvasId={Number(canvasId)}
                initialContent={page.content || ''}
                hasExistingYjsState={!!page.yjs_state}
                onHtmlChange={handleHtmlChange}
              />
            )
          ) : (
            <div className="CanvasPageView__Loading">Connecting...</div>
          )
        ) : page.type === 'typst' ? (
          <div className="CanvasPageView__TypstPreview">
            {typstSvg ? (
              <div className="CanvasPageView__TypstPage" dangerouslySetInnerHTML={{ __html: sanitizeSvg(typstSvg) }} />
            ) : typstError ? (
              <div className="CanvasPageView__TypstError">
                <AlertTriangle size={14} />
                <span>{typstError}</span>
              </div>
            ) : page.content ? (
              <div className="CanvasPageView__Loading">
                <Loader size={16} className="CanvasPageView__StatusSpin" />
                Rendering...
              </div>
            ) : (
              <p className="CanvasPageView__Empty">No content yet. Click Edit to start writing.</p>
            )}
          </div>
        ) : (
          <>
            <div
              ref={contentRef}
              className="CanvasPageView__Content ProseMirror"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(page.content) || '<p>No content yet. Click Edit to start writing.</p>' }}
            />
            <AnnotationLayer
              contentRef={contentRef}
              annotations={annotations}
              isEditing={isEditing}
              pageContent={page.content}
              activeAnnotationId={activeAnnotationId}
              onAnnotationClick={(id) => {
                setActiveAnnotationId(id);
                setSidebarOpen(true);
              }}
              onCreateAnnotation={(anchorData) => {
                setNewAnnotationData(anchorData);
                setSidebarOpen(true);
              }}
            />
          </>
        )}
      </div>
      {updateToast && (
        <div className="CanvasPageView__Toast">
          <span>This page was updated by {updateToast.name}</span>
          <button className="CanvasPageView__ToastBtn" onClick={updateToast.reload}>
            <RefreshCw size={13} />
            Refresh
          </button>
          <button className="CanvasPageView__ToastClose" onClick={() => setUpdateToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Delete Page"
        message={page.type === 'folder'
          ? `"${page.title}" 폴더와 하위 문서가 모두 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`
          : `"${page.title}" 문서를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`}
        confirmLabel="Delete"
        variant="danger"
      />
      <PageMoveModal
        isOpen={showMoveModal}
        onClose={() => setShowMoveModal(false)}
        onConfirm={handleMove}
        pages={movePages}
        currentPageId={pageId ? Number(pageId) : null}
        canvasName={moveCanvasName}
      />
      <AnnotationSidebar
        annotations={annotations}
        isOpen={sidebarOpen}
        onClose={() => { setSidebarOpen(false); setActiveAnnotationId(null); }}
        onResolve={resolveAnnotation}
        onReopen={reopenAnnotation}
        onDelete={deleteAnnotation}
        onCreateReply={createReply}
        onUpdateReply={updateReply}
        onDeleteReply={deleteReply}
        activeAnnotationId={activeAnnotationId}
        onAnnotationSelect={(id) => {
          setActiveAnnotationId(id);
          // 해당 텍스트로 스크롤
          const el = contentRef.current?.querySelector(
            `.annotation-anchor[data-annotation-id="${id}"]`
          );
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }}
        newAnnotationData={newAnnotationData}
        onSubmitNewAnnotation={async (html) => {
          if (!newAnnotationData) return;
          const annId = await createAnnotation({ ...newAnnotationData, content: html });
          if (annId) {
            setNewAnnotationData(null);
            setActiveAnnotationId(annId);
          }
        }}
        onCancelNewAnnotation={() => setNewAnnotationData(null)}
      />

      {/* 활동 이력 사이드바 */}
      {historyOpen && (
        <div className="CanvasPageView__HistorySidebar">
          <div className="CanvasPageView__HistorySidebarHeader">
            <span>History</span>
            <button onClick={() => setHistoryOpen(false)}><X size={14} /></button>
          </div>
          <div className="CanvasPageView__HistorySidebarContent">
            <ActivityTimeline
              apiUrl={`/canvases/${canvasId}/pages/${pageId}/activity`}
              expanded
            />
          </div>
        </div>
      )}
    </div>
  );
}
