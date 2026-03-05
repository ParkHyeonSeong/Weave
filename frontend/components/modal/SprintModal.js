import { useState } from 'react';
import { X } from 'lucide-react';
import { axios } from '@/library/_axios';

export default function SprintModal({ branchId, sprint, onClose }) {
  const isEdit = !!sprint?.sprint_id;

  const [sprintName, setSprintName] = useState(sprint?.sprint_name || '');
  const [goal, setGoal] = useState(sprint?.goal || '');
  const [startDate, setStartDate] = useState(sprint?.start_date || '');
  const [endDate, setEndDate] = useState(sprint?.end_date || '');
  const [status, setStatus] = useState(sprint?.status || 'future');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!sprintName.trim() || loading) return;

    setError('');
    setLoading(true);
    try {
      const payload = {
        sprint_name: sprintName.trim(),
        goal: goal.trim() || null,
        start_date: startDate || null,
        end_date: endDate || null,
      };

      let res;
      if (isEdit) {
        payload.status = status;
        res = await axios.patch(`/branches/${branchId}/sprints/${sprint.sprint_id}`, payload);
      } else {
        res = await axios.post(`/branches/${branchId}/sprints`, payload);
      }

      if (res.data.status) {
        window.dispatchEvent(new Event('task:updated'));
        onClose();
      } else {
        const messages = {
          'ACTIVE_SPRINT_EXISTS': 'There is already an active sprint.',
        };
        setError(messages[res.data.message] || res.data.message);
      }
    } catch {
      setError('Failed to save sprint.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit || loading) return;
    setLoading(true);
    try {
      const res = await axios.delete(`/branches/${branchId}/sprints/${sprint.sprint_id}`);
      if (res.data.status) {
        window.dispatchEvent(new Event('task:updated'));
        onClose();
      }
    } catch {
      setError('Failed to delete sprint.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="SprintModal__Backdrop" onClick={onClose}>
      <form className="SprintModal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="SprintModal__Header">
          <h2 className="SprintModal__Title">{isEdit ? 'Edit Sprint' : 'New Sprint'}</h2>
          <button type="button" className="SprintModal__CloseBtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="SprintModal__Body">
          <div className="SprintModal__Field">
            <label className="SprintModal__Label">Sprint Name</label>
            <input
              className="SprintModal__Input"
              type="text"
              placeholder="Sprint 1"
              value={sprintName}
              onChange={(e) => setSprintName(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div className="SprintModal__Field">
            <label className="SprintModal__Label">Goal</label>
            <textarea
              className="SprintModal__Textarea"
              placeholder="Sprint goal..."
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
            />
          </div>

          {isEdit && (
            <div className="SprintModal__Field">
              <label className="SprintModal__Label">Status</label>
              <select className="SprintModal__Select" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="future">Future</option>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          )}

          <div className="SprintModal__Row">
            <div className="SprintModal__Field SprintModal__Field--half">
              <label className="SprintModal__Label">Start Date</label>
              <input
                className="SprintModal__Input"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="SprintModal__Field SprintModal__Field--half">
              <label className="SprintModal__Label">End Date</label>
              <input
                className="SprintModal__Input"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          {error && <div className="SprintModal__Error">{error}</div>}
        </div>

        <div className="SprintModal__Footer">
          {isEdit && (
            <button type="button" className="SprintModal__DeleteBtn" onClick={handleDelete} disabled={loading}>
              Delete
            </button>
          )}
          <div className="SprintModal__FooterRight">
            <button type="button" className="SprintModal__CancelBtn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="SprintModal__SubmitBtn" disabled={!sprintName.trim() || loading}>
              {loading ? 'Saving...' : isEdit ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
