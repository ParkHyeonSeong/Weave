/**
 * Epic 선택 옵션 필터 — 완료된 epic은 새 배정 대상에서 제외하되,
 * 현재 소속 epic(currentEpicId, nullish 허용)은 선택값 표시가 깨지지 않도록 유지.
 */
export function selectableEpics(epics, currentEpicId) {
  return (epics || []).filter((ep) => ep.status !== 'done' || ep.epic_id === currentEpicId);
}
