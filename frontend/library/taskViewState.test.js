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
  it('assignee: task with two assignees appears in both buckets', () => {
    const at = [
      { task_id: 10, assignees: [{ user_id: 1 }, { user_id: 2 }] },
      { task_id: 11, assignees: [{ user_id: 1 }] },
      { task_id: 12, assignees: [] },
    ];
    const g = groupTasks(at, 'assignee');
    expect(g.find((x) => x.key === 1).tasks.map((t) => t.task_id).sort()).toEqual([10, 11]);
    expect(g.find((x) => x.key === 2).tasks.map((t) => t.task_id)).toEqual([10]);
    expect(g.find((x) => x.key === null).tasks.map((t) => t.task_id)).toEqual([12]);
  });
  it('label: task with two labels appears in both buckets, none → single null bucket', () => {
    const lt = [
      { task_id: 20, labels: [{ label_id: 5 }, { label_id: 6 }] },
      { task_id: 21, labels: [] },
    ];
    const g = groupTasks(lt, 'label');
    expect(g.find((x) => x.key === 5).tasks.map((t) => t.task_id)).toEqual([20]);
    expect(g.find((x) => x.key === 6).tasks.map((t) => t.task_id)).toEqual([20]);
    expect(g.find((x) => x.key === null).tasks.map((t) => t.task_id)).toEqual([21]);
  });
});
describe('applySort', () => {
  it('priority asc urgent first', () => expect(applySort(tasks, [{ field: 'priority', dir: 'asc' }])[0].task_id).toBe(2));
  it('due asc nulls last', () => { const r = applySort(tasks, [{ field: 'due_date', dir: 'asc' }]); expect(r[r.length - 1].task_id).toBe(3); });
});
