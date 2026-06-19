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

/**
 * filterTaskTree — 필터 활성 시 부모/하위 트리에 필터를 적용한다.
 * 부모가 불일치여도 하위가 하나라도 일치하면 부모를 "컨텍스트 행"으로 남기고
 * (isContextOnly=true) 일치한 하위만 visibleSubtasks 에 담는다.
 * 부모·하위 모두 불일치면 행 전체를 제거한다.
 * 호출 측에서 필터 비활성 시에는 호출하지 않는다(원본 배열 그대로 사용).
 * 주의: task.subtasks 원본은 보존하고 visibleSubtasks 파생 필드만 추가한다.
 */
export function filterTaskTree(tasks, ctx) {
  return (tasks || []).reduce((acc, task) => {
    const parentMatch = matchesFilters(task, ctx);
    const matchedSubs = (task.subtasks || []).filter((sub) => matchesFilters(sub, ctx));
    if (!parentMatch && matchedSubs.length === 0) return acc;
    acc.push({ ...task, visibleSubtasks: matchedSubs, isContextOnly: !parentMatch });
    return acc;
  }, []);
}

/**
 * countMatchedTasks — 섹션 배지에 표시할 "자동으로 화면에 드러나는 매칭 항목 수".
 * autoExpandedParents 가 컨텍스트 부모(직접 불일치)만 자동 펼치는 동작에 정확히 맞춘다:
 *   - 직접 매칭 부모(isContextOnly=false): 그 자체가 결과이므로 1.
 *     (하위는 autoExpand 대상이 아니라 접혀 있으므로 세지 않음 — 기존 "부모 행 수" 모델 유지)
 *   - 컨텍스트 부모(isContextOnly=true): 자기 자신은 결과가 아니고, autoExpand 로 펼쳐진
 *     매칭 하위(visibleSubtasks)가 결과이므로 그 수만큼.
 * 이렇게 하면 "부모 done + done 하위(접힘)" 케이스에서 배지(1)와 화면 행 수(1)가 일치한다.
 * 필터 비활성 원본 배열(플래그 미부여)에서는 각 항목이 1 → length 와 동일(기존 동작 보존).
 */
export function countMatchedTasks(filteredTasks) {
  return (filteredTasks || []).reduce(
    (n, t) => n + (t.isContextOnly ? (t.visibleSubtasks?.length || 0) : 1),
    0,
  );
}
