import { useState } from 'react';
import { useRouter } from 'next/router';
import { axios } from '@/library/_axios';
import { Globe, Lock, AlertTriangle } from 'lucide-react';
import AppearanceSection from '@/components/common/AppearanceSection';
import { DEFAULT_COLORS } from '@/library/entityAppearance';

export default function SettingsGeneral({ canvasId, canvas, isAdmin, onUpdated }) {
  const router = useRouter();
  const [canvasName, setCanvasName] = useState(canvas?.canvas_name || '');
  const [key, setKey] = useState(canvas?.key || '');
  const [keyError, setKeyError] = useState('');
  const [description, setDescription] = useState(canvas?.description || '');
  const [visibility, setVisibility] = useState(canvas?.visibility || 'private');
  const [color, setColor] = useState(canvas?.color || DEFAULT_COLORS.canvas);
  const [icon, setIcon] = useState(canvas?.icon || null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleKeyChange = (v) => {
    const upper = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setKey(upper);
    if (upper && !/^[A-Z][A-Z0-9]{1,9}$/.test(upper)) {
      setKeyError('2-10 uppercase letters/numbers, starting with a letter');
    } else {
      setKeyError('');
    }
  };

  const handleSave = async () => {
    if (!canvasName.trim() || !key.trim() || keyError || saving) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await axios.patch(`/canvases/${canvasId}`, {
        canvas_name: canvasName.trim(),
        key: key.trim(),
        description: description.trim() || null,
        visibility,
        color,
        icon,
      });
      if (res.data.status) {
        setSaved(true);
        if (onUpdated) onUpdated();
        window.dispatchEvent(new Event('canvas:created'));
        setTimeout(() => setSaved(false), 2000);
      } else if (res.data.message === 'KEY_ALREADY_EXISTS') {
        setKeyError('This key is already in use.');
      }
    } catch {}
    setSaving(false);
  };

  return (
    <div className="SettingsGeneral">
      {/* Appearance */}
      <AppearanceSection
        icon={icon}
        color={color}
        entityType="canvas"
        entityId={canvasId}
        disabled={!isAdmin}
        onChange={({ icon: newIcon, color: newColor }) => {
          setIcon(newIcon);
          setColor(newColor);
        }}
      />

      {/* Canvas Name */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">Canvas Name</label>
        <input
          className="SettingsGeneral__Input"
          value={canvasName}
          onChange={(e) => setCanvasName(e.target.value)}
          disabled={!isAdmin}
        />
      </div>

      {/* Key */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">Key</label>
        <input
          className={`SettingsGeneral__Input ${!isAdmin ? 'SettingsGeneral__Input--readonly' : ''}`}
          value={key}
          onChange={(e) => handleKeyChange(e.target.value)}
          disabled={!isAdmin}
          maxLength={10}
        />
        {keyError && <span className="SettingsGeneral__Error">{keyError}</span>}
        {isAdmin && !keyError && (
          <span className="SettingsGeneral__Hint">
            2-10 uppercase letters/numbers, starting with a letter
          </span>
        )}
      </div>

      {/* Description */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">Description</label>
        <textarea
          className="SettingsGeneral__Textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Canvas description..."
          disabled={!isAdmin}
        />
      </div>

      {/* Visibility */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">Visibility</label>
        <div className="SettingsGeneral__VisibilityGroup">
          <button
            type="button"
            className={`SettingsGeneral__VisibilityBtn ${visibility === 'private' ? 'SettingsGeneral__VisibilityBtn--active' : ''}`}
            onClick={() => isAdmin && setVisibility('private')}
            disabled={!isAdmin}
          >
            <Lock size={14} />
            Private
          </button>
          <button
            type="button"
            className={`SettingsGeneral__VisibilityBtn ${visibility === 'public' ? 'SettingsGeneral__VisibilityBtn--active' : ''}`}
            onClick={() => isAdmin && setVisibility('public')}
            disabled={!isAdmin}
          >
            <Globe size={14} />
            Public
          </button>
        </div>
        <span className="SettingsGeneral__Hint">
          {visibility === 'private'
            ? 'Only invited members can access this canvas.'
            : 'Anyone can find and join this canvas.'}
        </span>
      </div>

      {/* 저장 버튼 */}
      {isAdmin && (
        <div className="SettingsGeneral__Actions">
          <button
            className="SettingsGeneral__SaveBtn"
            onClick={handleSave}
            disabled={!canvasName.trim() || !key.trim() || keyError || saving}
          >
            {saving ? 'Saving...' : saved ? 'Saved' : 'Save Changes'}
          </button>
        </div>
      )}

      {/* Danger Zone */}
      {isAdmin && (
        <div className="SettingsGeneral__Danger">
          <div className="SettingsGeneral__DangerHeader">
            <AlertTriangle size={16} />
            <span>Danger Zone</span>
          </div>

          {!showDeleteConfirm ? (
            <div className="SettingsGeneral__DangerRow">
              <div className="SettingsGeneral__DangerInfo">
                <span className="SettingsGeneral__DangerTitle">이 캔버스 아카이브</span>
                <span className="SettingsGeneral__DangerDesc">
                  아카이브하면 목록에서 사라지고, 보관함에서 복원하거나 영구삭제할 수 있어요.
                </span>
              </div>
              <button
                className="SettingsGeneral__DeleteBtn"
                onClick={() => setShowDeleteConfirm(true)}
              >
                아카이브
              </button>
            </div>
          ) : (
            <div className="SettingsGeneral__DeleteConfirm">
              <p className="SettingsGeneral__DeleteWarning">
                보관함에서 되돌릴 수 있어요. 확정하려면 <strong>{canvas?.key}</strong> 입력.
              </p>
              <input
                className="SettingsGeneral__Input"
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder={canvas?.key}
              />
              <div className="SettingsGeneral__DeleteActions">
                <button
                  className="SettingsGeneral__DeleteConfirmBtn"
                  disabled={deleteInput !== canvas?.key || deleting}
                  onClick={async () => {
                    setDeleting(true);
                    try {
                      const res = await axios.delete(`/canvases/${canvasId}`);
                      if (res.data.status) {
                        window.dispatchEvent(new Event('canvas:created'));
                        router.replace('/canvas');
                      }
                    } catch {}
                    setDeleting(false);
                  }}
                >
                  {deleting ? '아카이브 중…' : '아카이브'}
                </button>
                <button
                  className="SettingsGeneral__CancelBtn"
                  onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
