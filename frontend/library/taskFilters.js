/**
 * taskFilters.js — TaskList·BoardView 공유 필터 predicate.
 * 핵심 수정: unassigned(selectedUserIds.has(0)) 필터가 예전엔 early-return true로
 * 나머지 필터를 우회했다. 이제 userMatch 불리언으로 잡고 나머지 검사를 계속한다.
 */
export function matchesFilters(task, { searchQuery, selectedUserIds, filters }) {
  if (searchQuery && !(task.title || '').toLowerCase().includes(searchQuery.toLowerCase())) return false;

  if (selectedUserIds.size > 0) {
    const taskUserIds = (task.assignees || []).map((a) => a.user_id);
    const userMatch =
      (selectedUserIds.has(0) && taskUserIds.length === 0) ||
      taskUserIds.some((uid) => selectedUserIds.has(uid));
    if (!userMatch) return false;
  }

  if (filters.priorities.size > 0 && !filters.priorities.has(task.priority)) return false;

  if (filters.labelIds.size > 0) {
    const taskLabelIds = (task.labels || []).map((l) => l.label_id);
    if (!taskLabelIds.some((id) => filters.labelIds.has(id))) return false;
  }

  if (filters.epicIds.size > 0 && !filters.epicIds.has(task.epic_id)) return false;
  if (filters.typeKeys.size > 0 && !filters.typeKeys.has(task.task_type)) return false;
  if (filters.statusKeys.size > 0 && !filters.statusKeys.has(task.status)) return false;

  return true;
}
