// 하위태스크 진행도/펼침 순수 헬퍼. React 의존 없음 → vitest(node)로 단위 테스트.
// progress 형태는 백엔드 계약과 동일: { done: <int>, total: <int> }.

export function progressLabel(progress) {
  if (!progress || !progress.total) return '';
  return `${progress.done}/${progress.total}`;
}

export function progressPercent(progress) {
  if (!progress || !progress.total) return 0;
  const pct = (progress.done / progress.total) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export function isParentExpanded(expandedSet, taskId) {
  return !!expandedSet && expandedSet.has(taskId);
}
