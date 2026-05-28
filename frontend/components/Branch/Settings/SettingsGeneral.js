import { useState } from 'react';
import { useRouter } from 'next/router';
import { axios } from '@/library/_axios';
import { Globe, Lock, AlertTriangle, Upload } from 'lucide-react';
import JiraMigrationModal from './JiraMigrationModal';
import AppearanceSection from '@/components/common/AppearanceSection';
import { DEFAULT_COLORS } from '@/library/entityAppearance';

export default function SettingsGeneral({ branchId, branch, isAdmin, onUpdated }) {
  const router = useRouter();
  const [branchName, setBranchName] = useState(branch?.branch_name || '');
  const [key, setKey] = useState(branch?.key || '');
  const [keyError, setKeyError] = useState('');
  const [description, setDescription] = useState(branch?.description || '');
  const [visibility, setVisibility] = useState(branch?.visibility || 'private');
  const [color, setColor] = useState(branch?.color || DEFAULT_COLORS.branch);
  const [icon, setIcon] = useState(branch?.icon || null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [showJiraMigration, setShowJiraMigration] = useState(false);

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
    if (!branchName.trim() || !key.trim() || keyError || saving) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await axios.patch(`/branches/${branchId}`, {
        branch_name: branchName.trim(),
        key: key.trim(),
        description: description.trim() || null,
        visibility,
        color,
        icon,
      });
      if (res.data.status) {
        setSaved(true);
        if (onUpdated) onUpdated();
        window.dispatchEvent(new Event('branch:created'));
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
        entityType="branch"
        entityId={branchId}
        disabled={!isAdmin}
        onChange={({ icon: newIcon, color: newColor }) => {
          setIcon(newIcon);
          setColor(newColor);
        }}
      />

      {/* Branch Name */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">Branch Name</label>
        <input
          className="SettingsGeneral__Input"
          value={branchName}
          onChange={(e) => setBranchName(e.target.value)}
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
            Changing the key will update all task IDs (e.g., {branch?.key}-1 → {key || '?'}-1)
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
          placeholder="Branch description..."
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
            ? 'Only invited members can access this branch.'
            : 'Anyone can find and join this branch.'}
        </span>
      </div>

      {/* 저장 버튼 */}
      {isAdmin && (
        <div className="SettingsGeneral__Actions">
          <button
            className="SettingsGeneral__SaveBtn"
            onClick={handleSave}
            disabled={!branchName.trim() || !key.trim() || keyError || saving}
          >
            {saving ? 'Saving...' : saved ? 'Saved' : 'Save Changes'}
          </button>
        </div>
      )}

      {/* Import from Jira */}
      {isAdmin && (
        <div className="SettingsGeneral__Actions">
          <button
            className="SettingsGeneral__ImportBtn"
            onClick={() => setShowJiraMigration(true)}
          >
            <Upload size={14} />
            Import from Jira
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
                <span className="SettingsGeneral__DangerTitle">Delete this branch</span>
                <span className="SettingsGeneral__DangerDesc">
                  Once deleted, all tasks, epics, and settings will be permanently removed.
                </span>
              </div>
              <button
                className="SettingsGeneral__DeleteBtn"
                onClick={() => setShowDeleteConfirm(true)}
              >
                Delete Branch
              </button>
            </div>
          ) : (
            <div className="SettingsGeneral__DeleteConfirm">
              <p className="SettingsGeneral__DeleteWarning">
                This action cannot be undone. Please type <strong>{branch?.key}</strong> to confirm.
              </p>
              <input
                className="SettingsGeneral__Input"
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder={branch?.key}
              />
              <div className="SettingsGeneral__DeleteActions">
                <button
                  className="SettingsGeneral__DeleteConfirmBtn"
                  disabled={deleteInput !== branch?.key || deleting}
                  onClick={async () => {
                    setDeleting(true);
                    try {
                      const res = await axios.delete(`/branches/${branchId}`);
                      if (res.data.status) {
                        window.dispatchEvent(new Event('branch:created'));
                        router.replace('/');
                      }
                    } catch {}
                    setDeleting(false);
                  }}
                >
                  {deleting ? 'Deleting...' : 'I understand, delete this branch'}
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
      {showJiraMigration && (
        <JiraMigrationModal
          branchId={branchId}
          onClose={() => setShowJiraMigration(false)}
        />
      )}
    </div>
  );
}
