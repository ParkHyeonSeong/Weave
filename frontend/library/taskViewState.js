// frontend/library/taskViewState.js
const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };
// 스칼라(단일 버킷) 그룹 키.
const KEY = {
  status: (t) => t.status, priority: (t) => t.priority, task_type: (t) => t.task_type,
  epic: (t) => t.epic_id, sprint: (t) => t.sprint_id,
};
// 다중값 그룹핑: 한 태스크가 여러 버킷에 들어갈 수 있는 필드(담당자·라벨). 추출은 여기서만 한다.
// 값이 없으면 단일 null 버킷으로(스칼라 KEY 경로와 동일한 '(없음)' 처리). user_id/label_id 중복 제거.
const MULTI_KEY = {
  assignee: (t) => ((t.assignees && t.assignees.length) ? [...new Set(t.assignees.map((a) => a.user_id))] : [null]),
  label: (t) => ((t.labels && t.labels.length) ? [...new Set(t.labels.map((l) => l.label_id))] : [null]),
};
export function groupTasks(tasks, groupBy) {
  if (!groupBy || groupBy === 'none' || !(KEY[groupBy] || MULTI_KEY[groupBy])) return [{ key: null, label: 'All', tasks: tasks || [] }];
  const buckets = new Map();
  const multi = MULTI_KEY[groupBy];
  for (const t of tasks || []) {
    // 담당자/라벨은 모든 값의 버킷에 넣는다(두 담당자면 두 레인 모두에 등장).
    // 그 외 필드는 기존 단일 스칼라 KEY 경로를 유지한다.
    const keys = multi ? multi(t) : [KEY[groupBy](t)];
    for (const k of keys) {
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(t);
    }
  }
  return [...buckets.entries()].map(([key, ts]) => ({ key, label: String(key), tasks: ts }));
}
function val(t, field) {
  if (field === 'priority') return PRIORITY_RANK[t.priority] ?? 99;
  if (field === 'due_date') return t.due_date;
  if (field === 'created' || field === 'created_at') return t.created_at;
  return t[field];
}
export function applySort(tasks, sort) {
  const arr = [...(tasks || [])];
  const keys = sort && sort.length ? sort : [];
  arr.sort((a, b) => {
    for (const s of keys) {
      const dir = s.dir === 'desc' ? -1 : 1;
      const av = val(a, s.field); const bv = val(b, s.field);
      if (av == null && bv == null) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
    }
    return a.task_id - b.task_id;
  });
  return arr;
}
