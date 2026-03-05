import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { axios } from '@/library/_axios';

export default function TaskModal({ branchId, branchKey, task, defaultSprintId, onClose }) {
  const isEdit = !!task;

  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [taskType, setTaskType] = useState(task?.task_type || 'task');
  const [status, setStatus] = useState(task?.status || 'todo');
  const [priority, setPriority] = useState(task?.priority || 'medium');
  const [epicId, setEpicId] = useState(task?.epic_id || '');
  const [sprintId, setSprintId] = useState(task?.sprint_id || defaultSprintId || '');
  const [assigneeId, setAssigneeId] = useState(task?.assignee_id || '');
  const [labelIds, setLabelIds] = useState([]);
  const [startDate, setStartDate] = useState(task?.start_date || '');
  const [dueDate, setDueDate] = useState(task?.due_date || '');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 옵션 데이터
  const [sprints, setSprints] = useState([]);
  const [epics, setEpics] = useState([]);
  const [members, setMembers] = useState([]);
  const [labels, setLabels] = useState([]);
  const [taskTypes, setTaskTypes] = useState([]);

  useEffect(() => {
    fetchOptions();
    if (isEdit) {
      fetchTaskLabels();
    }
  }, []);

  const fetchOptions = async () => {
    try {
      const [sprintRes, epicRes, memberRes, labelRes, typeRes] = await Promise.all([
        axios.get(`/branches/${branchId}/sprints`),
        axios.get(`/branches/${branchId}/epics`),
        axios.get(`/branches/${branchId}/members`),
        axios.get(`/branches/${branchId}/labels`),
        axios.get(`/branches/${branchId}/task-types`),
      ]);
      if (sprintRes.data.status) setSprints(sprintRes.data.sprints);
      if (epicRes.data.status) setEpics(epicRes.data.epics);
      if (memberRes.data.status) setMembers(memberRes.data.members);
      if (labelRes.data.status) setLabels(labelRes.data.labels);
      if (typeRes.data.status) setTaskTypes(typeRes.data.task_types);
    } catch {}
  };

  const fetchTaskLabels = async () => {
    if (!task?.labels) return;
    setLabelIds(task.labels.map((l) => l.label_id));
  };

  const handleLabelToggle = (labelId) => {
    setLabelIds((prev) =>
      prev.includes(labelId)
        ? prev.filter((id) => id !== labelId)
        : [...prev, labelId]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || loading) return;

    setError('');
    setLoading(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        task_type: taskType,
        status,
        priority,
        epic_id: epicId || null,
        sprint_id: sprintId || null,
        assignee_id: assigneeId || null,
        label_ids: labelIds.length > 0 ? labelIds : null,
        start_date: startDate || null,
        due_date: dueDate || null,
      };

      let res;
      if (isEdit) {
        res = await axios.patch(`/branches/${branchId}/tasks/${task.task_id}`, payload);
      } else {
        res = await axios.post(`/branches/${branchId}/tasks`, payload);
      }

      if (res.data.status) {
        window.dispatchEvent(new Event('task:updated'));
        onClose();
      } else {
        setError(res.data.message);
      }
    } catch {
      setError('Failed to save task.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit || loading) return;
    setLoading(true);
    try {
      const res = await axios.delete(`/branches/${branchId}/tasks/${task.task_id}`);
      if (res.data.status) {
        window.dispatchEvent(new Event('task:updated'));
        onClose();
      }
    } catch {
      setError('Failed to delete task.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="TaskModal__Backdrop" onClick={onClose}>
      <form className="TaskModal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="TaskModal__Header">
          <h2 className="TaskModal__Title">
            {isEdit ? `${branchKey}-${task.display_number}` : 'New Task'}
          </h2>
          <button type="button" className="TaskModal__CloseBtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="TaskModal__Body">
          {/* 제목 */}
          <div className="TaskModal__Field">
            <label className="TaskModal__Label">Title</label>
            <input
              className="TaskModal__Input"
              type="text"
              placeholder="Task title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              required
            />
          </div>

          {/* 타입 + 상태 + 우선순위 (한 줄) */}
          <div className="TaskModal__Row">
            <div className="TaskModal__Field TaskModal__Field--small">
              <label className="TaskModal__Label">Type</label>
              <select className="TaskModal__Select" value={taskType} onChange={(e) => setTaskType(e.target.value)}>
                {taskTypes.map((t) => (
                  <option key={t.type_key} value={t.type_key}>{t.type_name}</option>
                ))}
                {taskTypes.length === 0 && <option value="task">Task</option>}
              </select>
            </div>
            <div className="TaskModal__Field TaskModal__Field--small">
              <label className="TaskModal__Label">Status</label>
              <select className="TaskModal__Select" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
              </select>
            </div>
            <div className="TaskModal__Field TaskModal__Field--small">
              <label className="TaskModal__Label">Priority</label>
              <select className="TaskModal__Select" value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          {/* 설명 */}
          <div className="TaskModal__Field">
            <label className="TaskModal__Label">Description</label>
            <textarea
              className="TaskModal__Textarea"
              placeholder="Add description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          {/* Sprint + Epic (한 줄) */}
          <div className="TaskModal__Row">
            <div className="TaskModal__Field TaskModal__Field--half">
              <label className="TaskModal__Label">Sprint</label>
              <select className="TaskModal__Select" value={sprintId} onChange={(e) => setSprintId(e.target.value)}>
                <option value="">Backlog</option>
                {sprints.map((s) => (
                  <option key={s.sprint_id} value={s.sprint_id}>{s.sprint_name}</option>
                ))}
              </select>
            </div>
            <div className="TaskModal__Field TaskModal__Field--half">
              <label className="TaskModal__Label">Epic</label>
              <select className="TaskModal__Select" value={epicId} onChange={(e) => setEpicId(e.target.value)}>
                <option value="">None</option>
                {epics.map((ep) => (
                  <option key={ep.epic_id} value={ep.epic_id}>{ep.epic_name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 담당자 */}
          <div className="TaskModal__Field">
            <label className="TaskModal__Label">Assignee</label>
            <select className="TaskModal__Select" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>{m.username}</option>
              ))}
            </select>
          </div>

          {/* 라벨 */}
          {labels.length > 0 && (
            <div className="TaskModal__Field">
              <label className="TaskModal__Label">Labels</label>
              <div className="TaskModal__Labels">
                {labels.map((label) => (
                  <button
                    key={label.label_id}
                    type="button"
                    className={`TaskModal__LabelChip ${labelIds.includes(label.label_id) ? 'TaskModal__LabelChip--selected' : ''}`}
                    style={{
                      backgroundColor: labelIds.includes(label.label_id) ? label.color + '20' : 'transparent',
                      borderColor: label.color,
                      color: label.color,
                    }}
                    onClick={() => handleLabelToggle(label.label_id)}
                  >
                    {label.label_name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 날짜 (한 줄) */}
          <div className="TaskModal__Row">
            <div className="TaskModal__Field TaskModal__Field--half">
              <label className="TaskModal__Label">Start Date</label>
              <input
                className="TaskModal__Input"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="TaskModal__Field TaskModal__Field--half">
              <label className="TaskModal__Label">Due Date</label>
              <input
                className="TaskModal__Input"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          {error && <div className="TaskModal__Error">{error}</div>}
        </div>

        <div className="TaskModal__Footer">
          {isEdit && (
            <button type="button" className="TaskModal__DeleteBtn" onClick={handleDelete} disabled={loading}>
              Delete
            </button>
          )}
          <div className="TaskModal__FooterRight">
            <button type="button" className="TaskModal__CancelBtn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="TaskModal__SubmitBtn" disabled={!title.trim() || loading}>
              {loading ? 'Saving...' : isEdit ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
