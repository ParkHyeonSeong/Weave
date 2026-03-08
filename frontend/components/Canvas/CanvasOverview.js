import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { Pencil, X, Wifi, WifiOff, Loader } from 'lucide-react';
import { axios } from '@/library/_axios';
import useCollabProvider from '@/library/useCollabProvider';
import PresenceBar from './PresenceBar';

const CanvasCollabEditor = dynamic(() => import('./CanvasCollabEditor'), { ssr: false });

export default function CanvasOverview() {
  const router = useRouter();
  const { canvasId } = router.query;
  const [canvas, setCanvas] = useState(null);
  const [overview, setOverview] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [user, setUser] = useState(null);
  const [saveStatus, setSaveStatus] = useState('saved');
  const htmlRef = useRef('');
  const contentTimerRef = useRef(null);
  const contentRef = useRef(null);

  useEffect(() => {
    try {
      const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
      if (profile.user_id) setUser(profile);
    } catch {}
  }, []);

  const fetchCanvas = async () => {
    try {
      const res = await axios.get(`/canvases/${canvasId}`);
      if (res.data.status) setCanvas(res.data.canvas);
    } catch {}
  };

  const fetchOverview = useCallback(async () => {
    if (!canvasId) return;
    try {
      const res = await axios.get(`/canvases/${canvasId}/pages`);
      if (res.data.status) {
        const ov = res.data.pages.find((p) => p.type === 'overview');
        if (ov) {
          const detail = await axios.get(`/canvases/${canvasId}/pages/${ov.page_id}`);
          if (detail.data.status) {
            setOverview(detail.data.page);
          }
        }
      }
    } catch {}
  }, [canvasId]);

  useEffect(() => {
    if (!canvasId) return;
    fetchCanvas();
    fetchOverview();
  }, [canvasId, fetchOverview]);

  // Edit 모드일 때만 WebSocket 연결
  const { ydoc, provider, status, connectedUsers } = useCollabProvider(
    isEditing && canvasId ? Number(canvasId) : null,
    isEditing && overview?.page_id ? overview.page_id : null,
    isEditing ? user : null
  );

  useEffect(() => {
    if (!isEditing) return;
    if (status === 'disconnected') setSaveStatus('offline');
    else if (status === 'connected') setSaveStatus('saved');
  }, [status, isEditing]);

  // 읽기 모드에서 레퍼런스 클릭 핸들러 (task, doc, issue)
  useEffect(() => {
    if (isEditing || !contentRef.current) return;
    const handlers = [];

    contentRef.current.querySelectorAll('[data-task-ref]').forEach((el) => {
      el.classList.add('task-ref');
      el.style.cursor = 'pointer';
      const handler = () => {
        const branchId = el.getAttribute('data-branch-id');
        const taskId = el.getAttribute('data-task-id');
        if (branchId && taskId) router.push(`/branch/${branchId}/task/${taskId}`);
      };
      el.addEventListener('click', handler);
      handlers.push({ el, handler });
    });

    contentRef.current.querySelectorAll('[data-doc-ref]').forEach((el) => {
      el.classList.add('doc-ref');
      el.style.cursor = 'pointer';
      const handler = () => {
        const cId = el.getAttribute('data-canvas-id');
        const pId = el.getAttribute('data-page-id');
        if (cId && pId) router.push(`/canvas/${cId}/${pId}`);
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
        if (branchId && taskId && issueId) router.push(`/branch/${branchId}/task/${taskId}/issue/${issueId}`);
      };
      el.addEventListener('click', handler);
      handlers.push({ el, handler });
    });

    return () => handlers.forEach(({ el, handler }) => el.removeEventListener('click', handler));
  }, [isEditing, overview?.content, router]);

  // 읽기 모드에서 ref 상태 배치 갱신 + 뱃지 주입
  useEffect(() => {
    if (isEditing || !contentRef.current) return;

    const taskIds = new Set();
    const issueIds = new Set();

    contentRef.current.querySelectorAll('[data-task-ref]').forEach((el) => {
      const id = el.getAttribute('data-task-id');
      if (id) taskIds.add(Number(id));
    });
    contentRef.current.querySelectorAll('[data-issue-ref]').forEach((el) => {
      const id = el.getAttribute('data-issue-id');
      if (id) issueIds.add(Number(id));
    });

    const taskStatusMap = { todo: 'Todo', in_progress: 'In Progress', done: 'Done', in_review: 'In Review', testing: 'Testing', blocked: 'Blocked' };
    const issueStatusMap = { open: 'Open', closed: 'Closed' };

    const injectBadge = (el, status, labelMap) => {
      el.querySelector('[data-ref-badge]')?.remove();
      const badge = document.createElement('span');
      badge.className = `ref-chip__badge ref-chip__badge--${status}`;
      badge.textContent = labelMap[status] || status;
      badge.setAttribute('data-ref-badge', 'true');
      el.appendChild(badge);
    };

    contentRef.current.querySelectorAll('[data-task-ref]').forEach((el) => {
      const status = el.getAttribute('data-status') || 'todo';
      injectBadge(el, status, taskStatusMap);
    });
    contentRef.current.querySelectorAll('[data-issue-ref]').forEach((el) => {
      const status = el.getAttribute('data-status') || 'open';
      injectBadge(el, status, issueStatusMap);
    });

    if (taskIds.size === 0 && issueIds.size === 0) return;

    axios.post('/ref-status', {
      task_ids: [...taskIds],
      issue_ids: [...issueIds],
    }).then((res) => {
      if (!res.data.status || !contentRef.current) return;
      const { tasks, issues } = res.data;

      contentRef.current.querySelectorAll('[data-task-ref]').forEach((el) => {
        const id = el.getAttribute('data-task-id');
        const info = tasks[id];
        if (info) injectBadge(el, info.status, taskStatusMap);
      });
      contentRef.current.querySelectorAll('[data-issue-ref]').forEach((el) => {
        const id = el.getAttribute('data-issue-id');
        const info = issues[id];
        if (info) injectBadge(el, info.status, issueStatusMap);
      });
    }).catch(() => {});
  }, [isEditing, overview?.content]);

  const handleHtmlChange = (html) => {
    htmlRef.current = html;
    if (contentTimerRef.current) clearTimeout(contentTimerRef.current);
    contentTimerRef.current = setTimeout(async () => {
      if (!overview) return;
      setSaveStatus('saving');
      try {
        await axios.patch(`/canvases/${canvasId}/pages/${overview.page_id}`, {
          content: htmlRef.current,
        });
        setSaveStatus('saved');
      } catch {
        setSaveStatus('offline');
      }
    }, 5000);
  };

  const handleCloseEdit = async () => {
    if (htmlRef.current) {
      try {
        await axios.patch(`/canvases/${canvasId}/pages/${overview.page_id}`, {
          content: htmlRef.current,
        });
      } catch {}
    }
    if (contentTimerRef.current) clearTimeout(contentTimerRef.current);
    htmlRef.current = '';
    setIsEditing(false);
    fetchOverview();
  };

  useEffect(() => {
    return () => {
      if (contentTimerRef.current) clearTimeout(contentTimerRef.current);
    };
  }, []);

  if (!canvas) return null;

  return (
    <div className="CanvasOverview">
      <div className="CanvasOverview__Header">
        <div className="CanvasOverview__TitleRow">
          <span
            className="CanvasOverview__Dot"
            style={{ backgroundColor: canvas.color || '#16A34A' }}
          />
          <h2 className="CanvasOverview__Name">{canvas.canvas_name}</h2>
        </div>
        {canvas.description && (
          <p className="CanvasOverview__Desc">{canvas.description}</p>
        )}
      </div>

      {overview && (
        <div className="CanvasOverview__Overview">
          <div className="CanvasOverview__OverviewTopBar">
            {isEditing ? (
              <>
                <div className="CanvasOverview__StatusGroup">
                  <span className={`CanvasOverview__Status CanvasOverview__Status--${status}`}>
                    {status === 'connected' ? <Wifi size={14} /> :
                     status === 'connecting' ? <Loader size={14} className="CanvasOverview__StatusSpin" /> :
                     <WifiOff size={14} />}
                  </span>
                  <span className="CanvasOverview__SaveStatus">
                    {saveStatus === 'saved' ? 'Saved' : saveStatus === 'saving' ? 'Saving...' : 'Offline'}
                  </span>
                </div>
                <div className="CanvasOverview__OverviewActions">
                  <PresenceBar users={connectedUsers} currentUserId={user?.user_id} />
                  <button className="CanvasOverview__OverviewBtn" onClick={handleCloseEdit}>
                    <X size={15} />
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <div />
                <button className="CanvasOverview__OverviewBtn" onClick={() => setIsEditing(true)}>
                  <Pencil size={15} />
                  Edit
                </button>
              </>
            )}
          </div>

          <div className="CanvasOverview__OverviewBody">
            {isEditing ? (
              ydoc && provider ? (
                <CanvasCollabEditor
                  ydoc={ydoc}
                  provider={provider}
                  canvasId={Number(canvasId)}
                  initialContent={overview.content || ''}
                  hasExistingYjsState={!!overview.yjs_state}
                  onHtmlChange={handleHtmlChange}
                />
              ) : (
                <div className="CanvasOverview__Loading">Connecting...</div>
              )
            ) : (
              <div
                ref={contentRef}
                className="CanvasOverview__OverviewContent"
                dangerouslySetInnerHTML={{
                  __html: overview.content || '<p>No content yet. Click Edit to start writing.</p>',
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
