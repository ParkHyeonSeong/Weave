import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { Pencil, X, Wifi, WifiOff, Loader, RefreshCw } from 'lucide-react';
import { axios } from '@/library/_axios';
import useCollabProvider from '@/library/useCollabProvider';
import PresenceBar from './PresenceBar';
import katex from 'katex';
import { common, createLowlight } from 'lowlight';
import { toHtml } from 'hast-util-to-html';

const lowlight = createLowlight(common);

// SSR 비활성화
const CanvasCollabEditor = dynamic(() => import('./CanvasCollabEditor'), { ssr: false });

export default function CanvasPageView() {
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

  // sessionStorage에서 유저 정보 로드
  useEffect(() => {
    try {
      const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
      if (profile.user_id) setUser(profile);
    } catch {}
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

  useEffect(() => {
    fetchPage();
    setIsEditing(false);
  }, [fetchPage]);

  // 연결 상태에 따른 saveStatus 업데이트
  useEffect(() => {
    if (!isEditing) return;
    if (status === 'disconnected') setSaveStatus('offline');
    else if (status === 'connected') setSaveStatus('saved');
  }, [status, isEditing]);

  // 읽기 모드에서 KaTeX 수식 렌더링
  useEffect(() => {
    if (isEditing || !contentRef.current) return;
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
    if (isEditing || !contentRef.current) return;
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

  // 읽기 모드에서 태스크 레퍼런스 클릭 핸들러
  useEffect(() => {
    if (isEditing || !contentRef.current) return;
    const taskNodes = contentRef.current.querySelectorAll('[data-task-ref]');
    const handlers = [];
    taskNodes.forEach((el) => {
      el.classList.add('task-ref', `task-ref--${el.getAttribute('data-status') || 'todo'}`);
      el.style.cursor = 'pointer';
      const handler = () => {
        const branchId = el.getAttribute('data-branch-id');
        const taskId = el.getAttribute('data-task-id');
        if (branchId && taskId) router.push(`/branch/${branchId}?task=${taskId}`);
      };
      el.addEventListener('click', handler);
      handlers.push({ el, handler });
    });
    return () => handlers.forEach(({ el, handler }) => el.removeEventListener('click', handler));
  }, [isEditing, page?.content, router]);

  // 제목 변경 (debounced)
  const handleTitleChange = (e) => {
    const newTitle = e.target.value;
    setEditTitle(newTitle);
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
    titleTimerRef.current = setTimeout(async () => {
      if (newTitle && newTitle !== page?.title) {
        try {
          await axios.patch(`/canvases/${canvasId}/pages/${pageId}`, { title: newTitle });
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
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current);
    htmlRef.current = '';
    setIsEditing(false);
    fetchPage();
  }, [canvasId, pageId, fetchPage]);

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
    <div className="CanvasPageView">
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

      {/* 내용 */}
      <div className="CanvasPageView__Body">
        {isEditing ? (
          ydoc && provider ? (
            <CanvasCollabEditor
              ydoc={ydoc}
              provider={provider}
              canvasId={Number(canvasId)}
              initialContent={page.content || ''}
              hasExistingYjsState={!!page.yjs_state}
              onHtmlChange={handleHtmlChange}
            />
          ) : (
            <div className="CanvasPageView__Loading">Connecting...</div>
          )
        ) : (
          <div
            ref={contentRef}
            className="CanvasPageView__Content ProseMirror"
            dangerouslySetInnerHTML={{ __html: page.content || '<p>No content yet. Click Edit to start writing.</p>' }}
          />
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
    </div>
  );
}
