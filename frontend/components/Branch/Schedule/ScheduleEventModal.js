import { useState } from 'react';
import { X } from 'lucide-react';
import { axios } from '@/library/_axios';

const COLORS = ['#5E6AD2', '#2563EB', '#DC2626', '#16A34A', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4'];

export default function ScheduleEventModal({ branchId, event, defaultDate, onClose }) {
  const isEdit = !!event;

  const [title, setTitle] = useState(event?.title || '');
  const [description, setDescription] = useState(event?.description || '');
  const [startDate, setStartDate] = useState(event?.start_date || defaultDate || '');
  const [endDate, setEndDate] = useState(event?.end_date || '');
  const [color, setColor] = useState(event?.color || '#5E6AD2');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !startDate || loading) return;

    setError('');
    setLoading(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        start_date: startDate,
        end_date: endDate || null,
        color,
      };

      let res;
      if (isEdit) {
        res = await axios.patch(`/branches/${branchId}/schedule-events/${event.schedule_event_id}`, payload);
      } else {
        res = await axios.post(`/branches/${branchId}/schedule-events`, payload);
      }

      if (res.data.status) {
        window.dispatchEvent(new Event('schedule:updated'));
        onClose();
      } else {
        setError(res.data.message);
      }
    } catch {
      setError('Failed to save event.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit || loading) return;
    setLoading(true);
    try {
      const res = await axios.delete(`/branches/${branchId}/schedule-events/${event.schedule_event_id}`);
      if (res.data.status) {
        window.dispatchEvent(new Event('schedule:updated'));
        onClose();
      }
    } catch {
      setError('Failed to delete event.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ScheduleEventModal__Backdrop" onClick={onClose}>
      <form className="ScheduleEventModal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="ScheduleEventModal__Header">
          <h2 className="ScheduleEventModal__Title">{isEdit ? 'Edit Event' : 'New Event'}</h2>
          <button type="button" className="ScheduleEventModal__CloseBtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="ScheduleEventModal__Body">
          {/* 제목 */}
          <div className="ScheduleEventModal__Field">
            <label className="ScheduleEventModal__Label">Title</label>
            <input
              className="ScheduleEventModal__Input"
              type="text"
              placeholder="Event title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              required
            />
          </div>

          {/* 설명 */}
          <div className="ScheduleEventModal__Field">
            <label className="ScheduleEventModal__Label">Description</label>
            <textarea
              className="ScheduleEventModal__Textarea"
              placeholder="Add description..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          {/* 날짜 */}
          <div className="ScheduleEventModal__Row">
            <div className="ScheduleEventModal__Field ScheduleEventModal__Field--half">
              <label className="ScheduleEventModal__Label">Start Date</label>
              <input
                className="ScheduleEventModal__Input"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div className="ScheduleEventModal__Field ScheduleEventModal__Field--half">
              <label className="ScheduleEventModal__Label">End Date</label>
              <input
                className="ScheduleEventModal__Input"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          {/* 색상 */}
          <div className="ScheduleEventModal__Field">
            <label className="ScheduleEventModal__Label">Color</label>
            <div className="ScheduleEventModal__Colors">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`ScheduleEventModal__ColorBtn ${color === c ? 'ScheduleEventModal__ColorBtn--selected' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>

          {error && <div className="ScheduleEventModal__Error">{error}</div>}
        </div>

        <div className="ScheduleEventModal__Footer">
          {isEdit && (
            <button type="button" className="ScheduleEventModal__DeleteBtn" onClick={handleDelete} disabled={loading}>
              Delete
            </button>
          )}
          <div className="ScheduleEventModal__FooterRight">
            <button type="button" className="ScheduleEventModal__CancelBtn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="ScheduleEventModal__SubmitBtn" disabled={!title.trim() || !startDate || loading}>
              {loading ? 'Saving...' : isEdit ? 'Update' : 'Create'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
