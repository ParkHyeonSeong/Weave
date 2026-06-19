import { useState } from 'react';
import { Plus, Circle, CheckCircle2, X } from 'lucide-react';
import { axios } from '@/library/_axios';
import Avatar from '@/components/common/Avatar';

// status.category === 'done' 인 status key 집합 → done 카운트 폴백
function progressFromRows(subtasks, workflowStatuses) {
  const cat = {};
  (workflowStatuses || []).forEach((ws) => { cat[ws.key] = ws.category; });
  let done = 0;
  let total = 0;
  subtasks.forEach((s) => {
    const c = cat[s.status];
    if (c === 'cancelled') return;        // 분모 제외
    total += 1;
    if (c === 'done') done += 1;
  });
  return { done, total };
}

export default function TaskSubtaskSection({
  branchId, taskId, subtasks = [], progress, workflowStatuses = [], taskTypes = [], defaultTaskType, onSelectTask, onChanged,
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [subtaskError, setSubtaskError] = useState('');

  const prog = progress || progressFromRows(subtasks, workflowStatuses);

  const doneKeys = new Set(
    (workflowStatuses || []).filter((w) => w.category === 'done').map((w) => w.key),
  );
  const statusColor = (key) =>
    (workflowStatuses || []).find((w) => w.key === key)?.color || '#9CA3AF';
  const statusLabel = (key) =>
    (workflowStatuses || []).find((w) => w.key === key)?.label || key;

  const submit = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    setSubtaskError('');
    try {
      const res = await axios.post(`/branches/${branchId}/tasks`, {
        title: t,
        parent_task_id: taskId,
        // taskTypes 로딩 전(빈 배열)엔 undefined로 빠지므로, 부모 태스크의 task_type(항상 유효)로 fallback
        task_type: taskTypes?.[0]?.type_key ?? defaultTaskType,
      });
      if (res.data.status) {
        setTitle('');
        setAdding(false);
        setSubtaskError('');
        window.dispatchEvent(new Event('task:updated'));
        onChanged?.();
      } else {
        // 컨트롤러 검증 실패는 200 + {status:false} (silent-200 계약). 호출부에서 확인.
        const messages = {
          INVALID_TASK_TYPE: '이 브랜치에 없는 작업 유형이에요. 유형을 다시 선택해 주세요.',
        };
        setSubtaskError(messages[res.data.message] || res.data.message || res.data.detail || '하위태스크를 만들지 못했어요.');
      }
    } catch {
      setSubtaskError('하위태스크를 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="TaskSubtaskSection">
      <div className="TaskSubtaskSection__Header">
        <span className="TaskSubtaskSection__Label">
          Subtasks
          {prog.total > 0 && (
            <span className="TaskSubtaskSection__Count">{prog.done}/{prog.total}</span>
          )}
        </span>
        <button
          type="button"
          className="TaskSubtaskSection__AddBtn"
          onClick={() => { setAdding((v) => !v); setSubtaskError(''); }}
        >
          <Plus size={14} />
        </button>
      </div>

      {subtasks.length === 0 && !adding ? (
        <div className="TaskSubtaskSection__Empty">No subtasks yet.</div>
      ) : (
        <div className="TaskSubtaskSection__List">
          {subtasks.map((st) => {
            const done = doneKeys.has(st.status);
            const main = (st.assignees || []).find((a) => a.role === 'main');
            return (
              <button
                key={st.task_id}
                type="button"
                className="TaskSubtaskSection__Item"
                onClick={() => onSelectTask?.({ task_id: st.task_id, branch_id: st.branch_id, title: st.title })}
              >
                {done
                  ? <CheckCircle2 size={14} className="TaskSubtaskSection__StatusIcon TaskSubtaskSection__StatusIcon--done" />
                  : <Circle size={14} className="TaskSubtaskSection__StatusIcon" />}
                <span className="TaskSubtaskSection__ItemId">{st.display_id}</span>
                <span className="TaskSubtaskSection__ItemTitle">{st.title}</span>
                <span
                  className="TaskSubtaskSection__Pill"
                  style={{ color: statusColor(st.status), borderColor: statusColor(st.status) }}
                >
                  {statusLabel(st.status)}
                </span>
                {main && (
                  <Avatar
                    name={main.username}
                    userId={main.user_id}
                    avatarUrl={main.avatar_url}
                    avatarColor={main.avatar_color}
                    size="xs"
                    className="TaskSubtaskSection__Assignee"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {adding && (
        <form
          className="TaskSubtaskSection__AddForm"
          onSubmit={(e) => { e.preventDefault(); submit(); }}
        >
          <input
            className="TaskSubtaskSection__AddInput"
            value={title}
            autoFocus
            placeholder="Subtask title…"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setAdding(false); setTitle(''); setSubtaskError(''); } }}
          />
          <button type="submit" className="TaskSubtaskSection__AddSubmit" disabled={busy || !title.trim()}>
            Add
          </button>
          <button type="button" className="TaskSubtaskSection__AddCancel" onClick={() => { setAdding(false); setTitle(''); setSubtaskError(''); }}>
            <X size={14} />
          </button>
        </form>
      )}
      {adding && subtaskError && (
        <div className="TaskSubtaskSection__Error">{subtaskError}</div>
      )}
    </div>
  );
}
