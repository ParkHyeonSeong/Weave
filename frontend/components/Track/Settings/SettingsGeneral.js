import { useState } from 'react';
import { useRouter } from 'next/router';
import { Lock, Globe, AlertTriangle } from 'lucide-react';
import { axios } from '@/library/_axios';
import { showToast } from '@/components/Layout/Toast';
import AppearanceSection from '@/components/common/AppearanceSection';
import { HEX_RE, DEFAULT_TRACK_COLOR } from './constants';

export default function SettingsGeneral({ trackId, track, isOwner, onUpdated }) {
  const router = useRouter();
  const [trackName, setTrackName] = useState(track.track_name || '');
  const [description, setDescription] = useState(track.description || '');
  const [color, setColor] = useState(track.color || DEFAULT_TRACK_COLOR);
  const [icon, setIcon] = useState(track.icon || null);
  const [visibility, setVisibility] = useState(track.visibility || 'private');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  const colorValid = HEX_RE.test(color);
  const nameValid = trackName.trim().length > 0 && trackName.length <= 300;
  const dirty =
    trackName !== (track.track_name || '')
    || description !== (track.description || '')
    || color !== (track.color || DEFAULT_TRACK_COLOR)
    || icon !== (track.icon || null)
    || visibility !== (track.visibility || 'private');

  const canSave = isOwner && dirty && nameValid && colorValid && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await axios.patch(`/tracks/${trackId}`, {
        track_name: trackName.trim(),
        description: description.trim() || null,
        color,
        icon,
        visibility,
      });
      if (res.data.status) {
        setSaved(true);
        onUpdated?.();
        window.dispatchEvent(new Event('track:updated'));
        setTimeout(() => setSaved(false), 2000);
      } else {
        showToast(`저장 실패: ${res.data.message}`, 'error');
      }
    } catch {
      showToast('저장 실패', 'error');
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (deleteInput !== track.track_name || deleting) return;
    setDeleting(true);
    try {
      const res = await axios.delete(`/tracks/${trackId}`);
      if (res.data.status) {
        window.dispatchEvent(new Event('track:updated'));
        router.replace('/tracks');
      } else {
        showToast(`삭제 실패: ${res.data.message}`, 'error');
        setDeleting(false);
      }
    } catch {
      showToast('삭제 실패', 'error');
      setDeleting(false);
    }
  };

  return (
    <div className="SettingsGeneral">
      {/* Track Name */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">Track Name</label>
        <input
          className="SettingsGeneral__Input"
          value={trackName}
          onChange={(e) => setTrackName(e.target.value)}
          disabled={!isOwner}
          maxLength={300}
        />
        {!nameValid && trackName.length === 0 && isOwner && (
          <span className="SettingsGeneral__Error">이름은 필수입니다</span>
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
          placeholder="Track description..."
          disabled={!isOwner}
        />
      </div>

      {/* Appearance */}
      <AppearanceSection
        icon={icon}
        color={color}
        entityType="track"
        entityId={trackId}
        disabled={!isOwner}
        onChange={({ icon: newIcon, color: newColor }) => {
          setIcon(newIcon);
          setColor(newColor);
        }}
      />

      {/* Visibility */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">Visibility</label>
        <div className="SettingsGeneral__VisibilityGroup">
          <button
            type="button"
            className={`SettingsGeneral__VisibilityBtn ${visibility === 'private' ? 'SettingsGeneral__VisibilityBtn--active' : ''}`}
            onClick={() => isOwner && setVisibility('private')}
            disabled={!isOwner}
          >
            <Lock size={14} />
            Private
          </button>
          <button
            type="button"
            className={`SettingsGeneral__VisibilityBtn ${visibility === 'public' ? 'SettingsGeneral__VisibilityBtn--active' : ''}`}
            onClick={() => isOwner && setVisibility('public')}
            disabled={!isOwner}
          >
            <Globe size={14} />
            Public
          </button>
        </div>
        <span className="SettingsGeneral__Hint">
          {visibility === 'private'
            ? '초대된 멤버만 이 Track에 접근할 수 있어요.'
            : '누구나 이 Track을 찾아 볼 수 있어요.'}
        </span>
      </div>

      {/* Save */}
      {isOwner && (
        <div className="SettingsGeneral__Actions">
          <button
            className="SettingsGeneral__SaveBtn"
            onClick={handleSave}
            disabled={!canSave}
          >
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save Changes'}
          </button>
        </div>
      )}

      {/* Danger Zone */}
      {isOwner && (
        <div className="SettingsGeneral__Danger">
          <div className="SettingsGeneral__DangerHeader">
            <AlertTriangle size={16} />
            <span>Danger Zone</span>
          </div>

          {!showDeleteConfirm ? (
            <div className="SettingsGeneral__DangerRow">
              <div className="SettingsGeneral__DangerInfo">
                <span className="SettingsGeneral__DangerTitle">Delete this track</span>
                <span className="SettingsGeneral__DangerDesc">
                  Track 자체와 import한 item·link가 모두 영구 삭제됩니다.
                  Track에서 materialize한 의존 관계도 함께 정리됩니다.
                  원본 task·branch·sprint·epic에는 영향이 없습니다.
                </span>
              </div>
              <button
                className="SettingsGeneral__DeleteBtn"
                onClick={() => setShowDeleteConfirm(true)}
              >
                Delete Track
              </button>
            </div>
          ) : (
            <div className="SettingsGeneral__DeleteConfirm">
              <p className="SettingsGeneral__DeleteWarning">
                되돌릴 수 없습니다. 확정하려면 Track 이름{' '}
                <strong>{track.track_name}</strong>을(를) 입력하세요.
              </p>
              <input
                className="SettingsGeneral__Input"
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder={track.track_name}
              />
              <div className="SettingsGeneral__DeleteActions">
                <button
                  className="SettingsGeneral__DeleteConfirmBtn"
                  disabled={deleteInput !== track.track_name || deleting}
                  onClick={handleDelete}
                >
                  {deleting ? 'Deleting…' : 'I understand, delete this track'}
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
