import { useState, useEffect } from 'react';
import { axios } from '@/library/_axios';
import { X, Trash2 } from 'lucide-react';
import CustomSelect from '@/components/common/CustomSelect';
const COLORS = ['#5E6AD2', '#2563EB', '#DC2626', '#16A34A', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4'];

export default function EpicDetailPanel({ branchId, workflowStatuses = [], epicSummary, onClose }) {
  const [epic, setEpic] = useState(null);
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
      const res = await axios.get(`/branches/${branchId}/epics`);
      if (res.data.status) {
        const found = res.data.epics.find((e) => e.epic_id === epicSummary.epic_id);
        if (found) setEpic(found);
      }
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

            {/* Task 수 */}
            <div className="TaskDetailPanel__Row">
              <span className="TaskDetailPanel__RowLabel">Tasks</span>
              <div className="TaskDetailPanel__RowValue">
                <span className="TaskDetailPanel__FieldValue">{epic.task_count || 0} tasks</span>
              </div>
            </div>
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
