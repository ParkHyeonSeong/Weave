// frontend/library/taskViewState.test.js
import { describe, it, expect } from 'vitest';
import { groupTasks, applySort } from './taskViewState';
const tasks = [
  { task_id: 1, status: 'todo', priority: 'low', due_date: '2026-06-30' },
  { task_id: 2, status: 'done', priority: 'urgent', due_date: '2026-06-20' },
  { task_id: 3, status: 'todo', priority: 'high', due_date: null },
];
describe('groupTasks', () => {
  it('null → single', () => { const g = groupTasks(tasks, 'none'); expect(g).toHaveLength(1); expect(g[0].tasks).toHaveLength(3); });
  it('by status', () => { const g = groupTasks(tasks, 'status'); expect(g.find((x) => x.key === 'todo').tasks.map((t) => t.task_id).sort()).toEqual([1, 3]); });
});
describe('applySort', () => {
  it('priority asc urgent first', () => expect(applySort(tasks, [{ field: 'priority', dir: 'asc' }])[0].task_id).toBe(2));
  it('due asc nulls last', () => { const r = applySort(tasks, [{ field: 'due_date', dir: 'asc' }]); expect(r[r.length - 1].task_id).toBe(3); });
});
