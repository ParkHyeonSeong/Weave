import { useState, useEffect, useRef } from 'react';
import { X, ChevronDown } from 'lucide-react';
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

  // 참석자 상태
  const [members, setMembers] = useState([]);
  const [selectedParticipants, setSelectedParticipants] = useState(
    () => new Set((event?.participants || []).map((p) => p.user_id))
  );
  const [participantDropdownOpen, setParticipantDropdownOpen] = useState(false);
  const participantRef = useRef(null);

  // 이벤트-태스크 연결 상태
  const [linkedTasks, setLinkedTasks] = useState([]);
  const [taskSearch, setTaskSearch] = useState('');
  const [taskResults, setTaskResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchTimer = useRef(null);

  // 브랜치 멤버 로드
  useEffect(() => {
    axios.get(`/branches/${branchId}/members`)
      .then((res) => { if (res.data.status) setMembers(res.data.members); })
      .catch(() => {});
  }, [branchId]);

  // 편집 모드일 때 연결된 태스크 로드
  useEffect(() => {
    if (isEdit) {
      axios.get(`/branches/${branchId}/schedule-events/${event.schedule_event_id}/tasks`)
        .then((res) => { if (res.data.status) setLinkedTasks(res.data.tasks); })
        .catch(() => {});
    }
  }, [isEdit, branchId, event?.schedule_event_id]);

  // 참석자 드롭다운 외부 클릭 닫기
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (participantRef.current && !participantRef.current.contains(e.target)) {
        setParticipantDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 태스크 검색 (디바운스 300ms)
  useEffect(() => {
    if (!taskSearch.trim() || !isEdit) {
      setTaskResults([]);
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await axios.get(
          `/branches/${branchId}/schedule-events/${event.schedule_event_id}/tasks/search?q=${encodeURIComponent(taskSearch)}`
        );
        if (res.data.status) setTaskResults(res.data.tasks);
      } catch {} finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [taskSearch, isEdit, branchId, event?.schedule_event_id]);

  const toggleParticipant = (userId) => {
    setSelectedParticipants((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleLinkTask = async (task) => {
    try {
      const res = await axios.post(`/branches/${branchId}/schedule-events/${event.schedule_event_id}/tasks`, {
        task_id: task.task_id,
      });
      if (res.data.status) {
        setLinkedTasks((prev) => [...prev, { ...task, link_id: res.data.link_id }]);
        setTaskSearch('');
        setTaskResults([]);
      }
    } catch {}
  };

  const handleUnlinkTask = async (linkId) => {
    try {
      const res = await axios.delete(`/branches/${branchId}/schedule-events/${event.schedule_event_id}/tasks/${linkId}`);
      if (res.data.status) {
        setLinkedTasks((prev) => prev.filter((t) => t.link_id !== linkId));
      }
    } catch {}
  };

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
        participant_ids: [...selectedParticipants],
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

  // 선택된 참석자 이름 표시용
  const participantNames = members
    .filter((m) => selectedParticipants.has(m.user_id))
    .map((m) => m.username);

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

          {/* 참석자 */}
          <div className="ScheduleEventModal__Field">
            <label className="ScheduleEventModal__Label">Participants</label>
            <div className="ScheduleEventModal__ParticipantWrap" ref={participantRef}>
              <button
                type="button"
                className="ScheduleEventModal__ParticipantToggle"
                onClick={() => setParticipantDropdownOpen((prev) => !prev)}
              >
                <span className="ScheduleEventModal__ParticipantText">
                  {participantNames.length > 0 ? participantNames.join(', ') : 'Select participants...'}
                </span>
                <ChevronDown size={14} />
              </button>
              {participantDropdownOpen && (
                <div className="ScheduleEventModal__ParticipantDropdown">
                  {members.map((member) => (
                    <label key={member.user_id} className="ScheduleEventModal__ParticipantOption">
                      <input
                        type="checkbox"
                        checked={selectedParticipants.has(member.user_id)}
                        onChange={() => toggleParticipant(member.user_id)}
                      />
                      <span>{member.username}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 연결된 태스크 (편집 모드에서만) */}
          {isEdit && (
            <div className="ScheduleEventModal__Field">
              <label className="ScheduleEventModal__Label">Linked Tasks</label>

              {/* 연결된 태스크 목록 */}
              {linkedTasks.length > 0 && (
                <div className="ScheduleEventModal__LinkedTasks">
                  {linkedTasks.map((task) => (
                    <div key={task.link_id} className="ScheduleEventModal__LinkedTask">
                      <span className="ScheduleEventModal__LinkedTaskId">{task.display_id}</span>
                      <span className="ScheduleEventModal__LinkedTaskTitle">{task.title}</span>
                      <button type="button" onClick={() => handleUnlinkTask(task.link_id)}>
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 태스크 검색 */}
              <div className="ScheduleEventModal__TaskSearchWrap">
                <input
                  className="ScheduleEventModal__Input"
                  type="text"
                  placeholder="Search tasks to link..."
                  value={taskSearch}
                  onChange={(e) => setTaskSearch(e.target.value)}
                />
                {taskResults.length > 0 && (
                  <div className="ScheduleEventModal__TaskResults">
                    {taskResults.map((task) => (
                      <div
                        key={task.task_id}
                        className="ScheduleEventModal__TaskResult"
                        onClick={() => handleLinkTask(task)}
                      >
                        <span>{task.display_id}</span>
                        <span>{task.title}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

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
