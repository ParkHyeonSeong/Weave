import { useState, useEffect } from 'react';
import { axios } from '@/library/_axios';
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react';

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Select' },
  { value: 'date', label: 'Date' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'url', label: 'URL' },
];

export default function SettingsCustomFields({ branchId, typeId, isAdmin }) {
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);

  // 새 필드 추가
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('text');
  const [newOptions, setNewOptions] = useState('');
  const [newRequired, setNewRequired] = useState(false);

  // 인라인 편집
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('');
  const [editOptions, setEditOptions] = useState('');
  const [editRequired, setEditRequired] = useState(false);

  useEffect(() => {
    fetchFields();
  }, [branchId, typeId]);

  const basePath = `/branches/${branchId}/task-types/${typeId}/custom-fields`;

  const fetchFields = async () => {
    try {
      const res = await axios.get(basePath);
      if (res.data.status) setFields(res.data.fields);
    } catch {}
    setLoading(false);
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    const body = {
      field_name: newName.trim(),
      field_type: newType,
      is_required: newRequired,
    };
    if (newType === 'select' && newOptions.trim()) {
      body.field_options = newOptions.split(',').map(o => o.trim()).filter(Boolean);
    }
    try {
      const res = await axios.post(basePath, body);
      if (res.data.status) {
        fetchFields();
        setShowAdd(false);
        setNewName('');
        setNewType('text');
        setNewOptions('');
        setNewRequired(false);
      }
    } catch {}
  };

  const startEdit = (f) => {
    setEditingId(f.custom_field_id);
    setEditName(f.field_name);
    setEditType(f.field_type);
    setEditOptions(f.field_options ? f.field_options.join(', ') : '');
    setEditRequired(f.is_required);
  };

  const saveEdit = async (fieldId) => {
    const body = {
      field_name: editName.trim(),
      field_type: editType,
      is_required: editRequired,
    };
    if (editType === 'select' && editOptions.trim()) {
      body.field_options = editOptions.split(',').map(o => o.trim()).filter(Boolean);
    }
    try {
      const res = await axios.patch(`${basePath}/${fieldId}`, body);
      if (res.data.status) {
        fetchFields();
        setEditingId(null);
      }
    } catch {}
  };

  const handleDelete = async (fieldId) => {
    try {
      const res = await axios.delete(`${basePath}/${fieldId}`);
      if (res.data.status) fetchFields();
    } catch {}
  };

  const getTypeLabel = (type) => {
    const t = FIELD_TYPES.find(ft => ft.value === type);
    return t ? t.label : type;
  };

  if (loading) return null;

  return (
    <div className="SettingsCustomFields">
      <div className="SettingsCustomFields__List">
        {fields.map((f) => (
          <div key={f.custom_field_id} className="SettingsCustomFields__Item">
            {editingId === f.custom_field_id ? (
              <div className="SettingsCustomFields__EditRow">
                <div className="SettingsCustomFields__EditFields">
                  <input
                    className="SettingsCustomFields__EditInput"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Field name"
                  />
                  <select
                    className="SettingsCustomFields__Select"
                    value={editType}
                    onChange={(e) => setEditType(e.target.value)}
                  >
                    {FIELD_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  {editType === 'select' && (
                    <input
                      className="SettingsCustomFields__EditInput"
                      value={editOptions}
                      onChange={(e) => setEditOptions(e.target.value)}
                      placeholder="Options (comma separated)"
                    />
                  )}
                  <label className="SettingsCustomFields__CheckLabel">
                    <input
                      type="checkbox"
                      checked={editRequired}
                      onChange={(e) => setEditRequired(e.target.checked)}
                    />
                    Required
                  </label>
                </div>
                <div className="SettingsCustomFields__EditActions">
                  <button className="SettingsCustomFields__SaveBtn" onClick={() => saveEdit(f.custom_field_id)}>
                    <Check size={14} />
                  </button>
                  <button className="SettingsCustomFields__CancelBtn" onClick={() => setEditingId(null)}>
                    <X size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <div className="SettingsCustomFields__DisplayRow">
                <div className="SettingsCustomFields__Info">
                  <span className="SettingsCustomFields__Name">{f.field_name}</span>
                  <span className="SettingsCustomFields__Type">{getTypeLabel(f.field_type)}</span>
                  {f.is_required && (
                    <span className="SettingsCustomFields__Required">Required</span>
                  )}
                  {f.field_type === 'select' && f.field_options && (
                    <span className="SettingsCustomFields__Options">
                      {f.field_options.join(', ')}
                    </span>
                  )}
                </div>
                {isAdmin && (
                  <div className="SettingsCustomFields__ItemActions">
                    <button
                      className="SettingsCustomFields__ActionBtn"
                      onClick={() => startEdit(f)}
                      title="Edit"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      className="SettingsCustomFields__ActionBtn SettingsCustomFields__ActionBtn--danger"
                      onClick={() => handleDelete(f.custom_field_id)}
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

        {fields.length === 0 && (
          <p className="SettingsCustomFields__Empty">No custom fields defined yet.</p>
        )}
      </div>

      {isAdmin && (
        <>
          {showAdd ? (
            <div className="SettingsCustomFields__AddForm">
              <div className="SettingsCustomFields__AddFields">
                <input
                  className="SettingsCustomFields__AddInput"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Field name"
                />
                <select
                  className="SettingsCustomFields__Select"
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                >
                  {FIELD_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                {newType === 'select' && (
                  <input
                    className="SettingsCustomFields__AddInput"
                    value={newOptions}
                    onChange={(e) => setNewOptions(e.target.value)}
                    placeholder="Options (comma separated)"
                  />
                )}
                <label className="SettingsCustomFields__CheckLabel">
                  <input
                    type="checkbox"
                    checked={newRequired}
                    onChange={(e) => setNewRequired(e.target.checked)}
                  />
                  Required
                </label>
              </div>
              <div className="SettingsCustomFields__AddActions">
                <button className="SettingsCustomFields__SubmitBtn" onClick={handleAdd}>
                  Add Field
                </button>
                <button className="SettingsCustomFields__CancelAddBtn" onClick={() => setShowAdd(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button className="SettingsCustomFields__AddBtn" onClick={() => setShowAdd(true)}>
              <Plus size={14} />
              Add Custom Field
            </button>
          )}
        </>
      )}
    </div>
  );
}
