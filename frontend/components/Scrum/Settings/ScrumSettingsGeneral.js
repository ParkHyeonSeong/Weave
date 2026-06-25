import { useState } from 'react';
import { useRouter } from 'next/router';
import { Lock, Globe, AlertTriangle, Check } from 'lucide-react';
import { axios } from '@/library/_axios';
import { showToast } from '@/components/Layout/Toast';
import { COLOR_PRESETS, DEFAULT_COLORS } from '@/library/entityAppearance';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';

const CADENCES = [
  { v: 'weekly', label: '매주' },
  { v: 'biweekly', label: '격주' },
  { v: 'every_n_weeks', label: 'N주마다' },
  { v: 'monthly', label: '매월' },
  { v: 'manual', label: '수동' },
];
const WEEKDAYS = [['0', '월'], ['1', '화'], ['2', '수'], ['3', '목'], ['4', '금']];
const DEFAULT_SCRUM_COLOR = DEFAULT_COLORS.scrum;

export default function ScrumSettingsGeneral({ board, boardId, isAdmin, onUpdated }) {
  const router = useRouter();
  const [name, setName] = useState(board.name || '');
  const [color, setColor] = useState(board.color || DEFAULT_SCRUM_COLOR);
  const [visibility, setVisibility] = useState(board.visibility || 'private');
  const [cadence, setCadence] = useState(board.retro_cadence || 'weekly');
  const [intervalWeeks, setIntervalWeeks] = useState(board.retro_interval_weeks ?? 3);
  const [anchorWeekday, setAnchorWeekday] = useState(board.retro_anchor_weekday ?? 4);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);

  const nameValid = name.trim().length > 0 && name.length <= 300;
  const intervalValid = cadence !== 'every_n_weeks'
    || (Number(intervalWeeks) >= 2 && Number(intervalWeeks) <= 12);

  const dirty =
    name !== (board.name || '')
    || color !== (board.color || DEFAULT_SCRUM_COLOR)
    || visibility !== (board.visibility || 'private')
    || cadence !== (board.retro_cadence || 'weekly')
    || Number(anchorWeekday) !== (board.retro_anchor_weekday ?? 4)
    || (cadence === 'every_n_weeks'
        && Number(intervalWeeks) !== (board.retro_interval_weeks ?? 3));

  const canSave = isAdmin && dirty && nameValid && intervalValid && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await axios.patch(`/scrum/${boardId}`, {
        name: name.trim(),
        color,
        visibility,
        retro_cadence: cadence,
        retro_interval_weeks: cadence === 'every_n_weeks' ? Number(intervalWeeks) : null,
        retro_anchor_weekday: Number(anchorWeekday),
      });
      if (res.data.status) {
        setSaved(true);
        onUpdated?.();
        window.dispatchEvent(new Event('scrum:updated'));
        setTimeout(() => setSaved(false), 2000);
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? '저장 실패';
        showToast(msg, 'error');
      }
    } catch {
      showToast('저장 실패', 'error');
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (deleteInput !== board.name || deleting) return;
    setDeleting(true);
    try {
      const res = await axios.delete(`/scrum/${boardId}`);
      if (res.data.status) {
        window.dispatchEvent(new Event('scrum:updated'));
        router.replace('/scrum');
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? '아카이브 실패';
        showToast(msg, 'error');
        setDeleting(false);
      }
    } catch {
      showToast('아카이브 실패', 'error');
      setDeleting(false);
    }
  };

  return (
    <div className="SettingsGeneral">
      {/* Board Name */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">팀 이름</label>
        <input
          className="SettingsGeneral__Input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!isAdmin}
          maxLength={300}
        />
        {!nameValid && name.length === 0 && isAdmin && (
          <span className="SettingsGeneral__Error">이름은 필수입니다</span>
        )}
      </div>

      {/* Color */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">색상</label>
        <div className="SettingsGeneral__ColorRow">
          <div className="SettingsGeneral__Swatches">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                className={`SettingsGeneral__Swatch ${color === c ? 'SettingsGeneral__Swatch--active' : ''}`}
                style={{ background: c }}
                onClick={() => isAdmin && setColor(c)}
                disabled={!isAdmin}
                aria-label={`color ${c}`}
              >
                {color === c && <Check size={13} color="#fff" />}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Visibility */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">공개 범위</label>
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
            ? '멤버만 이 보드에 접근할 수 있어요.'
            : '조직 전체가 이 보드를 조회할 수 있어요.'}
        </span>
      </div>

      {/* Retro cadence */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">회고 주기</label>
        <div className="Scrum__ChipRow">
          {CADENCES.map((c) => (
            <button
              key={c.v}
              type="button"
              className={`Scrum__Chip ${cadence === c.v ? 'Scrum__Chip--on' : ''}`}
              onClick={() => isAdmin && setCadence(c.v)}
              disabled={!isAdmin}
            >
              {c.label}
            </button>
          ))}
        </div>
        {cadence === 'every_n_weeks' && (
          <input
            type="number"
            min={2}
            max={12}
            className="SettingsGeneral__Input"
            style={{ marginTop: 8, maxWidth: 120 }}
            value={intervalWeeks}
            onChange={(e) => setIntervalWeeks(e.target.value)}
            disabled={!isAdmin}
          />
        )}
      </div>

      {/* Anchor weekday */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">기준 요일</label>
        <div className="Scrum__ChipRow">
          {WEEKDAYS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={`Scrum__Chip ${String(anchorWeekday) === v ? 'Scrum__Chip--on' : ''}`}
              onClick={() => isAdmin && setAnchorWeekday(Number(v))}
              disabled={!isAdmin}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Retro template (read-only — only KPT exists) */}
      <div className="SettingsGeneral__Field">
        <label className="SettingsGeneral__Label">회고 템플릿</label>
        <input
          className="SettingsGeneral__Input SettingsGeneral__Input--readonly"
          value="KPT"
          readOnly
          disabled
        />
        <span className="SettingsGeneral__Hint">현재는 KPT 템플릿만 지원해요.</span>
      </div>

      {/* Save */}
      {isAdmin && (
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
      {isAdmin && (
        <div className="SettingsGeneral__Danger">
          <div className="SettingsGeneral__DangerHeader">
            <AlertTriangle size={16} />
            <span>Danger Zone</span>
          </div>

          {!showDeleteConfirm ? (
            <div className="SettingsGeneral__DangerRow">
              <div className="SettingsGeneral__DangerInfo">
                <span className="SettingsGeneral__DangerTitle">보드 아카이브</span>
                <span className="SettingsGeneral__DangerDesc">
                  이 스크럼 보드와 모든 주간 보드·회고가 아카이브됩니다.
                  멤버는 더 이상 접근할 수 없어요.
                </span>
              </div>
              <button
                className="SettingsGeneral__DeleteBtn"
                onClick={() => setShowDeleteConfirm(true)}
              >
                보드 아카이브
              </button>
            </div>
          ) : (
            <div className="SettingsGeneral__DeleteConfirm">
              <p className="SettingsGeneral__DeleteWarning">
                되돌릴 수 없습니다. 확정하려면 보드 이름{' '}
                <strong>{board.name}</strong>을(를) 입력하세요.
              </p>
              <input
                className="SettingsGeneral__Input"
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder={board.name}
              />
              <div className="SettingsGeneral__DeleteActions">
                <button
                  className="SettingsGeneral__DeleteConfirmBtn"
                  disabled={deleteInput !== board.name || deleting}
                  onClick={handleDelete}
                >
                  {deleting ? 'Archiving…' : '확인했습니다, 아카이브'}
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
