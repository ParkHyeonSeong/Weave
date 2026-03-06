import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { Pencil, Save, X } from 'lucide-react';
import { axios } from '@/library/_axios';

// SSR 비활성화 (TipTap은 브라우저 전용)
const CanvasEditor = dynamic(() => import('./CanvasEditor'), { ssr: false });

export default function CanvasPageView() {
  const router = useRouter();
  const { canvasId, pageId } = router.query;
  const [page, setPage] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [saving, setSaving] = useState(false);

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

  const handleSave = async () => {
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
          />
        ) : (
          <div
            className="CanvasPageView__Content ProseMirror"
            dangerouslySetInnerHTML={{ __html: page.content || '<p>No content yet. Click Edit to start writing.</p>' }}
          />
        )}
      </div>
    </div>
  );
}
