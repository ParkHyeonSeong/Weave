import { useState, useEffect, useRef } from 'react';
import { axios } from '@/library/_axios';
import { X, CheckSquare, Bug, BookOpen, Trash2 } from 'lucide-react';

const typeIcons = { task: CheckSquare, bug: Bug, story: BookOpen };
const typeLabels = { task: 'Task', bug: 'Bug', story: 'Story' };
const statusLabels = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' };
const priorityLabels = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
const priorityColors = { urgent: '#DC2626', high: '#F59E0B', medium: '#5E6AD2', low: '#9CA3AF' };

export default function TaskDetailPanel({ branchId, branchKey, taskSummary, onClose }) {
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);

  // 옵션 데이터
  const [sprints, setSprints] = useState([]);
  const [epics, setEpics] = useState([]);
  const [members, setMembers] = useState([]);
  const [labels, setLabels] = useState([]);

  // 인라인 편집 중인 필드
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState('');

  // 제목 편집
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');
  const titleRef = useRef(null);

  // 설명 편집
  const [editingDesc, setEditingDesc] = useState(false);
  const [descValue, setDescValue] = useState('');

  useEffect(() => {
    if (!taskSummary) return;
    fetchTask();
    fetchOptions();
  }, [taskSummary?.task_id]);

  const fetchTask = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/branches/${branchId}/tasks/${taskSummary.task_id}`);
      if (res.data.status) {
        setTask(res.data.task);
      }
    } catch {}
    setLoading(false);
  };

  const fetchOptions = async () => {
    try {
      const [sprintRes, epicRes, memberRes, labelRes] = await Promise.all([
        axios.get(`/branches/${branchId}/sprints`),
        axios.get(`/branches/${branchId}/epics`),
        axios.get(`/branches/${branchId}/members`),
        axios.get(`/branches/${branchId}/labels`),
      ]);
      if (sprintRes.data.status) setSprints(sprintRes.data.sprints);
      if (epicRes.data.status) setEpics(epicRes.data.epics);
      if (memberRes.data.status) setMembers(memberRes.data.members);
      if (labelRes.data.status) setLabels(labelRes.data.labels);
    } catch {}
  };

  // 필드 업데이트 (자동 저장 + 재조회)
  const updateField = async (field, value) => {
    try {
      const payload = { [field]: value };
      const res = await axios.patch(`/branches/${branchId}/tasks/${task.task_id}`, payload);
      if (res.data.status) {
        await fetchTask();
        window.dispatchEvent(new Event('task:updated'));
      }
    } catch {}
  };

  // 라벨 토글
  const toggleLabel = async (labelId) => {
    const currentIds = (task.labels || []).map((l) => l.label_id);
    const newIds = currentIds.includes(labelId)
      ? currentIds.filter((id) => id !== labelId)
      : [...currentIds, labelId];
    try {
      const res = await axios.patch(`/branches/${branchId}/tasks/${task.task_id}`, { label_ids: newIds });
      if (res.data.status) {
        fetchTask();
        window.dispatchEvent(new Event('task:updated'));
      }
    } catch {}
  };

  // 제목 저장
  const saveTitle = () => {
    if (titleValue.trim() && titleValue.trim() !== task.title) {
      updateField('title', titleValue.trim());
    }
    setEditingTitle(false);
  };

  // 설명 저장
  const saveDesc = () => {
    const val = descValue.trim() || null;
    if (val !== (task.description || null)) {
      updateField('description', val);
    }
    setEditingDesc(false);
  };

  // 삭제
  const handleDelete = async () => {
    try {
      const res = await axios.delete(`/branches/${branchId}/tasks/${task.task_id}`);
      if (res.data.status) {
        window.dispatchEvent(new Event('task:updated'));
        onClose();
      }
    } catch {}
  };

  // Select 필드 변경 핸들러
  const handleSelectChange = (field, value) => {
    const parsed = value === '' ? null : (field.endsWith('_id') ? Number(value) : value);
    updateField(field, parsed);
    setEditingField(null);
  };

  if (loading || !task) {
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

  const TypeIcon = typeIcons[task.task_type] || CheckSquare;
  const displayId = task.display_id || `${branchKey}-${task.display_number}`;

  return (
    <div className="TaskDetailPanel">
      {/* 헤더 */}
      <div className="TaskDetailPanel__Header">
        <div className="TaskDetailPanel__HeaderLeft">
          <TypeIcon
            size={14}
            style={{ color: task.task_type === 'bug' ? '#DC2626' : '#5E6AD2' }}
          />
          <span className="TaskDetailPanel__Id">{displayId}</span>
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
              ref={titleRef}
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
              onClick={() => { setTitleValue(task.title); setEditingTitle(true); }}
            >
              {task.title}
            </h2>
          )}
        </div>

        {/* 상태 버튼 */}
        <div className="TaskDetailPanel__StatusWrap">
          <select
            className={`TaskDetailPanel__StatusSelect TaskDetailPanel__StatusSelect--${task.status}`}
            value={task.status}
            onChange={(e) => updateField('status', e.target.value)}
          >
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
          </select>
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
              className={`TaskDetailPanel__DescText ${!task.description ? 'TaskDetailPanel__DescText--empty' : ''}`}
              onClick={() => { setDescValue(task.description || ''); setEditingDesc(true); }}
            >
              {task.description || 'Add description...'}
            </div>
          )}
        </div>

        <div className="TaskDetailPanel__Divider" />

        {/* 세부 사항 */}
        <div className="TaskDetailPanel__Section">
          <div className="TaskDetailPanel__SectionLabel">Details</div>
          <div className="TaskDetailPanel__Fields">
            {/* 타입 */}
            <DetailRow label="Type">
              {editingField === 'task_type' ? (
                <select
                  className="TaskDetailPanel__InlineSelect"
                  value={task.task_type}
                  onChange={(e) => handleSelectChange('task_type', e.target.value)}
                  onBlur={() => setEditingField(null)}
                  autoFocus
                >
                  <option value="task">Task</option>
                  <option value="bug">Bug</option>
                  <option value="story">Story</option>
                </select>
              ) : (
                <span
                  className="TaskDetailPanel__FieldValue TaskDetailPanel__FieldValue--clickable"
                  onClick={() => setEditingField('task_type')}
                >
                  <TypeIcon size={12} style={{ color: task.task_type === 'bug' ? '#DC2626' : '#5E6AD2' }} />
                  {typeLabels[task.task_type] || task.task_type}
                </span>
              )}
            </DetailRow>

            {/* 우선순위 */}
            <DetailRow label="Priority">
              {editingField === 'priority' ? (
                <select
                  className="TaskDetailPanel__InlineSelect"
                  value={task.priority}
                  onChange={(e) => handleSelectChange('priority', e.target.value)}
                  onBlur={() => setEditingField(null)}
                  autoFocus
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              ) : (
                <span
                  className="TaskDetailPanel__FieldValue TaskDetailPanel__FieldValue--clickable"
                  onClick={() => setEditingField('priority')}
                >
                  <span style={{ color: priorityColors[task.priority], fontWeight: 600 }}>
                    {task.priority === 'urgent' ? '!!!' : task.priority === 'high' ? '!!' : task.priority === 'medium' ? '!' : ''}
                  </span>
                  {priorityLabels[task.priority] || task.priority}
                </span>
              )}
            </DetailRow>

            {/* Sprint */}
            <DetailRow label="Sprint">
              {editingField === 'sprint_id' ? (
                <select
                  className="TaskDetailPanel__InlineSelect"
                  value={task.sprint_id || ''}
                  onChange={(e) => handleSelectChange('sprint_id', e.target.value)}
                  onBlur={() => setEditingField(null)}
                  autoFocus
                >
                  <option value="">Backlog</option>
                  {sprints.map((s) => (
                    <option key={s.sprint_id} value={s.sprint_id}>{s.sprint_name}</option>
                  ))}
                </select>
              ) : (
                <span
                  className="TaskDetailPanel__FieldValue TaskDetailPanel__FieldValue--clickable"
                  onClick={() => setEditingField('sprint_id')}
                >
                  {task.sprint_name || 'Backlog'}
                </span>
              )}
            </DetailRow>

            {/* Epic */}
            <DetailRow label="Epic">
              {editingField === 'epic_id' ? (
                <select
                  className="TaskDetailPanel__InlineSelect"
                  value={task.epic_id || ''}
                  onChange={(e) => handleSelectChange('epic_id', e.target.value)}
                  onBlur={() => setEditingField(null)}
                  autoFocus
                >
                  <option value="">None</option>
                  {epics.map((ep) => (
                    <option key={ep.epic_id} value={ep.epic_id}>{ep.epic_name}</option>
                  ))}
                </select>
              ) : (
                <span
                  className="TaskDetailPanel__FieldValue TaskDetailPanel__FieldValue--clickable"
                  onClick={() => setEditingField('epic_id')}
                >
                  {task.epic_name || 'None'}
                </span>
              )}
            </DetailRow>

            {/* 담당자 */}
            <DetailRow label="Assignee">
              {editingField === 'assignee_id' ? (
                <select
                  className="TaskDetailPanel__InlineSelect"
                  value={task.assignee_id || ''}
                  onChange={(e) => handleSelectChange('assignee_id', e.target.value)}
                  onBlur={() => setEditingField(null)}
                  autoFocus
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>{m.username}</option>
                  ))}
                </select>
              ) : (
                <span
                  className="TaskDetailPanel__FieldValue TaskDetailPanel__FieldValue--clickable"
                  onClick={() => setEditingField('assignee_id')}
                >
                  {task.assignee_name ? (
                    <>
                      <span className="TaskDetailPanel__Avatar">
                        {task.assignee_name.charAt(0).toUpperCase()}
                      </span>
                      {task.assignee_name}
                    </>
                  ) : 'Unassigned'}
                </span>
              )}
            </DetailRow>

            {/* 라벨 */}
            <DetailRow label="Labels" align="top">
              <div className="TaskDetailPanel__Labels">
                {labels.map((label) => {
                  const selected = (task.labels || []).some((l) => l.label_id === label.label_id);
                  return (
                    <button
                      key={label.label_id}
                      className={`TaskDetailPanel__LabelChip ${selected ? 'TaskDetailPanel__LabelChip--selected' : ''}`}
                      style={{
                        backgroundColor: selected ? label.color + '20' : 'transparent',
                        borderColor: label.color,
                        color: label.color,
                      }}
                      onClick={() => toggleLabel(label.label_id)}
                    >
                      {label.label_name}
                    </button>
                  );
                })}
                {labels.length === 0 && (
                  <span className="TaskDetailPanel__FieldValue">None</span>
                )}
              </div>
            </DetailRow>

            {/* 시작일 */}
            <DetailRow label="Start date">
              <input
                className="TaskDetailPanel__DateInput"
                type="date"
                value={task.start_date || ''}
                onChange={(e) => updateField('start_date', e.target.value || null)}
              />
            </DetailRow>

            {/* 마감일 */}
            <DetailRow label="Due date">
              <input
                className="TaskDetailPanel__DateInput"
                type="date"
                value={task.due_date || ''}
                onChange={(e) => updateField('due_date', e.target.value || null)}
              />
            </DetailRow>
          </div>
        </div>

        <div className="TaskDetailPanel__Divider" />

        {/* 삭제 */}
        <button className="TaskDetailPanel__DeleteBtn" onClick={handleDelete}>
          <Trash2 size={14} />
          Delete task
        </button>
      </div>
    </div>
  );
}

function DetailRow({ label, children, align }) {
  return (
    <div className={`TaskDetailPanel__Row ${align === 'top' ? 'TaskDetailPanel__Row--top' : ''}`}>
      <span className="TaskDetailPanel__RowLabel">{label}</span>
      <div className="TaskDetailPanel__RowValue">{children}</div>
    </div>
  );
}
