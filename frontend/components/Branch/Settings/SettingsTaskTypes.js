import { useState, useEffect } from 'react';
import { axios } from '@/library/_axios';
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react';
import TaskTypeIcon, { ICON_OPTIONS } from '@/components/common/TaskTypeIcon';

export default function SettingsTaskTypes({ branchId, isAdmin }) {
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);

  // 새 타입 추가 폼
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('CheckSquare');
  const [newColor, setNewColor] = useState('#5E6AD2');

  // 인라인 편집
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editIcon, setEditIcon] = useState('');
  const [editColor, setEditColor] = useState('');

  const PRESET_COLORS = [
    '#5E6AD2', '#DC2626', '#16A34A', '#2563EB', '#F59E0B',
    '#8B5CF6', '#EC4899', '#06B6D4', '#F97316', '#6B7280',
  ];

  useEffect(() => {
    fetchTypes();
  }, [branchId]);

  const fetchTypes = async () => {
    try {
      const res = await axios.get(`/branches/${branchId}/task-types`);
      if (res.data.status) setTypes(res.data.task_types);
    } catch {}
    setLoading(false);
  };

  // 추가
  const handleAdd = async () => {
    if (!newKey.trim() || !newName.trim()) return;
    try {
      const res = await axios.post(`/branches/${branchId}/task-types`, {
        type_key: newKey.trim().toLowerCase(),
        type_name: newName.trim(),
        icon: newIcon,
        color: newColor,
      });
      if (res.data.status) {
        fetchTypes();
        setShowAdd(false);
        setNewKey('');
        setNewName('');
        setNewIcon('CheckSquare');
        setNewColor('#5E6AD2');
      }
    } catch {}
  };

  // 편집 시작
  const startEdit = (type) => {
    setEditingId(type.type_id);
    setEditName(type.type_name);
    setEditIcon(type.icon);
    setEditColor(type.color);
  };

  // 편집 저장
  const saveEdit = async (typeId) => {
    try {
      const res = await axios.patch(`/branches/${branchId}/task-types/${typeId}`, {
        type_name: editName.trim(),
        icon: editIcon,
        color: editColor,
      });
      if (res.data.status) {
        fetchTypes();
        setEditingId(null);
      }
    } catch {}
  };

  // 삭제
  const handleDelete = async (typeId) => {
    try {
      const res = await axios.delete(`/branches/${branchId}/task-types/${typeId}`);
      if (res.data.status) fetchTypes();
    } catch {}
  };

  if (loading) return null;

  return (
    <div className="SettingsTaskTypes">
      {/* 타입 목록 */}
      <div className="SettingsTaskTypes__List">
        {types.map((type) => (
          <div key={type.type_id} className="SettingsTaskTypes__Item">
            {editingId === type.type_id ? (
              /* 편집 모드 */
              <div className="SettingsTaskTypes__EditRow">
                <div className="SettingsTaskTypes__EditFields">
                  <div className="SettingsTaskTypes__IconPicker">
                    {ICON_OPTIONS.map((opt) => (
                      <button
                        key={opt.name}
                        className={`SettingsTaskTypes__IconBtn ${editIcon === opt.name ? 'SettingsTaskTypes__IconBtn--active' : ''}`}
                        onClick={() => setEditIcon(opt.name)}
                        title={opt.name}
                      >
                        <TaskTypeIcon name={opt.name} size={14} color={editColor} />
                      </button>
                    ))}
                  </div>
                  <input
                    className="SettingsTaskTypes__EditInput"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Type name"
                  />
                  <div className="SettingsTaskTypes__ColorPicker">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        className={`SettingsTaskTypes__ColorBtn ${editColor === c ? 'SettingsTaskTypes__ColorBtn--active' : ''}`}
                        style={{ backgroundColor: c }}
                        onClick={() => setEditColor(c)}
                      />
                    ))}
                  </div>
                </div>
                <div className="SettingsTaskTypes__EditActions">
                  <button className="SettingsTaskTypes__SaveBtn" onClick={() => saveEdit(type.type_id)}>
                    <Check size={14} />
                  </button>
                  <button className="SettingsTaskTypes__CancelBtn" onClick={() => setEditingId(null)}>
                    <X size={14} />
                  </button>
                </div>
              </div>
            ) : (
              /* 표시 모드 */
              <div className="SettingsTaskTypes__DisplayRow">
                <div className="SettingsTaskTypes__Info">
                  <TaskTypeIcon name={type.icon} size={16} color={type.color} />
                  <span className="SettingsTaskTypes__Name">{type.type_name}</span>
                  <span className="SettingsTaskTypes__Key">{type.type_key}</span>
                </div>
                {isAdmin && (
                  <div className="SettingsTaskTypes__ItemActions">
                    <button
                      className="SettingsTaskTypes__ActionBtn"
                      onClick={() => startEdit(type)}
                      title="Edit"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      className="SettingsTaskTypes__ActionBtn SettingsTaskTypes__ActionBtn--danger"
                      onClick={() => handleDelete(type.type_id)}
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 추가 폼 */}
      {isAdmin && (
        <>
          {showAdd ? (
            <div className="SettingsTaskTypes__AddForm">
              <div className="SettingsTaskTypes__AddFields">
                <input
                  className="SettingsTaskTypes__AddInput"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="type_key (e.g. feature)"
                />
                <input
                  className="SettingsTaskTypes__AddInput"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Display name"
                />
              </div>
              <div className="SettingsTaskTypes__IconPicker">
                {ICON_OPTIONS.map((opt) => (
                  <button
                    key={opt.name}
                    className={`SettingsTaskTypes__IconBtn ${newIcon === opt.name ? 'SettingsTaskTypes__IconBtn--active' : ''}`}
                    onClick={() => setNewIcon(opt.name)}
                    title={opt.name}
                  >
                    <TaskTypeIcon name={opt.name} size={14} color={newColor} />
                  </button>
                ))}
              </div>
              <div className="SettingsTaskTypes__ColorPicker">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`SettingsTaskTypes__ColorBtn ${newColor === c ? 'SettingsTaskTypes__ColorBtn--active' : ''}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setNewColor(c)}
                  />
                ))}
              </div>
              <div className="SettingsTaskTypes__AddActions">
                <button className="SettingsTaskTypes__SubmitBtn" onClick={handleAdd}>
                  Add Type
                </button>
                <button className="SettingsTaskTypes__CancelBtn" onClick={() => setShowAdd(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button className="SettingsTaskTypes__AddBtn" onClick={() => setShowAdd(true)}>
              <Plus size={14} />
              Add Task Type
            </button>
          )}
        </>
      )}
    </div>
  );
}
