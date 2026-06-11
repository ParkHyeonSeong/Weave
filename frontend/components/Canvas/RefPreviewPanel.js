import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { X, ExternalLink, ArrowRight, Loader } from 'lucide-react';
import { axios } from '@/library/_axios';
import { sanitizeHtml } from '@/library/sanitize';
import { useRefHydration } from '@/library/refHydration';

export default function RefPreviewPanel({ refType, refData, onClose }) {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const bodyRef = useRef(null);

  // refData를 안정적인 키로 변환 (객체 참조 비교 문제 방지)
  const refKey = JSON.stringify({ refType, ...refData });

  useEffect(() => {
    setData(null);
    setLoading(true);
    let cancelled = false;

    const fetchData = async () => {
      try {
        let res;
        if (refType === 'task') {
          res = await axios.get(`/branches/${refData.branchId}/tasks/${refData.taskId}`);
          if (!cancelled && res.data.status) setData(res.data.task);
        } else if (refType === 'doc') {
          res = await axios.get(`/canvases/${refData.canvasId}/pages/${refData.pageId}`);
          if (!cancelled && res.data.status) setData(res.data.page);
        } else if (refType === 'issue') {
          res = await axios.get(`/branches/${refData.branchId}/tasks/${refData.taskId}/issues/${refData.issueId}`);
          if (!cancelled && res.data.status) setData(res.data.issue);
        }
      } catch {}
      if (!cancelled) setLoading(false);
    };

    fetchData();
    return () => { cancelled = true; };
  }, [refKey]);

  // 프리뷰 본문의 ref 칩 하이드레이션 (최신 제목·상태 + 탭 내 변경 이벤트)
  useRefHydration(bodyRef, [data]);

  const getNavigateUrl = () => {
    if (refType === 'task') return `/branch/${refData.branchId}/task/${refData.taskId}`;
    if (refType === 'doc') return `/canvas/${refData.canvasId}/${refData.pageId}`;
    if (refType === 'issue') return `/branch/${refData.branchId}/task/${refData.taskId}/issue/${refData.issueId}`;
    return '/';
  };

  const handleNavigate = () => {
    router.push(getNavigateUrl());
  };

  const handleOpenNewTab = () => {
    window.open(getNavigateUrl(), '_blank');
  };

  const typeLabels = { task: 'Task', doc: 'Document', issue: 'Issue' };

  return (
    <div className="RefPreviewPanel">
      <div className="RefPreviewPanel__Header">
        <span className="RefPreviewPanel__TypeLabel">{typeLabels[refType] || 'Preview'}</span>
        <div className="RefPreviewPanel__HeaderRight">
          <button className="RefPreviewPanel__HeaderBtn" onClick={handleOpenNewTab} title="Open in new tab">
            <ExternalLink size={14} />
          </button>
          <button className="RefPreviewPanel__HeaderBtn" onClick={handleNavigate} title="Navigate">
            <ArrowRight size={14} />
          </button>
          <button className="RefPreviewPanel__HeaderBtn" onClick={onClose} title="Close">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="RefPreviewPanel__Body" ref={bodyRef}>
        {loading ? (
          <div className="RefPreviewPanel__Loading">
            <Loader size={20} className="RefPreviewPanel__Spinner" />
          </div>
        ) : !data ? (
          <div className="RefPreviewPanel__Empty">Failed to load content.</div>
        ) : (
          <>
            {refType === 'task' && <TaskPreview task={data} />}
            {refType === 'doc' && <DocPreview page={data} />}
            {refType === 'issue' && <IssuePreview issue={data} />}
          </>
        )}
      </div>
    </div>
  );
}

function TaskPreview({ task }) {
  const statusCategory = task.status_category || task.status;

  return (
    <div className="RefPreviewPanel__Content">
      <div className="RefPreviewPanel__TitleRow">
        <span className="RefPreviewPanel__DisplayId">{task.display_id}</span>
        <span className={`RefPreviewPanel__Badge RefPreviewPanel__Badge--${statusCategory}`}
          style={task.status_color ? { backgroundColor: `${task.status_color}20`, color: task.status_color } : {}}
        >
          {task.status_label || task.status}
        </span>
      </div>
      <h3 className="RefPreviewPanel__Title">{task.title}</h3>

      {task.priority && (
        <div className="RefPreviewPanel__Field">
          <span className="RefPreviewPanel__FieldLabel">Priority</span>
          <span className="RefPreviewPanel__FieldValue">{task.priority}</span>
        </div>
      )}

      {task.assignees && task.assignees.length > 0 && (
        <div className="RefPreviewPanel__Field">
          <span className="RefPreviewPanel__FieldLabel">Assignees</span>
          <span className="RefPreviewPanel__FieldValue">
            {task.assignees.map((a) => a.username).join(', ')}
          </span>
        </div>
      )}

      {task.epic_name && (
        <div className="RefPreviewPanel__Field">
          <span className="RefPreviewPanel__FieldLabel">Epic</span>
          <span className="RefPreviewPanel__FieldValue">{task.epic_name}</span>
        </div>
      )}

      {task.sprint_name && (
        <div className="RefPreviewPanel__Field">
          <span className="RefPreviewPanel__FieldLabel">Sprint</span>
          <span className="RefPreviewPanel__FieldValue">{task.sprint_name}</span>
        </div>
      )}

      {task.description && (
        <div className="RefPreviewPanel__Section">
          <span className="RefPreviewPanel__SectionTitle">Description</span>
          <div
            className="RefPreviewPanel__HtmlContent"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(task.description) }}
          />
        </div>
      )}
    </div>
  );
}

function DocPreview({ page }) {
  return (
    <div className="RefPreviewPanel__Content">
      <h3 className="RefPreviewPanel__Title">{page.title}</h3>

      {page.content && (
        <div
          className="RefPreviewPanel__HtmlContent RefPreviewPanel__HtmlContent--doc ProseMirror"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(page.content) }}
        />
      )}
    </div>
  );
}

function IssuePreview({ issue }) {
  const statusLabel = issue.status === 'open' ? 'Open' : 'Closed';

  return (
    <div className="RefPreviewPanel__Content">
      <div className="RefPreviewPanel__TitleRow">
        <span className={`RefPreviewPanel__Badge RefPreviewPanel__Badge--${issue.status}`}>
          {statusLabel}
        </span>
      </div>
      <h3 className="RefPreviewPanel__Title">{issue.title}</h3>

      {issue.description && (
        <div className="RefPreviewPanel__Section">
          <span className="RefPreviewPanel__SectionTitle">Description</span>
          <div
            className="RefPreviewPanel__HtmlContent"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(issue.description) }}
          />
        </div>
      )}
    </div>
  );
}
