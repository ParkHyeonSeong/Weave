import { useState, useEffect, useRef } from 'react';
import { axios } from '@/library/_axios';
import { X, Trash2 } from 'lucide-react';
import CustomSelect from '@/components/common/CustomSelect';
import TaskTypeIcon from '@/components/common/TaskTypeIcon';

export default function TaskDetailPanel({ branchId, branchKey, taskTypes, taskSummary, onClose }) {
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);

  // 옵션 데이터
  const [sprints, setSprints] = useState([]);
  const [epics, setEpics] = useState([]);
  const [members, setMembers] = useState([]);
  const [labels, setLabels] = useState([]);

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

  const typeConfig = (taskTypes || []).find((t) => t.type_key === task.task_type);
  const displayId = task.display_id || `${branchKey}-${task.display_number}`;

  return (
    <div className="TaskDetailPanel">
      {/* 헤더 */}
      <div className="TaskDetailPanel__Header">
        <div className="TaskDetailPanel__HeaderLeft">
          <TaskTypeIcon
            name={typeConfig?.icon || 'CheckSquare'}
            size={14}
            color={typeConfig?.color || '#5E6AD2'}
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
          <CustomSelect
            value={task.status}
            options={[
              { value: 'todo', label: 'To Do', color: '#9CA3AF' },
              { value: 'in_progress', label: 'In Progress', color: '#2563EB' },
              { value: 'done', label: 'Done', color: '#16A34A' },
            ]}
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
              <CustomSelect
                value={task.task_type}
                options={(taskTypes || []).map((t) => ({
                  value: t.type_key,
                  label: t.type_name,
                  icon: <TaskTypeIcon name={t.icon} size={12} color={t.color} />,
                }))}
                onChange={(val) => handleSelectChange('task_type', val)}
                size="sm"
              />
            </DetailRow>

            {/* 우선순위 */}
            <DetailRow label="Priority">
              <CustomSelect
                value={task.priority}
                options={[
                  { value: 'urgent', label: 'Urgent', color: '#DC2626' },
                  { value: 'high', label: 'High', color: '#F59E0B' },
                  { value: 'medium', label: 'Medium', color: '#5E6AD2' },
                  { value: 'low', label: 'Low', color: '#9CA3AF' },
                ]}
                onChange={(val) => handleSelectChange('priority', val)}
                size="sm"
              />
            </DetailRow>

            {/* Sprint */}
            <DetailRow label="Sprint">
              <CustomSelect
                value={task.sprint_id || ''}
                options={[
                  { value: '', label: 'Backlog' },
                  ...sprints.map((s) => ({ value: s.sprint_id, label: s.sprint_name })),
                ]}
                onChange={(val) => handleSelectChange('sprint_id', val)}
                size="sm"
              />
            </DetailRow>

            {/* Epic */}
            <DetailRow label="Epic">
              <CustomSelect
                value={task.epic_id || ''}
                options={[
                  { value: '', label: 'None' },
                  ...epics.map((ep) => ({
                    value: ep.epic_id,
                    label: ep.epic_name,
                    color: ep.color || '#5E6AD2',
                  })),
                ]}
                onChange={(val) => handleSelectChange('epic_id', val)}
                size="sm"
              />
            </DetailRow>

            {/* 담당자 */}
            <DetailRow label="Assignee">
              <CustomSelect
                value={task.assignee_id || ''}
                options={[
                  { value: '', label: 'Unassigned' },
                  ...members.map((m) => ({ value: m.user_id, label: m.username })),
                ]}
                onChange={(val) => handleSelectChange('assignee_id', val)}
                size="sm"
              />
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
