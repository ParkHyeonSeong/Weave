import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { axios } from '@/library/_axios';
import DatePicker from '@/components/common/DatePicker';

const COLORS = ['#5E6AD2', '#2563EB', '#DC2626', '#16A34A', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4'];

export default function EpicModal({ branchId, epic, onClose }) {
  const isEdit = !!epic;

  const [epicName, setEpicName] = useState(epic?.epic_name || '');
  const [description, setDescription] = useState(epic?.description || '');
  const [status, setStatus] = useState(epic?.status || 'todo');
  const [color, setColor] = useState(epic?.color || '#5E6AD2');
  const [startDate, setStartDate] = useState(epic?.start_date || '');
  const [dueDate, setDueDate] = useState(epic?.due_date || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [workflowStatuses, setWorkflowStatuses] = useState([]);

  useEffect(() => {
    const fetchStatuses = async () => {
      try {
        const res = await axios.get(`/branches/${branchId}/workflow-statuses`);
        if (res.data.status) setWorkflowStatuses(res.data.statuses);
      } catch {}
    };
    fetchStatuses();
  }, [branchId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!epicName.trim() || loading) return;

    setError('');
    setLoading(true);
    try {
      const payload = {
        epic_name: epicName.trim(),
        description: description.trim() || null,
        status,
        color,
        start_date: startDate || null,
        due_date: dueDate || null,
      };

      let res;
      if (isEdit) {
        res = await axios.patch(`/branches/${branchId}/epics/${epic.epic_id}`, payload);
      } else {
        res = await axios.post(`/branches/${branchId}/epics`, payload);
      }

      if (res.data.status) {
        window.dispatchEvent(new Event('epic:updated'));
        onClose();
      } else {
        setError(res.data.message);
      }
    } catch {
      setError('Failed to save epic.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit || loading) return;
    setLoading(true);
    try {
      const res = await axios.delete(`/branches/${branchId}/epics/${epic.epic_id}`);
      if (res.data.status) {
        window.dispatchEvent(new Event('epic:updated'));
        onClose();
      }
    } catch {
      setError('Failed to delete epic.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="EpicModal__Backdrop" onClick={onClose}>
      <form className="EpicModal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="EpicModal__Header">
          <h2 className="EpicModal__Title">{isEdit ? 'Edit Epic' : 'New Epic'}</h2>
          <button type="button" className="EpicModal__CloseBtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="EpicModal__Body">
          {/* 이름 */}
          <div className="EpicModal__Field">
            <label className="EpicModal__Label">Name</label>
            <input
              className="EpicModal__Input"
              type="text"
              placeholder="Epic name"
              value={epicName}
              onChange={(e) => setEpicName(e.target.value)}
              autoFocus
              required
            />
          </div>

          {/* 설명 */}
          <div className="EpicModal__Field">
            <label className="EpicModal__Label">Description</label>
            <textarea
              className="EpicModal__Textarea"
              placeholder="Add description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          {/* 상태 + 색상 */}
          <div className="EpicModal__Row">
            <div className="EpicModal__Field EpicModal__Field--half">
              <label className="EpicModal__Label">Status</label>
              <select className="EpicModal__Select" value={status} onChange={(e) => setStatus(e.target.value)}>
                {workflowStatuses.length > 0 ? (
                  workflowStatuses.map((ws) => (
                    <option key={ws.key} value={ws.key}>{ws.label}</option>
                  ))
                ) : (
                  <>
                    <option value="todo">To Do</option>
                    <option value="in_progress">In Progress</option>
                    <option value="done">Done</option>
                  </>
                )}
              </select>
            </div>
            <div className="EpicModal__Field EpicModal__Field--half">
              <label className="EpicModal__Label">Color</label>
              <div className="EpicModal__Colors">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`EpicModal__ColorBtn ${color === c ? 'EpicModal__ColorBtn--selected' : ''}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* 날짜 */}
          <div className="EpicModal__Row">
            <div className="EpicModal__Field EpicModal__Field--half">
              <label className="EpicModal__Label">Start Date</label>
              <DatePicker
                value={startDate || null}
                onChange={(val) => setStartDate(val || '')}
                max={dueDate || null}
              />
            </div>
            <div className="EpicModal__Field EpicModal__Field--half">
              <label className="EpicModal__Label">Due Date</label>
              <DatePicker
                value={dueDate || null}
                onChange={(val) => setDueDate(val || '')}
                min={startDate || null}
              />
            </div>
          </div>

          {error && <div className="EpicModal__Error">{error}</div>}
        </div>

        <div className="EpicModal__Footer">
          {isEdit && (
            <button type="button" className="EpicModal__DeleteBtn" onClick={handleDelete} disabled={loading}>
              Delete
            </button>
          )}
          <div className="EpicModal__FooterRight">
            <button type="button" className="EpicModal__CancelBtn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="EpicModal__SubmitBtn" disabled={!epicName.trim() || loading}>
              {loading ? 'Saving...' : isEdit ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
