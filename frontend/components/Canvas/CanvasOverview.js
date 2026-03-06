import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { Pencil, Save, X } from 'lucide-react';
import { axios } from '@/library/_axios';
import katex from 'katex';
import { common, createLowlight } from 'lowlight';
import { toHtml } from 'hast-util-to-html';

const lowlight = createLowlight(common);
const CanvasEditor = dynamic(() => import('./CanvasEditor'), { ssr: false });

export default function CanvasOverview() {
  const router = useRouter();
  const { canvasId } = router.query;
  const [canvas, setCanvas] = useState(null);
  const [overview, setOverview] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const contentRef = useRef(null);

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
          // overview의 상세 내용 가져오기
          const detail = await axios.get(`/canvases/${canvasId}/pages/${ov.page_id}`);
          if (detail.data.status) {
            setOverview(detail.data.page);
            setEditTitle(detail.data.page.title);
            setEditContent(detail.data.page.content || '');
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
  }, [isEditing, overview?.content]);

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
  }, [isEditing, overview?.content]);

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
  }, [isEditing, overview?.content, router]);

  const handleSave = async () => {
    if (!overview) return;
    setSaving(true);
    try {
      const body = {};
      if (editTitle !== overview.title) body.title = editTitle;
      if (editContent !== (overview.content || '')) body.content = editContent;

      if (Object.keys(body).length > 0) {
        await axios.patch(`/canvases/${canvasId}/pages/${overview.page_id}`, body);
        await fetchOverview();
      }
      setIsEditing(false);
    } catch {}
    setSaving(false);
  };

  const handleCancel = () => {
    setEditTitle(overview.title);
    setEditContent(overview.content || '');
    setIsEditing(false);
  };

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

      {/* Overview 편집/보기 */}
      {overview && (
        <div className="CanvasOverview__Overview">
          <div className="CanvasOverview__OverviewTopBar">
            {isEditing ? (
              <>
                <button
                  className="CanvasOverview__OverviewBtn CanvasOverview__OverviewBtn--secondary"
                  onClick={handleCancel}
                >
                  <X size={15} /> Cancel
                </button>
                <button
                  className="CanvasOverview__OverviewBtn CanvasOverview__OverviewBtn--primary"
                  onClick={handleSave}
                  disabled={saving}
                >
                  <Save size={15} /> {saving ? 'Saving...' : 'Save'}
                </button>
              </>
            ) : (
              <button
                className="CanvasOverview__OverviewBtn"
                onClick={() => setIsEditing(true)}
              >
                <Pencil size={15} /> Edit
              </button>
            )}
          </div>

          {isEditing ? (
            <>
              <input
                className="CanvasOverview__OverviewTitleInput"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Overview title..."
              />
              <CanvasEditor content={editContent} onChange={setEditContent} />
            </>
          ) : (
            <div
              ref={contentRef}
              className="CanvasOverview__OverviewContent ProseMirror"
              dangerouslySetInnerHTML={{
                __html: overview.content || '<p>No content yet. Click Edit to start writing.</p>',
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
