// frontend/library/savedViewState.js
import { buildEffectiveSpec } from './filterSpecAdapter';
import { emptyGroup } from './filterBuilderState';

// 저장: 레거시 quick-chip + 고급 spec을 단일 filter_spec으로 합성.
// 정렬은 모드별로 실제 활성 상태를 담는다: 평면 뷰(groupBy='none')는 단일정렬 sortConfig가 실제
// 정렬이므로 sort로 저장하고(안 그러면 'Due Date 정렬→저장→적용' 시 정렬이 사라짐 — 리뷰 P1),
// 그룹핑 뷰는 multiSort를 담는다. applySavedView가 sort[0]→sortConfig로 되돌려 평면 정렬을 복원.
export function toSavedPayload({ legacyCtx, filterSpec, groupBy, multiSort, sortConfig }) {
  const grouping = groupBy && groupBy !== 'none';
  let sort = [];
  if (grouping) {
    if (multiSort && multiSort.length) sort = multiSort;
  } else if (sortConfig && sortConfig.field) {
    sort = [{ field: sortConfig.field, dir: sortConfig.direction === 'desc' ? 'desc' : 'asc' }];
  }
  return {
    filter_spec: buildEffectiveSpec({ legacyCtx, filterSpec }),
    group_by: grouping ? groupBy : null,
    sort,
  };
}

// 적용: 뷰 → 화면 상태(레거시 quick-chip은 호출 측에서 비움).
// 주의: TaskList는 그룹핑 모드에서만 multiSort를 적용하고, 평면(groupBy='none') 뷰는 레거시 단일정렬(sortConfig)을
// 쓴다. 그래서 뷰의 첫 정렬키를 sortConfig로도 매핑해 평면 뷰에서도 정렬이 반영되게 한다.
// 백엔드는 cond 루트 spec을 보존한다(test_cond_root_spec_preserved). FilterBuilder UI는 group 루트를
// 가정하므로, cond 루트는 {type:'group',op:'AND',children:[cond]}로 감싸 적용한다. group/cond가 아니면
// 빈 그룹. ⚠️ type==='group'만 통과시키면 cond 루트가 조용히 emptyGroup→'전체보기' 버그(리뷰 P1).
function normalizeApplied(spec) {
  if (spec && spec.type === 'group') return spec;
  if (spec && spec.type === 'cond') return { type: 'group', op: 'AND', negate: false, children: [spec] };
  return emptyGroup();
}

export function applySavedView(view) {
  const multiSort = Array.isArray(view.sort) ? view.sort : [];
  const first = multiSort[0];
  return {
    filterSpec: normalizeApplied(view.filter_spec),
    groupBy: view.group_by || 'none',
    multiSort,
    sortConfig: first ? { field: first.field, direction: first.dir === 'desc' ? 'desc' : 'asc' }
                      : { field: null, direction: 'asc' },
  };
}
