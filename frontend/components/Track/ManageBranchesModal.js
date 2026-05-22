import { useState, useEffect } from 'react';
import { X, GitBranch, Check, AlertTriangle } from 'lucide-react';

/**
 * Track의 Participating branches를 관리하는 모달.
 * - 추가: 아직 참여 안 한 branch를 체크
 * - 제거: 이미 참여 중인 branch를 체크 해제
 *   → 제거 시 그 branch에서 온 item들이 Track에서 어떻게 될지 안내
 */
export default function ManageBranchesModal({
  allBranches,
  participatingBranchIds,
  itemsByBranchId,
  onClose,
  onConfirm,
}) {
  const [selected, setSelected] = useState(() => new Set(participatingBranchIds));

  // ESC로 닫기
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const toggle = (branchId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) next.delete(branchId); else next.add(branchId);
      return next;
    });
  };

  const initial = new Set(participatingBranchIds);
  const added = [...selected].filter((id) => !initial.has(id));
  const removed = [...initial].filter((id) => !selected.has(id));

  // 제거하면 영향 받는 item 카운트
  const impactedByRemoval = removed.reduce((sum, bid) => sum + (itemsByBranchId.get(bid) || 0), 0);

  const hasChanges = added.length > 0 || removed.length > 0;

  return (
    <div className="ManageBranches__Backdrop" onClick={onClose}>
      <div className="ManageBranches" onClick={(e) => e.stopPropagation()}>
        <header className="ManageBranches__Head">
          <div className="ManageBranches__Title">
            <GitBranch size={16} />
            <span>Participating branches</span>
          </div>
          <button className="ManageBranches__Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <p className="ManageBranches__Desc">
          이 Track에 어떤 branch가 참여하는지 정해줘.
          여기서 선택된 branch만 SourcePicker 트리에 노출되고, task를 드래그해 추가할 수 있어.
        </p>

        <ul className="ManageBranches__List">
          {allBranches.map((b) => {
            const checked = selected.has(b.branch_id);
            const wasIn = initial.has(b.branch_id);
            const itemCount = itemsByBranchId.get(b.branch_id) || 0;
            return (
              <li key={b.branch_id}>
                <label
                  className={`ManageBranches__Item ${checked ? 'ManageBranches__Item--checked' : ''}`}
                  style={{ '--branch-color': b.color }}
                >
                  <input
                    type="checkbox"
                    className="ManageBranches__Checkbox"
                    checked={checked}
                    onChange={() => toggle(b.branch_id)}
                  />
                  <span className="ManageBranches__Mark">
                    {checked && <Check size={12} />}
                  </span>
                  <span className="ManageBranches__BranchDot" />
                  <span className="ManageBranches__BranchName">{b.name}</span>
                  <span className="ManageBranches__BranchKey">{b.key}</span>
                  {wasIn && itemCount > 0 && (
                    <span className="ManageBranches__ItemCount">
                      {itemCount} item{itemCount > 1 ? 's' : ''}
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>

        {removed.length > 0 && impactedByRemoval > 0 && (
          <div className="ManageBranches__Warn">
            <AlertTriangle size={14} />
            <span>
              제거한 branch에서 온 <strong>{impactedByRemoval}개 item</strong>이
              Track에서 사라져. 원본 branch의 task에는 영향 없음.
            </span>
          </div>
        )}

        <footer className="ManageBranches__Foot">
          <div className="ManageBranches__Diff">
            {added.length > 0 && <span className="ManageBranches__DiffAdd">+{added.length} added</span>}
            {added.length > 0 && removed.length > 0 && <span className="ManageBranches__DiffSep">·</span>}
            {removed.length > 0 && <span className="ManageBranches__DiffRemove">−{removed.length} removed</span>}
          </div>
          <div className="ManageBranches__Actions">
            <button className="ManageBranches__Btn ManageBranches__Btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              className="ManageBranches__Btn ManageBranches__Btn--primary"
              onClick={() => onConfirm([...selected])}
              disabled={!hasChanges}
            >
              {hasChanges ? 'Save changes' : 'No changes'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
