import { useState, useEffect } from 'react';
import { axios } from '@/library/_axios';
import { X, Trash2 } from 'lucide-react';
import CustomSelect from '@/components/common/CustomSelect';
import TaskTypeIcon from '@/components/common/TaskTypeIcon';

const COLORS = ['#5E6AD2', '#2563EB', '#DC2626', '#16A34A', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4'];

const STATUS_COLORS = {
  todo: '#9CA3AF',
  in_progress: '#2563EB',
  done: '#16A34A',
};

export default function EpicDetailPanel({ branchId, workflowStatuses = [], epicSummary, onClose, onSelectTask }) {
  const [epic, setEpic] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  // 제목 편집
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');

  // 설명 편집
  const [editingDesc, setEditingDesc] = useState(false);
  const [descValue, setDescValue] = useState('');

  useEffect(() => {
    if (!epicSummary) return;
    fetchEpic();
  }, [epicSummary?.epic_id]);

  const fetchEpic = async () => {
    setLoading(true);
    try {
      const [epicRes, taskRes] = await Promise.all([
        axios.get(`/branches/${branchId}/epics`),
        axios.get(`/branches/${branchId}/epics/${epicSummary.epic_id}/tasks`),
      ]);
      if (epicRes.data.status) {
        const found = epicRes.data.epics.find((e) => e.epic_id === epicSummary.epic_id);
        if (found) setEpic(found);
      }
      if (taskRes.data.status) setTasks(taskRes.data.tasks);
    } catch {}
    setLoading(false);
  };

  const updateField = async (field, value) => {
    try {
      const payload = { [field]: value };
      const res = await axios.patch(`/branches/${branchId}/epics/${epic.epic_id}`, payload);
      if (res.data.status) {
        await fetchEpic();
        window.dispatchEvent(new Event('epic:updated'));
      }
    } catch {}
  };

  const saveTitle = () => {
    if (titleValue.trim() && titleValue.trim() !== epic.epic_name) {
      updateField('epic_name', titleValue.trim());
    }
    setEditingTitle(false);
  };

  const saveDesc = () => {
    const val = descValue.trim() || null;
    if (val !== (epic.description || null)) {
      updateField('description', val);
    }
    setEditingDesc(false);
  };

  const handleDelete = async () => {
    try {
      const res = await axios.delete(`/branches/${branchId}/epics/${epic.epic_id}`);
      if (res.data.status) {
        window.dispatchEvent(new Event('epic:updated'));
        onClose();
      }
    } catch {}
  };

  // 태스크 클릭 -> 태스크탭 + 상세패널 열기
  const handleTaskClick = (task) => {
    if (onSelectTask) onSelectTask(task);
  };

  if (loading || !epic) {
    return (
      <div className="TaskDetailPanel">
        <div className="TaskDetailPanel__Header">
          <div />
          <button className="TaskDetailPanel__CloseBtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  // 워크플로우 상태 정보 매핑
  const getStatusInfo = (statusKey) => {
    const ws = workflowStatuses.find((w) => w.key === statusKey);
    if (ws) return { label: ws.label, color: ws.color };
    return { label: statusKey, color: STATUS_COLORS[statusKey] || '#9CA3AF' };
  };

  return (
    <div className="TaskDetailPanel">
      {/* 헤더 */}
      <div className="TaskDetailPanel__Header">
        <div className="TaskDetailPanel__HeaderLeft">
          <span
            style={{
              width: 10, height: 10, borderRadius: '50%',
              backgroundColor: epic.color || '#5E6AD2', flexShrink: 0,
            }}
          />
          <span className="TaskDetailPanel__Id">Epic</span>
        </div>
        <button className="TaskDetailPanel__CloseBtn" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      <div className="TaskDetailPanel__Body">
        {/* 제목 */}
        <div className="TaskDetailPanel__TitleWrap">
          {editingTitle ? (
            <input
              className="TaskDetailPanel__TitleInput"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
              autoFocus
            />
          ) : (
            <h2
              className="TaskDetailPanel__Title"
              onClick={() => { setTitleValue(epic.epic_name); setEditingTitle(true); }}
            >
              {epic.epic_name}
            </h2>
          )}
        </div>

        {/* 상태 */}
        <div className="TaskDetailPanel__StatusWrap">
          <CustomSelect
            value={epic.status}
            options={workflowStatuses.length > 0
              ? workflowStatuses.map((ws) => ({ value: ws.key, label: ws.label, color: ws.color }))
              : [
                { value: 'todo', label: 'To Do', color: '#9CA3AF' },
                { value: 'in_progress', label: 'In Progress', color: '#2563EB' },
                { value: 'done', label: 'Done', color: '#16A34A' },
              ]
            }
            onChange={(val) => updateField('status', val)}
          />
        </div>

        {/* 설명 */}
        <div className="TaskDetailPanel__Section">
          <div className="TaskDetailPanel__SectionLabel">Description</div>
          {editingDesc ? (
            <textarea
              className="TaskDetailPanel__DescInput"
              value={descValue}
              onChange={(e) => setDescValue(e.target.value)}
              onBlur={saveDesc}
              onKeyDown={(e) => { if (e.key === 'Escape') setEditingDesc(false); }}
              autoFocus
              rows={4}
            />
          ) : (
            <div
              className={`TaskDetailPanel__DescText ${!epic.description ? 'TaskDetailPanel__DescText--empty' : ''}`}
              onClick={() => { setDescValue(epic.description || ''); setEditingDesc(true); }}
            >
              {epic.description || 'Add description...'}
            </div>
          )}
        </div>

        <div className="TaskDetailPanel__Divider" />

        {/* 세부 사항 */}
        <div className="TaskDetailPanel__Section">
          <div className="TaskDetailPanel__SectionLabel">Details</div>
          <div className="TaskDetailPanel__Fields">
            {/* 색상 */}
            <div className="TaskDetailPanel__Row">
              <span className="TaskDetailPanel__RowLabel">Color</span>
              <div className="TaskDetailPanel__RowValue">
                <div style={{ display: 'flex', gap: 4 }}>
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      style={{
                        width: 20, height: 20, borderRadius: '50%', backgroundColor: c,
                        border: epic.color === c ? '2px solid #1C1C1C' : '2px solid transparent',
                        cursor: 'pointer', transition: 'transform 150ms ease',
                      }}
                      onClick={() => updateField('color', c)}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* 시작일 */}
            <div className="TaskDetailPanel__Row">
              <span className="TaskDetailPanel__RowLabel">Start date</span>
              <div className="TaskDetailPanel__RowValue">
                <input
                  className="TaskDetailPanel__DateInput"
                  type="date"
                  value={epic.start_date || ''}
                  onChange={(e) => updateField('start_date', e.target.value || null)}
                />
              </div>
            </div>

            {/* 마감일 */}
            <div className="TaskDetailPanel__Row">
              <span className="TaskDetailPanel__RowLabel">Due date</span>
              <div className="TaskDetailPanel__RowValue">
                <input
                  className="TaskDetailPanel__DateInput"
                  type="date"
                  value={epic.due_date || ''}
                  onChange={(e) => updateField('due_date', e.target.value || null)}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="TaskDetailPanel__Divider" />

        {/* 태스크 목록 */}
        <div className="TaskDetailPanel__Section">
          <div className="TaskDetailPanel__SectionLabel">Tasks ({tasks.length})</div>
          <div className="EpicTaskList">
            {tasks.length === 0 ? (
              <div className="EpicTaskList__Empty">No tasks in this epic</div>
            ) : (
              tasks.map((task) => {
                const si = getStatusInfo(task.status);
                return (
                  <div key={task.task_id} className="EpicTaskList__Item" onClick={() => handleTaskClick(task)}>
                    <span className="EpicTaskList__StatusDot" style={{ backgroundColor: si.color }} />
                    <TaskTypeIcon type={task.task_type} size={14} />
                    <span className="EpicTaskList__Id">{task.display_id}</span>
                    <span className="EpicTaskList__Title">{task.title}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="TaskDetailPanel__Divider" />

        <button className="TaskDetailPanel__DeleteBtn" onClick={handleDelete}>
          <Trash2 size={14} />
          Delete epic
        </button>
      </div>
    </div>
  );
}
