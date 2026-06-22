// frontend/library/taskViewState.js
const PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };
const KEY = {
  status: (t) => t.status, priority: (t) => t.priority, task_type: (t) => t.task_type,
  epic: (t) => t.epic_id, sprint: (t) => t.sprint_id,
  assignee: (t) => (t.assignees && t.assignees[0] ? t.assignees[0].user_id : null),
  label: (t) => (t.labels && t.labels[0] ? t.labels[0].label_id : null),
};
export function groupTasks(tasks, groupBy) {
  if (!groupBy || groupBy === 'none' || !KEY[groupBy]) return [{ key: null, label: 'All', tasks: tasks || [] }];
  const buckets = new Map();
  for (const t of tasks || []) {
    const k = KEY[groupBy](t);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(t);
  }
  return [...buckets.entries()].map(([key, ts]) => ({ key, label: String(key), tasks: ts }));
}
function val(t, field) {
  if (field === 'priority') return PRIORITY_RANK[t.priority] ?? 99;
  if (field === 'due_date') return t.due_date;
  if (field === 'created' || field === 'created_at') return t.created_at;
  if (field === 'status') return t.sort_order;  // null/undefined는 applySort의 nulls-last 분기로(백엔드 NULLS LAST 정합)
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
