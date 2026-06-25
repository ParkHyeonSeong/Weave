import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { axios } from '@/library/_axios';
import { Pencil, X, RotateCcw, Info } from 'lucide-react';
import ConfirmModal from '@/components/modal/ConfirmModal';
import { showToast } from '@/components/Layout/Toast';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';
import { COLOR_PRESETS, HEX_RE, DEFAULT_TRACK_COLOR } from './constants';
import EntityIcon from '@/components/common/EntityIcon';

export default function SettingsBranches({ trackId, isEditor }) {
  const router = useRouter();
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [draftName, setDraftName] = useState('');
  const [draftColor, setDraftColor] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(null);  // { branch_id, display_name }

  const fetchBranches = useCallback(async () => {
    if (!trackId) return;
    try {
      const res = await axios.get(`/tracks/${trackId}/branches`);
      if (res.data.status) setBranches(res.data.branches);
    } catch {}
    setLoading(false);
  }, [trackId]);

  useEffect(() => { fetchBranches(); }, [fetchBranches]);

  const startEdit = (branch) => {
    setEditingId(branch.branch_id);
    setDraftName(branch.display_name_override || '');
    setDraftColor(branch.color_override || branch.branch_real_color || DEFAULT_TRACK_COLOR);
  };
  const cancelEdit = () => { setEditingId(null); };

  const saveEdit = async (branch) => {
    const trimmedName = draftName.trim();
    const namePayload = trimmedName ? trimmedName : null;
    const colorPayload =
      !draftColor || draftColor === branch.branch_real_color ? null : draftColor;

    if (colorPayload && !HEX_RE.test(colorPayload)) {
      showToast('유효한 hex (#RRGGBB)를 입력하세요', 'error');
      return;
    }
    try {
      const res = await axios.patch(
        `/tracks/${trackId}/branches/${branch.branch_id}`,
        { display_name_override: namePayload, color_override: colorPayload },
      );
      if (res.data.status) {
        fetchBranches();
        setEditingId(null);
        window.dispatchEvent(new Event('track:updated'));
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? '저장 실패';
        showToast(msg, 'error');
      }
    } catch {
      showToast('저장 실패', 'error');
    }
  };

  const resetOverrides = async (branch) => {
    try {
      const res = await axios.patch(
        `/tracks/${trackId}/branches/${branch.branch_id}`,
        { display_name_override: null, color_override: null },
      );
      if (res.data.status) {
        fetchBranches();
        setEditingId(null);
        window.dispatchEvent(new Event('track:updated'));
      }
    } catch {
      showToast('초기화 실패', 'error');
    }
  };

  const removeBranch = async (branchId) => {
    try {
      const res = await axios.delete(`/tracks/${trackId}/branches/${branchId}`);
      if (res.data.status) {
        fetchBranches();
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? '제거 실패';
        showToast(msg, 'error');
      }
    } catch {
      showToast('제거 실패', 'error');
    }
    setConfirmRemove(null);
  };

  if (loading) return null;

  return (
    <div className="SettingsBranches">
      <div className="SettingsBranches__Banner">
        <Info size={14} />
        <div>
          <strong>Branch는 bulk add/drag 시 자동으로 합류합니다.</strong>{' '}
          여기선 이 Track에서만 다르게 보이도록 표시 이름과 색을 덮어쓰거나,
          제거해 모든 item과 의존을 정리할 수 있어요.
        </div>
      </div>

      {branches.length === 0 ? (
        <div className="SettingsBranches__Empty">
          <div className="SettingsBranches__EmptyTitle">아직 참여 중인 branch가 없어요</div>
          <div className="SettingsBranches__EmptyHint">
            Track으로 돌아가 <strong>Add by Sprint / Epic / Filter</strong>로 시작하세요.
          </div>
          <button
            className="SettingsBranches__EmptyBtn"
            onClick={() => router.push(`/tracks/${trackId}`)}
          >
            Back to Track
          </button>
        </div>
      ) : (
        <ul className="SettingsBranches__List">
          {branches.map((b) => {
            const editing = editingId === b.branch_id;
            const overridden = !!(b.display_name_override || b.color_override);
            return (
              <li key={b.branch_id} className="SettingsBranches__Card">
                <div className="SettingsBranches__CardMain">
                  <EntityIcon
                    icon={b.icon}
                    color={b.color_override || b.branch_real_color || b.color}
                    size={14}
                    entityType="branch"
                  />
                  <div className="SettingsBranches__Names">
                    <span className="SettingsBranches__Name">{b.display_name}</span>
                    <span className="SettingsBranches__Sub">
                      {b.branch_key}
                      {overridden && (
                        <em className="SettingsBranches__OverrideMark">overridden</em>
                      )}
                    </span>
                  </div>
                  {isEditor && !editing && (
                    <div className="SettingsBranches__Actions">
                      <button
                        className="SettingsBranches__IconBtn"
                        onClick={() => startEdit(b)}
                        title="Edit display name / color"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        className="SettingsBranches__IconBtn SettingsBranches__IconBtn--danger"
                        onClick={() => setConfirmRemove({
                          branch_id: b.branch_id,
                          display_name: b.display_name,
                        })}
                        title="Remove branch (item·dep cascade)"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}
                </div>

                {editing && (
                  <div className="SettingsBranches__Edit">
                    <label className="SettingsBranches__EditField">
                      <span className="SettingsBranches__EditLabel">
                        Display name (이 Track에서만)
                      </span>
                      <input
                        className="SettingsBranches__EditInput"
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        placeholder={b.branch_real_name}
                        maxLength={300}
                      />
                    </label>
                    <label className="SettingsBranches__EditField">
                      <span className="SettingsBranches__EditLabel">
                        Color (이 Track에서만)
                      </span>
                      <div className="SettingsBranches__ColorRow">
                        <div className="SettingsBranches__Swatches">
                          {COLOR_PRESETS.map((p) => (
                            <button
                              key={p}
                              type="button"
                              className={`SettingsBranches__Swatch ${draftColor.toLowerCase() === p.toLowerCase() ? 'SettingsBranches__Swatch--active' : ''}`}
                              style={{ background: p }}
                              onClick={() => setDraftColor(p)}
                              aria-label={p}
                            />
                          ))}
                        </div>
                        <input
                          className="SettingsBranches__HexInput"
                          value={draftColor}
                          onChange={(e) => setDraftColor(e.target.value)}
                          maxLength={7}
                          placeholder="#RRGGBB"
                        />
                      </div>
                    </label>
                    <div className="SettingsBranches__EditActions">
                      {overridden && (
                        <button
                          className="SettingsBranches__ResetBtn"
                          onClick={() => resetOverrides(b)}
                          title="원본 이름·색으로 되돌리기"
                        >
                          <RotateCcw size={12} /> Reset
                        </button>
                      )}
                      <span style={{ flex: 1 }} />
                      <button
                        className="SettingsBranches__CancelBtn"
                        onClick={cancelEdit}
                      >
                        Cancel
                      </button>
                      <button
                        className="SettingsBranches__SaveBtn"
                        onClick={() => saveEdit(b)}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmModal
        isOpen={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={() => confirmRemove && removeBranch(confirmRemove.branch_id)}
        title="Remove branch from track"
        message={
          confirmRemove
            ? `"${confirmRemove.display_name}" branch를 이 Track에서 빼면 해당 branch의 모든 item과 materialize된 의존이 함께 정리됩니다. 계속할까요?`
            : ''
        }
        confirmLabel="Remove"
        variant="danger"
      />
    </div>
  );
}
