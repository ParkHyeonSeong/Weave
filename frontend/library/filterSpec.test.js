// frontend/library/filterSpec.test.js
import { describe, it, expect } from 'vitest';
import { evaluate } from './filterSpec';

const CTX = { userId: 7, today: '2026-06-22' };
const g = (c, op = 'AND', negate = false) => ({ type: 'group', op, negate, children: c });
const c = (field, op, value = null, negate = false) => ({ type: 'cond', field, op, value, negate });
const task = { status: 'todo', priority: 'high', epic_id: 5, sprint_id: null, parent_task_id: null,
  due_date: '2026-06-25', title: 'Fix login', description: '<p>bug</p>',
  assignees: [{ user_id: 7 }], labels: [{ label_id: 3 }], custom_fields: { '12': 'red' } };

describe('evaluate', () => {
  it('empty true', () => expect(evaluate(task, g([]), CTX)).toBe(true));
  it('null true', () => expect(evaluate(task, null, CTX)).toBe(true));
  it('eq', () => expect(evaluate(task, g([c('priority', 'eq', 'high')]), CTX)).toBe(true));
  it('negate', () => expect(evaluate(task, g([c('priority', 'eq', 'high', true)]), CTX)).toBe(false));
  it('or', () => expect(evaluate(task, g([c('priority', 'eq', 'low'), c('status', 'eq', 'todo')], 'OR'), CTX)).toBe(true));
  it('label in', () => expect(evaluate(task, g([c('label', 'in', [3])]), CTX)).toBe(true));
  it('assignee me', () => expect(evaluate(task, g([c('assignee', 'eq', '$me')]), CTX)).toBe(true));
  it('due relative', () => expect(evaluate(task, g([c('due_date', 'lt', '$today+7d')]), CTX)).toBe(true));
  it('text strips html', () => expect(evaluate(task, g([c('text', 'contains', 'bug')]), CTX)).toBe(true));
  it('sprint empty', () => expect(evaluate(task, g([c('sprint', 'is_empty')]), CTX)).toBe(true));
  it('cf eq', () => expect(evaluate(task, g([c('cf:12', 'eq', 'red')]), CTX)).toBe(true));
});
