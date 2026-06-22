// frontend/library/filterSpecAdapter.js
const cond = (field, op, value) => ({ type: 'cond', field, op, value, negate: false });

export function toFilterSpec({ searchQuery, selectedUserIds, filters }) {
  const children = [];
  if (searchQuery) children.push(cond('text', 'contains', searchQuery));
  const ids = [...(selectedUserIds || new Set())];
  if (ids.length) {
    const real = ids.filter((i) => i !== 0);
    const hasUnassigned = ids.includes(0);
    // 현 UI 의미(taskFilters.js): 미할당(0) OR (선택 유저들). 동작 보존 위해 OR 그룹으로 변환.
    const userConds = [];
    if (hasUnassigned) userConds.push(cond('assignee', 'is_empty', null));
    if (real.length) userConds.push(cond('assignee', 'in', real));
    if (userConds.length === 1) children.push(userConds[0]);
    else if (userConds.length > 1) children.push({ type: 'group', op: 'OR', negate: false, children: userConds });
  }
  if (filters.priorities?.size) children.push(cond('priority', 'in', [...filters.priorities]));
  if (filters.statusKeys?.size) children.push(cond('status', 'in', [...filters.statusKeys]));
  if (filters.typeKeys?.size) children.push(cond('task_type', 'in', [...filters.typeKeys]));
  if (filters.labelIds?.size) children.push(cond('label', 'in', [...filters.labelIds]));
  if (filters.epicIds?.size) children.push(cond('epic', 'in', [...filters.epicIds]));
  return { type: 'group', op: 'AND', negate: false, children };
}

// 레거시 quick-chip 필터(legacyCtx)와 고급 빌더 spec(filterSpec)을 AND로 합성한 단일 spec.
// 빈 그룹은 생략. 둘 다 비면 children=[] (=전체).
export function buildEffectiveSpec({ legacyCtx, filterSpec }) {
  const children = [];
  const legacy = toFilterSpec(legacyCtx || { searchQuery: '', selectedUserIds: new Set(), filters: {} });
  if (legacy.children.length) children.push(legacy);
  if (filterSpec && (filterSpec.children || []).length) children.push(filterSpec);
  if (children.length === 1) return children[0];
  return { type: 'group', op: 'AND', negate: false, children };
}
