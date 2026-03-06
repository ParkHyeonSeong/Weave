import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { Pencil, Save, X } from 'lucide-react';
import { axios } from '@/library/_axios';
import katex from 'katex';
import { common, createLowlight } from 'lowlight';
import { toHtml } from 'hast-util-to-html';

const lowlight = createLowlight(common);

// SSR 비활성화 (TipTap은 브라우저 전용)
const CanvasEditor = dynamic(() => import('./CanvasEditor'), { ssr: false });

const MAX_PLAIN_TEXT_LENGTH = 60000;

function getPlainTextLength(html) {
  if (!html) return 0;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || '').length;
}

export default function CanvasPageView() {
  const router = useRouter();
  const { canvasId, pageId } = router.query;
  const [page, setPage] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const contentRef = useRef(null);

  const fetchPage = useCallback(async () => {
    if (!canvasId || !pageId) return;
    try {
      const res = await axios.get(`/canvases/${canvasId}/pages/${pageId}`);
      if (res.data.status) {
        setPage(res.data.page);
        setEditTitle(res.data.page.title);
        setEditContent(res.data.page.content || '');
      }
    } catch {}
  }, [canvasId, pageId]);

  useEffect(() => {
    fetchPage();
    setIsEditing(false);
  }, [fetchPage]);

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

  const handleSave = async () => {
    // 길이 제한 체크
    if (getPlainTextLength(editContent) > MAX_PLAIN_TEXT_LENGTH) {
      setSaveError(`Content exceeds the maximum length of ${MAX_PLAIN_TEXT_LENGTH.toLocaleString()} characters.`);
      return;
    }
    setSaveError('');
    setSaving(true);
    try {
      const body = {};
      if (editTitle !== page.title) body.title = editTitle;
      if (editContent !== (page.content || '')) body.content = editContent;

      if (Object.keys(body).length > 0) {
        await axios.patch(`/canvases/${canvasId}/pages/${pageId}`, body);
        await fetchPage();
      }
      setIsEditing(false);
    } catch {}
    setSaving(false);
  };

  const handleCancel = () => {
    setEditTitle(page.title);
    setEditContent(page.content || '');
    setIsEditing(false);
    setSaveError('');
  };

  if (!page) return null;

  return (
    <div className="CanvasPageView">
      <div className="CanvasPageView__TopBar">
        <div className="CanvasPageView__Actions">
          {isEditing ? (
            <>
              <button
                className="CanvasPageView__ActionBtn CanvasPageView__ActionBtn--secondary"
                onClick={handleCancel}
              >
                <X size={15} />
                Cancel
              </button>
              <button
                className="CanvasPageView__ActionBtn CanvasPageView__ActionBtn--primary"
                onClick={handleSave}
                disabled={saving}
              >
                <Save size={15} />
                {saving ? 'Saving...' : 'Save'}
              </button>
            </>
          ) : (
            <button
              className="CanvasPageView__ActionBtn"
              onClick={() => setIsEditing(true)}
            >
              <Pencil size={15} />
              Edit
            </button>
          )}
        </div>
        {saveError && <div className="CanvasPageView__Error">{saveError}</div>}
      </div>

      {/* 제목 */}
      <div className="CanvasPageView__TitleArea">
        {isEditing ? (
          <input
            className="CanvasPageView__TitleInput"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Page title..."
          />
        ) : (
          <h1 className="CanvasPageView__Title">{page.title}</h1>
        )}
        {!isEditing && page.updated_at && (
          <span className="CanvasPageView__Meta">
            Last updated {new Date(page.updated_at).toLocaleDateString()}
            {page.created_by_name && ` by ${page.created_by_name}`}
          </span>
        )}
      </div>

      {/* 내용 */}
      <div className="CanvasPageView__Body">
        {isEditing ? (
          <CanvasEditor
            content={editContent}
            onChange={setEditContent}
            canvasId={Number(canvasId)}
          />
        ) : (
          <div
            ref={contentRef}
            className="CanvasPageView__Content ProseMirror"
            dangerouslySetInnerHTML={{ __html: page.content || '<p>No content yet. Click Edit to start writing.</p>' }}
          />
        )}
      </div>
    </div>
  );
}
