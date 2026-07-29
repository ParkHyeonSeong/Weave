// BulkAdd 모달의 Branch 선택 전이 판정 — 순수 함수(컴포넌트 밖에서 테스트 가능).
//
// 배경: Branch를 바꾸면 Epic/Sprint 목록은 그 branch 것으로 다시 받아야 하므로 초기화한다.
// 그런데 재조회 effect는 branchId 변화에만 반응한다. 같은 branch를 다시 고를 때도 초기화를
// 태우면 목록만 비워지고 재조회가 영영 일어나지 않아 드롭다운이 영구 공란이 된다
// (branch가 1개인 워크스페이스는 자동 선택되므로 다른 값으로 바꿔 복구할 수도 없다).
// 따라서 "값이 실제로 바뀌었는가"를 여기서 한 번만 판정한다.
//
// CustomSelect는 value를 문자열로 돌려줄 수 있어 숫자 비교 전에 정규화한다.

export function toBranchId(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// changed=false면 호출부는 아무 상태도 건드리지 않는다(초기화 금지).
export function resolveBranchChange(current, raw) {
  const branchId = toBranchId(raw);
  return { changed: branchId !== toBranchId(current), branchId };
}
