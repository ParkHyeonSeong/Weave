import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/router';
import { ArrowLeft, Trash2, ChevronDown } from 'lucide-react';
import { axios } from '@/library/_axios';
import CustomSelect from '@/components/common/CustomSelect';
import TaskTypeIcon from '@/components/common/TaskTypeIcon';
import useTaskDetail from '@/hooks/useTaskDetail';
import TaskIssueSection from './TaskIssueSection';

export default function TaskFullPage() {
  const router = useRouter();
  const { id: branchId, taskId } = router.query;

  const [branch, setBranch] = useState(null);
  const [taskTypes, setTaskTypes] = useState([]);

  const {
    task, loading, sprints, epics, members, labels,
    updateField, updateAssignees, toggleLabel, handleDelete, handleSelectChange,
  } = useTaskDetail(branchId, taskId);

  // 제목 편집
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState('');

  // 설명 편집
  const [editingDesc, setEditingDesc] = useState(false);
  const [descValue, setDescValue] = useState('');

  useEffect(() => {
    if (!branchId) return;
    const fetchBranch = async () => {
      try {
        const [branchRes, typeRes] = await Promise.all([
          axios.get(`/branches/${branchId}`),
          axios.get(`/branches/${branchId}/task-types`),
        ]);
        if (branchRes.data.status) setBranch(branchRes.data.branch);
        if (typeRes.data.status) setTaskTypes(typeRes.data.task_types);
      } catch {}
    };
    fetchBranch();
  }, [branchId]);

  const saveTitle = () => {
    if (titleValue.trim() && titleValue.trim() !== task.title) {
      updateField('title', titleValue.trim());
    }
    setEditingTitle(false);
  };

  const saveDesc = () => {
    const val = descValue.trim() || null;
    if (val !== (task.description || null)) {
      updateField('description', val);
    }
    setEditingDesc(false);
  };

  const onDelete = async () => {
    const ok = await handleDelete();
    if (ok) router.push(`/branch/${branchId}`);
  };

  if (!branchId || !taskId) return null;
  if (loading || !task) {
    return <div className="TaskFullPage"><div className="TaskFullPage__Loading">Loading...</div></div>;
  }

  const branchKey = branch?.key || '';
  const typeConfig = (taskTypes || []).find((t) => t.type_key === task.task_type);
  const displayId = task.display_id || `${branchKey}-${task.display_number}`;

  return (
    <div className="TaskFullPage">
      {/* 헤더 */}
      <div className="TaskFullPage__Header">
        <div className="TaskFullPage__HeaderLeft">
          <button className="TaskFullPage__BackBtn" onClick={() => router.push(`/branch/${branchId}`)}>
            <ArrowLeft size={16} />
          </button>
          <TaskTypeIcon
            name={typeConfig?.icon || 'CheckSquare'}
            size={16}
            color={typeConfig?.color || '#5E6AD2'}
          />
          <span className="TaskFullPage__DisplayId">{displayId}</span>
        </div>
        <button className="TaskFullPage__DeleteBtn" onClick={onDelete}>
          <Trash2 size={14} />
          Delete
        </button>
      </div>

      {/* 2단 레이아웃 */}
      <div className="TaskFullPage__Layout">
        {/* 왼쪽: 제목 + 상태 + 설명 + 이슈 */}
        <div className="TaskFullPage__Main">
          {/* 제목 */}
          <div className="TaskFullPage__TitleWrap">
            {editingTitle ? (
              <input
                className="TaskFullPage__TitleInput"
                value={titleValue}
                onChange={(e) => setTitleValue(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') setEditingTitle(false); }}
                autoFocus
              />
            ) : (
              <h1
                className="TaskFullPage__Title"
                onClick={() => { setTitleValue(task.title); setEditingTitle(true); }}
              >
                {task.title}
              </h1>
            )}
          </div>

          {/* 상태 */}
          <div className="TaskFullPage__StatusWrap">
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
          <div className="TaskFullPage__Section">
            <div className="TaskFullPage__SectionLabel">Description</div>
            {editingDesc ? (
              <textarea
                className="TaskFullPage__DescInput"
                value={descValue}
                onChange={(e) => setDescValue(e.target.value)}
                onBlur={saveDesc}
                onKeyDown={(e) => { if (e.key === 'Escape') setEditingDesc(false); }}
                autoFocus
                rows={6}
              />
            ) : (
              <div
                className={`TaskFullPage__DescText ${!task.description ? 'TaskFullPage__DescText--empty' : ''}`}
                onClick={() => { setDescValue(task.description || ''); setEditingDesc(true); }}
              >
                {task.description || 'Add description...'}
              </div>
            )}
          </div>

          <div className="TaskFullPage__Divider" />

          {/* 이슈 */}
          <TaskIssueSection branchId={branchId} taskId={task.task_id} expanded />
        </div>

        {/* 오른쪽: 세부 사항 */}
        <div className="TaskFullPage__Sidebar">
          <div className="TaskFullPage__SectionLabel">Details</div>
          <div className="TaskFullPage__Fields">
            <FieldRow label="Type">
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
            </FieldRow>

            <FieldRow label="Priority">
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
            </FieldRow>

            <FieldRow label="Sprint">
              <CustomSelect
                value={task.sprint_id || ''}
                options={[
                  { value: '', label: 'Backlog' },
                  ...sprints.map((s) => ({ value: s.sprint_id, label: s.sprint_name })),
                ]}
                onChange={(val) => handleSelectChange('sprint_id', val)}
                size="sm"
              />
            </FieldRow>

            <FieldRow label="Epic">
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
            </FieldRow>

            <FieldRow label="Main Assignee">
              <CustomSelect
                value={(task.assignees || []).find((a) => a.role === 'main')?.user_id || ''}
                options={[
                  { value: '', label: 'Unassigned' },
                  ...members.map((m) => ({ value: m.user_id, label: m.username })),
                ]}
                onChange={(val) => {
                  const mainId = val === '' ? null : Number(val);
                  const currentSubs = (task.assignees || []).filter((a) => a.role === 'sub').map((a) => a.user_id);
                  updateAssignees(mainId, currentSubs);
                }}
                size="sm"
              />
            </FieldRow>

            <FieldRow label="Sub Assignees">
              <SubAssigneeDropdown
                members={members.filter((m) => {
                  const mainId = (task.assignees || []).find((a) => a.role === 'main')?.user_id;
                  return m.user_id !== mainId;
                })}
                selectedIds={(task.assignees || []).filter((a) => a.role === 'sub').map((a) => a.user_id)}
                onChange={(newSubs) => {
                  const mainId = (task.assignees || []).find((a) => a.role === 'main')?.user_id || null;
                  updateAssignees(mainId, newSubs);
                }}
              />
            </FieldRow>

            <FieldRow label="Labels" align="top">
              <div className="TaskFullPage__Labels">
                {labels.map((label) => {
                  const selected = (task.labels || []).some((l) => l.label_id === label.label_id);
                  return (
                    <button
                      key={label.label_id}
                      className={`TaskFullPage__LabelChip ${selected ? 'TaskFullPage__LabelChip--selected' : ''}`}
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
                {labels.length === 0 && <span className="TaskFullPage__FieldEmpty">None</span>}
              </div>
            </FieldRow>

            <FieldRow label="Start date">
              <input
                className="TaskFullPage__DateInput"
                type="date"
                value={task.start_date || ''}
                onChange={(e) => updateField('start_date', e.target.value || null)}
              />
            </FieldRow>

            <FieldRow label="Due date">
              <input
                className="TaskFullPage__DateInput"
                type="date"
                value={task.due_date || ''}
                onChange={(e) => updateField('due_date', e.target.value || null)}
              />
            </FieldRow>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldRow({ label, children, align }) {
  return (
    <div className={`TaskFullPage__Row ${align === 'top' ? 'TaskFullPage__Row--top' : ''}`}>
      <span className="TaskFullPage__RowLabel">{label}</span>
      <div className="TaskFullPage__RowValue">{children}</div>
    </div>
  );
}

function SubAssigneeDropdown({ members, selectedIds, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const toggle = (userId) => {
    const newIds = selectedIds.includes(userId)
      ? selectedIds.filter((id) => id !== userId)
      : [...selectedIds, userId];
    onChange(newIds);
  };

  const selectedNames = members
    .filter((m) => selectedIds.includes(m.user_id))
    .map((m) => m.username);

  return (
    <div className="TaskFullPage__SubAssigneeWrap" ref={ref}>
      <button
        type="button"
        className="TaskFullPage__SubAssigneeBtn"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className={selectedNames.length > 0 ? '' : 'TaskFullPage__Placeholder'}>
          {selectedNames.length > 0 ? selectedNames.join(', ') : 'None'}
        </span>
        <ChevronDown size={12} />
      </button>
      {open && members.length > 0 && (
        <div className="TaskFullPage__SubAssigneeDropdown">
          {members.map((m) => (
            <label key={m.user_id} className="TaskFullPage__SubAssigneeOption">
              <input
                type="checkbox"
                checked={selectedIds.includes(m.user_id)}
                onChange={() => toggle(m.user_id)}
              />
              <span>{m.username}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
