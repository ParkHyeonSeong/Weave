import { useState } from 'react';
import { useRouter } from 'next/router';
import { axios } from '@/library/_axios';
import { Globe, Lock, AlertTriangle } from 'lucide-react';

export default function SettingsGeneral({ branchId, branch, isAdmin, onUpdated }) {
  const router = useRouter();
  const [branchName, setBranchName] = useState(branch?.branch_name || '');
  const [description, setDescription] = useState(branch?.description || '');
  const [visibility, setVisibility] = useState(branch?.visibility || 'private');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    if (!branchName.trim() || saving) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await axios.patch(`/branches/${branchId}`, {
        branch_name: branchName.trim(),
        description: description.trim() || null,
        visibility,
      });
      if (res.data.status) {
        setSaved(true);
        if (onUpdated) onUpdated();
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {}
    setSaving(false);
  };

  return (
    <div className="SettingsGeneral">
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

      {/* Key (읽기 전용) */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">Key</label>
        <input
          className="SettingsGeneral__Input SettingsGeneral__Input--readonly"
          value={branch?.key || ''}
          disabled
        />
        <span className="SettingsGeneral__Hint">Key cannot be changed after creation.</span>
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
            disabled={!branchName.trim() || saving}
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
    </div>
  );
}
